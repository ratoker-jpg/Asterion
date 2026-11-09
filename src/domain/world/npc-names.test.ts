import assert from 'node:assert/strict';
import test from 'node:test';
import { ALLIANCE_NAME_MAX, ALLIANCE_TAG_MAX, ALLIANCE_TAG_MIN } from '../command/catalog.ts';
import { ALLIANCE_NAME_POOL, pickNpcAllianceName } from '../command/alliance-names.ts';
import { NICKNAME_POOL } from './nickname-pool.ts';
import { gameTermClashes, nameStems, nameWords, sharedNameStems } from './name-stems.ts';
import { COMBAT_FACTIONS, COMBAT_FACTION_IDS } from '../combat/factions.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { COMBAT_CATALOG } from '../combat/catalog.ts';
import { BUILDING_ROLES, getBuildingPresentation } from '../buildings/balance-v1.ts';
import { SOLAR_CRYSTALS } from '../sun-raid/config.ts';
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
  const names = generateNpcNicknames('big-world', 1_000, ['Кракен', 'Morfeus']);
  assert.equal(names.length, 1_000);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, 1_000);
  assert.ok(!names.some((name) => name.toLowerCase() === 'morfeus'));
  for (const name of names) assert.ok(name.length <= NICKNAME_MAX, name);
});

test('alliance name pool is big, unique and fits catalog limits', () => {
  assert.ok(ALLIANCE_NAME_POOL.length >= 120, `pool has ${ALLIANCE_NAME_POOL.length}`);
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
  const picked = pickNpcAllianceName('owner-x', 'Легион', () => false);
  assert.ok(!picked.name.toLowerCase().includes('легион'));
});

test('root check reads Latin, Cyrillic and leetspeak as one spelling', () => {
  assert.deepEqual(nameWords('Kraken'), nameWords('Кракен'));
  assert.deepEqual(nameWords('Kr4ken'), nameWords('Kraken'));
  assert.deepEqual(nameWords('Тёмная_ТеньPro'), ['temnaia', 'ten', 'pro']);
  assert.deepEqual(nameStems('Лорд Ворон'), ['lord', 'voro']);
  assert.equal(sharedNameStems(['Нагибатор', 'Нагибатор Про']).length, 1);
  assert.equal(sharedNameStems(['Ворон', 'Kr0w_Ворон']).length, 1);
  assert.equal(sharedNameStems(['Kraken', 'Кракен']).length, 1);
  assert.deepEqual(sharedNameStems(['Ворон', 'Гранит']), []);
});

test('no two nicks or clan names share a root (owner rule 10.11)', () => {
  assert.deepEqual(sharedNameStems(NICKNAME_POOL), [], 'nicks repeat each other');
  assert.deepEqual(sharedNameStems(ALLIANCE_NAME_POOL.map((item) => item.name)), [], 'clans repeat each other');
  assert.deepEqual(sharedNameStems([...NICKNAME_POOL, ...ALLIANCE_NAME_POOL.map((item) => item.name)]), [], 'a clan repeats a nick');
});

test('nicks and clans are grown-up: no digit tails, xX, caps lock or kid words', () => {
  const kid = /нагиб|nagib|батя|batya|мамк|mamk|пельм|pelm|дед|ded|xx_|_xx|про$|pro$|228|1337|666|007/iu;
  for (const name of [...NICKNAME_POOL, ...ALLIANCE_NAME_POOL.map((item) => item.name)]) {
    assert.doesNotMatch(name, /\d/u, `digits in ${name}`);
    assert.doesNotMatch(name, kid, `kid style in ${name}`);
    const letters = name.replace(/[^\p{L}]/gu, '');
    assert.ok(letters.length < 4 || letters !== letters.toLocaleUpperCase('ru-RU'), `caps lock: ${name}`);
    assert.ok((name.match(/_/g) ?? []).length <= 1, `too many underscores: ${name}`);
  }
});

test('clan tags are never political', () => {
  const banned = new Set(['СВО', 'Z', 'ZV', 'ZOV', 'ЗОВ', 'SS', 'СС', 'НКВД', 'КГБ', 'ФСБ', 'ВДВ', 'ВКС', 'НАТО', 'NATO', 'ОМОН', 'РФ', 'СССР', 'USSR', 'USA', 'UA', 'ВСУ', 'ИГИЛ', 'ISIS', 'КПСС', 'KKK', 'ДНР', 'ЛНР', 'АТО', 'ЧВК']);
  for (const item of ALLIANCE_NAME_POOL) assert.ok(!banned.has(item.tag.toLocaleUpperCase('ru-RU')), item.tag);
});

/** Words a player reads as game objects: races, ships, defence, commanders, buildings of every race, Sun crystals. */
function gameTerms(): string[] {
  const terms = new Set<string>(['Солнце', 'Врата', 'Кристалл']);
  for (const faction of COMBAT_FACTIONS) terms.add(faction.name);
  for (const factionId of COMBAT_FACTION_IDS) {
    for (const entity of [...getFactionShipCatalog(factionId), ...getFactionDefenseCatalog(factionId)]) terms.add(entity.name);
    for (const role of BUILDING_ROLES) terms.add(getBuildingPresentation(role, factionId).name);
  }
  for (const entity of COMBAT_CATALOG) terms.add(entity.name);
  for (const crystal of Object.values(SOLAR_CRYSTALS)) {
    terms.add(crystal.name);
    terms.add(crystal.short);
  }
  return [...terms];
}

test('no nick or clan name looks like a race, ship, building or other game term', () => {
  const terms = gameTerms();
  assert.ok(terms.length > 100, `only ${terms.length} game terms found`);
  assert.deepEqual(gameTermClashes(NICKNAME_POOL, terms), [], 'a nick reads as a game term');
  assert.deepEqual(gameTermClashes(ALLIANCE_NAME_POOL.map((item) => item.name), terms), [], 'a clan reads as a game term');
});

test('game term check catches roots, transcriptions and longer terms', () => {
  const terms = ['Джаггернаут', 'Вайпер', 'Врата', 'Металлическая шахта I', 'Рой'];
  assert.deepEqual(gameTermClashes(['Juggernaut', 'Viper', 'Тайные Врата', 'Шахта', 'Металлическая Шахта', 'Рой', 'Гранит'], terms), [
    'Juggernaut ← Джаггернаут', 'Viper ← Вайпер', 'Тайные Врата ← Врата', 'Металлическая Шахта ← Металлическая шахта I', 'Рой ← Рой',
  ]);
});
