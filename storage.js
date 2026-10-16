'use strict';
// Local data storage for AI Creative OS.
// Pure Node module (no Electron imports) so it can be tested with `npm test`.
// Rules:
//  - Never silently replace a damaged database with seed data.
//  - Always keep a copy of the current database before a risky change
//    (migration, restore/import, and at most once per hour during normal saves).
//  - Write atomically: temp file first, then rename over the real file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CURRENT_SCHEMA = 2;
const DB_FILE = 'creative-os.json';
const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const AUTO_BACKUP_KEEP = 30;
const ALLOWED_CATEGORIES = ['Winner', 'Potential', 'Underperform', ''];
const PROJECT_FIELDS = ['id', 'title', 'brand', 'angle', 'format', 'formula', 'hook', 'character', 'channel', 'category', 'notes', 'avoid', 'script', 'factors', 'ratings', 'createdAt', 'reviewedAt', 'video', 'reviewHistory', 'scriptVersions', 'targetAudience', 'cta', 'duration', 'finalLink', 'publishDate', 'feedbackRules'];

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function safeProject(p) {
  const o = {};
  for (const k of PROJECT_FIELDS) if (p && Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
  if (!ALLOWED_CATEGORIES.includes(o.category)) o.category = '';
  o.id = String(o.id || crypto.randomUUID());
  return o;
}

function isValidDb(d) {
  return !!d && typeof d === 'object' && Array.isArray(d.projects);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createStore({ dir, seed = [], log = () => {} }) {
  const dbPath = path.join(dir, DB_FILE);
  const backupDir = path.join(dir, 'backups');
  const migrationDir = path.join(dir, 'migration-backups');
  const state = { readOnly: false, recoveredFrom: null, error: null };

  function writeAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }

  function listBackups() {
    const out = [];
    for (const d of [backupDir, migrationDir]) {
      if (!fs.existsSync(d)) continue;
      for (const name of fs.readdirSync(d)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(d, name);
        out.push({ file, name, mtimeMs: fs.statSync(file).mtimeMs });
      }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  // Copy the current database file (as-is) into backups/. Returns the path or null.
  function backupNow(reason = 'manual') {
    if (!fs.existsSync(dbPath)) return null;
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `${reason}-${stamp()}-${crypto.randomBytes(2).toString('hex')}.json`);
    fs.copyFileSync(dbPath, file);
    log('info', `Backup dibuat (${reason}): ${file}`);
    return file;
  }

  function pruneAutoBackups() {
    if (!fs.existsSync(backupDir)) return;
    const autos = fs.readdirSync(backupDir).filter(n => n.startsWith('auto-') && n.endsWith('.json'))
      .map(n => ({ file: path.join(backupDir, n), mtimeMs: fs.statSync(path.join(backupDir, n)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const old of autos.slice(AUTO_BACKUP_KEEP)) fs.unlinkSync(old.file);
  }

  function autoBackupIfDue(now = Date.now()) {
    if (!fs.existsSync(dbPath)) return null;
    const latestAuto = listBackups().find(b => b.name.startsWith('auto-'));
    if (latestAuto && now - latestAuto.mtimeMs < AUTO_BACKUP_INTERVAL_MS) return null;
    const file = backupNow('auto');
    pruneAutoBackups();
    return file;
  }

  function freshDb() {
    return { schemaVersion: CURRENT_SCHEMA, version: 1, projects: seed.map(p => ({ ...p })), insights: [], preferences: { brand: 'NOVIA' }, migrationHistory: [] };
  }

  // v0.2 (no schemaVersion) -> schema 2. Backup is written and verified first.
  function migrate() {
    if (!fs.existsSync(dbPath)) return { migrated: false };
    const original = fs.readFileSync(dbPath, 'utf8');
    let data;
    try { data = JSON.parse(original); } catch { return { migrated: false, skipped: 'invalid-json' }; }
    if (!isValidDb(data) || (data.schemaVersion || 1) >= CURRENT_SCHEMA) return { migrated: false };
    fs.mkdirSync(migrationDir, { recursive: true });
    const backup = path.join(migrationDir, `creative-os-v0.2-before-v0.3-${stamp()}.json`);
    fs.writeFileSync(backup, original, { flag: 'wx' });
    if (readJson(backup).projects.length !== data.projects.length) throw new Error('Validasi backup migrasi gagal; data asli tidak diubah.');
    const migrated = { ...data, schemaVersion: CURRENT_SCHEMA, migrationHistory: [...(data.migrationHistory || []), { to: CURRENT_SCHEMA, date: new Date().toISOString(), backup }] };
    writeAtomic(dbPath, migrated);
    log('info', `Migrasi ke schema ${CURRENT_SCHEMA} selesai. Backup: ${backup}`);
    return { migrated: true, backup };
  }

  function load() {
    state.readOnly = false; state.error = null;
    if (!fs.existsSync(dbPath)) {
      // A leftover .tmp means a write was interrupted before rename; it may be the newest data.
      const tmp = dbPath + '.tmp';
      if (fs.existsSync(tmp)) {
        try { const d = readJson(tmp); if (isValidDb(d)) { fs.renameSync(tmp, dbPath); log('warn', 'Database dipulihkan dari file sementara (.tmp).'); return d; } } catch { /* fall through */ }
      }
      const db = freshDb();
      writeAtomic(dbPath, db);
      log('info', 'Database baru dibuat dengan data awal.');
      return db;
    }
    try {
      const d = readJson(dbPath);
      if (!isValidDb(d)) throw new Error('struktur projects tidak ditemukan');
      return d;
    } catch (e) {
      // Damaged database: keep a copy, then try the newest valid backup. Never fall back to seed silently.
      const quarantine = path.join(dir, `creative-os.damaged-${stamp()}.json`);
      fs.copyFileSync(dbPath, quarantine);
      log('error', `Database rusak (${e.message}). Salinan disimpan: ${quarantine}`);
      for (const b of listBackups()) {
        try {
          const d = readJson(b.file);
          if (!isValidDb(d)) continue;
          writeAtomic(dbPath, d);
          state.recoveredFrom = b.file;
          log('warn', `Database dipulihkan dari backup: ${b.file}`);
          return d;
        } catch { /* try next backup */ }
      }
      state.readOnly = true;
      state.error = `Database rusak dan tidak ada backup yang valid. File asli disalin ke ${quarantine}. Penyimpanan dikunci agar tidak menimpa data.`;
      throw new Error(state.error);
    }
  }

  function save(db) {
    if (state.readOnly) throw new Error('Penyimpanan dikunci karena database rusak. ' + (state.error || ''));
    if (!isValidDb(db)) throw new Error('Data tidak valid: projects harus berupa daftar.');
    const clean = { ...db, schemaVersion: db.schemaVersion || CURRENT_SCHEMA, projects: db.projects.map(safeProject) };
    autoBackupIfDue();
    writeAtomic(dbPath, clean);
    return true;
  }

  // Replace the database with a backup file. The current data is backed up first.
  function importFrom(file) {
    const imported = readJson(file);
    if (!isValidDb(imported)) throw new Error('File backup tidak valid: tidak ada daftar projects.');
    const before = backupNow('before-restore');
    const clean = { ...imported, schemaVersion: imported.schemaVersion || CURRENT_SCHEMA, projects: imported.projects.map(safeProject) };
    state.readOnly = false; state.error = null;
    writeAtomic(dbPath, clean);
    log('info', `Restore dari ${file}. Data sebelumnya: ${before || '(tidak ada)'}`);
    return clean;
  }

  function exportTo(file) {
    if (!fs.existsSync(dbPath)) throw new Error('Belum ada data untuk dibackup.');
    fs.copyFileSync(dbPath, file);
    return true;
  }

  return { dbPath, backupDir, migrationDir, state, load, save, migrate, backupNow, listBackups, autoBackupIfDue, importFrom, exportTo };
}

module.exports = { createStore, safeProject, CURRENT_SCHEMA, AUTO_BACKUP_KEEP, AUTO_BACKUP_INTERVAL_MS };
