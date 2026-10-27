import type { SaveState } from './contracts.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';

/**
 * Raises each listed owner to exactly `resourcePoints` resource points through
 * the unrecovered-cost ledger, so attack scenarios that are not about the
 * points rule start from mutually admissible owners. Fixtures that are about
 * the rule set their own figures.
 */
export function withAttackEligiblePoints(state: SaveState, ownerIds: readonly string[], resourcePoints = 50_000): SaveState {
  const unrecovered = { ...state.rating.unrecoveredCostsByOwnerId };
  for (const ownerId of ownerIds) {
    const current = selectOwnerScore(state, ownerId)?.resourcePoints;
    if (current === undefined) throw new Error(`Owner ${ownerId} has no scored planets in this fixture.`);
    if (current > resourcePoints) throw new Error(`Owner ${ownerId} already has ${current} resource points (> ${resourcePoints}).`);
    const previous = unrecovered[ownerId] ?? { metal: 0, minerals: 0, gas: 0 };
    unrecovered[ownerId] = { ...previous, metal: previous.metal + (resourcePoints - current) * 1_000 };
  }
  return { ...state, rating: { ...state.rating, unrecoveredCostsByOwnerId: unrecovered } };
}
