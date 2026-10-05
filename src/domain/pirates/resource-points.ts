import { isPirateShipId } from '../combat/side-entity.ts';
import type { BattlePointStack } from '../combat/battle-points.ts';
import { PIRATE_CATALOG_BY_ID } from './catalog.ts';

const RESOURCE_UNITS_PER_POINT = 1_000;

/** Calculates pirate ship losses from the pirate catalog, separate from playable faction catalogs. */
export function calculatePirateResourcePointsLost(stacks: readonly BattlePointStack[]) {
  return stacks.reduce((total, stack) => {
    if (!isPirateShipId(stack.entityId) || stack.countBefore == null || stack.countAfter == null) return total;
    const destroyed = Math.max(0, Math.floor(stack.countBefore) - Math.floor(stack.countAfter));
    if (!destroyed) return total;
    const cost = PIRATE_CATALOG_BY_ID[stack.entityId].cost;
    return total + destroyed * (cost.metal + cost.minerals + cost.gas) / RESOURCE_UNITS_PER_POINT;
  }, 0);
}
