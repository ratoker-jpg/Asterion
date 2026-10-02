import {
  CURRENT_PLAYER_ID,
  createPlayerRatingEntries,
} from '../rating/fixtures.ts';
import type { OwnerScore, PlayerRatingEntry } from '../rating/types.ts';
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
): PlayerRatingEntry | null {
  if (!score) return null;
  return createPlayerRatingEntries(score, mode).find((entry) => entry.id === playerId) ?? null;
}

export function selectPlayerProfileMetrics(
  profile: PlayerProfileState,
  score: OwnerScore | null | undefined,
  mode: RuntimeMode = 'test',
): PlayerProfileMetric[] {
  const entry = selectPlayerRatingEntry(score, profile.playerId, mode);
  return [
    { key: 'resourcePoints', label: 'Ресурсные очки', description: 'Очки развития ресурсной экономики игрока.', value: entry?.resourcePoints ?? null },
    { key: 'battlePoints', label: 'Боевые очки', description: 'Очки боевого рейтинга игрока.', value: entry?.battlePoints ?? null },
    { key: 'totalPoints', label: 'Общие очки', description: 'Сумма ресурсных и боевых очков.', value: entry?.totalPoints ?? null },
    { key: 'achievementPoints', label: 'Очки достижений', description: 'Очки достижений игрока.', value: entry?.achievementPoints ?? null },
  ];
}

