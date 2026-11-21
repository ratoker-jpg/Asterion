import assert from 'node:assert/strict';
import test from 'node:test';

import { DEVELOPMENT_ACHIEVEMENTS } from '../domain/achievements/catalog.ts';
import { earnedNpcAchievementPoints, NPC_FIRST_STONE_ACHIEVEMENT_ID, NPC_FOUNDER_ACHIEVEMENT_ID } from '../domain/achievements/npc.ts';
import { COMMANDER_IDS } from '../domain/combat/commanders.ts';
import { BUILDING_ROLES, getBuildingMaxLevel, type BuildingLevels } from '../domain/buildings/resource-zone.ts';
import { migrateNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import { createInitialSaveState } from './persistence.ts';
import { applyNpcDiplomacyAction } from './npc-diplomacy.ts';
import {
  NPC_FOUNDER_ACHIEVEMENT_ID as FOUNDER_ID,
  NPC_FIRST_STONE_ACHIEVEMENT_ID as FIRST_STONE_ID,
  reconcileNpcAchievementProgressForOwners,
  reconcileUninitializedNpcAchievements,
  recordNpcAchievement,
  selectNpcAchievementPointsByOwner,
} from './npc-achievements.ts';

const NOW = Date.UTC(2026, 10, 1, 12);

function campaign(seed = 'NPC-ACHIEVEMENTS'): SaveState {
  const config = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Achievement Test' });
  return createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount: 4 } });
}

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function withTargets(state: SaveState, targets: Readonly<Record<string, SpyTargetState>>): SaveState {
  return { ...state, espionage: { ...state.espionage!, targets } };
}

function allSevenMilestonesMet(state: SaveState, ownerId: string): SaveState {
  const current = npcTargets(state);
  const owned = current.filter((target) => target.ownerId === ownerId);
  const other = current.find((target) => target.ownerId !== ownerId);
  assert.ok(owned[0] && other, 'fixture has at least two real NPC owners');
  const chosen = owned[0];
  const buildings = Object.fromEntries(BUILDING_ROLES.map((role) => [role, Math.min(25, getBuildingMaxLevel(role))])) as BuildingLevels;
  assert.ok(Object.values(buildings).reduce((sum, level) => sum + level, 0) >= 300, 'real catalog roles can reach the planet total milestone');
  const commanderId = COMMANDER_IDS[0]!;
  const completed = {
    ...chosen,
    buildings,
    resources: { ...chosen.resources, developmentEnergy: 10_000 },
    energyLedger: undefined,
    ownerProfile: {
      scienceLevels: chosen.ownerProfile?.scienceLevels ?? {},
      shipLevels: chosen.ownerProfile?.shipLevels ?? {},
      ...(chosen.ownerProfile ?? {}),
      commanderLevels: { ...(chosen.ownerProfile?.commanderLevels ?? {}), [commanderId]: 10 },
    },
  } satisfies SpyTargetState;
  const secondOwnedPlanet = { ...other, ownerId, ownerProfile: completed.ownerProfile };
  const targets = { ...state.espionage!.targets!, [completed.id]: completed, [secondOwnedPlanet.id]: secondOwnedPlanet };
  const science = state.npcScience?.owners[ownerId];
  assert.ok(state.npcScience && science);
  return {
    ...withTargets(state, targets),
    npcScience: {
      ...state.npcScience,
      owners: { ...state.npcScience.owners, [ownerId]: { ...science, levels: { ...science.levels, 1: 10 } } },
    },
  };
}

test('real current progress earns seven development milestones once per owner and remains monotonic', () => {
  const state = campaign();
  const [ownerId, otherOwnerId] = npcTargets(state).map((target) => target.ownerId).filter((id, index, ids) => ids.indexOf(id) === index);
  assert.ok(ownerId && otherOwnerId);
  const advanced = allSevenMilestonesMet(state, ownerId);
  const seven = DEVELOPMENT_ACHIEVEMENTS.filter(({ id }) => ![FIRST_STONE_ID, FOUNDER_ID].includes(id as typeof FIRST_STONE_ID | typeof FOUNDER_ID));

  const reconciled = reconcileNpcAchievementProgressForOwners(advanced, [ownerId]);
  const earned = reconciled.npc!.profiles[ownerId]!.earnedAchievementIds!;
  assert.deepEqual(new Set(earned), new Set(seven.map(({ id }) => id)));
  assert.deepEqual(reconciled.npc!.profiles[otherOwnerId]!.earnedAchievementIds, undefined, 'awards do not leak to another NPC');
  assert.equal(selectNpcAchievementPointsByOwner(reconciled)[ownerId], seven.reduce((sum, item) => sum + item.points, 0));

  const downgradedTargets = Object.fromEntries(Object.entries(reconciled.espionage!.targets!).map(([id, target]) => [id,
    target.ownerId === ownerId ? { ...target, buildings: {} as BuildingLevels, ownerProfile: { ...target.ownerProfile!, commanderLevels: {} } } : target,
  ]));
  const downgraded = { ...withTargets(reconciled, downgradedTargets), npcScience: { ...reconciled.npcScience!, owners: {
    ...reconciled.npcScience!.owners, [ownerId]: { ...reconciled.npcScience!.owners[ownerId]!, levels: {} },
  } } };
  assert.equal(reconcileNpcAchievementProgressForOwners(downgraded, [ownerId]), downgraded, 'earned state is monotonic and unchanged replays do not write');
  assert.deepEqual(downgraded.npc!.profiles[ownerId]!.earnedAchievementIds, earned);
});

test('one-time baseline uses live state only and event awards remain deduplicated', () => {
  const state = campaign();
  const ownerId = npcTargets(state)[0]!.ownerId;
  const bootstrapped = reconcileUninitializedNpcAchievements(state);
  assert.equal(bootstrapped.npc!.profiles[ownerId]!.achievementsReconciled, true);
  assert.equal(bootstrapped.npc!.profiles[ownerId]!.earnedAchievementIds?.includes(FIRST_STONE_ID), false,
    'existing starting buildings do not invent a first-completion event');
  assert.equal(reconcileUninitializedNpcAchievements(bootstrapped), bootstrapped, 'initialized empty profiles do not trigger repeat writes');

  const first = recordNpcAchievement(bootstrapped, ownerId, NPC_FIRST_STONE_ACHIEVEMENT_ID);
  assert.equal(first.npc!.profiles[ownerId]!.earnedAchievementIds?.includes(FIRST_STONE_ID), true);
  assert.equal(selectNpcAchievementPointsByOwner(first)[ownerId], 5);
  assert.equal(recordNpcAchievement(first, ownerId, NPC_FIRST_STONE_ACHIEVEMENT_ID), first, 'same event ID is a no-op');
  assert.equal(recordNpcAchievement(first, state.profile.playerId, NPC_FOUNDER_ACHIEVEMENT_ID), first, 'player records never enter NPC profiles');

  const persistedNpc = {
    ...first.npc!,
    profiles: { ...first.npc!.profiles, [ownerId]: { ...first.npc!.profiles[ownerId]!, earnedAchievementIds: [FIRST_STONE_ID, FOUNDER_ID] } },
  };
  const reloaded = migrateNpcState(persistedNpc, [ownerId], 'unused-fallback', NOW + 1);
  assert.deepEqual(reloaded.profiles[ownerId]!.earnedAchievementIds, [FIRST_STONE_ID, FOUNDER_ID]);
});

test('NPC founder award follows a successful create-alliance action only', () => {
  const state = campaign();
  const ownerId = npcTargets(state)[0]!.ownerId;
  const target = npcTargets(state).find((item) => item.ownerId === ownerId)!;
  const withHall = withTargets(state, {
    ...state.espionage!.targets!,
    [target.id]: { ...target, buildings: { ...target.buildings, 'planetary-government': 1 } },
  });
  const action = { id: 'founder-test', kind: 'create-alliance' as const, weight: 1, payload: {} };
  const created = applyNpcDiplomacyAction(withHall, ownerId, action, NOW, action.id);
  assert.equal(created.ok, true);
  assert.equal(created.state.npc!.profiles[ownerId]!.earnedAchievementIds?.includes(FOUNDER_ID), true);
  assert.equal(selectNpcAchievementPointsByOwner(created.state)[ownerId], 10);

  const refused = applyNpcDiplomacyAction(state, ownerId, action, NOW, action.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.state.npc!.profiles[ownerId]!.earnedAchievementIds?.includes(FOUNDER_ID) ?? false, false);
});
