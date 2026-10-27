/**
 * Owner rule for attacking another owner's planet (player or NPC), checked
 * once at launch. A flight already in the air arrives even if the points have
 * changed since.
 *
 * - Below 300 total points an owner can neither attack nor be attacked.
 * - Otherwise the target is in range when its total points lie within
 *   [attacker / 2; attacker × 2], or its resource points lie within the same
 *   band of the attacker's resource points. Both bounds are inclusive; a zero
 *   on either side of the resource branch never admits.
 *
 * Pirates, Suns, exploration objects and the Test Mode Bot 01 are outside the
 * rule; callers decide that before asking. Alliance wars and NPC revenge do
 * not lift it.
 */
export const ATTACK_PROTECTION_TOTAL_POINTS = 300;

export type AttackEligibilityPoints = {
  totalPoints: number;
  resourcePoints: number;
};

export type AttackPointRange = { min: number; max: number };

export type AttackEligibility =
  | { allowed: true; reason: null; message: null; byTotal: boolean; byResource: boolean }
  | {
    allowed: false;
    reason: 'attacker-protected' | 'defender-protected';
    message: string;
    attacker: AttackEligibilityPoints;
    defender: AttackEligibilityPoints;
  }
  | {
    allowed: false;
    reason: 'out-of-range';
    message: string;
    attacker: AttackEligibilityPoints;
    defender: AttackEligibilityPoints;
    totalRange: AttackPointRange;
    resourceRange: AttackPointRange | null;
  };

function points(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalize(value: Partial<AttackEligibilityPoints> | null | undefined): AttackEligibilityPoints {
  return { totalPoints: points(value?.totalPoints), resourcePoints: points(value?.resourcePoints) };
}

/** Integer-exact: target × 2 ≥ own and target ≤ own × 2. */
function withinBand(own: number, target: number): boolean {
  return target * 2 >= own && target <= own * 2;
}

/** The inclusive band shown to the player; the lower bound rounds up to the first admitted whole point. */
export function attackPointRange(own: number): AttackPointRange {
  const safe = points(own);
  return { min: Math.ceil(safe / 2), max: safe * 2 };
}

function formatPoints(value: number): string {
  return Math.floor(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** «1 общее очко», «2 общих очка», «5 общих очков». */
function totalPointsPhrase(value: number): string {
  const lastTwo = value % 100;
  const last = value % 10;
  const amount = formatPoints(value);
  if (lastTwo >= 11 && lastTwo <= 14) return `${amount} общих очков`;
  if (last === 1) return `${amount} общее очко`;
  if (last >= 2 && last <= 4) return `${amount} общих очка`;
  return `${amount} общих очков`;
}

export function evaluateAttackEligibility(
  attackerPoints: Partial<AttackEligibilityPoints> | null | undefined,
  defenderPoints: Partial<AttackEligibilityPoints> | null | undefined,
): AttackEligibility {
  const attacker = normalize(attackerPoints);
  const defender = normalize(defenderPoints);
  if (attacker.totalPoints < ATTACK_PROTECTION_TOTAL_POINTS) {
    return {
      allowed: false,
      reason: 'attacker-protected',
      message: `У вас ${totalPointsPhrase(attacker.totalPoints)}: атаковать можно с ${ATTACK_PROTECTION_TOTAL_POINTS}.`,
      attacker,
      defender,
    };
  }
  if (defender.totalPoints < ATTACK_PROTECTION_TOTAL_POINTS) {
    return {
      allowed: false,
      reason: 'defender-protected',
      message: `У цели ${totalPointsPhrase(defender.totalPoints)}: атаковать можно с ${ATTACK_PROTECTION_TOTAL_POINTS}.`,
      attacker,
      defender,
    };
  }
  const byTotal = withinBand(attacker.totalPoints, defender.totalPoints);
  const byResource = attacker.resourcePoints > 0 && defender.resourcePoints > 0
    && withinBand(attacker.resourcePoints, defender.resourcePoints);
  if (byTotal || byResource) return { allowed: true, reason: null, message: null, byTotal, byResource };

  const totalRange = attackPointRange(attacker.totalPoints);
  const resourceRange = attacker.resourcePoints > 0 ? attackPointRange(attacker.resourcePoints) : null;
  const allowedText = `${formatPoints(totalRange.min)}–${formatPoints(totalRange.max)} общих`
    + (resourceRange ? ` или ${formatPoints(resourceRange.min)}–${formatPoints(resourceRange.max)} ресурсных` : '');
  return {
    allowed: false,
    reason: 'out-of-range',
    message: `Цель вне диапазона: у цели ${formatPoints(defender.totalPoints)} общих и ${formatPoints(defender.resourcePoints)} ресурсных, допустимо ${allowedText}.`,
    attacker,
    defender,
    totalRange,
    resourceRange,
  };
}
