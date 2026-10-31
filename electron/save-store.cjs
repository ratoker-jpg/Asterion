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

// Older versions stay until the renderer points at the new one; the one
// before the previous is no longer referenced by anything.
function dropStaleVersions(key, target) {
  const others = filesOf(key).filter((name) => name !== path.basename(target))
    .map((name) => ({ name, at: fs.statSync(path.join(savesDir(), name)).mtimeMs }))
    .sort((left, right) => right.at - left.at);
  for (const stale of others.slice(1)) fs.rmSync(path.join(savesDir(), stale.name), { force: true });
}

// Bot journal (src/application/npc-journal.ts): JSON lines next to the save,
// appended as the world runs; the last three game days are kept.
const BOT_JOURNAL_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const botJournalSize = new Map();

function botJournalFile(key) {
  return path.join(savesDir(), `${key}.bots.jsonl`);
}

function pruneBotJournal(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
  const times = lines.map((line) => { try { return JSON.parse(line).t; } catch { return null; } });
  const last = times.reduce((max, t) => (typeof t === 'number' && t > max ? t : max), Number.NEGATIVE_INFINITY);
  const kept = lines.filter((_line, index) => typeof times[index] === 'number' && times[index] >= last - BOT_JOURNAL_KEEP_MS);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
  fs.renameSync(temporary, file);
  return fs.statSync(file).size;
}

function registerSaveStore() {
  ipcMain.handle('asterion:bot-journal:append', async (_event, key, lines) => {
    try {
      if (!KEY.test(key) || typeof lines !== 'string') throw new Error('Invalid bot journal write.');
      const file = botJournalFile(key);
      await fs.promises.appendFile(file, lines, 'utf8');
      const size = fs.statSync(file).size;
      // Pruned whenever it has grown by half since the last prune.
      if (!botJournalSize.has(key)) botJournalSize.set(key, size);
      if (size > 1.5 * botJournalSize.get(key) + 65536) botJournalSize.set(key, pruneBotJournal(file));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  // The server's lines after this file's last game time join it (a world back from the server).
  ipcMain.handle('asterion:bot-journal:merge', async (_event, key, lines) => {
    try {
      if (!KEY.test(key) || typeof lines !== 'string') throw new Error('Invalid bot journal merge.');
      const file = botJournalFile(key);
      const timeOf = (line) => { try { return JSON.parse(line).t; } catch { return null; } };
      const local = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()) : [];
      const last = local.reduce((max, line) => { const t = timeOf(line); return typeof t === 'number' && t > max ? t : max; }, Number.NEGATIVE_INFINITY);
      const added = lines.split('\n').filter((line) => { const t = timeOf(line); return typeof t === 'number' && t > last; });
      if (added.length) fs.appendFileSync(file, `${added.join('\n')}\n`, 'utf8');
      if (fs.existsSync(file)) botJournalSize.set(key, pruneBotJournal(file));
      return { ok: true, added: added.length };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  ipcMain.handle('asterion:bot-journal:read', async (_event, key) => {
    try {
      if (!KEY.test(key)) throw new Error('Invalid bot journal key.');
      const file = botJournalFile(key);
      if (!fs.existsSync(file)) return { ok: true, text: '' };
      botJournalSize.set(key, pruneBotJournal(file));
      return { ok: true, text: await fs.promises.readFile(file, 'utf8') };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
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
      dropStaleVersions(key, target);
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
  ipcMain.handle('asterion:save-store:write-async', async (_event, key, writeId, text) => {
    try {
      if (!KEY.test(key) || !WRITE_ID.test(writeId) || typeof text !== 'string') throw new Error('Invalid save write.');
      const target = fileFor(key, writeId);
      const temporary = `${target}.tmp`;
      await fs.promises.writeFile(temporary, text, 'utf8');
      await fs.promises.rename(temporary, target);
      dropStaleVersions(key, target);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  ipcMain.on('asterion:save-store:remove', (event, key) => {
    try {
      if (!KEY.test(key)) throw new Error('Invalid save key.');
      for (const name of filesOf(key)) fs.rmSync(path.join(savesDir(), name), { force: true });
      fs.rmSync(botJournalFile(key), { force: true });
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
}

module.exports = { registerSaveStore };
