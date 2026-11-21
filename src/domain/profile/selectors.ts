import {
  CURRENT_PLAYER_ID,
  createPlayerRatingEntries,
} from '../rating/fixtures.ts';
import type { AchievementPointsByOwner, OwnerScore, PlayerRatingEntry } from '../rating/types.ts';
import { achievementPointsForOwner } from '../rating/selectors.ts';
import type { RuntimeMode } from '../runtime/mode.ts';
import type { PlayerProfileState } from './types.ts';

export type PlayerProfileMetricKey = 'resourcePoints' | 'battlePoints' | 'totalPoints' | 'achievementPoints';

export type PlayerProfileMetric = {
  key: PlayerProfileMetricKey;
  label: string;
  description: string;
  value: number | null;
};

export function selectPlayerRatingEntry(
  score: OwnerScore | null | undefined,
  playerId = CURRENT_PLAYER_ID,
  mode: RuntimeMode = 'test',
  achievementPoints = 0,
  achievementPointsByOwner?: AchievementPointsByOwner,
): PlayerRatingEntry | null {
  if (!score) return null;
  const points = achievementPointsForOwner(achievementPointsByOwner, playerId, achievementPoints);
  return createPlayerRatingEntries(score, mode, score.ownerId, points).find((entry) => entry.id === playerId) ?? null;
}

export function selectPlayerProfileMetrics(
  profile: PlayerProfileState,
  score: OwnerScore | null | undefined,
  mode: RuntimeMode = 'test',
  achievementPoints = 0,
  achievementPointsByOwner?: AchievementPointsByOwner,
): PlayerProfileMetric[] {
  const entry = selectPlayerRatingEntry(score, profile.playerId, mode, achievementPoints, achievementPointsByOwner);
  return [
    { key: 'resourcePoints', label: 'Ресурсные очки', description: 'Очки развития ресурсной экономики игрока.', value: entry?.resourcePoints ?? null },
    { key: 'battlePoints', label: 'Боевые очки', description: 'Очки боевого рейтинга игрока.', value: entry?.battlePoints ?? null },
    { key: 'totalPoints', label: 'Общие очки', description: 'Сумма ресурсных и боевых очков.', value: entry?.totalPoints ?? null },
    { key: 'achievementPoints', label: 'Очки достижений', description: 'Очки достижений игрока.', value: entry?.achievementPoints ?? null },
  ];
}

