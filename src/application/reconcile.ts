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
import { reconcileSunRaids, type SunRaidNotice } from './sun-raid.ts';
import { reconcileAidMembership, syncAidState } from './alliance-aid.ts';
import { selectDuePirateRolls, resolveDuePirateRoll } from './pirate-raids.ts';
import { advanceExplorationNpcProgress, selectDueExplorationNpcRolls, resolveDueExplorationNpcRoll } from './exploration-npc.ts';
import { createDefaultPirateState } from '../domain/pirates/mission.ts';
import {
  reconcileAllPlanetOverpopulation,
} from './overpopulation.ts';
import type { PlanetId } from './contracts.ts';
import { getEspionageState, getEspionageTargets } from '../domain/espionage/runtime.ts';
import { collectOrbitalDebrisAtCoordinate, getOrbitalDebrisAtCoordinate } from '../domain/espionage/orbital-debris.ts';
import { advanceUniverseAsteroidSimulationAt, getNextUniverseAsteroidTransitionAt } from '../domain/universe/asteroid-simulation.ts';
import { advanceAsteroidGasAt } from '../domain/universe/asteroid-gas.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { createExplorationState, recordHighestExplorationScore } from '../domain/exploration/ledger.ts';

export type RuntimeReconcileEvent =
  | { kind: 'science'; scienceIds: ScienceId[] }
  | { kind: 'building'; planetId: string; assetRole: BuildingRole }
  | { kind: 'recycling'; planetId: string; jobIds: string[] }
  | { kind: 'spaceport'; planetId: string; tasks: Array<{ track: SpaceportUpgradeTrack; shipId: string }> }
  | { kind: 'fleet-production'; planetId: string; completed: FleetProductionCompletion[] }
  | { kind: 'flight'; events: FlightReconcileEvent[] }
  | { kind: 'sun-raid'; notices: SunRaidNotice[] }
  | { kind: 'pirate-raid-check'; ownerId: string; contactCycleKey: string; flightId?: string };

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
  // Aid flights whose sender, recipient or request no longer stand turn back before anything else settles.
  let next = reconcileAidMembership(state, context.now);
  const events: RuntimeReconcileEvent[] = [];
  const startingPirate = next.pirate ?? createDefaultPirateState();
  let pirateCursor = startingPirate.raidProcessedAt ?? context.now;
  if (!Number.isSafeInteger(pirateCursor) || pirateCursor < 0) pirateCursor = context.now;
  let raidDueEvents = selectDuePirateRolls(next, pirateCursor, context.now, context.mode, context.testTimeScale);
  let raidIndex = 0;
  const npcCursor = next.exploration?.npcProcessedAt ?? Math.max(0,context.now - 20*60_000);
  const npcDueEvents = selectDueExplorationNpcRolls(next,npcCursor,context.now,context.mode);
  let npcIndex = 0;
  let selectedCredit: ResourceCreditResult | null = null;
  const emptyCredit = (): ResourceCreditResult => ({
    wallet: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    accepted: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    burned: { metal: 0, minerals: 0, gas: 0, energy: 0 },
  });

  // The raid calendar is keyed by (owner, system), not by colony. Rebuild its
  // remaining due events only when that footprint changes during flight arrivals
  // (e.g. colonization or the destruction of an owner's last planet in a system).
  const raidSystemFootprint = (value: SaveState): string => {
    const systems = new Set<string>();
    for (const planet of Object.values(value.planets)) {
      systems.add(JSON.stringify([value.profile.playerId, planet.universeGalaxy ?? 1, planet.universeSystem ?? 1]));
    }
    for (const target of Object.values(getEspionageTargets(value.espionage))) {
      if (target.ownerId !== value.profile.playerId) {
        systems.add(JSON.stringify([target.ownerId, target.coordinate.galaxy, target.coordinate.system]));
      }
    }
    return [...systems].sort().join('|');
  };

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
          : flight.phase === 'arrived' && flight.missionId === 'expedition'
            ? (() => {
              const contact = flight.operationId ? next.exploration?.contacts[flight.operationId] : undefined;
              if (!contact?.claim || contact.claim.flightId !== flight.id) return flight.arrivalAt;
              return Math.min(contact.expiresAt, contact.claim.pendingRecallAt === undefined
                ? Number.POSITIVE_INFINITY : contact.claim.pendingRecallAt + 30_000);
            })()
          : undefined;
      if (checkpoint === undefined || !Number.isFinite(checkpoint)
        || checkpoint > context.now || checkpoint <= after) continue;
      if (earliest === undefined || checkpoint < earliest) earliest = checkpoint;
    }
    return earliest;
  };

  // Building and research completions change income and energy: income up to
  // each finishAt accrues at the old rate, the completion applies, and the rest
  // of the interval accrues at the new rate, however rarely the game is opened.
  const nextDueWorkCheckpoint = (after: number): number | undefined => {
    let earliest: number | undefined;
    const consider = (checkpoint: number | undefined) => {
      if (checkpoint === undefined || !Number.isFinite(checkpoint)
        || checkpoint > context.now || checkpoint <= after) return;
      if (earliest === undefined || checkpoint < earliest) earliest = checkpoint;
    };
    for (const planetId of Object.keys(next.planets)) consider(next.queues[planetId]?.[0]?.finishAt);
    consider(next.science.queue[0]?.finishAt);
    return earliest;
  };

  const applyAsteroidTransitionsAt = (at: number) => {
    const simulation = next.asteroidSimulation;
    if (!simulation) return;
    const advanced = advanceUniverseAsteroidSimulationAt(simulation, at, 1);
    next = { ...next, asteroidSimulation: advanced.state };
    for (const transition of advanced.transitions) {
      const key = String(transition.spawnIndex);
      // An asteroid on the first position of a system also sweeps the Sun's debris (position 0).
      const sweep = transition.fromCoordinate.position === 1
        ? [transition.fromCoordinate, { ...transition.fromCoordinate, position: 0 }]
        : [transition.fromCoordinate];
      for (const coordinate of sweep) {
      const espionage = getEspionageState(next);
      const freeDebris = getOrbitalDebrisAtCoordinate(espionage, coordinate);
      if (freeDebris > 0) {
        const captured = collectOrbitalDebrisAtCoordinate(espionage, coordinate, freeDebris);
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
      }

      // The final boundary transition still vacates its last coordinate and
      // captures free debris there, then the asteroid and all its cargo leave.
      if (!advanced.state.asteroids.some((asteroid) => asteroid.spawnIndex === transition.spawnIndex)) {
        const cargo = { ...(next.asteroidDebrisBySpawnIndex ?? {}) };
        delete cargo[key];
        next = { ...next, asteroidDebrisBySpawnIndex: cargo };
      }
    }
    advanceAsteroidGasForSimulationAt(at);
  };

  const advanceAsteroidGasForSimulationAt = (at: number) => {
    const simulation = next.asteroidSimulation;
    if (!simulation) return;
    let changed = false;
    const asteroids = simulation.asteroids.map((asteroid) => {
      const advanced = advanceAsteroidGasAt(asteroid, at);
      if (advanced !== asteroid) changed = true;
      return advanced;
    });
    if (changed) next = { ...next, asteroidSimulation: { ...simulation, asteroids } };
  };

  const processFlightsAt = (at: number): boolean => {
    // No rng fallback here: espionage rolls derive their own deterministic
    // seeded streams when context.rng is not provided.
    const beforeSystems = raidSystemFootprint(next);
    const flights = reconcileFlights(next, at, context.rng, {
      mode: context.mode,
      testTimeScale: context.testTimeScale,
      reconcileTargetResources: true,
    });
    if (flights.changed) {
      next = flights.state;
      if (flights.events.length > 0) events.push({ kind: 'flight', events: flights.events });
    }
    // Sun raids run after ordinary arrivals: a Bot 01 assault resolved at this
    // checkpoint can already destroy a Gate, and Sun battles see the same clock.
    const sun = reconcileSunRaids(next, { now: at, mode: context.mode, testTimeScale: context.testTimeScale });
    if (sun.changed) next = sun.state;
    if (sun.notices.length) events.push({ kind: 'sun-raid', notices: sun.notices });
    return (flights.changed || sun.changed) && beforeSystems !== raidSystemFootprint(next);
  };

  let processedThrough = Number.NEGATIVE_INFINITY;
  while (true) {
    const flightCheckpoint = nextDueFlightCheckpoint(processedThrough);
    while (raidIndex < raidDueEvents.length && raidDueEvents[raidIndex]!.at <= processedThrough) raidIndex++;
    while (npcIndex < npcDueEvents.length && npcDueEvents[npcIndex]!.at <= processedThrough) npcIndex++;
    const pirateCheckpoint = raidDueEvents[raidIndex]?.at;
    const npcCheckpoint = npcDueEvents[npcIndex]?.at;
    const nextAsteroidCheckpoint = next.asteroidSimulation
      ? getNextUniverseAsteroidTransitionAt(next.asteroidSimulation, context.now)
      : null;
    const asteroidCheckpoint = nextAsteroidCheckpoint ?? undefined;
    const workCheckpoint = nextDueWorkCheckpoint(processedThrough);
    const checkpoint = [flightCheckpoint, asteroidCheckpoint, pirateCheckpoint, npcCheckpoint, workCheckpoint]
      .filter((point): point is number => point !== undefined)
      .reduce<number | undefined>((min, point) => min === undefined ? point : Math.min(min,point), undefined);
    if (checkpoint === undefined) break;
    const asteroidIsDue = asteroidCheckpoint === checkpoint;
    const flightIsDue = flightCheckpoint === checkpoint;
    const pirateIsDue = pirateCheckpoint === checkpoint;
    const npcIsDue = npcCheckpoint === checkpoint;
    const workIsDue = workCheckpoint === checkpoint;
    // Advancing the cursor before processing prevents a due-but-unmodified
    // record at this timestamp from creating a zero-progress loop. Flights
    // created by this checkpoint can still contribute a later return time.
    processedThrough = checkpoint;
    // At an exact millisecond tie, the asteroid vacates/captures its old orbit
    // first; flight arrivals and battles then observe the post-transition
    // free-orbit state. Flight ties retain reconcileFlights' stable ID order.
    if (asteroidIsDue) applyAsteroidTransitionsAt(checkpoint);
    if (workIsDue && !flightIsDue && !pirateIsDue && !npcIsDue) {
      // A completion alone: settle income and queues at its finishAt. Overpopulation
      // episodes keep their existing detection points (reconcile time and the
      // other checkpoints); only an already stored lock pauses work here.
      const storedLocks = new Set(Object.entries(next.planets)
        .filter(([, planet]) => planet.overpopulation?.blocked === true)
        .map(([planetId]) => planetId));
      reconcilePlanetWork(checkpoint, storedLocks);
    } else if (flightIsDue || pirateIsDue || npcIsDue) {
      advanceAsteroidGasForSimulationAt(checkpoint);
      const overpopulation = reconcileAllPlanetOverpopulation(next, checkpoint);
      next = overpopulation.state;
      reconcilePlanetWork(checkpoint, overpopulation.blockedPlanetIds);
      const defeatedBefore = next.pirate?.contact.defeatedCycles;
      if (flightIsDue && processFlightsAt(checkpoint)) {
        // Include checks exactly at this timestamp: arrivals are resolved first,
        // then newly owned systems participate in the same-time pirate roll.
        raidDueEvents = selectDuePirateRolls(next, Math.max(pirateCursor, checkpoint - 1),
          context.now, context.mode, context.testTimeScale);
        raidIndex = 0;
      }
      next = reconcileAllPlanetOverpopulation(next, checkpoint).state;
      if (pirateIsDue || raidDueEvents[raidIndex]?.at === checkpoint) {
        while (raidIndex < raidDueEvents.length && raidDueEvents[raidIndex]!.at === checkpoint) {
          const event = raidDueEvents[raidIndex++]!;
          next = resolveDuePirateRoll(next, event, context.mode, context.testTimeScale);
          const roll = next.pirate?.raidRolls?.[JSON.stringify([event.ownerId,event.contactCycleKey])];
          events.push({kind:'pirate-raid-check', ownerId:event.ownerId,
            contactCycleKey:event.contactCycleKey,...(roll?.flightId?{flightId:roll.flightId}:{})});
        }
      }
      if (npcIsDue) {
        // At a tie, all arriving flights resolve FIRST. NPC competition uses
        // only the resulting real contact owner and NPC's own hangar.
        while(npcIndex<npcDueEvents.length && npcDueEvents[npcIndex]!.at===checkpoint){
          const due=npcDueEvents[npcIndex++]!;
          next=resolveDueExplorationNpcRoll(next,due,context.testTimeScale);
        }
      }
      if (next.pirate?.contact.defeatedCycles !== defeatedBefore) {
        raidDueEvents = selectDuePirateRolls(next, checkpoint, context.now, context.mode, context.testTimeScale);
        raidIndex = 0;
      }
      // A Hall lost to an arrival at this checkpoint must stop the charge clock from here on, not from `now`.
      next = syncAidState(next, { now: checkpoint, mode: context.mode, testTimeScale: context.testTimeScale });
    }
  }

  const finalOverpopulation = reconcileAllPlanetOverpopulation(next, context.now);
  next = finalOverpopulation.state;
  reconcilePlanetWork(context.now, finalOverpopulation.blockedPlanetIds);
  advanceAsteroidGasForSimulationAt(context.now);
  if (processFlightsAt(context.now)) {
    // Covers legacy arrived-phase flights processed only by the final sweep.
    for (const event of selectDuePirateRolls(next, Math.max(pirateCursor, context.now - 1),
      context.now, context.mode, context.testTimeScale)) {
      next = resolveDuePirateRoll(next, event, context.mode, context.testTimeScale);
      const roll = next.pirate?.raidRolls?.[JSON.stringify([event.ownerId, event.contactCycleKey])];
      events.push({ kind: 'pirate-raid-check', ownerId: event.ownerId,
        contactCycleKey: event.contactCycleKey, ...(roll?.flightId ? { flightId: roll.flightId } : {}) });
    }
  }
  next = reconcileAllPlanetOverpopulation(next, context.now).state;
  next = reconcileAidMembership(next, context.now);
  next = syncAidState(next, { now: context.now, mode: context.mode, testTimeScale: context.testTimeScale });
  // Preserve the all-time resource high-water mark across losses, fleet launches
  // and reloads. A later weak expedition must never erase an earlier real peak.
  const currentScore = selectOwnerScores(next)[next.profile.playerId]?.resourcePoints ?? 0;
  const previousLedger = next.exploration ?? createExplorationState();
  const scoredLedger = recordHighestExplorationScore(previousLedger, next.profile.playerId, currentScore);
  const updatedLedger = context.mode === 'production'
    ? advanceExplorationNpcProgress(scoredLedger,npcCursor,context.now)
    : scoredLedger;
  if (updatedLedger !== previousLedger) next = {...next, exploration: updatedLedger};
  const completedCursor = Math.max(pirateCursor, context.now);
  if (next.pirate?.raidProcessedAt !== completedCursor) {
    next = {...next, pirate: {...(next.pirate ?? createDefaultPirateState()),raidProcessedAt:completedCursor}};
  }

  return {
    changed: next !== state,
    state: next,
    events,
    credit: selectedCredit ?? emptyCredit(),
  };
}
