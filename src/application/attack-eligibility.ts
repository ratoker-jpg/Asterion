import type { SaveState } from './contracts.ts';
import { evaluateAttackEligibility, type AttackEligibility, type AttackEligibilityPoints } from '../domain/rating/attack-eligibility.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { ownShieldMessage, SHIELD_TELEMETRY, targetShieldMessage } from './shield.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';

const EXEMPT: AttackEligibility = { allowed: true, reason: null, message: null, byTotal: false, byResource: false };

/** Test Mode Bot 01 scenarios are verification fixtures, outside the owner points rule. */
export function isAttackEligibilityExempt(ownerId: string | undefined): boolean {
  return ownerId === UNIVERSE_NPC_OWNER_ID;
}

/**
 * The gate itself, over any source of the owners' points. The map asks it with
 * the points it already holds, so its colours and the launch give one answer.
 */
export function evaluateOwnerAttackEligibility(
  attackerOwnerId: string,
  defenderOwnerId: string,
  scoreOf: (ownerId: string) => AttackEligibilityPoints | undefined,
): AttackEligibility {
  if (isAttackEligibilityExempt(attackerOwnerId) || isAttackEligibilityExempt(defenderOwnerId)) return EXEMPT;
  return evaluateAttackEligibility(scoreOf(attackerOwnerId), scoreOf(defenderOwnerId));
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
  /** Game time of the launch; when given, planet shields are checked too. */
  at?: number,
): AttackEligibility {
  if (at !== undefined && !isAttackEligibilityExempt(attackerOwnerId) && !isAttackEligibilityExempt(defenderOwnerId)) {
    const own = ownShieldMessage(state, attackerOwnerId, at);
    if (own) return { allowed: false, reason: 'attacker-shielded', message: own };
    const theirs = targetShieldMessage(state, defenderOwnerId, at);
    if (theirs) SHIELD_TELEMETRY.attacksBlocked += 1;
    if (theirs) return { allowed: false, reason: 'defender-shielded', message: theirs };
  }
  return evaluateOwnerAttackEligibility(attackerOwnerId, defenderOwnerId, (ownerId) => {
    if (scoreCache?.has(ownerId)) return scoreCache.get(ownerId);
    const value = selectOwnerScore(state, ownerId);
    scoreCache?.set(ownerId, value);
    return value;
  });
}
