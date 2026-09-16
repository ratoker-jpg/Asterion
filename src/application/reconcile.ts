import {
  completeBuilding,
  reconcileRecycling,
  reconcileSpaceport,
  reconcileTrade,
  type BuildingApplicationContext,
} from './buildings.ts';
import { reconcileScience } from './science.ts';
import { reconcileFleetProduction } from './fleet-production.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import type { ScienceId } from '../domain/science/types.ts';
import type { SpaceportUpgradeTrack } from '../domain/buildings/spaceport-upgrades.ts';
import type { SaveState } from './contracts.ts';
import { reconcileResourceIncome } from './resource-clock.ts';
import type { ResourceCreditResult } from '../domain/resources/credit.ts';
import type { FleetProductionCompletion } from '../domain/fleet/production.ts';

export type RuntimeReconcileEvent =
  | { kind: 'science'; scienceIds: ScienceId[] }
  | { kind: 'building'; assetRole: BuildingRole }
  | { kind: 'recycling'; jobIds: string[] }
  | { kind: 'spaceport'; tasks: Array<{ track: SpaceportUpgradeTrack; shipId: string }> }
  | { kind: 'fleet-production'; completed: FleetProductionCompletion[] };

export type RuntimeReconcileResult = {
  changed: boolean;
  state: SaveState;
  events: RuntimeReconcileEvent[];
  credit: ResourceCreditResult;
};

/**
 * Runs the existing independent queue transitions in the same order as App's
 * effects. Queue semantics stay in their domain modules; this only owns the
 * shared clock and the orchestration boundary.
 */
export function reconcileRuntime(
  state: SaveState,
  context: BuildingApplicationContext,
): RuntimeReconcileResult {
  let next = state;
  const events: RuntimeReconcileEvent[] = [];

  // Close the interval using the pre-transition buildings and capacities. Any
  // completion at this exact timestamp affects the next interval.
  const resources = reconcileResourceIncome(next, context);
  if (resources.changed) next = resources.state;

  const science = reconcileScience(next, context);
  if (science.changed) {
    next = science.state;
    if (science.completedScienceIds.length > 0) {
      events.push({ kind: 'science', scienceIds: science.completedScienceIds });
    }
  }

  const building = completeBuilding(next, context);
  if (building.changed && building.completedRole) {
    next = building.state;
    events.push({ kind: 'building', assetRole: building.completedRole });
  }

  const recycling = reconcileRecycling(next, context);
  if (recycling.state !== next) {
    next = recycling.state;
    if (recycling.autoCollectedJobIds.length > 0) {
      events.push({ kind: 'recycling', jobIds: recycling.autoCollectedJobIds });
    }
  }

  const trade = reconcileTrade(next, context);
  if (trade.state !== next) next = trade.state;

  const spaceport = reconcileSpaceport(next, context);
  if (spaceport.state !== next) {
    next = spaceport.state;
    if (spaceport.completed.length > 0) {
      events.push({ kind: 'spaceport', tasks: spaceport.completed });
    }
  }

  const fleetProduction = reconcileFleetProduction(next, context);
  if (fleetProduction.changed) {
    next = fleetProduction.state;
    if (fleetProduction.completed.length > 0) {
      events.push({ kind: 'fleet-production', completed: fleetProduction.completed });
    }
  }

  return { changed: next !== state, state: next, events, credit: resources.credit };
}
