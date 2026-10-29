// Large saves on disk (see src/application/save-storage.ts): a late campaign
// outgrows localStorage, so the renderer keeps a pointer there and the text
// here, one file per key and write id, in <userData>/saves. Synchronous IPC
// keeps the game's Storage interface synchronous.
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const KEY = /^asterion\.[A-Za-z0-9._-]{1,120}$/;
const WRITE_ID = /^[a-z0-9-]{1,40}$/;

function savesDir() {
  const dir = path.join(app.getPath('userData'), 'saves');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(key, writeId) {
  return path.join(savesDir(), `${key}.${writeId}.save.json`);
}

function filesOf(key) {
  const prefix = `${key}.`;
  return fs.readdirSync(savesDir()).filter((name) => name.startsWith(prefix) && name.endsWith('.save.json')
    && WRITE_ID.test(name.slice(prefix.length, -'.save.json'.length)));
}

function registerSaveStore() {
  ipcMain.on('asterion:save-store:read', (event, key, writeId) => {
    try {
      if (!KEY.test(key) || !WRITE_ID.test(writeId)) throw new Error('Invalid save key.');
      event.returnValue = { ok: true, text: fs.readFileSync(fileFor(key, writeId), 'utf8') };
    } catch (error) {
      event.returnValue = { ok: false, missing: error && error.code === 'ENOENT', error: String(error && error.message || error) };
    }
  });
  ipcMain.on('asterion:save-store:write', (event, key, writeId, text) => {
    try {
      if (!KEY.test(key) || !WRITE_ID.test(writeId) || typeof text !== 'string') throw new Error('Invalid save write.');
      const target = fileFor(key, writeId);
      const temporary = `${target}.tmp`;
      fs.writeFileSync(temporary, text, 'utf8');
      fs.renameSync(temporary, target);
      // Older versions stay until the renderer points at this one; the one
      // before the previous is no longer referenced by anything.
      const others = filesOf(key).filter((name) => name !== path.basename(target))
        .map((name) => ({ name, at: fs.statSync(path.join(savesDir(), name)).mtimeMs }))
        .sort((left, right) => right.at - left.at);
      for (const stale of others.slice(1)) fs.rmSync(path.join(savesDir(), stale.name), { force: true });
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
  ipcMain.on('asterion:save-store:remove', (event, key) => {
    try {
      if (!KEY.test(key)) throw new Error('Invalid save key.');
      for (const name of filesOf(key)) fs.rmSync(path.join(savesDir(), name), { force: true });
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
}

module.exports = { registerSaveStore };
