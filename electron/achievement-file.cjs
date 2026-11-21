// Profile-global achievement chronicle: a small versioned JSON file outside
// campaign saves, with one recoverable backup beside it.
const fs = require('fs');
const path = require('path');

const FILE = 'achievements.v1.json';
const BACKUP = 'achievements.v1.backup.json';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Keep the Electron boundary aligned with parseAchievementChronicle() so a
// syntactically valid but malformed v1 file never replaces a good backup.
function parseChronicle(text) {
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: 'invalid' }; }
  if (!isRecord(value) || typeof value.version !== 'number') return { ok: false, reason: 'invalid' };
  if (value.version > 1) return { ok: false, reason: 'newer' };
  const earned = Array.isArray(value.earned) && value.earned.every((entry) => isRecord(entry)
    && typeof entry.id === 'string' && entry.id.length > 0 && Number.isFinite(entry.at)
    && (entry.campaignId === undefined || typeof entry.campaignId === 'string')
    && (entry.roundId === undefined || typeof entry.roundId === 'string'));
  const purchases = Array.isArray(value.purchases) && value.purchases.every((entry) => isRecord(entry)
    && typeof entry.lookId === 'string' && entry.lookId.length > 0
    && typeof entry.price === 'number' && Number.isFinite(entry.price) && entry.price >= 0
    && typeof entry.at === 'number' && Number.isFinite(entry.at));
  const counters = isRecord(value.counters)
    && Object.values(value.counters).every((count) => Number.isSafeInteger(count) && count >= 0);
  if (value.version !== 1 || !earned || !purchases || !counters || !Array.isArray(value.rounds)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, chronicle: value };
}

function writeAtomic(file, text) {
  const temporary = `${file}.tmp`;
  const handle = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(handle, text, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, file);
}

function readAchievementFile(dir) {
  return { text: readText(path.join(dir, FILE)), backup: readText(path.join(dir, BACKUP)) };
}

/**
 * A valid current file becomes the backup. A corrupt current file is kept
 * aside, and a file from a newer game version is never replaced.
 */
function writeAchievementFile(dir, text) {
  const parsedIncoming = parseChronicle(text);
  if (!parsedIncoming.ok) throw new Error('Invalid achievement chronicle.');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, FILE);
  const lock = path.join(dir, 'achievements.v1.lock');
  let lockHandle;
  try {
    lockHandle = fs.openSync(lock, 'wx');
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    let stale = false;
    try { stale = Date.now() - fs.statSync(lock).mtimeMs > 30_000; } catch { stale = true; }
    if (!stale) throw new Error('Achievement chronicle is being updated by another game instance.');
    try { fs.rmSync(lock, { force: true }); } catch { throw new Error('Achievement chronicle is being updated by another game instance.'); }
    try { lockHandle = fs.openSync(lock, 'wx'); } catch { throw new Error('Achievement chronicle is being updated by another game instance.'); }
  }
  try { fs.writeFileSync(lockHandle, `${process.pid}\n${Date.now()}\n`, 'utf8'); } catch (error) {
    try { fs.closeSync(lockHandle); } catch { /* no open handle remains */ }
    try { fs.rmSync(lock, { force: true }); } catch { /* release best effort */ }
    throw error;
  }
  try {
    const current = readText(target);
    const parsedCurrent = current === null ? null : parseChronicle(current);
    if (parsedCurrent?.reason === 'newer') throw new Error('The achievement chronicle belongs to a newer game version.');
    if (parsedCurrent?.ok) {
      const byId = new Map(parsedCurrent.chronicle.earned.map((record) => [record.id, record]));
      for (const record of parsedIncoming.chronicle.earned) if (!byId.has(record.id)) byId.set(record.id, record);
      // Awards are permanent, global identities. Merge them at the file
      // boundary so a stale second renderer cannot erase another award.
      parsedIncoming.chronicle.earned = [...byId.values()];
      writeAtomic(path.join(dir, BACKUP), current);
    } else if (current !== null) {
      const damaged = path.join(dir, `achievements.v1.damaged-${Date.now()}.json`);
      fs.renameSync(target, damaged);
    }
    writeAtomic(target, JSON.stringify(parsedIncoming.chronicle));
  } finally {
    try { fs.closeSync(lockHandle); } catch { /* already closed */ }
    try { fs.rmSync(lock, { force: true }); } catch { /* next write recovers a stale lock */ }
  }
}

module.exports = { readAchievementFile, writeAchievementFile };
