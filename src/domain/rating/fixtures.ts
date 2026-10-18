import type { OwnerScore, PlayerRatingEntry } from './types.ts';
import { TEST_ALLY_OWNER_ID } from '../command/catalog.ts';
import type { RuntimeMode } from '../runtime/mode.ts';

const CALLSIGNS = ['Vega', 'Orion', 'Helios', 'Nyx', 'Astra', 'Kepler', 'Titan', 'Nova', 'Cygnus', 'Draco', 'Altair', 'Rigel'];
const ALLIANCE_TAGS = ['ARC', 'NEX', 'VOID', 'AUR', 'ION', 'HEX', 'SOL', 'DRK'];

export const CURRENT_PLAYER_ID = 'player-current';
export const CURRENT_PLAYER_DISPLAY_NAME = 'Dendrilion';

export type RatingPrototypeState = {
  /** One immutable award record per real report ID; legacy reports are not backfilled. */
  battleAwardsByReportId: Record<string, Record<string, number>>;
  /** Net M/M/G sunk costs after queue cancellation/refund. */
  unrecoveredCostsByOwnerId: Record<string, { metal: number; minerals: number; gas: number }>;
};

export function createDefaultRatingPrototypeState(): RatingPrototypeState {
  return { battleAwardsByReportId: {}, unrecoveredCostsByOwnerId: {} };
}

export function migrateRatingPrototypeState(value: unknown): RatingPrototypeState {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const battleAwardsByReportId: RatingPrototypeState['battleAwardsByReportId'] = {};
  const rawAwards = source.battleAwardsByReportId;
  if (rawAwards && typeof rawAwards === 'object' && !Array.isArray(rawAwards)) {
    for (const [reportId, rawOwnerAwards] of Object.entries(rawAwards)) {
      if (!reportId || !rawOwnerAwards || typeof rawOwnerAwards !== 'object' || Array.isArray(rawOwnerAwards)) continue;
      battleAwardsByReportId[reportId] = Object.fromEntries(Object.entries(rawOwnerAwards).flatMap(([ownerId, points]) => (
        ownerId && typeof points === 'number' && Number.isFinite(points) && points >= 0
          ? [[ownerId, Math.floor(points)]]
          : []
      )));
    }
  }
  const unrecoveredCostsByOwnerId: RatingPrototypeState['unrecoveredCostsByOwnerId'] = {};
  const rawCosts = source.unrecoveredCostsByOwnerId;
  if (rawCosts && typeof rawCosts === 'object' && !Array.isArray(rawCosts)) {
    for (const [ownerId, rawCost] of Object.entries(rawCosts)) {
      if (!ownerId || !rawCost || typeof rawCost !== 'object' || Array.isArray(rawCost)) continue;
      const cost = rawCost as Record<string, unknown>;
      unrecoveredCostsByOwnerId[ownerId] = {
        metal: typeof cost.metal === 'number' && Number.isFinite(cost.metal) ? Math.max(0, Math.floor(cost.metal)) : 0,
        minerals: typeof cost.minerals === 'number' && Number.isFinite(cost.minerals) ? Math.max(0, Math.floor(cost.minerals)) : 0,
        gas: typeof cost.gas === 'number' && Number.isFinite(cost.gas) ? Math.max(0, Math.floor(cost.gas)) : 0,
      };
    }
  }
  return {
    battleAwardsByReportId,
    unrecoveredCostsByOwnerId,
  };
}

export function createPlayerRatingEntries(
  currentPlayerScore: number | { resourcePoints: number; battlePoints: number } = 0,
  mode: RuntimeMode = 'test',
  currentPlayerId = CURRENT_PLAYER_ID,
): PlayerRatingEntry[] {
  const currentResourcePoints = typeof currentPlayerScore === 'number' ? currentPlayerScore : currentPlayerScore.resourcePoints;
  const currentBattlePoints = typeof currentPlayerScore === 'number' ? 0 : currentPlayerScore.battlePoints;
  const safeCurrentResourcePoints = Math.max(0, Math.floor(Number.isFinite(currentResourcePoints) ? currentResourcePoints : 0));
  const safeCurrentBattlePoints = Math.max(0, Math.floor(Number.isFinite(currentBattlePoints) ? currentBattlePoints : 0));
  if (mode === 'production') {
    return [{
      id: currentPlayerId,
      rank: 1,
      name: CURRENT_PLAYER_DISPLAY_NAME,
      race: 'aster',
      allianceTag: null,
      achievementPoints: 0,
      resourcePoints: safeCurrentResourcePoints,
      battlePoints: safeCurrentBattlePoints,
      totalPoints: safeCurrentResourcePoints + safeCurrentBattlePoints,
      isCurrentPlayer: true,
    }];
  }

  return Array.from({ length: 84 }, (_, index) => {
    const standing = index + 1;
    const fixtureResourcePoints = 1_150_000 - index * 8_170;
    const battlePoints = 610_000 - index * 3_910;
    const isCurrentPlayer = standing === 37;
    const resourcePoints = isCurrentPlayer ? safeCurrentResourcePoints : fixtureResourcePoints;
    return {
      id: isCurrentPlayer ? currentPlayerId : `player-${String(standing).padStart(3, '0')}`,
      rank: standing,
      name: isCurrentPlayer ? CURRENT_PLAYER_DISPLAY_NAME : `${CALLSIGNS[index % CALLSIGNS.length]}-${String(standing).padStart(2, '0')}`,
      race: (['aster', 'cyber', 'xeno'] as const)[index % 3],
      allianceTag: standing % 7 === 0 ? null : ALLIANCE_TAGS[index % ALLIANCE_TAGS.length],
      achievementPoints: 0,
      resourcePoints,
      battlePoints: isCurrentPlayer ? safeCurrentBattlePoints : battlePoints,
      totalPoints: resourcePoints + (isCurrentPlayer ? safeCurrentBattlePoints : battlePoints),
      isCurrentPlayer,
    };
  });
}

/**
 * Managed Test Mode scores for owners the scoring pipeline cannot derive from
 * planets (the Ira Vel ally fixture). They are never applied in production.
 */
export const TEST_OWNER_SCORE_FIXTURES: Readonly<Record<string, OwnerScore>> = {
  [TEST_ALLY_OWNER_ID]: {
    ownerId: TEST_ALLY_OWNER_ID,
    resourcePoints: 1_000_000,
    battlePoints: 0,
    totalPoints: 1_000_000,
    achievementPoints: 0,
  },
};

/** Adds the managed fixture scores in Test Mode; a score computed from real data always wins. */
export function withTestOwnerScoreFixtures(
  scores: Readonly<Record<string, OwnerScore>>,
  mode: RuntimeMode,
): Record<string, OwnerScore> {
  if (mode !== 'test') return { ...scores };
  const merged: Record<string, OwnerScore> = { ...scores };
  for (const [ownerId, fixture] of Object.entries(TEST_OWNER_SCORE_FIXTURES)) {
    if (!merged[ownerId]) merged[ownerId] = { ...fixture };
  }
  return merged;
}
