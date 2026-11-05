import assert from 'node:assert/strict';
import test from 'node:test';

import { TEST_ALLY_OWNER_ID } from '../domain/command/catalog.ts';
import { combatBaseEntityId, combatGroupTag, type ShipId } from '../domain/combat/ids.ts';
import { replacePlanetState, type SaveState } from './contracts.ts';
import { createInitialSaveState } from './persistence.ts';
import { reconcileRuntime } from './reconcile.ts';
import { currentSunRaidState, launchSunRaid, testBot01DefendSun, testIraJoinRaid, testLaunchRaidNow } from './sun-raid.ts';

/**
 * Owner report 05.11: three owners of three races (Астера, Лар, Рой) send fleets to one
 * Sun raid, but only one race fought. Every owner's ships must fight as their own race,
 * and the losses must fall on their own flights.
 */

const T0 = Date.UTC(2026, 9, 1, 12);
const options = (now: number) => ({ now, mode: 'test' as const, testTimeScale: 1 as const });
const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) assert.fail(`expected ok: ${JSON.stringify((result as { error?: unknown }).error)}`);
  return result as Extract<T, { ok: true }>;
};

function threeRaceRaid() {
  let state: SaveState = createInitialSaveState('test', T0);
  const planet = state.planets['helion-01']!;
  state = replacePlanetState(state, 'helion-01', {
    ...planet,
    buildings: { ...planet.buildings, hangar: Math.max(planet.buildings.hangar ?? 0, 40) },
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, cruiser: 400, scout: 100 } },
  });
  state = ok(launchSunRaid(state, { galaxy: 1, system: 5, originPlanetId: 'helion-01', ships: { cruiser: 200, scout: 60 }, requestId: 'races' }, options(T0))).state;
  const raidId = currentSunRaidState(state).raids[0]!.id;
  state = ok(testIraJoinRaid(state, raidId, options(T0 + 10))).state;
  // A third owner: a copy of the second fleet under another owner and race.
  const attackers = state.flights.records.filter((flight) => flight.sunRaid?.raidId === raidId && flight.sunRaid.side === 'attacker');
  assert.equal(attackers.length, 2);
  const [mine, ira] = attackers as [typeof attackers[number], typeof attackers[number]];
  const third = {
    ...ira, id: `${ira.id}-third`, requestId: `${ira.requestId}-third`, ownerId: 'third-owner',
    selectedShips: { cruiser: 25, scout: 15 } as Partial<Record<ShipId, number>>,
    sunRaid: { ...ira.sunRaid!, ownerId: 'third-owner', ownerName: 'Третий', factionId: 'veyra' as const,
      technologies: { ...ira.sunRaid!.technologies, laserScience: 10 } },
  };
  state = { ...state, flights: { ...state.flights, records: [...state.flights.records.map((flight) => {
    if (flight.id === mine.id) return { ...flight, sunRaid: { ...flight.sunRaid!, factionId: 'aegis' as const, technologies: { ...flight.sunRaid!.technologies, laserScience: 0 } } };
    if (flight.id === ira.id) return { ...flight, selectedShips: { cruiser: 40, scout: 30 } as Partial<Record<ShipId, number>>, sunRaid: { ...flight.sunRaid!, factionId: 'synod' as const, technologies: { ...flight.sunRaid!.technologies, laserScience: 5 }, shipLevels: { cruiser: 4 } } };
    return flight;
  }), third] } };
  state = ok(testLaunchRaidNow(state, raidId, options(T0 + 15))).state;
  state = ok(testBot01DefendSun(state, raidId, options(T0 + 20))).state;
  return { state, raidId, mineId: mine.id, iraId: ira.id, thirdId: third.id };
}

test('three owners of three races in one Sun raid: every ship fights as its own race and is lost to its own owner', () => {
  const { state: armed, raidId, mineId, iraId, thirdId } = threeRaceRaid();
  const raid = currentSunRaidState(armed).raids[0]!;
  const state = reconcileRuntime(armed, { planetId: armed.currentPlanetId, now: raid.arrivesAt!, mode: 'test', testTimeScale: 1 }).state;
  const result = currentSunRaidState(state).raids.find((item) => item.id === raidId)!.result!;
  const report = state.combat.reports.find((item) => item.id === result.reportId)!;
  const stacks = report.attackerForce.stacks;
  const of = (tag: string | null, id: string) => stacks.find((stack) => combatBaseEntityId(stack.entityId) === id && combatGroupTag(stack.entityId) === tag);
  assert.equal(of(null, 'cruiser')?.countBefore, 200, 'the biggest fleet leads');
  assert.equal(of('g2', 'cruiser')?.factionId, 'synod', 'second owner fights as its own race');
  assert.equal(of('g3', 'cruiser')?.factionId, 'veyra', 'third owner fights as its own race');
  assert.equal(of('g2', 'cruiser')?.countBefore, 40);
  assert.equal(of('g3', 'cruiser')?.countBefore, 25);
  assert.equal(of('g3', 'scout')?.countBefore, 15, 'no ship is dropped');
  assert.equal(of('g2', 'cruiser')?.level, 4, 'ship levels are the owner\'s own');

  // Losses stay with the owner of the destroyed hulls.
  for (const [flightId, tag] of [[mineId, null], [iraId, 'g2'], [thirdId, 'g3']] as const) {
    const flight = state.flights.records.find((item) => item.id === flightId)!;
    const stack = of(tag, 'cruiser')!;
    assert.equal((flight.selectedShips.cruiser ?? 0), stack.countAfter, `${flightId}: survivors equal its own stack`);
  }
});
