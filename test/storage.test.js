'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, AUTO_BACKUP_KEEP } = require('../storage');

const WINNERS = ['APR016', 'MEI013', 'MEI016', 'JULI020', 'SEPT010'].map(id => ({ id, title: id, brand: 'NOVIA', category: 'Winner' }));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cos-'));
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

test('fresh install: seed saved with schema 2, 5 Winner present', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  const db = s.load();
  assert.strictEqual(db.schemaVersion, 2);
  assert.deepStrictEqual(db.projects.map(p => p.category), Array(5).fill('Winner'));
  assert.ok(fs.existsSync(s.dbPath), 'database file written on first start');
  assert.deepStrictEqual(s.migrate(), { migrated: false }, 'fresh db does not need migration');
});

test('save/load round trip keeps reviewedAt, review history and script versions', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  const db = s.load();
  Object.assign(db.projects[0], { reviewedAt: '2026-10-16T01:00:00Z', reviewHistory: [{ category: 'Winner', notes: 'x' }], scriptVersions: [{ script: 'v1' }], category: 'Winner' });
  s.save(db);
  const again = createStore({ dir, seed: [] }).load();
  assert.strictEqual(again.projects[0].reviewedAt, '2026-10-16T01:00:00Z');
  assert.strictEqual(again.projects[0].reviewHistory.length, 1);
  assert.strictEqual(again.projects[0].scriptVersions[0].script, 'v1');
});

test('invalid category from renderer is cleared, not saved', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  const db = s.load();
  db.projects[1].category = 'AutoWinnerByAI';
  s.save(db);
  assert.strictEqual(createStore({ dir }).load().projects[1].category, '');
});

test('v0.2 upgrade: backup first, labels and reviews unchanged', () => {
  const dir = tmpDir();
  const v02 = { version: 1, projects: [...WINNERS, { id: 'CR-1', title: 'Old', category: 'Underperform', notes: 'hook lambat', avoid: true }], insights: [] };
  fs.writeFileSync(path.join(dir, 'creative-os.json'), JSON.stringify(v02));
  const s = createStore({ dir });
  const r = s.migrate();
  assert.ok(r.migrated && fs.existsSync(r.backup));
  assert.deepStrictEqual(read(r.backup), v02, 'backup equals original byte content');
  const db = s.load();
  assert.strictEqual(db.schemaVersion, 2);
  assert.strictEqual(db.projects.filter(p => p.category === 'Winner').length, 5);
  assert.strictEqual(db.projects[5].notes, 'hook lambat');
  assert.deepStrictEqual(s.migrate(), { migrated: false }, 'migration runs only once');
});

test('damaged database: never replaced by seed; recovers from newest backup', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  const db = s.load();
  db.projects.push({ id: 'CR-REAL', title: 'Data asli user', category: 'Potential' });
  s.save(db);
  s.backupNow('manual');
  fs.writeFileSync(s.dbPath, '{ rusak');
  const s2 = createStore({ dir, seed: WINNERS });
  const loaded = s2.load();
  assert.ok(loaded.projects.some(p => p.id === 'CR-REAL'), 'user project recovered');
  assert.ok(s2.state.recoveredFrom);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('creative-os.damaged-')), 'damaged copy kept');
});

test('damaged database without backup: load fails and saving is locked', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'creative-os.json'), 'not json');
  const s = createStore({ dir, seed: WINNERS });
  assert.throws(() => s.load(), /rusak/);
  assert.throws(() => s.save({ projects: WINNERS }), /dikunci/);
  assert.strictEqual(fs.readFileSync(s.dbPath, 'utf8'), 'not json', 'original bytes untouched');
});

test('interrupted write: leftover .tmp is recovered instead of seeding', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'creative-os.json.tmp'), JSON.stringify({ schemaVersion: 2, projects: [{ id: 'CR-TMP' }] }));
  const db = createStore({ dir, seed: WINNERS }).load();
  assert.deepStrictEqual(db.projects.map(p => p.id), ['CR-TMP']);
});

test('restore: current data backed up before being replaced', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  s.load();
  const backupFile = path.join(dir, 'external.json');
  fs.writeFileSync(backupFile, JSON.stringify({ projects: [{ id: 'X', category: 'Winner' }] }));
  const restored = s.importFrom(backupFile);
  assert.deepStrictEqual(restored.projects.map(p => p.id), ['X']);
  const before = s.listBackups().find(b => b.name.startsWith('before-restore-'));
  assert.ok(before, 'pre-restore backup exists');
  assert.strictEqual(read(before.file).projects.length, 5, 'pre-restore backup holds the 5 Winners');
  assert.throws(() => s.importFrom(path.join(dir, 'creative-os.json.missing')));
});

test('restore rejects invalid backup and leaves data intact', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  s.load();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ hello: 1 }));
  assert.throws(() => s.importFrom(bad), /tidak valid/);
  assert.strictEqual(s.load().projects.length, 5);
});

test('export writes a restorable copy', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  s.load();
  const out = path.join(dir, 'export.json');
  s.exportTo(out);
  const s2 = createStore({ dir: tmpDir() });
  s2.load();
  assert.strictEqual(s2.importFrom(out).projects.length, 5);
});

test('auto backup: at most once per hour, old ones pruned', () => {
  const dir = tmpDir();
  const s = createStore({ dir, seed: WINNERS });
  const db = s.load();
  s.save(db); s.save(db); s.save(db);
  const autos = () => s.listBackups().filter(b => b.name.startsWith('auto-'));
  assert.strictEqual(autos().length, 1, 'only one auto backup within the hour');
  for (let i = 0; i < AUTO_BACKUP_KEEP + 5; i++) {
    const old = Date.now() - (i + 2) * 3600e3;
    for (const b of autos()) fs.utimesSync(b.file, old / 1000, old / 1000);
    s.autoBackupIfDue();
  }
  assert.ok(autos().length <= AUTO_BACKUP_KEEP, `pruned to ${AUTO_BACKUP_KEEP}`);
});
