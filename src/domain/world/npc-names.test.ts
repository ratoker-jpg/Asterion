import assert from 'node:assert/strict';
import test from 'node:test';
import { ALLIANCE_NAME_MAX, ALLIANCE_TAG_MAX, ALLIANCE_TAG_MIN } from '../command/catalog.ts';
import { ALLIANCE_NAME_POOL, pickNpcAllianceName } from '../command/alliance-names.ts';
import { NICKNAME_POOL } from './nickname-pool.ts';
import { generateNpcNicknames, NICKNAME_MAX } from './nicknames.ts';

test('nickname pool is big, unique and fits the length limit', () => {
  assert.ok(NICKNAME_POOL.length >= 300, `pool has ${NICKNAME_POOL.length}`);
  const keys = NICKNAME_POOL.map((nick) => nick.toLowerCase());
  assert.equal(new Set(keys).size, keys.length, 'duplicate nick in pool');
  for (const nick of NICKNAME_POOL) {
    assert.ok(nick.length >= 3 && nick.length <= NICKNAME_MAX, `bad length: ${nick}`);
    assert.equal(nick, nick.trim());
  }
});

test('nicknames are deterministic from the seed and differ between seeds', () => {
  assert.deepEqual(generateNpcNicknames('seed-a', 100), generateNpcNicknames('seed-a', 100));
  assert.notDeepEqual(generateNpcNicknames('seed-a', 100), generateNpcNicknames('seed-b', 100));
});

test('nicknames are unique inside a world, even past the pool, and skip taken names', () => {
  const names = generateNpcNicknames('big-world', 1_000, ['Нагибатор', 'xx_zloy_xx']);
  assert.equal(names.length, 1_000);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, 1_000);
  assert.ok(!names.some((name) => name.toLowerCase() === 'нагибатор'));
  for (const name of names) assert.ok(name.length <= NICKNAME_MAX, name);
});

test('alliance name pool is big, unique and fits catalog limits', () => {
  assert.ok(ALLIANCE_NAME_POOL.length >= 150, `pool has ${ALLIANCE_NAME_POOL.length}`);
  const names = ALLIANCE_NAME_POOL.map((item) => item.name.toLocaleLowerCase('ru-RU'));
  const tags = ALLIANCE_NAME_POOL.map((item) => item.tag.toLocaleUpperCase('ru-RU'));
  assert.equal(new Set(names).size, names.length, 'duplicate clan name');
  assert.equal(new Set(tags).size, tags.length, 'duplicate clan tag');
  for (const item of ALLIANCE_NAME_POOL) {
    assert.ok(item.name.length >= 3 && item.name.length <= ALLIANCE_NAME_MAX, item.name);
    assert.ok(item.tag.length >= ALLIANCE_TAG_MIN && item.tag.length <= Math.min(5, ALLIANCE_TAG_MAX), item.tag);
    assert.match(item.tag, /^[\p{L}\p{N}]+$/u, item.tag);
  }
});

test('bot alliance names are deterministic, unique and never use the leader nick', () => {
  const taken = new Set<string>();
  const isTaken = (name: string, tag: string) => taken.has(name.toLowerCase()) || taken.has(`#${tag.toUpperCase()}`);
  const nicks = generateNpcNicknames('clans', 400);
  const names: string[] = [];
  nicks.forEach((nick, index) => {
    const again = pickNpcAllianceName(`owner-${index}`, nick, isTaken);
    assert.deepEqual(again, pickNpcAllianceName(`owner-${index}`, nick, isTaken));
    assert.ok(!again.name.toLowerCase().includes(nick.toLowerCase()), `${again.name} contains ${nick}`);
    assert.notEqual(again.tag.toLowerCase(), nick.toLowerCase());
    assert.ok(again.name.length <= ALLIANCE_NAME_MAX && again.tag.length >= ALLIANCE_TAG_MIN && again.tag.length <= ALLIANCE_TAG_MAX);
    taken.add(again.name.toLowerCase());
    taken.add(`#${again.tag.toUpperCase()}`);
    names.push(again.name);
  });
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
});

test('a founder whose nick is a clan word still gets another clan name', () => {
  const picked = pickNpcAllianceName('owner-x', 'Кракен', () => false);
  assert.ok(!picked.name.toLowerCase().includes('кракен'));
});
