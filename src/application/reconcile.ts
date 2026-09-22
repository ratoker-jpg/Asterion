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
import { reconcileFlights, type FlightReconcileEvent } from './flights.ts';

export type RuntimeReconcileEvent =
  | { kind: 'science'; scienceIds: ScienceId[] }
  | { kind: 'building'; planetId: string; assetRole: BuildingRole }
  | { kind: 'recycling'; planetId: string; jobIds: string[] }
  | { kind: 'spaceport'; planetId: string; tasks: Array<{ track: SpaceportUpgradeTrack; shipId: string }> }
  | { kind: 'fleet-production'; planetId: string; completed: FleetProductionCompletion[] }
  | { kind: 'flight'; events: FlightReconcileEvent[] };

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
  const planetIds = Object.keys(next.planets).sort();
  let selectedCredit: ResourceCreditResult | null = null;

  // Close every owned planet's interval using its own buildings and clock.
  // Any completion at this exact timestamp affects the next interval.
  for (const planetId of planetIds) {
    const resources = reconcileResourceIncome(next, { ...context, planetId });
    if (planetId === context.planetId || selectedCredit === null) selectedCredit = resources.credit;
    if (resources.changed) next = resources.state;
  }

  const science = reconcileScience(next, { ...context, planetId: context.planetId });
  if (science.changed) {
    next = science.state;
    if (science.completedScienceIds.length > 0) {
      events.push({ kind: 'science', scienceIds: science.completedScienceIds });
    }
  }

  for (const planetId of planetIds) {
    const planetContext = { ...context, planetId };
    const building = completeBuilding(next, planetContext);
    if (building.changed && building.completedRole) {
      next = building.state;
      events.push({ kind: 'building', planetId, assetRole: building.completedRole });
    }

    const recycling = reconcileRecycling(next, planetContext);
    if (recycling.state !== next) {
      next = recycling.state;
      if (recycling.autoCollectedJobIds.length > 0) {
        events.push({ kind: 'recycling', planetId, jobIds: recycling.autoCollectedJobIds });
      }
    }

    const trade = reconcileTrade(next, planetContext);
    if (trade.state !== next) next = trade.state;

    const spaceport = reconcileSpaceport(next, planetContext);
    if (spaceport.state !== next) {
      next = spaceport.state;
      if (spaceport.completed.length > 0) {
        events.push({ kind: 'spaceport', planetId, tasks: spaceport.completed });
      }
    }

    const fleetProduction = reconcileFleetProduction(next, { planetId, now: context.now });
    if (fleetProduction.changed) {
      next = fleetProduction.state;
      if (fleetProduction.completed.length > 0) {
        events.push({ kind: 'fleet-production', planetId, completed: fleetProduction.completed });
      }
    }
  }

  // No rng fallback here: espionage rolls derive their own deterministic
  // seeded streams when context.rng is not provided.
  const flights = reconcileFlights(next, context.now, context.rng, {
    mode: context.mode,
    testTimeScale: context.testTimeScale,
    reconcileTargetResources: true,
  });
  if (flights.changed) {
    next = flights.state;
    if (flights.events.length > 0) events.push({ kind: 'flight', events: flights.events });
  }

  return {
    changed: next !== state,
    state: next,
    events,
    credit: selectedCredit ?? {
      wallet: { metal: 0, minerals: 0, gas: 0, energy: 0 },
      accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 },
      burned: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    },
  };
}
