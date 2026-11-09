import assert from 'node:assert/strict';
import test from 'node:test';

import { selectOwnerMembership } from '../domain/command/selectors.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { sunRaidCapsOf } from '../domain/sun-raid/config.ts';
import { padSunOrder, type SunRaidOrder } from '../domain/sun-raid/order.ts';
import { replacePlanetState, type SaveState } from './contracts.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { reconcileRuntime } from './reconcile.ts';
import {
  allianceSunRaces,
  currentSunRaidState,
  joinSunRaid,
  launchSunRaid,
  previewSunLaunch,
  selectPlayerOrderRoom,
  selectRaidOrderFill,
  sendSunSupport,
  testBot01RaidSun,
  testLaunchRaidNow,
} from './sun-raid.ts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 9, 12);
const options = (now: number) => ({ now, mode: 'test' as const, testTimeScale: 1 as const });

function armed(state: SaveState, ships: Partial<Record<ShipId, number>>): SaveState {
  const planet = state.planets['helion-01']!;
  return replacePlanetState(state, 'helion-01', {
    ...planet,
    buildings: { ...planet.buildings, hangar: Math.max(planet.buildings.hangar ?? 0, 40) },
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, ...ships } },
  });
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) assert.fail(`expected ok: ${JSON.stringify((result as { error?: unknown }).error)}`);
  return result as Extract<T, { ok: true }>;
}

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

test('the launcher\'s order: only alliance races, only ordered hulls join, slots fill, and the order survives a reload', () => {
  let state = armed(createInitialSaveState('test', T0), { cruiser: 400, battleship: 300, destroyer: 50, scout: 100 });
  const race = state.profile.factionId;
  const allianceId = selectOwnerMembership(state.command, state.profile.playerId)!.alliance.id;
  const races = allianceSunRaces(state, allianceId);
  assert.ok(races.includes(race), `the player's race is the alliance's (${races.join(',')})`);
  const { perSide } = sunRaidCapsOf(state);
  const order: SunRaidOrder = padSunOrder({ version: 1, preset: 'custom', slots: [
    { kind: 'ship', factionId: race, entityId: 'battleship', count: 200 },
    { kind: 'ship', factionId: race, entityId: 'cruiser', count: 300 },
  ] }, [race], perSide);
  // The pad adds the smallest hull of the race: scouts. The player sends none of them.
  const foreign = races.length < 3 ? (['aegis', 'synod', 'veyra'] as const).find((item) => !races.includes(item))! : null;
  if (foreign) {
    const wrong: SunRaidOrder = { ...order, slots: [...order.slots, { kind: 'ship', factionId: foreign, entityId: 'battleship', count: 1 }] };
    assert.match(previewSunLaunch(state, { kind: 'attack', galaxy: 1, system: 20, originPlanetId: 'helion-01', ships: { battleship: 100 }, order: wrong }, options(T0)).error ?? '', /раса|лимита/);
  }
  const refused = previewSunLaunch(state, { kind: 'attack', galaxy: 1, system: 20, originPlanetId: 'helion-01', ships: { destroyer: 10 }, order }, options(T0));
  assert.match(refused.error ?? '', /Заказ рейда не принимает/);
  state = ok(launchSunRaid(state, { galaxy: 1, system: 20, originPlanetId: 'helion-01', ships: { battleship: 120 }, requestId: 'ordered-1', order }, options(T0))).state;
  const raid = currentSunRaidState(state).raids[0]!;
  assert.deepEqual(raid.order?.slots, order.slots, 'the raid keeps its order');
  assert.equal(selectRaidOrderFill(state, raid).get(`${race}:battleship`), 120);
  assert.equal(selectPlayerOrderRoom(state, raid)?.perEntity.battleship, 80);

  const destroyers = joinSunRaid(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { destroyer: 5 }, requestId: 'join-destroyers' }, options(T0 + 60_000));
  assert.equal(destroyers.ok, false, 'a hull outside the order stays home');
  state = ok(joinSunRaid(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { cruiser: 300 }, requestId: 'join-cruisers' }, options(T0 + 60_000))).state;
  state = ok(joinSunRaid(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { battleship: 80 }, requestId: 'join-battleships' }, options(T0 + 60_000))).state;
  const overfill = joinSunRaid(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { battleship: 1 }, requestId: 'join-over' }, options(T0 + 60_000));
  assert.equal(overfill.ok, false, 'a full slot takes nothing more');

  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'test', storage, now: () => T0 + 2 * 60_000, testTimeScale: 1 });
  assert.equal(facade.write(state).ok, true);
  const reloaded = facade.read();
  const again = currentSunRaidState(reloaded).raids[0]!;
  assert.deepEqual(again.order, raid.order);
  assert.deepEqual([...selectRaidOrderFill(reloaded, again)], [...selectRaidOrderFill(state, again)]);
});

test('every Sun battle leaves a compact log entry (both sides, levels, rounds, outcome, losses) that a reload keeps', () => {
  let state = armed(createInitialSaveState('test', T0), { cruiser: 400, battleship: 120 });
  state = ok(testBot01RaidSun(state, 1, 1, options(T0))).state;
  const raid = currentSunRaidState(state).raids[0]!;
  state = ok(sendSunSupport(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { cruiser: 400, battleship: 120 }, requestId: 'support-1' }, options(T0 + HOUR))).state;
  const resolved = reconcileRuntime(state, { planetId: state.currentPlanetId, now: T0 + 3 * HOUR + 1, mode: 'test', testTimeScale: 1 }).state;
  const log = currentSunRaidState(resolved).battleLog ?? [];
  assert.equal(log.length, 1);
  const entry = log[0]!;
  assert.equal(entry.id, raid.id);
  assert.equal(entry.winner, currentSunRaidState(resolved).raids[0]!.result!.winner, 'a draw stays a draw');
  assert.ok(entry.rounds >= 1 && entry.rounds <= 12);
  assert.ok(entry.attack.rows.length > 0 && entry.defence.rows.length > 0);
  assert.deepEqual(entry.defence.rows.map((row) => row.e).sort(), ['battleship', 'cruiser']);
  assert.equal(entry.defence.owners, 1);
  assert.ok(entry.attack.lost + entry.defence.lost > 0);
  assert.equal(entry.ordered, false, 'a raid without an order says so');

  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'test', storage, now: () => T0 + 4 * HOUR, testTimeScale: 1 });
  assert.equal(facade.write(resolved).ok, true);
  assert.deepEqual(currentSunRaidState(facade.read()).battleLog, log);
});

test('a raid of an old save (no order) still accepts any combat hull', () => {
  let state = armed(createInitialSaveState('test', T0), { cruiser: 400, destroyer: 10 });
  state = ok(launchSunRaid(state, { galaxy: 1, system: 20, originPlanetId: 'helion-01', ships: { cruiser: 100 }, requestId: 'legacy-1' }, options(T0))).state;
  const raid = currentSunRaidState(state).raids[0]!;
  assert.equal(raid.order, undefined);
  assert.equal(selectPlayerOrderRoom(state, raid), null);
  state = ok(joinSunRaid(state, { raidId: raid.id, originPlanetId: 'helion-01', ships: { destroyer: 10 }, requestId: 'legacy-join' }, options(T0 + 1000))).state;
  assert.equal(ok(testLaunchRaidNow(state, raid.id, options(T0 + 2000))).state.flights.records.filter((flight) => flight.missionId === 'sun-attack').length, 2);
});
