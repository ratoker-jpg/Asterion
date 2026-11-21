import {
  ACHIEVEMENT_RANKS,
  DEVELOPMENT_ACHIEVEMENTS,
  type PlayerAchievementProofs,
  type PlayerEventAchievementId,
  type DevelopmentAchievementId,
} from './catalog.ts';
import type { AchievementChronicle } from './chronicle.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceId } from '../science/types.ts';
import { COMMANDER_IDS, type CommanderId } from '../combat/commanders.ts';

/** The progression fields required by the development achievements. */
export type AchievementProgressSource = Readonly<{
  planets: Readonly<Record<string, Readonly<{
    buildings: Readonly<Record<string, number>>;
    energy?: number;
    availableEnergy?: number;
  }> | undefined>>;
  /** Completed levels from `SaveState.science.levels`; queued work is excluded. */
  scienceLevels?: Partial<Record<ScienceId, number>>;
  /** Completed player commander levels from the owner-upgrade selector, including legacy fallback. */
  commanderUpgradeLevels?: Partial<Record<CommanderId, number>>;
  /** Proven player actions copied with the campaign; absent on saves from before the event. */
  playerAchievementProofs?: PlayerAchievementProofs;
}>;

/** Persistent earned-record fields used by the chronicle and by saved copies. */
export type EarnedAchievementRecord = Readonly<{
  id: string;
  at: number;
  campaignId?: string;
  roundId?: string;
}>;

export type AchievementProgressRow = (typeof DEVELOPMENT_ACHIEVEMENTS)[number] & Readonly<{
  progress: number;
  met: boolean;
  earned: boolean;
}>;

export type AchievementRankProgress = Readonly<{
  earnedPoints: number;
  current: (typeof ACHIEVEMENT_RANKS)[number];
  next: (typeof ACHIEVEMENT_RANKS)[number] | null;
  pointsIntoRank: number;
  pointsToNext: number;
  progressToNext: number;
  maxedOut: boolean;
}>;

export type AchievementAwards = Readonly<{
  earned: readonly EarnedAchievementRecord[];
  newlyEarned: readonly EarnedAchievementRecord[];
}>;

function finiteProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function ownedPlanets(source: AchievementProgressSource) {
  return Object.values(source.planets).filter((planet): planet is NonNullable<typeof planet> => Boolean(planet));
}

function highestBuildingLevel(source: AchievementProgressSource): number {
  let highest = 0;
  for (const planet of ownedPlanets(source)) {
    for (const level of Object.values(planet.buildings)) highest = Math.max(highest, finiteProgress(level));
  }
  return highest;
}

function highestPlanetBuildingTotal(source: AchievementProgressSource): number {
  let highest = 0;
  for (const planet of ownedPlanets(source)) {
    const total = Object.values(planet.buildings).reduce((sum, level) => sum + finiteProgress(level), 0);
    highest = Math.max(highest, total);
  }
  return highest;
}

function highestPlanetEnergyBalance(source: AchievementProgressSource): number {
  let highest = 0;
  for (const planet of ownedPlanets(source)) {
    highest = Math.max(highest, finiteProgress(planet.availableEnergy ?? planet.energy ?? 0));
  }
  return highest;
}

function completedResearchLevels(source: AchievementProgressSource): number {
  return SCIENCE_CATALOG.reduce((total, science) => {
    const level = finiteProgress(source.scienceLevels?.[science.id] ?? 0);
    return total + Math.min(level, science.maxLevel);
  }, 0);
}

function highestCommanderUpgradeLevel(source: AchievementProgressSource): number {
  let highest = 0;
  for (const commanderId of COMMANDER_IDS) {
    highest = Math.max(highest, finiteProgress(source.commanderUpgradeLevels?.[commanderId] ?? 0));
  }
  return highest;
}

function playerAchievementProofAt(
  source: AchievementProgressSource,
  id: DevelopmentAchievementId,
): number | undefined {
  if (id !== 'first-stone' && id !== 'founder') return undefined;
  const at = source.playerAchievementProofs?.[id];
  return Number.isSafeInteger(at) && Number(at) >= 0 ? Number(at) : undefined;
}

function rawProgress(source: AchievementProgressSource, id: DevelopmentAchievementId): number {
  switch (id) {
    case 'bridge':
      return highestCommanderUpgradeLevel(source);
    case 'scholar':
      return completedResearchLevels(source);
    case 'builder':
    case 'architect':
      return highestBuildingLevel(source);
    case 'empire-architect':
      return highestPlanetBuildingTotal(source);
    case 'colonist':
      return ownedPlanets(source).length;
    case 'power-grid':
      return highestPlanetEnergyBalance(source);
    case 'first-stone':
    case 'founder':
      return playerAchievementProofAt(source, id) === undefined ? 0 : 1;
  }
}

/** Records the first authoritative proof for an action without changing a prior timestamp. */
export function recordPlayerAchievementProof(
  current: PlayerAchievementProofs | undefined,
  id: PlayerEventAchievementId,
  at: number,
): PlayerAchievementProofs | undefined {
  if (!Number.isSafeInteger(at) || at < 0) return current;
  if (current?.[id] !== undefined) return current;
  return { ...current, [id]: at };
}

/** Returns live development progress from the current owned-planet state. */
export function selectDevelopmentAchievementProgress(
  source: AchievementProgressSource,
  earned: readonly EarnedAchievementRecord[] = [],
): AchievementProgressRow[] {
  const earnedIds = new Set(earned.map((record) => record.id));
  return DEVELOPMENT_ACHIEVEMENTS.map((achievement) => {
    const current = rawProgress(source, achievement.id);
    return {
      ...achievement,
      progress: Math.min(current, achievement.goal),
      met: current >= achievement.goal,
      earned: earnedIds.has(achievement.id),
    };
  });
}

/**
 * Backfills milestones already met by a loaded save and records new awards by
 * stable achievement id. Passing the returned array on the next load is a no-op.
 */
export function reconcileDevelopmentAchievementAwards(
  source: AchievementProgressSource,
  earned: readonly EarnedAchievementRecord[],
  context: Readonly<{ at: number; campaignId?: string; roundId?: string }>,
): AchievementAwards {
  const earnedIds = new Set(earned.map((record) => record.id));
  const newlyEarned = selectDevelopmentAchievementProgress(source)
    .filter((row) => row.met && !earnedIds.has(row.id))
    .map((row): EarnedAchievementRecord => ({
      id: row.id,
      at: playerAchievementProofAt(source, row.id) ?? context.at,
      ...(context.campaignId ? { campaignId: context.campaignId } : {}),
      ...(context.roundId ? { roundId: context.roundId } : {}),
    }));
  return { earned: newlyEarned.length ? [...earned, ...newlyEarned] : earned, newlyEarned };
}

/** Reconciles the live save against the separate chronicle without mutating either input. */
export function reconcileDevelopmentAchievementChronicle(
  source: AchievementProgressSource,
  chronicle: AchievementChronicle,
  context: Readonly<{ at: number; campaignId?: string; roundId?: string }>,
): Readonly<{ chronicle: AchievementChronicle; newlyEarned: readonly EarnedAchievementRecord[] }> {
  const awards = reconcileDevelopmentAchievementAwards(source, chronicle.earned, context);
  if (awards.newlyEarned.length === 0) return { chronicle, newlyEarned: awards.newlyEarned };
  return {
    chronicle: { ...chronicle, earned: awards.earned },
    newlyEarned: awards.newlyEarned,
  };
}

/** Sums unique, known milestone ids so loading or copying a save cannot add points twice. */
export function earnedDevelopmentAchievementPoints(earned: readonly EarnedAchievementRecord[]): number {
  const earnedIds = new Set(earned.map((record) => record.id));
  return DEVELOPMENT_ACHIEVEMENTS.reduce(
    (sum, achievement) => sum + (earnedIds.has(achievement.id) ? achievement.points : 0),
    0,
  );
}

/** Resolves the honor rank and progress bar from earned points. */
export function selectAchievementRankProgress(points: number): AchievementRankProgress {
  const earnedPoints = finiteProgress(points);
  let rankIndex = 0;
  while (rankIndex + 1 < ACHIEVEMENT_RANKS.length && ACHIEVEMENT_RANKS[rankIndex + 1]!.at <= earnedPoints) {
    rankIndex += 1;
  }
  const current = ACHIEVEMENT_RANKS[rankIndex]!;
  const next = ACHIEVEMENT_RANKS[rankIndex + 1] ?? null;
  const pointsIntoRank = earnedPoints - current.at;
  const pointsToNext = next ? Math.max(0, next.at - earnedPoints) : 0;
  return {
    earnedPoints,
    current,
    next,
    pointsIntoRank,
    pointsToNext,
    progressToNext: next ? Math.min(1, pointsIntoRank / (next.at - current.at)) : 1,
    maxedOut: next === null,
  };
}

/** Stable view model for the first achievements screen slice. */
export function selectAchievementScreenData(
  source: AchievementProgressSource,
  chronicle: AchievementChronicle,
): Readonly<{
  entries: AchievementProgressRow[];
  earnedPoints: number;
  rank: AchievementRankProgress;
}> {
  const earnedPoints = earnedDevelopmentAchievementPoints(chronicle.earned);
  return {
    entries: selectDevelopmentAchievementProgress(source, chronicle.earned),
    earnedPoints,
    rank: selectAchievementRankProgress(earnedPoints),
  };
}
