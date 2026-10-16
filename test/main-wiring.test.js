'use strict';
// Runs main.js against a fake Electron to check startup and IPC wiring
// (the real Electron app is tested on Windows / GitHub Actions).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function bootMain({ appData, gotLock = true }) {
  const handlers = {}, dialogs = [], paths = { appData };
  const fakeElectron = {
    app: {
      getPath: k => paths[k], setPath: (k, v) => { paths[k] = v; },
      getVersion: () => '0.3.0', isPackaged: false,
      requestSingleInstanceLock: () => gotLock, quit: () => { fakeElectron.app.quitCalled = true; },
      on: () => {}, whenReady: () => Promise.resolve(),
    },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    dialog: { showErrorBox: (t, m) => dialogs.push(['error', t, m]), showMessageBox: o => { dialogs.push(['message', o.title]); return Promise.resolve({}); } },
    shell: { openPath: () => '' },
    BrowserWindow: class { constructor() { this.webContents = { once() {}, send() {}, setWindowOpenHandler() {}, on() {} }; } loadFile() {} isDestroyed() { return false; } },
  };
  const fakeUpdater = { autoUpdater: { on() {}, checkForUpdates: async () => {} } };
  const origLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === 'electron') return fakeElectron;
    if (req === 'electron-updater') return fakeUpdater;
    return origLoad.call(this, req, parent, isMain);
  };
  const mainPath = require.resolve('../main.js');
  delete require.cache[mainPath];
  try { require(mainPath); } finally { Module._load = origLoad; }
  return new Promise(r => setImmediate(() => r({ handlers, dialogs, paths, app: fakeElectron.app })));
}

test('startup uses %APPDATA%\\ai-creative-os-desktop and seeds 5 Winner', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
  const { handlers, paths } = await bootMain({ appData });
  assert.strictEqual(paths.userData, path.join(appData, 'ai-creative-os-desktop'));
  const db = await handlers['db:load']();
  assert.deepStrictEqual(db.projects.map(p => p.id), ['APR016', 'MEI013', 'MEI016', 'JULI020', 'SEPT010']);
  assert.ok(db.projects.every(p => p.category === 'Winner'));
  assert.ok(fs.existsSync(path.join(paths.userData, 'logs', 'main.log')), 'log file written');
});

test('IPC save then restart keeps user data', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
  let { handlers } = await bootMain({ appData });
  const db = await handlers['db:load']();
  db.projects.unshift({ id: 'CR-NEW', title: 'Baru', category: '', reviewedAt: 'x' });
  assert.strictEqual(await handlers['db:save'](null, db), true);
  ({ handlers } = await bootMain({ appData }));
  const again = await handlers['db:load']();
  assert.strictEqual(again.projects.length, 6);
  assert.strictEqual(again.projects[0].reviewedAt, 'x');
});

test('v0.2 data on disk is migrated at startup with a backup', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
  const userData = path.join(appData, 'ai-creative-os-desktop');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'creative-os.json'), JSON.stringify({ version: 1, projects: [{ id: 'OLD', category: 'Potential' }] }));
  const { handlers } = await bootMain({ appData });
  const db = await handlers['db:load']();
  assert.strictEqual(db.schemaVersion, 2);
  assert.strictEqual(db.projects[0].category, 'Potential');
  assert.strictEqual(fs.readdirSync(path.join(userData, 'migration-backups')).length, 1);
});

test('corrupt database at startup: user is warned, saving blocked', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
  const userData = path.join(appData, 'ai-creative-os-desktop');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'creative-os.json'), '{broken');
  const { handlers, dialogs } = await bootMain({ appData });
  assert.ok(dialogs.some(d => d[1] === 'Data tidak bisa dibuka'));
  await assert.rejects(async () => handlers['db:load'](), /rusak/);
  await assert.rejects(async () => handlers['db:save'](null, { projects: [] }), /dikunci/);
  assert.strictEqual(fs.readFileSync(path.join(userData, 'creative-os.json'), 'utf8'), '{broken');
});

test('second instance does not register handlers or touch data', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
  const { handlers, app } = await bootMain({ appData, gotLock: false });
  assert.ok(app.quitCalled);
  assert.strictEqual(Object.keys(handlers).length, 0);
});

test('updater in dev mode reports not active instead of failing', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
  const { handlers } = await bootMain({ appData });
  const s = await handlers['update:check']();
  assert.strictEqual(s.status, 'dev');
});
