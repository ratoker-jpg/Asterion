import assert from 'node:assert/strict';
import test from 'node:test';
import { describeOwnerPresence, FOREIGN_PRESENCE_ONLINE_GRACE_MS } from './owner-presence.ts';

const NOW = 10 * 24 * 3_600_000;
const MINUTE = 60_000;

test('allies see exact presence', () => {
  assert.equal(describeOwnerPresence({ online: true }, NOW, true).text, 'В сети');
  assert.equal(describeOwnerPresence({ online: false, lastSeenAt: NOW - 25 * MINUTE }, NOW, true).text, 'Был 25 мин назад');
  assert.equal(describeOwnerPresence({ online: false, lastSeenAt: NOW - 5 * 60 * MINUTE }, NOW, true).text, 'Был 5 ч назад');
});

test('others see only a coarse window that hides the logout time', () => {
  const justLeft = describeOwnerPresence({ online: false, lastSeenAt: NOW - FOREIGN_PRESENCE_ONLINE_GRACE_MS + 1 }, NOW, false);
  assert.deepEqual(justLeft, { tone: 'online', text: 'В сети' });
  assert.equal(describeOwnerPresence({ online: false, lastSeenAt: NOW - 25 * MINUTE }, NOW, false).text, 'Был в течение суток');
  assert.equal(describeOwnerPresence({ online: false, lastSeenAt: NOW - 2 * 24 * 60 * MINUTE }, NOW, false).text, 'Был на днях');
  assert.equal(describeOwnerPresence({ online: false, lastSeenAt: NOW - 5 * 24 * 60 * MINUTE }, NOW, false).text, 'Давно не заходил');
  assert.equal(describeOwnerPresence(undefined, NOW, false).text, 'Ещё не заходил');
});
