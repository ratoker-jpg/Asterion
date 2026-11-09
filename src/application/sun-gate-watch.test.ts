import assert from 'node:assert/strict';
import test from 'node:test';

import type { ShipId } from '../domain/combat/ids.ts';
import type { GateProject } from '../domain/sun-raid/types.ts';
import { replacePlanetState, type SaveState } from './contracts.ts';
import { dispatchFlight } from './flights.ts';
import { createInitialSaveState } from './persistence.ts';
import { sendQuickLegs } from './quick-actions.ts';
import { currentSunRaidState, testBot01RaidSun } from './sun-raid.ts';
import {
  buildSunSupportCommand,
  freeSunCombatShips,
  previewSunDefenceLeg,
  selectDefendableRaids,
  selectGateBeacons,
  sunDefenceRoom,
  sunDefenceSources,
} from './sun-gate-watch.ts';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 12);
const runtime = (now: number) => ({ now, mode: 'test' as const, testTimeScale: 1 as const });

function armed(state: SaveState, ships: Partial<Record<ShipId, number>> = { cruiser: 400, battleship: 120, transporter: 7 }): SaveState {
  const planet = state.planets['helion-01']!;
  return replacePlanetState(state, 'helion-01', {
    ...planet,
    buildings: { ...planet.buildings, hangar: Math.max(planet.buildings.hangar ?? 0, 40) },
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, ...ships } },
  });
}

function raided(): SaveState {
  const result = testBot01RaidSun(armed(createInitialSaveState('test', T0)), 1, 1, runtime(T0));
  assert.ok(result.ok);
  return result.state;
}

test('Gate beacons: public news of every Gate being built, with the host coordinate and side', () => {
  const state = createInitialSaveState('test', T0);
  const sunRaid = currentSunRaidState(state);
  const gate = (id: string, holder: GateProject['holder'], hostPlanetId: string, completesAt: number): GateProject => ({
    id, holder, holderName: id, hostOwnerId: 'x', hostOwnerName: 'X', hostPlanetId, hostPlanetName: 'Тирон',
    startedAt: T0, completesAt, status: 'building', crystals: [], announcedMilestones: [0],
  });
  const withGates: SaveState = { ...state, sunRaid: { ...sunRaid, gates: [
    gate('far', { kind: 'alliance', id: 'rival-alliance' }, 'nowhere-planet', T0 + 4 * HOUR),
    gate('mine', { kind: 'owner', id: state.profile.playerId }, 'helion-01', T0 + 2 * HOUR),
    { ...gate('old', { kind: 'owner', id: 'y' }, 'helion-01', T0), status: 'destroyed' },
  ] } };
  const beacons = selectGateBeacons(withGates, T0 + HOUR);
  assert.deepEqual(beacons.map((beacon) => beacon.gateId), ['mine', 'far'], 'only Gates under construction, soonest first');
  assert.equal(beacons[0]!.side, 'own');
  assert.equal(beacons[1]!.side, 'rival');
  assert.equal(Math.round(beacons[0]!.progress), 50);
  assert.deepEqual(beacons[0]!.coordinate, { galaxy: 1, system: 1, position: state.planets['helion-01']!.universePosition ?? 1 });
  assert.equal(beacons[1]!.coordinate, null, 'a host the map does not know has no coordinate');
});

test('Sun defence: sources list combat hulls only, the leg is the Fleets command and lands in time', () => {
  const state = raided();
  const [raid] = selectDefendableRaids(state, T0 + HOUR);
  assert.ok(raid);
  const sources = sunDefenceSources(state, raid);
  const home = sources.find((source) => source.planetId === 'helion-01')!;
  assert.deepEqual(home.free, freeSunCombatShips(state, 'helion-01'));
  assert.equal(home.free.transporter, undefined, 'civil ships never fly to a Sun');
  assert.ok(home.population > 0);

  const idle = previewSunDefenceLeg(state, raid, 'helion-01', {}, runtime(T0 + HOUR));
  assert.ok(idle.oneWayMs > 0, 'timing is shown before anything is picked');
  assert.equal(idle.population, 0);
  assert.equal(idle.late, false);

  const ships = { cruiser: 100 };
  const leg = previewSunDefenceLeg(state, raid, 'helion-01', ships, runtime(T0 + HOUR));
  assert.equal(leg.error, null);
  assert.ok(leg.marginMs > 0);
  const room = sunDefenceRoom(state, raid);
  assert.equal(room.committed, 0);

  const { state: sent, outcomes } = sendQuickLegs(state, [buildSunSupportCommand(raid, 'helion-01', ships, runtime(T0 + HOUR))], runtime(T0 + HOUR), dispatchFlight);
  assert.ok(outcomes[0]!.result.ok, outcomes[0]!.result.ok ? '' : outcomes[0]!.result.error.message);
  const flight = sent.flights.records.find((item) => item.missionId === 'sun-support')!;
  assert.equal(flight.sunRaid?.raidId, raid.id);
  assert.ok(sunDefenceRoom(sent, raid).committed > 0);
  assert.equal(freeSunCombatShips(sent, 'helion-01').cruiser, 300);
});

test('Sun defence: a fleet that would land after the raid is flagged late and refused', () => {
  const state = raided();
  const [raid] = selectDefendableRaids(state, T0);
  const at = raid!.arrivesAt - 1_000;
  const leg = previewSunDefenceLeg(state, raid!, 'helion-01', { cruiser: 10 }, runtime(at));
  assert.equal(leg.late, true);
  assert.ok(leg.marginMs < 0);
  assert.match(leg.error ?? '', /не успеет/);
});
