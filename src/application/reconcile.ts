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
import {
  reconcileAllPlanetOverpopulation,
} from './overpopulation.ts';
import type { PlanetId } from './contracts.ts';
import { getEspionageState } from '../domain/espionage/runtime.ts';
import { collectOrbitalDebrisAtCoordinate, getOrbitalDebrisAtCoordinate } from '../domain/espionage/orbital-debris.ts';
import { advanceUniverseAsteroidSimulationAt, getNextUniverseAsteroidTransitionAt } from '../domain/universe/asteroid-simulation.ts';

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
  let selectedCredit: ResourceCreditResult | null = null;
  const emptyCredit = (): ResourceCreditResult => ({
    wallet: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    burned: { metal: 0, minerals: 0, gas: 0, energy: 0 },
  });

  const reconcilePlanetWork = (
    at: number,
    blockedPlanetIds: ReadonlySet<PlanetId>,
  ) => {
    const planetIds = Object.keys(next.planets).sort();
    for (const planetId of planetIds) {
      if (blockedPlanetIds.has(planetId)) continue;
      const resources = reconcileResourceIncome(next, { ...context, planetId, now: at });
      if (planetId === context.planetId || selectedCredit === null) selectedCredit = resources.credit;
      if (resources.changed) next = resources.state;
    }

    const blockedPlanetStartedAt = new Map<PlanetId, number>();
    for (const planetId of blockedPlanetIds) {
      const episode = next.planets[planetId]?.overpopulation;
      if (episode?.blocked) blockedPlanetStartedAt.set(planetId, episode.episodeStartedAt);
    }
    const science = reconcileScience(next, {
      planetId: context.planetId,
      now: at,
      blockedPlanetIds,
      blockedPlanetStartedAt,
    });
    if (science.changed) {
      next = science.state;
      if (science.completedScienceIds.length > 0) {
        events.push({ kind: 'science', scienceIds: science.completedScienceIds });
      }
    }

    for (const planetId of planetIds) {
      if (blockedPlanetIds.has(planetId)) continue;
      const planetContext = { ...context, planetId, now: at };
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

      const fleetProduction = reconcileFleetProduction(next, { planetId, now: at });
      if (fleetProduction.changed) {
        next = fleetProduction.state;
        if (fleetProduction.completed.length > 0) {
          events.push({ kind: 'fleet-production', planetId, completed: fleetProduction.completed });
        }
      }
    }
  };

  const nextDueFlightCheckpoint = (after: number): number | undefined => {
    let earliest: number | undefined;
    for (const flight of next.flights.records) {
      const checkpoint = flight.phase === 'outbound'
        ? flight.arrivalAt
        : flight.phase === 'returning'
          ? flight.returnAt
          : undefined;
      if (checkpoint === undefined || !Number.isFinite(checkpoint)
        || checkpoint > context.now || checkpoint <= after) continue;
      if (earliest === undefined || checkpoint < earliest) earliest = checkpoint;
    }
    return earliest;
  };

  const applyAsteroidTransitionsAt = (at: number) => {
    const simulation = next.asteroidSimulation;
    if (!simulation) return;
    const advanced = advanceUniverseAsteroidSimulationAt(simulation, at, 1);
    next = { ...next, asteroidSimulation: advanced.state };
    for (const transition of advanced.transitions) {
      const espionage = getEspionageState(next);
      const freeDebris = getOrbitalDebrisAtCoordinate(espionage, transition.fromCoordinate);
      const key = String(transition.spawnIndex);
      if (freeDebris > 0) {
        const captured = collectOrbitalDebrisAtCoordinate(espionage, transition.fromCoordinate, freeDebris);
        if (captured.collected > 0) {
          const previousCargo = Math.max(0, Math.floor(next.asteroidDebrisBySpawnIndex?.[key] ?? 0));
          next = {
            ...next,
            espionage: captured.espionage,
            asteroidDebrisBySpawnIndex: {
              ...(next.asteroidDebrisBySpawnIndex ?? {}),
              [key]: Math.min(Number.MAX_SAFE_INTEGER, previousCargo + captured.collected),
            },
          };
        }
      }

      // The final boundary transition still vacates its last coordinate and
      // captures free debris there, then the asteroid and all its cargo leave.
      if (!advanced.state.asteroids.some((asteroid) => asteroid.spawnIndex === transition.spawnIndex)) {
        const cargo = { ...(next.asteroidDebrisBySpawnIndex ?? {}) };
        delete cargo[key];
        next = { ...next, asteroidDebrisBySpawnIndex: cargo };
      }
    }
  };

  const processFlightsAt = (at: number) => {
    // No rng fallback here: espionage rolls derive their own deterministic
    // seeded streams when context.rng is not provided.
    const flights = reconcileFlights(next, at, context.rng, {
      mode: context.mode,
      testTimeScale: context.testTimeScale,
      reconcileTargetResources: true,
    });
    if (flights.changed) {
      next = flights.state;
      if (flights.events.length > 0) events.push({ kind: 'flight', events: flights.events });
    }
  };

  let processedThrough = Number.NEGATIVE_INFINITY;
  while (true) {
    const flightCheckpoint = nextDueFlightCheckpoint(processedThrough);
    const nextAsteroidCheckpoint = next.asteroidSimulation
      ? getNextUniverseAsteroidTransitionAt(next.asteroidSimulation, context.now)
      : null;
    const asteroidCheckpoint = nextAsteroidCheckpoint ?? undefined;
    const checkpoint = flightCheckpoint === undefined
      ? asteroidCheckpoint
      : asteroidCheckpoint === undefined
        ? flightCheckpoint
        : Math.min(flightCheckpoint, asteroidCheckpoint);
    if (checkpoint === undefined) break;
    const asteroidIsDue = asteroidCheckpoint === checkpoint;
    const flightIsDue = flightCheckpoint === checkpoint;
    // Advancing the cursor before processing prevents a due-but-unmodified
    // record at this timestamp from creating a zero-progress loop. Flights
    // created by this checkpoint can still contribute a later return time.
    processedThrough = checkpoint;
    // At an exact millisecond tie, the asteroid vacates/captures its old orbit
    // first; flight arrivals and battles then observe the post-transition
    // free-orbit state. Flight ties retain reconcileFlights' stable ID order.
    if (asteroidIsDue) applyAsteroidTransitionsAt(checkpoint);
    if (flightIsDue) {
      const overpopulation = reconcileAllPlanetOverpopulation(next, checkpoint);
      next = overpopulation.state;
      const beforeWork = overpopulation.blockedPlanetIds;
      reconcilePlanetWork(checkpoint, beforeWork);
      processFlightsAt(checkpoint);
      next = reconcileAllPlanetOverpopulation(next, checkpoint).state;
    }
  }

  const finalOverpopulation = reconcileAllPlanetOverpopulation(next, context.now);
  next = finalOverpopulation.state;
  reconcilePlanetWork(context.now, finalOverpopulation.blockedPlanetIds);
  processFlightsAt(context.now);
  next = reconcileAllPlanetOverpopulation(next, context.now).state;

  return {
    changed: next !== state,
    state: next,
    events,
    credit: selectedCredit ?? emptyCredit(),
  };
}
