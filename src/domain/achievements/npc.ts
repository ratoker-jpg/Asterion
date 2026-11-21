import { DEVELOPMENT_ACHIEVEMENTS, type PlayerEventAchievementId } from './catalog.ts';
import { selectDevelopmentAchievementProgress, type AchievementProgressSource } from './development.ts';

export const NPC_FIRST_STONE_ACHIEVEMENT_ID = 'first-stone' as const;
export const NPC_FOUNDER_ACHIEVEMENT_ID = 'founder' as const;

export type NpcEventAchievementId = PlayerEventAchievementId;

export type NpcAchievementAwardResult = Readonly<{
  earnedAchievementIds: readonly string[];
  newlyEarnedAchievementIds: readonly string[];
}>;

/**
 * Reconcile the seven live development milestones without losing event-only
 * awards already recorded for this NPC. Unknown IDs are deliberately kept so
 * later catalog entries remain forward-compatible.
 */
export function reconcileNpcDevelopmentAchievementIds(
  source: AchievementProgressSource,
  earnedAchievementIds: readonly string[] = [],
): NpcAchievementAwardResult {
  const earned = new Set(earnedAchievementIds);
  const newlyEarnedAchievementIds = selectDevelopmentAchievementProgress(source)
    .filter((row) => row.met && !earned.has(row.id))
    .map((row) => row.id);
  return {
    earnedAchievementIds: newlyEarnedAchievementIds.length
      ? [...earnedAchievementIds, ...newlyEarnedAchievementIds]
      : earnedAchievementIds,
    newlyEarnedAchievementIds,
  };
}

/** Add a verified event achievement once, preserving the order of prior IDs. */
export function recordNpcEventAchievementId(
  earnedAchievementIds: readonly string[],
  achievementId: NpcEventAchievementId,
): NpcAchievementAwardResult {
  if (earnedAchievementIds.includes(achievementId)) {
    return { earnedAchievementIds, newlyEarnedAchievementIds: [] };
  }
  return {
    earnedAchievementIds: [...earnedAchievementIds, achievementId],
    newlyEarnedAchievementIds: [achievementId],
  };
}

/** Sum unique known achievement IDs from the one shared award catalog. */
export function earnedNpcAchievementPoints(earnedAchievementIds: readonly string[] = []): number {
  const earned = new Set(earnedAchievementIds);
  let points = 0;
  for (const achievement of DEVELOPMENT_ACHIEVEMENTS) {
    if (earned.has(achievement.id)) points += achievement.points;
  }
  return points;
}
