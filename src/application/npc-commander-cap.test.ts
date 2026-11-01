// One command ship of each kind on a planet. The factory and loading a save
// always kept the rule; landing did not, so a catch-up reloaded between slices
// parted from the uninterrupted one at the first second ship of a kind.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { resolveSavedFleetState } from '../domain/fleet/runtime.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';
import type { SaveState } from './contracts.ts';
import { reconcileFlights } from './flights.ts';
import { dispatchNpcDeployment, dispatchNpcMission, npcCommandersAtPlanet } from './npc-missions.ts';
import { createInitialSaveState } from './persistence.ts';

const START = Date.UTC(2026, 9, 27, 12);
const MINUTE = 60_000;
const SCIENCE = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 15]));

/** One owner with two planets, each with the same command ship; a weak neighbour. */
function world(): { state: SaveState; owner: string; home: string; colony: string; other: string } {
  const base = createDefaultNewGameConfig({ seed: 'npc-commander-cap', factionId: 'aegis', playerName: 'Cap' });
  const state = createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 4, campaignSpeed: 'standard' as const } });
  const all = Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc').sort((left, right) => left.id.localeCompare(right.id));
  const [homePlanet, colony, other] = [all[0]!, all[1]!, all[2]!];
  const owner = homePlanet.ownerId;
  const targets = { ...getEspionageTargets(state.espionage) };
  for (const planet of [homePlanet, colony]) {
    targets[planet.id] = { ...planet, ownerId: owner, ownerName: homePlanet.ownerName, raceId: 'aegis',
      ownerProfile: { scienceLevels: SCIENCE, shipLevels: {}, commanderLevels: {} } as SpyTargetState['ownerProfile'],
      resources: { ...planet.resources, gas: 10_000_000 }, buildings: { ...planet.buildings, hangar: 60 },
      fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, cruiser: 20 }, commanders: { ...planet.fleet.commanders, executioner: 1 } } } as SpyTargetState;
  }
  return { state: withAttackEligiblePoints({ ...state, espionage: { ...state.espionage!, targets } }, [owner, other.ownerId], 2_000_000),
    owner, home: homePlanet.id, colony: colony.id, other: other.id };
}

const planet = (state: SaveState, id: string) => getEspionageTargets(state.espionage)[id]!;
const setCommander = (state: SaveState, id: string, count: number): SaveState => {
  const target = planet(state, id);
  return { ...state, espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [id]: { ...target,
    fleet: { ...target.fleet, commanders: { ...target.fleet.commanders, executioner: count } } } } } };
};

function settle(start: SaveState, until: (state: SaveState) => boolean): SaveState {
  let state = start;
  for (let at = START + MINUTE; at < START + 30 * 24 * 60 * MINUTE && !until(state); at += 5 * MINUTE) {
    state = reconcileFlights(state, at, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  }
  assert.ok(until(state), 'the flight must land');
  return state;
}

const assertSameAfterLoad = (state: SaveState, id: string) => {
  const fleet = planet(state, id).fleet;
  assert.deepEqual(resolveSavedFleetState(JSON.parse(JSON.stringify(fleet)), 'aegis').commanders, fleet.commanders, 'a reload changes nothing');
};

test('a deployment landing on a planet that has the command ship leaves one, as a reload would', () => {
  const { state, owner, home, colony } = world();
  const sent = dispatchNpcDeployment(state, { requestId: 'cap:deploy', ownerId: owner, originPlanetId: home, destinationPlanetId: colony,
    selectedShips: { cruiser: 2 }, selectedCommanders: { executioner: 1 } }, START, 1);
  assert.ok(sent.ok, sent.reason ?? '');
  const landed = settle(sent.state, (current) => current.flights.records.find((flight) => flight.id === sent.flight!.id)?.phase === 'completed');
  assert.equal(planet(landed, colony).fleet.commanders.executioner, 1);
  assert.equal(planet(landed, colony).fleet.ships.cruiser, 22, 'the ships still arrive');
  assertSameAfterLoad(landed, colony);
});

test('a command ship coming home to a planet that built another leaves one, as a reload would', () => {
  const { state, owner, home, other } = world();
  const target = planet(state, other);
  const sent = dispatchNpcMission(state, { ownerId: owner, originPlanetId: home, requestId: 'cap:attack', missionId: 'attack', selectedShips: { cruiser: 20 },
    selectedCommanders: { executioner: 1 }, destination: { kind: 'planet', planetId: other, coordinate: { ...target.coordinate } }, targetPlanetId: other }, START, 1);
  assert.ok(sent.ok, sent.reason ?? '');
  assert.equal(planet(sent.state, home).fleet.commanders.executioner, 0, 'away, it leaves the roster');
  const landed = settle(setCommander(sent.state, home, 1), (current) => current.flights.records.find((flight) => flight.id === sent.flight!.id)?.phase === 'completed');
  assert.equal(planet(landed, home).fleet.commanders.executioner, 1);
  assertSameAfterLoad(landed, home);
});

test('a command ship away from its planet or deployed to it counts as there: the owner neither builds nor sends a second', () => {
  const { state, owner, home, colony, other } = world();
  const free = setCommander(state, colony, 0);
  assert.equal(npcCommandersAtPlanet(free, owner, planet(free, colony)).has('executioner'), false);
  assert.equal(npcCommandersAtPlanet(free, owner, planet(free, home)).has('executioner'), true, 'on the planet');
  const deployed = dispatchNpcDeployment(free, { requestId: 'cap:bound', ownerId: owner, originPlanetId: home, destinationPlanetId: colony,
    selectedShips: { cruiser: 1 }, selectedCommanders: { executioner: 1 } }, START, 1);
  assert.ok(deployed.ok, deployed.reason ?? '');
  assert.equal(planet(deployed.state, home).fleet.commanders.executioner, 0);
  assert.equal(npcCommandersAtPlanet(deployed.state, owner, planet(deployed.state, colony)).has('executioner'), true, 'on its way here');
  assert.equal(npcCommandersAtPlanet(deployed.state, owner, planet(deployed.state, home)).has('executioner'), true, 'flown from here until it lands');
  assert.equal(npcCommandersAtPlanet(deployed.state, owner, planet(deployed.state, other)).has('executioner'), false);
});
