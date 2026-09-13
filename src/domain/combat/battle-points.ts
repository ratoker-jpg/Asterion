import { COMBAT_ENTITY_BY_ID } from './catalog.ts';
import type { CombatEntityId } from './ids.ts';
import type { BattleWinner } from './report.ts';

const RESOURCE_UNITS_PER_POINT = 1_000;

export type BattlePointStack = {
  entityId: string;
  countBefore: number | null;
  countAfter: number | null;
};

export type BattlePointResult = {
  attackerResourcePointsLost: number;
  defenderResourcePointsLost: number;
  attacker: number;
  defender: number;
};

function destroyedCount(stack: BattlePointStack) {
  if (stack.countBefore == null || stack.countAfter == null) return 0;
  return Math.max(0, Math.floor(stack.countBefore) - Math.floor(stack.countAfter));
}

/**
 * Converts the catalog cost of destroyed units into Nemexia resource points.
 * Solar satellites are intentionally excluded: Nemexia does not award battle
 * points for them, even though they have a catalog cost in Asterion.
 */
export function calculateResourcePointsLost(
  stacks: readonly BattlePointStack[],
  defenses: readonly BattlePointStack[] = [],
) {
  return [...stacks, ...defenses].reduce((total, stack) => {
    if (stack.entityId === 'solar-satellite') return total;
    const destroyed = destroyedCount(stack);
    const entity = COMBAT_ENTITY_BY_ID.get(stack.entityId as CombatEntityId);
    if (!destroyed || !entity) return total;
    const cost = entity.cost.metal + entity.cost.minerals + entity.cost.gas;
    return total + destroyed * cost / RESOURCE_UNITS_PER_POINT;
  }, 0);
}

function roundedBattlePoints(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function winnerPoints(winnerLoss: number, loserLoss: number) {
  if (winnerLoss <= 0 && loserLoss <= 0) return 0;
  const denominator = loserLoss - winnerLoss / 2;
  if (denominator <= 0) return 0;
  return roundedBattlePoints(loserLoss * Math.sqrt((loserLoss + winnerLoss / 2) / denominator));
}

function loserPoints(winnerLoss: number, loserLoss: number) {
  if (winnerLoss <= 0 && loserLoss <= 0) return 0;
  const denominator = loserLoss + winnerLoss / 2;
  if (denominator <= 0) return 0;
  const ratio = Math.max(0, (loserLoss - winnerLoss / 2) / denominator);
  return roundedBattlePoints(winnerLoss * Math.sqrt(ratio));
}

/**
 * Calculates both sides' Battle Points from the report's historical losses.
 * On a draw, the side with fewer resource-point losses is treated as the
 * winner for this formula only; an exact tie deterministically favors attacker.
 */
export function calculateBattlePoints(
  winner: BattleWinner,
  attackerStacks: readonly BattlePointStack[],
  defenderStacks: readonly BattlePointStack[],
  attackerDefenses: readonly BattlePointStack[] = [],
  defenderDefenses: readonly BattlePointStack[] = [],
): BattlePointResult {
  const attackerResourcePointsLost = calculateResourcePointsLost(attackerStacks, attackerDefenses);
  const defenderResourcePointsLost = calculateResourcePointsLost(defenderStacks, defenderDefenses);
  const formulaWinner = winner === 'draw'
    ? attackerResourcePointsLost <= defenderResourcePointsLost ? 'attacker' : 'defender'
    : winner;
  const winnerLoss = formulaWinner === 'attacker' ? attackerResourcePointsLost : defenderResourcePointsLost;
  const loserLoss = formulaWinner === 'attacker' ? defenderResourcePointsLost : attackerResourcePointsLost;
  const winnerBattlePoints = winnerPoints(winnerLoss, loserLoss);
  const loserBattlePoints = loserPoints(winnerLoss, loserLoss);

  return {
    attackerResourcePointsLost,
    defenderResourcePointsLost,
    attacker: formulaWinner === 'attacker' ? winnerBattlePoints : loserBattlePoints,
    defender: formulaWinner === 'defender' ? winnerBattlePoints : loserBattlePoints,
  };
}
