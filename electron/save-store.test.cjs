const test = require('node:test');
const assert = require('node:assert/strict');
const { staleVersionsToDrop, STALE_GRACE_MS, sweepStaleTemporaryFiles } = require('./save-store.cjs');

const NOW = 1_000_000_000;
const file = (name, agoMs) => ({ name, at: NOW - agoMs });

test('three quick writes keep every file the window may still point at', () => {
  const entries = [file('target', 0), file('b', 15_000), file('c', 30_000), file('d', 45_000)];
  assert.deepEqual(staleVersionsToDrop(entries, 'target', 2, NOW), [], 'd is the pointer file until the window moves it: it is young');
});

test('files beyond the newest ones go once they are old enough', () => {
  const entries = [file('target', 0), file('b', 60_000), file('c', 3 * 60_000), file('d', 10 * 60_000)];
  assert.deepEqual(staleVersionsToDrop(entries, 'target', 2, NOW).sort(), ['d'], 'only d is both beyond the newest two and past the grace time');
  assert.ok(3 * 60_000 >= STALE_GRACE_MS);
});

test('the file just written is never dropped', () => {
  assert.deepEqual(staleVersionsToDrop([file('target', 10 * 60_000), file('b', 20 * 60_000), file('c', 30 * 60_000)], 'target', 1, NOW), ['c']);
});

test('a burst of young files cannot grow without limit', () => {
  const entries = [file('target', 0), ...Array.from({ length: 10 }, (_, index) => file(`f${index}`, (index + 1) * 1000))];
  const dropped = staleVersionsToDrop(entries, 'target', 2, NOW);
  assert.equal(entries.length - 1 - dropped.length, 6, 'at most six older files stay');
  assert.ok(!dropped.includes('f0') && !dropped.includes('f5'), 'the newest stay');
});

test('leftover .tmp files older than an hour are swept at start, young ones and saves stay', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-sweep-'));
  const saves = path.join(dir, 'saves');
  fs.mkdirSync(saves);
  const old = path.join(saves, 'asterion.slot.slot-a.v1.w1.save.json.tmp');
  const young = path.join(saves, 'asterion.slot.slot-a.v1.w2.save.json.tmp');
  const save = path.join(saves, 'asterion.slot.slot-a.v1.w3.save.json');
  for (const file of [old, young, save]) fs.writeFileSync(file, 'x');
  const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(old, longAgo, longAgo);
  fs.utimesSync(save, longAgo, longAgo);
  try {
    const removed = sweepStaleTemporaryFiles(saves);
    assert.deepEqual(removed, ['asterion.slot.slot-a.v1.w1.save.json.tmp']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
