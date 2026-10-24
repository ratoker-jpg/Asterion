import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import { createDefaultEspionageState, getEspionageTargets } from '../domain/espionage/runtime.ts';
import { createBot01Planets } from '../domain/espionage/fixtures.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { createEmptyDefenseState } from '../domain/fleet/production.ts';
import { createNpcState } from '../domain/npc/state.ts';
import type { SaveState } from './contracts.ts';
import { candidateToNpcMissionCommand, getNpcMissionCandidates } from './npc-mission-policy.ts';

const OWNER = 'npc-policy-owner';
const OTHER_OWNER = 'npc-policy-other';
const ORIGIN_ID = `${OWNER}-origin`;
const TARGET_ID = `${OTHER_OWNER}-target`;
const AT = 10_000;

function target(id: string, ownerId: string, coordinate: SpyTargetState['coordinate'], kind: SpyTargetState['kind']): SpyTargetState {
  const base = Object.values(createBot01Planets(0))[0]!;
  const ships = { ...createEmptyFleetState().ships };
  if (ownerId === OWNER) {
    ships.scout = 2;
    ships['spy-probe'] = 1;
    ships.colonizer = 1;
  } else {
    ships.scout = 0;
  }
  return {
    ...base,
    id,
    ownerId,
    ownerName: ownerId,
    coordinate,
    kind,
    raceId: 'aegis',
    alliance: null,
    resources: { metal: 20_000, minerals: 20_000, gas: 20_000, debris: 0, developmentEnergy: 100 },
    fleet: { ...createEmptyFleetState(), ships },
    defense: createEmptyDefenseState(),
    population: { total: 0, fleet: 0, defense: 0 },
    ownerProfile: { scienceLevels: {}, shipLevels: {}, commanderLevels: {} },
  } as SpyTargetState;
}

function baseState(reportOwner?: string, reportAt = AT): SaveState {
  const state = createInitialSaveState('test', 0);
  const origin = target(ORIGIN_ID, OWNER, { galaxy: 1, system: 1, position: 1 }, 'npc');
  const enemy = target(TARGET_ID, OTHER_OWNER, { galaxy: 1, system: 1, position: 2 }, 'npc');
  const reports: SpyReportSnapshot[] = reportOwner ? [{
    id: 'report-policy-target',
    missionId: 'mission-policy-target',
    ownerId: reportOwner,
    createdAt: reportAt,
    sourcePlanetId: `${reportOwner}-origin`,
    targetPlanetId: TARGET_ID,
    targetPlanetName: TARGET_ID,
    targetOwnerId: OTHER_OWNER,
    targetOwnerName: OTHER_OWNER,
    targetRaceId: 'aegis',
    targetRelation: 'neutral',
    targetCoordinate: enemy.coordinate,
    spyLevel: 1,
    targetEspionageLevel: 1,
    delta: 0,
    roll: 1,
    quality: 'basic',
    resources: { metal: 0, minerals: 0, gas: 0, debris: 0, developmentEnergy: 0 },
    firstReport: true,
  }] : [];
  const targets = { ...getEspionageTargets(state.espionage), [origin.id]: origin, [enemy.id]: enemy };
  return {
    ...state,
    npc: createNpcState([OWNER, OTHER_OWNER], 'npc-policy-tests', 0),
    espionage: { ...createDefaultEspionageState(), ...state.espionage, targets, reports },
  };
}

function candidates(state: SaveState) {
  const profile = state.npc!.profiles[OWNER]!;
  return getNpcMissionCandidates(state, profile, AT);
}

test('mission candidates are deterministic and ignore hidden target fleet changes', () => {
  const observed = baseState(OWNER);
  const espionage = observed.espionage!;
  const original = candidates(observed);
  assert.ok(original.some((candidate) => candidate.kind === 'attack' && candidate.payload.destinationPlanetId === TARGET_ID));
  const changedTarget = getEspionageTargets(observed.espionage)[TARGET_ID]!;
  const changed = {
    ...observed,
    espionage: {
      ...espionage,
      targets: {
        ...espionage.targets,
        [TARGET_ID]: { ...changedTarget, fleet: { ...changedTarget.fleet, ships: { ...changedTarget.fleet.ships, battleship: 999_999 } } },
      },
    },
  };
  assert.deepEqual(candidates(observed), candidates(observed));
  assert.deepEqual(candidates(changed), original, 'hidden enemy fleet data cannot influence candidate enumeration');
});

test('attack eligibility is owner-scoped and respects the observation time', () => {
  const otherOwnerReport = candidates(baseState(OTHER_OWNER));
  const futureReport = candidates(baseState(OWNER, AT + 1));
  assert.equal(otherOwnerReport.some((candidate) => candidate.kind === 'attack'), false);
  assert.equal(futureReport.some((candidate) => candidate.kind === 'attack'), false);
});

test('colonization only proposes canonical public empty coordinates and respects the owner cap', () => {
  const state = baseState();
  const result = candidates(state).filter((candidate) => candidate.kind === 'colonize');
  assert.ok(result.length > 0);
  const occupied = new Set([
    ...Object.values(getEspionageTargets(state.espionage!)).map(({ coordinate }) => `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`),
    ...Object.values(state.planets).flatMap((planet) => planet.universeGalaxy === undefined
      || planet.universeSystem === undefined || planet.universePosition === undefined ? []
      : [`${planet.universeGalaxy}:${planet.universeSystem}:${planet.universePosition}`]),
  ]);
  for (const candidate of result) {
    const key = `${candidate.payload.destinationGalaxy}:${candidate.payload.destinationSystem}:${candidate.payload.destinationPosition}`;
    assert.equal(occupied.has(key), false);
  }
  const capped = {
    ...state,
    espionage: {
      ...state.espionage!,
      targets: Object.fromEntries([...Object.entries(state.espionage!.targets!), ...Array.from({ length: 6 }, (_, index) => {
        const id = `${OWNER}-extra-${index}`;
        return [id, target(id, OWNER, { galaxy: 1, system: 2, position: index + 1 }, 'npc')];
      })]),
    },
  };
  assert.equal(candidates(capped).some((candidate) => candidate.kind === 'colonize'), false);
});

test('candidate adapter emits a real mission command with canonical target/contact payload', () => {
  const state = baseState(OWNER);
  const attack = candidates(state).find((candidate) => candidate.kind === 'attack' && candidate.payload.destinationPlanetId === TARGET_ID)!;
  const command = candidateToNpcMissionCommand(attack, OWNER, 'decision-1');
  assert.equal(command?.missionId, 'attack');
  assert.equal(command?.ownerId, OWNER);
  assert.deepEqual(command?.destination, {
    kind: 'planet',
    planetId: TARGET_ID,
    coordinate: { galaxy: 1, system: 1, position: 2 },
  });
  assert.equal(candidateToNpcMissionCommand({ ...attack, payload: { ...attack.payload, selectedShips: '{bad' } }, OWNER, 'decision-1'), null);
});

test('the live player is ranked exactly like any NPC owner (owner-id permutation)', () => {
  const state = baseState();
  const playerPlanetId = 'helion-01';
  const withPlayer = (reportTargets: readonly string[]): SaveState => {
    const planet = state.planets[playerPlanetId]!;
    const coordinate = { galaxy: 1, system: 1, position: 3 };
    const reports = reportTargets.map((targetPlanetId, index) => ({
      ...({} as SpyReportSnapshot), id: `report-perm-${index}`, missionId: `mission-perm-${index}`, ownerId: OWNER, createdAt: AT,
      targetPlanetId, targetCoordinate: targetPlanetId === TARGET_ID ? { galaxy: 1, system: 1, position: 2 } : coordinate,
    })) as SpyReportSnapshot[];
    return {
      ...state,
      planets: { ...state.planets, [playerPlanetId]: { ...planet, universeGalaxy: 1, universeSystem: 1, universePosition: 3 } },
      espionage: { ...state.espionage!, reports },
    };
  };
  const shape = (list: ReturnType<typeof candidates>, kind: string, destination: string) => {
    const found = list.find((candidate) => candidate.kind === kind && candidate.payload.destinationPlanetId === destination);
    if (!found) return null;
    return { weight: found.weight, relation: found.payload.targetRelation, ships: found.payload.selectedShips };
  };

  const unobserved = candidates(withPlayer([]));
  assert.ok(shape(unobserved, 'espionage', playerPlanetId), 'the player is a legal spy target');
  assert.deepEqual(shape(unobserved, 'espionage', playerPlanetId), shape(unobserved, 'espionage', TARGET_ID));
  assert.equal(shape(unobserved, 'attack', playerPlanetId), null, 'no attack on the player without own intelligence');
  assert.equal(shape(unobserved, 'attack', TARGET_ID), null, 'no attack on an NPC without own intelligence');

  const observed = candidates(withPlayer([playerPlanetId, TARGET_ID]));
  assert.ok(shape(observed, 'attack', playerPlanetId));
  assert.deepEqual(shape(observed, 'attack', playerPlanetId), shape(observed, 'attack', TARGET_ID),
    'same weight, relation and fleet for the player and an equivalent NPC target');
});
