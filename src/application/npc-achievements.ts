import type { AchievementProgressSource } from '../domain/achievements/development.ts';
import {
  earnedNpcAchievementPoints,
  NPC_FIRST_STONE_ACHIEVEMENT_ID,
  NPC_FOUNDER_ACHIEVEMENT_ID,
  reconcileNpcDevelopmentAchievementIds,
  recordNpcEventAchievementId,
  type NpcEventAchievementId,
} from '../domain/achievements/npc.ts';
import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { SCIENCE_CATALOG } from '../domain/science/catalog.ts';
import type { ScienceId } from '../domain/science/types.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { targetEnergyLedger } from './npc-economy.ts';
import type { SaveState } from './contracts.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';

export { NPC_FIRST_STONE_ACHIEVEMENT_ID, NPC_FOUNDER_ACHIEVEMENT_ID };
export type { NpcEventAchievementId };

/**
 * Reconciles actual live progress for the named owners. It is safe to call at
 * development completion boundaries: awards are monotonic and duplicate IDs
 * do not cause a state write.
 */
export function reconcileNpcAchievementProgressForOwners(
  state: SaveState,
  ownerIds: readonly string[],
  ownedIds?: (ownerId: string) => readonly string[],
): SaveState {
  const npc = state.npc;
  const allTargets = state.espionage?.targets;
  if (!npc || !allTargets || ownerIds.length === 0) return state;
  const targetsByOwner = ownedIds ? undefined : getNpcTargetsByOwner(state, ownerIds);
  let profiles: Record<string, NpcProfile> | null = null;
  for (const ownerId of new Set(ownerIds)) {
    if (ownerId === state.profile.playerId || ownerId === UNIVERSE_NPC_OWNER_ID) continue;
    const profile = (profiles ?? npc.profiles)[ownerId];
    const targets = ownedIds
      ? ownedIds(ownerId).map((id) => allTargets[id]).filter((target): target is SpyTargetState => target?.kind === 'npc' && target.ownerId === ownerId)
      : targetsByOwner?.get(ownerId);
    if (!profile || !targets?.length) continue;
    const source = selectNpcAchievementProgressSourceForTargets(state, ownerId, targets);
    const result = reconcileNpcDevelopmentAchievementIds(source, profile.earnedAchievementIds ?? []);
    const alreadyInitialized = profile.achievementsReconciled === true;
    if (alreadyInitialized && result.newlyEarnedAchievementIds.length === 0) continue;
    if (profiles === null) profiles = { ...npc.profiles };
    profiles[ownerId] = {
      ...profile,
      earnedAchievementIds: result.earnedAchievementIds,
      achievementsReconciled: true,
    };
  }
  return profiles ? { ...state, npc: { ...npc, profiles } } : state;
}

/** One-time snapshot bootstrap for legacy profiles; call at load/first handoff, not per render. */
export function reconcileUninitializedNpcAchievements(state: SaveState): SaveState {
  const owners = Object.values(state.npc?.profiles ?? {})
    .filter((profile) => profile.achievementsReconciled !== true)
    .map((profile) => profile.ownerId);
  return owners.length ? reconcileNpcAchievementProgressForOwners(state, owners) : state;
}

/** Records one verified first-stone/founder event for a real NPC. */
export function recordNpcAchievement(
  state: SaveState,
  ownerId: string,
  achievementId: NpcEventAchievementId,
): SaveState {
  const npc = state.npc;
  const profile = npc?.profiles[ownerId];
  if (!npc || !profile || (profile.earnedAchievementIds ?? []).includes(achievementId) || !isRealNpcOwner(state, ownerId)) return state;
  const result = recordNpcEventAchievementId(profile.earnedAchievementIds ?? [], achievementId);
  return {
    ...state,
    npc: {
      ...npc,
      profiles: {
        ...npc.profiles,
        [ownerId]: { ...profile, earnedAchievementIds: result.earnedAchievementIds },
      },
    },
  };
}

/** Snapshot of current NPC awards for rating/profile projections. */
export function selectNpcAchievementPointsByOwner(state: SaveState): Readonly<Record<string, number>> {
  const points: Record<string, number> = Object.create(null) as Record<string, number>;
  const currentOwners = new Set(Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId && target.ownerId !== UNIVERSE_NPC_OWNER_ID)
    .map((target) => target.ownerId));
  for (const [ownerId, profile] of Object.entries(state.npc?.profiles ?? {})) {
    if (!currentOwners.has(ownerId)) continue;
    points[ownerId] = earnedNpcAchievementPoints(profile.earnedAchievementIds ?? []);
  }
  return points;
}

function selectNpcAchievementProgressSourceForTargets(
  state: SaveState,
  ownerId: string,
  targets: readonly SpyTargetState[],
): AchievementProgressSource {
  const planets: Record<string, { buildings: Readonly<Record<string, number>>; availableEnergy: number }> = Object.create(null) as Record<string, { buildings: Readonly<Record<string, number>>; availableEnergy: number }>;
  const commanderUpgradeLevels: Partial<Record<CommanderId, number>> = {};
  let legacyScienceLevels: Partial<Record<ScienceId, number>> | undefined;
  for (const target of targets) {
    planets[target.id] = {
      buildings: target.buildings,
      availableEnergy: Math.max(0, targetEnergyLedger(target).availableEnergy),
    };
    for (const commanderId of COMMANDER_IDS) {
      const level = target.ownerProfile?.commanderLevels[commanderId] ?? 0;
      commanderUpgradeLevels[commanderId] = Math.max(commanderUpgradeLevels[commanderId] ?? 0, level);
    }
    if (target.ownerProfile?.scienceLevels) {
      legacyScienceLevels ??= {};
      for (const science of SCIENCE_CATALOG) {
        const level = target.ownerProfile.scienceLevels[science.id] ?? 0;
        legacyScienceLevels[science.id] = Math.max(legacyScienceLevels[science.id] ?? 0, level);
      }
    }
  }
  return {
    planets,
    scienceLevels: state.npcScience?.owners[ownerId]?.levels ?? legacyScienceLevels,
    commanderUpgradeLevels,
  };
}

function getNpcTargetsByOwner(state: SaveState, ownerIds: readonly string[]): Map<string, SpyTargetState[]> {
  const requested = new Set(ownerIds);
  const targetsByOwner = new Map<string, SpyTargetState[]>();
  for (const target of Object.values(state.espionage?.targets ?? {})) {
    if (target.kind !== 'npc' || !requested.has(target.ownerId) || target.ownerId === UNIVERSE_NPC_OWNER_ID) continue;
    const targets = targetsByOwner.get(target.ownerId);
    if (targets) targets.push(target);
    else targetsByOwner.set(target.ownerId, [target]);
  }
  return targetsByOwner;
}

function isRealNpcOwner(state: SaveState, ownerId: string): boolean {
  if (!ownerId || ownerId === state.profile.playerId || ownerId === UNIVERSE_NPC_OWNER_ID || !state.npc?.profiles[ownerId]) return false;
  return Object.values(state.espionage?.targets ?? {}).some((target) => target.kind === 'npc' && target.ownerId === ownerId);
}
