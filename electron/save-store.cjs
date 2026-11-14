// Large saves on disk (see src/application/save-storage.ts): a late campaign
// outgrows localStorage, so the renderer keeps a pointer there and the text
// here, one file per key and write id, in <userData>/saves. Synchronous IPC
// keeps the game's Storage interface synchronous.
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { readPersonaFile, writePersonaFile } = require('./persona-file.cjs');
const { createLatestWinsQueue } = require('./write-queue.cjs');

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

// Older versions stay until the renderer points at the new one. The pointer lives in the
// window, which moves it a moment after a file lands, so the main process cannot know which
// file it still references. A file is therefore dropped only when it is both beyond the
// `keep` newest others and older than STALE_GRACE_MS (audit 13.11: three quick writes used to
// delete the file the pointer still named). More than MAX_OTHERS older files are dropped
// regardless of age, so a burst cannot fill the disk.
const STALE_GRACE_MS = 2 * 60 * 1000;
const MAX_OTHERS = 6;

/** Which of `entries` ({ name, at }) may be deleted after `targetName` was written. Pure. */
function staleVersionsToDrop(entries, targetName, keep = 1, now = Date.now()) {
  const others = entries.filter((entry) => entry.name !== targetName).sort((left, right) => right.at - left.at);
  return others.slice(keep)
    .filter((entry, index) => now - entry.at >= STALE_GRACE_MS || keep + index >= MAX_OTHERS)
    .map((entry) => entry.name);
}

function dropStaleVersions(key, target, keep = 1) {
  const entries = filesOf(key).map((name) => ({ name, at: fs.statSync(path.join(savesDir(), name)).mtimeMs }));
  for (const name of staleVersionsToDrop(entries, path.basename(target), keep)) fs.rmSync(path.join(savesDir(), name), { force: true });
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

// Files of a campaign no slot lists any more (a deleted slot, a crash between
// the file and the index): its saves and bot journal. Only slot keys, only
// files untouched for an hour, so a campaign being created right now is safe.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const SLOT_FILE = /^(asterion\.(?:slot\.slot-[a-z0-9-]{1,40}\.v1|vertical-slice\.v1))(?:\.backup-[a-z0-9]{1,16})?\.(?:[a-z0-9-]{1,40}\.save\.json|bots\.jsonl)$/;

function pruneOrphanFiles(keep, now = Date.now()) {
  const kept = new Set(keep);
  const removed = [];
  for (const name of fs.readdirSync(savesDir())) {
    const match = SLOT_FILE.exec(name);
    if (!match || kept.has(match[1])) continue;
    const file = path.join(savesDir(), name);
    if (now - fs.statSync(file).mtimeMs < ORPHAN_MIN_AGE_MS) continue;
    fs.rmSync(file, { force: true });
    removed.push(name);
  }
  return removed;
}

// A write cut short by a crash leaves `<file>.tmp` (50-500 MB each): swept at start when older than an hour.
function sweepStaleTemporaryFiles(dir, now = Date.now()) {
  const removed = [];
  let names = [];
  try { dir = dir || savesDir(); names = fs.readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    if (!name.endsWith('.tmp')) continue;
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      fs.rmSync(file, { force: true });
      removed.push(name);
    } catch { /* busy or gone: next start */ }
  }
  return removed;
}

// Reads the save file a pointer names (the cloud upload, from the main process).
function readSaveFile(key, writeId) {
  if (!KEY.test(key) || !WRITE_ID.test(writeId)) throw new Error('Invalid save key.');
  return fs.promises.readFile(fileFor(key, writeId), 'utf8');
}
function readSaveFileSync(key, writeId) {
  if (!KEY.test(key) || !WRITE_ID.test(writeId)) throw new Error('Invalid save key.');
  return fs.readFileSync(fileFor(key, writeId), 'utf8');
}

// The live world worker's saves: UTF-8 bytes through a MessagePort, written exactly as they arrive
// (the same bytes the text write would make). Processed in order; answered on the same port.
// Three versions are kept, not two: the window moves its pointer a moment after the file lands.
async function writeFromPort(port, message) {
  const reply = { ok: false, version: message && message.version, writeId: message && message.writeId, chars: message && message.chars };
  try {
    const { key, writeId, bytes } = message || {};
    if (!KEY.test(key) || !WRITE_ID.test(writeId)) throw new Error('Invalid save write.');
    const data = ArrayBuffer.isView(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : (bytes instanceof ArrayBuffer ? Buffer.from(bytes) : null);
    if (!data) throw new Error('Invalid save bytes.');
    const target = fileFor(key, writeId);
    const temporary = `${target}.tmp`;
    await fs.promises.writeFile(temporary, data);
    await fs.promises.rename(temporary, target);
    dropStaleVersions(key, target, 2);
    reply.ok = true;
  } catch (error) {
    reply.error = String(error && error.message || error);
  }
  try { port.postMessage(reply); } catch { /* the worker is gone */ }
}

function registerSaveStore() {
  sweepStaleTemporaryFiles();
  ipcMain.on('asterion:save-store:port', (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    // One write in flight, only the newest waits: a slow disk cannot pile up 50-500 MB buffers.
    // A write replaced by a newer one is answered `skipped`; the newer one becomes the save.
    const queue = createLatestWinsQueue(
      (message) => writeFromPort(port, message),
      (message) => {
        try { port.postMessage({ ok: true, skipped: true, version: message && message.version, writeId: message && message.writeId, chars: message && message.chars }); } catch { /* the worker is gone */ }
      },
    );
    port.on('message', (portEvent) => queue.push(portEvent.data));
    port.start();
  });
  ipcMain.on('asterion:save-store:prune', (event, keep) => {
    try {
      if (!Array.isArray(keep) || !keep.length || !keep.every((key) => typeof key === 'string' && KEY.test(key))) throw new Error('Invalid prune request.');
      event.returnValue = { ok: true, removed: pruneOrphanFiles(keep).length };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
  // The series registry: read and written only at the boundaries of a campaign.
  ipcMain.on('asterion:personas:read', (event) => {
    try {
      event.returnValue = { ok: true, ...readPersonaFile(app.getPath('userData')) };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
  ipcMain.on('asterion:personas:write', (event, text) => {
    try {
      if (typeof text !== 'string') throw new Error('Invalid persona registry.');
      writePersonaFile(app.getPath('userData'), text);
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
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
  ipcMain.on('asterion:save-store:remove', (event, key, savesOnly) => {
    try {
      if (!KEY.test(key)) throw new Error('Invalid save key.');
      for (const name of filesOf(key)) fs.rmSync(path.join(savesDir(), name), { force: true });
      if (savesOnly !== true) fs.rmSync(botJournalFile(key), { force: true });
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });
}

module.exports = { staleVersionsToDrop, STALE_GRACE_MS, registerSaveStore, pruneOrphanFiles, sweepStaleTemporaryFiles, readSaveFile, readSaveFileSync };
