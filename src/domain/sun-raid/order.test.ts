import assert from 'node:assert/strict';
import test from 'node:test';

import { appendSunBattleLog, migrateSunBattleLog, SUN_BATTLE_LOG_LIMIT, sunBattleAverageLevel, sunBattleRows, sunExperience, expectedSunDefence, type SunBattleLogEntry, type SunBattleSide } from './battle-log.ts';
import {
  BALANCED_SUN_MIX,
  buildSunOrderFromMix,
  hullValuePerPopulation,
  migrateSunRaidOrder,
  orderPopulation,
  padSunOrder,
  placeSunPledge,
  sunOrderFill,
  sunOrderRoomFor,
  validateSunRaidOrder,
  type SunRaidOrder,
} from './order.ts';

const T = 112_500;

function order(slots: SunRaidOrder['slots']): SunRaidOrder {
  return { version: 1, preset: 'custom', slots };
}

test('an order must fill the side cap within the launch tolerance, never more, with races of the alliance only', () => {
  const full = padSunOrder(order([{ kind: 'ship', factionId: 'aegis', entityId: 'battleship', count: 5000 }]), ['aegis'], T);
  assert.ok(orderPopulation(full) <= T && orderPopulation(full) >= T - 100, `padded to ${orderPopulation(full)}`);
  assert.equal(validateSunRaidOrder(full, { perSide: T, races: ['aegis'] }), null);
  assert.match(validateSunRaidOrder(full, { perSide: T, races: ['synod'] }) ?? '', /раса/);
  assert.match(validateSunRaidOrder(order([{ kind: 'ship', factionId: 'aegis', entityId: 'battleship', count: 100 }]), { perSide: T, races: ['aegis'] }) ?? '', /полным лимитом/);
  assert.match(validateSunRaidOrder(order([{ kind: 'any', population: T + 1 }]), { perSide: T, races: ['aegis'] }) ?? '', /больше лимита/);
  assert.match(validateSunRaidOrder(order([{ kind: 'ship', factionId: 'aegis', entityId: 'spy-probe' as never, count: 10 }, { kind: 'any', population: T - 10 }]), { perSide: T, races: ['aegis'] }) ?? '', /не летит/);
});

test('a pledge fills its own slot first, the rest goes to «любые», anything else and low levels are refused', () => {
  const plan = order([
    { kind: 'ship', factionId: 'aegis', entityId: 'battleship', count: 100, minLevel: 5 },
    { kind: 'ship', factionId: 'veyra', entityId: 'destroyer', count: 10 },
    { kind: 'any', population: 1000, minLevel: 3 },
  ]);
  const placed = placeSunPledge(plan, new Map(), { factionId: 'aegis', ships: { battleship: 120 }, levels: { battleship: 6 } });
  assert.equal(placed.refused, 0);
  assert.equal(placed.fill.get('aegis:battleship'), 100);
  assert.equal(placed.fill.get('any'), 20 * 15, 'the 20 over the slot take 300 of the «любые» room');
  const junk = placeSunPledge(plan, placed.fill, { factionId: 'aegis', ships: { scout: 10 }, levels: { scout: 0 } });
  assert.equal(junk.refused, 20, 'level-0 scouts fit no slot');
  assert.deepEqual(junk.refusedIds, ['scout']);
  const lowLevel = placeSunPledge(plan, new Map(), { factionId: 'aegis', ships: { battleship: 1 }, levels: { battleship: 2 } });
  assert.equal(lowLevel.refused, 15, 'below the slot\'s level and the «любые» bar');
  const wrongRace = placeSunPledge(plan, new Map(), { factionId: 'synod', ships: { destroyer: 1 }, levels: { destroyer: 9 } });
  assert.equal(wrongRace.fill.get('veyra:destroyer'), undefined, 'a slot is race + hull');
  assert.equal(wrongRace.fill.get('any'), 28);

  const fill = sunOrderFill(plan, [
    { factionId: 'aegis', ships: { battleship: 60 }, levels: { battleship: 9 } },
    { factionId: 'veyra', ships: { destroyer: 10 }, levels: {} },
  ]);
  const room = sunOrderRoomFor(plan, fill, 'aegis', { battleship: 9 });
  assert.deepEqual(room.perEntity, { battleship: 40 });
  assert.equal(room.anyPopulation, 1000);
  assert.deepEqual(sunOrderRoomFor(plan, fill, 'aegis', { battleship: 2 }).perEntity, {}, 'a low-level owner sees the slot closed');
});

test('presets: balanced over two races, exactly the cap; stored orders survive migration, garbage does not', () => {
  const built = buildSunOrderFromMix(BALANCED_SUN_MIX, ['veyra', 'aegis'], T, [{ factionId: 'aegis', entityId: 'battleship', count: 3000, level: 8 }], 'balanced')!;
  assert.ok(built);
  assert.equal(validateSunRaidOrder(built, { perSide: T, races: ['aegis', 'veyra'] }), null);
  const battleships = built.slots.filter((slot) => slot.kind === 'ship' && slot.entityId === 'battleship');
  assert.deepEqual(battleships.map((slot) => slot.kind === 'ship' ? slot.factionId : ''), ['aegis'], 'battleships go to the race that has them');
  assert.deepEqual(migrateSunRaidOrder(JSON.parse(JSON.stringify(built))), built);
  assert.equal(migrateSunRaidOrder({ slots: [{ kind: 'ship', factionId: 'zerg', entityId: 'battleship', count: 3 }] }), undefined);
  assert.equal(migrateSunRaidOrder(null), undefined);
  assert.deepEqual(buildSunOrderFromMix(BALANCED_SUN_MIX, ['veyra'], T, [], 'balanced'), buildSunOrderFromMix(BALANCED_SUN_MIX, ['veyra'], T, [], 'balanced'), 'deterministic');
});

test('hull value per population counts the level: a level-10 hull outweighs the same hull at level 0', () => {
  assert.ok(hullValuePerPopulation('aegis', 'destroyer', 10) > 2 * hullValuePerPopulation('aegis', 'destroyer', 0));
  assert.ok(hullValuePerPopulation('veyra', 'scout', 0) < hullValuePerPopulation('aegis', 'battleship', 0));
});

function side(rows: SunBattleSide['rows']): SunBattleSide {
  return { rows, owners: 1, groups: 1, population: rows.reduce((sum, row) => sum + row.p, 0), lost: 0, bonuses: [] };
}

function entry(id: string, winner: SunBattleLogEntry['winner'], attack: SunBattleSide['rows'], defence: SunBattleSide['rows']): SunBattleLogEntry {
  return { id, at: 1, g: 1, s: 5, allianceId: 'a', tag: 'TAG', ordered: true, winner, rounds: 6, attack: side(attack), defence: side(defence) };
}

test('battle log: bounded, migrated, and its experience prefers the hulls that won against a like defence; a draw is its own outcome', () => {
  const defence = [{ f: 'synod' as const, e: 'battleship' as const, l: 10, n: 100, p: 1300 }];
  const won = entry('r1', 'attacker', [{ f: 'aegis', e: 'death-star', l: 10, n: 10, p: 7000 }], defence);
  const lost = entry('r2', 'defender', [{ f: 'veyra', e: 'scout', l: 0, n: 7000, p: 7000 }], defence);
  const draw = entry('r3', 'draw', [{ f: 'aegis', e: 'cruiser', l: 5, n: 1000, p: 7000 }], defence);
  const experience = sunExperience([won, lost, draw], expectedSunDefence([won, lost, draw], 1, 5));
  assert.equal(experience.battles, 3);
  assert.equal(experience.multipliers['death-star'], 1.25);
  assert.equal(experience.multipliers.scout, 0.75);
  assert.ok(experience.multipliers.cruiser! < 1 && experience.multipliers.cruiser! > 0.75, 'a draw is not a win');
  assert.deepEqual(sunExperience([won, lost, draw], expectedSunDefence([won, lost, draw], 1, 5)), experience, 'deterministic');
  assert.deepEqual(sunExperience([won], { bomber: 1 }).multipliers, {}, 'an unlike defence teaches nothing');

  let log: SunBattleLogEntry[] = [];
  for (let index = 0; index < SUN_BATTLE_LOG_LIMIT + 7; index += 1) log = appendSunBattleLog(log, { ...won, id: `r${index}` });
  assert.equal(log.length, SUN_BATTLE_LOG_LIMIT);
  assert.equal(log[0]!.id, 'r7');
  assert.deepEqual(migrateSunBattleLog(JSON.parse(JSON.stringify(log))), log);
  assert.deepEqual(migrateSunBattleLog([{ id: 'x' }, 5, null]), []);
  assert.equal(migrateSunBattleLog([draw])[0]!.winner, 'draw');

  const rows = sunBattleRows([{ factionId: 'aegis', ships: { battleship: 10, scout: 0 }, levels: { battleship: 8 } }, { factionId: 'aegis', ships: { battleship: 5 }, levels: { battleship: 8 } }]);
  assert.deepEqual(rows, [{ f: 'aegis', e: 'battleship', l: 8, n: 15, p: 225 }]);
  assert.equal(sunBattleAverageLevel(rows), 8);
});
