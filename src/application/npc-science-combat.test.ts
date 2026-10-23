import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { stageOwnerRelation } from '../domain/command/test-helpers.ts';
import { dispatchFlight } from './flights.ts';
import { getNpcScienceCandidates, startNpcScience } from './npc-science.ts';
import { reconcileRuntime } from './reconcile.ts';
import { createInitialSaveState } from './persistence.ts';
import type { SaveState } from './contracts.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';

const START = Date.UTC(2026, 9, 23, 12);

function campaign(): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'NPC-SCIENCE-COMBAT-TIE-V1', factionId: 'aegis', playerName: 'Science Combat QA' });
  const setup = { ...config, world: { ...config.world, galaxyCount: 1, npcCount: 2, maxNpcPerSystem: 2 as const, randomPlayerStart: false } };
  const state = createInitialSaveState('production', START, setup);
  return { ...state, npc: createNpcState(Object.keys(state.npc!.profiles), 'npc-science-combat-tie-v1', START), asteroidSimulation: undefined };
}

function targetFor(state: SaveState, ownerId?: string): SpyTargetState {
  const target = Object.values(state.espionage?.targets ?? {})
    .find((candidate) => candidate.kind === 'npc' && (!ownerId || candidate.ownerId === ownerId));
  assert.ok(target, 'campaign fixture contains an NPC target');
  return target;
}

function npcScience(state: SaveState, target: SpyTargetState) {
  assert.ok(state.npcScience);
  return state.npcScience.owners[target.ownerId]!;
}

test('NPC science completing exactly at an attack arrival updates that battle before combat, while launch snapshots and other owners stay isolated', () => {
  const initial = campaign();
  const generatedTarget = targetFor(initial);
  const otherTarget = targetFor(initial, Object.keys(initial.npcScience!.owners)
    .find((ownerId) => ownerId !== generatedTarget.ownerId)!);
  const distantTarget: SpyTargetState = {
    ...generatedTarget,
    coordinate: { galaxy: 9, system: 40, position: 24 },
    buildings: { ...generatedTarget.buildings, research: 5 },
    resources: {
      ...generatedTarget.resources,
      metal: 100_000_000,
      minerals: 100_000_000,
      gas: 100_000_000,
      developmentEnergy: 100_000_000,
    },
    fleet: {
      ...generatedTarget.fleet,
      ships: { ...generatedTarget.fleet.ships, scout: 20 },
    },
    ownerProfile: {
      scienceLevels: { ...(generatedTarget.ownerProfile?.scienceLevels ?? {}), 1: 4, 7: 0 },
      shipLevels: generatedTarget.ownerProfile?.shipLevels ?? {},
      commanderLevels: generatedTarget.ownerProfile?.commanderLevels ?? {},
    },
  };
  const source = initial.planets[initial.currentPlanetId]!;
  const prepared: SaveState = {
    ...initial,
    command: stageOwnerRelation(initial.command, initial.profile.playerId, generatedTarget.ownerId, 'neutral'),
    planets: {
      ...initial.planets,
      [initial.currentPlanetId]: {
        ...source,
        fleet: { ...source.fleet, ships: { ...source.fleet.ships, scout: Math.max(20, source.fleet.ships.scout ?? 0) } },
      },
    },
    espionage: {
      ...initial.espionage!,
      targets: { ...initial.espionage!.targets, [distantTarget.id]: distantTarget },
    },
    npcScience: {
      ...initial.npcScience!,
      owners: {
        ...initial.npcScience!.owners,
        [generatedTarget.ownerId]: { ...npcScience(initial, generatedTarget), levels: { 1: 4, 7: 0 }, queue: [] },
      },
    },
  };

  const dispatched = dispatchFlight(prepared, {
    requestId: 'npc-science-combat-tie',
    missionId: 'attack',
    originPlanetId: prepared.currentPlanetId,
    destination: { kind: 'planet', planetId: distantTarget.id, coordinate: distantTarget.coordinate },
    targetRelation: 'neutral',
    targetOwnerId: distantTarget.ownerId,
    selectedShips: { scout: 5 },
    selectedCommanders: {},
    maxRounds: 5,
    departedAt: START,
  }, { now: START, mode: 'production', testTimeScale: 1 });
  assert.equal(dispatched.ok, true, dispatched.ok ? '' : dispatched.error.message);
  if (!dispatched.ok) return;
  const launchSnapshot = dispatched.flight.attackSnapshot!;
  assert.equal(launchSnapshot.attackerTechnologies.shipArmor, 0);

  const preview = getNpcScienceCandidates(distantTarget, npcScience(prepared, distantTarget), dispatched.flight.arrivalAt, 1)
    .find((candidate) => candidate.scienceId === 7)!;
  assert.ok(preview?.canStart, preview?.reason ?? 'NPC must be able to research ship armor');
  const researchStartedAt = dispatched.flight.arrivalAt - preview.durationMs;
  assert.ok(researchStartedAt > dispatched.flight.departedAt, 'research starts after the fleet has launched');
  const started = startNpcScience(distantTarget, npcScience(prepared, distantTarget), 7,
    researchStartedAt, 1, 'npc-science-combat-ship-armor');
  assert.equal(started.ok, true, started.reason ?? 'NPC ship armor research should start');
  const task = started.science.queue[0]!;
  assert.equal(task.finishAt, dispatched.flight.arrivalAt, 'research completion and attack arrival share a millisecond');

  const inFlight: SaveState = {
    ...dispatched.state,
    // The player gains this technology after launch; the attack must retain its saved launch snapshot.
    science: { ...dispatched.state.science, levels: { ...dispatched.state.science.levels, 7: 2 } },
    espionage: {
      ...dispatched.state.espionage!,
      targets: { ...dispatched.state.espionage!.targets, [distantTarget.id]: started.target },
    },
    npcScience: {
      ...dispatched.state.npcScience!,
      owners: { ...dispatched.state.npcScience!.owners, [distantTarget.ownerId]: started.science },
    },
  };
  const completed = reconcileRuntime(inFlight, {
    planetId: inFlight.currentPlanetId,
    now: dispatched.flight.arrivalAt,
    mode: 'production',
    testTimeScale: 1,
  });

  const report = completed.state.combat.reports.find((item) => item.id === `battle-attack-${dispatched.flight.id}`);
  if (!report) throw new Error('The coinciding flight did not resolve through the actual combat engine.');
  assert.equal(report.defenderForce.technologyLevels?.shipArmor, 1,
    'the defender uses owner science completed at the exact arrival timestamp');
  assert.equal(report.attackerForce.technologyLevels?.shipArmor, 0,
    'the attacker uses its immutable launch snapshot despite later player science');
  assert.deepEqual(completed.state.flights.records.find((flight) => flight.id === dispatched.flight.id)?.attackSnapshot, launchSnapshot);
  assert.equal(completed.state.npcScience?.owners[distantTarget.ownerId]?.levels[7], 1);
  assert.equal(completed.state.npcScience?.owners[otherTarget.ownerId]?.levels[7] ?? 0, 0,
    'research does not transfer to another NPC owner');
  assert.equal(completed.state.science.levels[7], 2, 'NPC science does not overwrite the player science ledger');
  assert.equal(completed.state.espionage?.targets?.[otherTarget.id]?.ownerProfile?.scienceLevels?.[7] ?? 0, 0,
    'projected owner profiles remain isolated');
  assert.ok(completed.events.some((event) => event.kind === 'npc-science'
    && event.ownerId === distantTarget.ownerId && event.scienceId === 7 && event.at === task.finishAt));
});
