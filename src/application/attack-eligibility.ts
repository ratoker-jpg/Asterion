import type { SaveState } from './contracts.ts';
import { evaluateAttackEligibility, type AttackEligibility, type AttackEligibilityPoints } from '../domain/rating/attack-eligibility.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';

const EXEMPT: AttackEligibility = { allowed: true, reason: null, message: null, byTotal: false, byResource: false };

/** Test Mode Bot 01 scenarios are verification fixtures, outside the owner points rule. */
export function isAttackEligibilityExempt(ownerId: string | undefined): boolean {
  return ownerId === UNIVERSE_NPC_OWNER_ID;
}

/**
 * The authoritative launch gate for attacking a player or NPC planet, shared
 * by the player's dispatch, NPC dispatch and NPC candidate filtering. Pass a
 * cache to reuse each owner's score across many targets in one decision.
 */
export function evaluatePlanetAttackEligibility(
  state: SaveState,
  attackerOwnerId: string,
  defenderOwnerId: string,
  scoreCache?: Map<string, AttackEligibilityPoints | undefined>,
): AttackEligibility {
  if (isAttackEligibilityExempt(attackerOwnerId) || isAttackEligibilityExempt(defenderOwnerId)) return EXEMPT;
  const score = (ownerId: string) => {
    if (scoreCache?.has(ownerId)) return scoreCache.get(ownerId);
    const value = selectOwnerScore(state, ownerId);
    scoreCache?.set(ownerId, value);
    return value;
  };
  return evaluateAttackEligibility(score(attackerOwnerId), score(defenderOwnerId));
}
