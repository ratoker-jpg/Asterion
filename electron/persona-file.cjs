// The series registry on disk (src/domain/npc/persona-registry.ts): one small
// versioned JSON file in the game's profile, written atomically, with the
// previous version kept beside it. No Electron here so tests can run it.
const fs = require('fs');
const path = require('path');

const FILE = 'personas.v1.json';
const BACKUP = 'personas.v1.backup.json';
const DAMAGED = 'personas.v1.damaged.json';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function versionOf(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && typeof value.version === 'number' ? value.version : null;
  } catch {
    return null;
  }
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

function readPersonaFile(dir) {
  return { text: readText(path.join(dir, FILE)), backup: readText(path.join(dir, BACKUP)) };
}

/**
 * The current file becomes the backup, unless it cannot be parsed: then it is
 * set aside and the good backup stays. A file of a newer game is never replaced.
 */
function writePersonaFile(dir, text) {
  const incoming = versionOf(text);
  if (incoming === null) throw new Error('Invalid persona registry.');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, FILE);
  const current = readText(target);
  if (current !== null) {
    const version = versionOf(current);
    if (version !== null && version > incoming) throw new Error('The persona registry belongs to a newer game version.');
    if (version === null) fs.renameSync(target, path.join(dir, DAMAGED));
    else writeAtomic(path.join(dir, BACKUP), current);
  }
  writeAtomic(target, text);
}

module.exports = { readPersonaFile, writePersonaFile };
