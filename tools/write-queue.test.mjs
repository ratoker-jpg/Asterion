import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const { createLatestWinsQueue } = createRequire(import.meta.url)('../electron/write-queue.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('one write in flight, only the newest waits, older waiting writes are skipped', async () => {
  const gates = [];
  const done = [];
  const skipped = [];
  const queue = createLatestWinsQueue(async (message) => {
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    done.push(message);
  }, (message) => skipped.push(message));
  queue.push('a');
  queue.push('b');
  queue.push('c');
  queue.push('d');
  assert.deepEqual(skipped, ['b', 'c'], 'a slow disk never builds a chain of buffers');
  assert.equal(gates.length, 1);
  gates[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 2, 'the newest write starts after the first');
  gates[1].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(done, ['a', 'd']);
  assert.equal(queue.busy, false);
});

test('a failing write does not stop the queue', async () => {
  const done = [];
  const queue = createLatestWinsQueue(async (message) => {
    if (message === 'bad') throw new Error('disk full');
    done.push(message);
  }, () => undefined);
  queue.push('bad');
  queue.push('good');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(done, ['good']);
});
