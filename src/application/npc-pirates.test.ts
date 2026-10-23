import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import { createDefaultEspionageState, getEspionageTargets } from '../domain/espionage/runtime.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { getCurrentPirateContact } from './pirates.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import { dispatchNpcPirateMission, getNpcPirateCandidates, resolveNpcPirateArrival } from './npc-pirates.ts';

const OWNER = 'npc-pirate-contract-owner';
const ORIGIN_ID = `${OWNER}-colony`;
const TIME_SCALE = 1_000;

function firstScheduledContact() {
  const schedule = Array.from({ length: 100 }, (_, index) => getUniverseTimedObjectSchedule('pirate', 1, 2, index))
    .find((candidate) => candidate.present);
  assert.ok(schedule);
  return schedule;
}

function withNpcOrigin(state: SaveState, ships: Partial<Record<string, number>>): SaveState {
  const contactSchedule = firstScheduledContact();
  const playerOrigin = state.planets['helion-01']!;
  const fleet = createEmptyFleetState();
  Object.assign(fleet.ships, ships);
  const target: SpyTargetState = {
    id: ORIGIN_ID,
    name: 'NPC Colony',
    coordinate: { galaxy: 1, system: 2, position: 8 },
    ownerId: OWNER,
    ownerName: 'NPC Admiral',
    raceId: 'aegis',
    alliance: null,
    kind: 'npc',
    espionageLevel: 0,
    resources: { metal: 4_000, minerals: 4_000, gas: 100_000, debris: 0, developmentEnergy: 0 },
    buildings: { ...playerOrigin.buildings, hangar: 20 },
    fleet,
    defense: playerOrigin.defense,
    commanders: {},
    population: { total: 0, fleet: 0, defense: 0 },
    hunterLevel: 0,
    ownerProfile: { scienceLevels: {}, shipLevels: {}, commanderLevels: {} },
  };
  const npc = createNpcState([OWNER], 'npc-pirate-tests', contactSchedule.startAt);
  const targets = { ...getEspionageTargets(state.espionage), [ORIGIN_ID]: target };
  const next: SaveState = {
    ...state,
    npc,
    espionage: { ...createDefaultEspionageState(), ...state.espionage, targets },
  };
  return next;
}

function activeNpcContact(state: SaveState, at: number) {
  const contact = getCurrentPirateContact(state, { galaxy: 1, system: 2, position: 1 }, at);
  assert.ok(contact, 'the scheduled system must expose its public active pirate contact');
  return contact;
}

test('NPC pirate candidates use an owned public contact, own fleet, and canonical recon availability', () => {
  const scheduled = firstScheduledContact();
  const state = withNpcOrigin(createInitialSaveState('test', scheduled.startAt), { 'spy-probe': 1, cruiser: 4 });
  const contact = activeNpcContact(state, scheduled.startAt + 1);
  const candidates = getNpcPirateCandidates(state, state.npc!.profiles[OWNER]!, scheduled.startAt + 1);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.some((candidate) => candidate.missionId === 'pirate-recon'
    && candidate.contactCycleKey === contact.contactCycleKey
    && candidate.selectedShips['spy-probe'] === 1));
  assert.ok(candidates.some((candidate) => candidate.missionId === 'pirate-elimination'
    && candidate.selectedShips.cruiser === 4));

  const recon = candidates.find((candidate) => candidate.missionId === 'pirate-recon')!;
  const sent = dispatchNpcPirateMission(state, OWNER, recon, scheduled.startAt + 1, 'npc-pirate-recon-1', TIME_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  assert.equal(getNpcPirateCandidates(sent.state, sent.state.npc!.profiles[OWNER]!, scheduled.startAt + 2)
    .some((candidate) => candidate.missionId === 'pirate-recon'), false, 'the canonical cycle cooldown blocks duplicate probes');
  const originAfterLaunch = getEspionageTargets(sent.state.espionage)[ORIGIN_ID]!;
  assert.equal(originAfterLaunch.fleet.ships['spy-probe'], 0);
  assert.equal(originAfterLaunch.fleet.ships.cruiser, 4);
  assert.deepEqual(sent.state.planets, state.planets);
});

test('NPC elimination arrival runs canonical combat and isolates player-owned save fields', () => {
  const scheduled = firstScheduledContact();
  const state = withNpcOrigin(createInitialSaveState('test', scheduled.startAt), { cruiser: 8, battleship: 3 });
  const at = scheduled.startAt + 1;
  const candidate = getNpcPirateCandidates(state, state.npc!.profiles[OWNER]!, at)
    .find((item) => item.missionId === 'pirate-elimination');
  assert.ok(candidate);
  const sent = dispatchNpcPirateMission(state, OWNER, candidate, at, 'npc-pirate-elimination-1', TIME_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  const afterDispatch = getEspionageTargets(sent.state.espionage)[ORIGIN_ID]!;
  assert.equal(afterDispatch.fleet.ships.cruiser, 0);
  assert.equal(afterDispatch.fleet.ships.battleship, 0);

  const playerFields = {
    planets: sent.state.planets,
    wallet: [sent.state.metal, sent.state.minerals, sent.state.gas],
    profile: sent.state.profile,
    science: sent.state.science,
    upgrades: sent.state.shipUpgradeLevels,
    priority: sent.state.combatPriority,
  };
  const resolved = resolveNpcPirateArrival(sent.state, sent.flight!, sent.flight!.arrivalAt);
  assert.equal(resolved.ok, true, resolved.reason ?? undefined);
  assert.ok(resolved.state.combat.reports.some((report) => report.id === `battle-pirate-${sent.flight!.id}`));
  assert.equal(resolved.flight?.attackResolution?.reportId, `battle-pirate-${sent.flight!.id}`);
  assert.deepEqual(resolved.state.planets, playerFields.planets);
  assert.deepEqual([resolved.state.metal, resolved.state.minerals, resolved.state.gas], playerFields.wallet);
  assert.deepEqual(resolved.state.profile, playerFields.profile);
  assert.deepEqual(resolved.state.science, playerFields.science);
  assert.deepEqual(resolved.state.shipUpgradeLevels, playerFields.upgrades);
  assert.deepEqual(resolved.state.combatPriority, playerFields.priority);
  const npcOriginAfter = getEspionageTargets(resolved.state.espionage)[ORIGIN_ID]!;
  const report = resolved.state.combat.reports.find((item) => item.id === `battle-pirate-${sent.flight!.id}`)!;
  for (const shipId of ['cruiser', 'battleship'] as const) {
    const destroyed = report.attackerForce.stacks?.find((stack) => stack.entityId === shipId)?.destroyed ?? 0;
    assert.equal(resolved.flight!.selectedShips[shipId], sent.flight!.selectedShips[shipId]! - destroyed,
      `return manifest carries only canonical ${shipId} survivors`);
    assert.equal(npcOriginAfter.fleet.ships[shipId], 0, 'flight survivors remain in transit until the return time');
  }
  assert.equal(npcOriginAfter.resources.gas, afterDispatch.resources.gas, 'arrival does not grant unearned resources');
});
