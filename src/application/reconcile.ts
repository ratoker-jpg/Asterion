import {
  completeBuilding,
  reconcileRecycling,
  reconcileSpaceport,
  reconcileTrade,
  type BuildingApplicationContext,
} from './buildings.ts';
import { reconcileScience } from './science.ts';
import { pruneCampaignHistory } from './history-retention.ts';
import { reconcileFleetProduction } from './fleet-production.ts';
import { settleNpcFleetProduction, getNextNpcFleetProductionCheckpoint } from './npc-fleet-production.ts';
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
import { selectDuePirateRolls, resolveDuePirateRoll, type PirateDueRoll, type PirateRollWriteScope } from './pirate-raids.ts';
import { advanceExplorationNpcProgress, selectDueExplorationNpcRolls, resolveDueExplorationNpcRoll } from './exploration-npc.ts';
import { createDefaultPirateState } from '../domain/pirates/mission.ts';
import {
  reconcileAllPlanetOverpopulation,
} from './overpopulation.ts';
import type { PlanetId } from './contracts.ts';
import { getEspionageState, getEspionageTargets } from '../domain/espionage/runtime.ts';
import { collectOrbitalDebrisAtCoordinate, getOrbitalDebrisAtCoordinate } from '../domain/espionage/orbital-debris.ts';
import { advanceUniverseAsteroidSimulationAt, getNextUniverseAsteroidTransitionAt } from '../domain/universe/asteroid-simulation.ts';
import { advanceAsteroidGasAt, initializeAsteroidGasState } from '../domain/universe/asteroid-gas.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { createExplorationState, recordHighestExplorationScore } from '../domain/exploration/ledger.ts';
import { generateNpcOwnerReplayEvents, applyNpcReplayEventsAt, initializeNpcReplaySessionsAt, type NpcReplayEmission, type NpcReplayEvent } from './npc-replay.ts';
import { compareNpcEvents } from '../domain/npc/events.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { getNextNpcEconomyCheckpoint, settleNpcPlanet } from './npc-economy.ts';
import { getNextNpcScienceCheckpoint, pauseNpcScienceForSettlement, projectNpcScienceLedger, reconcileNpcScienceAt } from './npc-science.ts';
import { getReplayNpcOwnerIds, NPC_REPLAY_GENERATION_STEP_MS, NPC_REPLAY_MAX_GROUPS, NPC_REPLAY_WINDOW_MS } from './npc-catchup.ts';
import { CAMPAIGN_SPEED_SCALE } from '../domain/runtime/mode.ts';
import { LEADER_ABSENCE_MS } from '../domain/command/catalog.ts';
import { settleLeadership } from '../domain/command/membership.ts';

/**
 * One owner's NPC events in one aligned generation step, keyed by the frozen
 * profile (any applied event replaces the profile and so misses the cache).
 */
const ownerStepEventCache = new WeakMap<NpcProfile, Map<number, readonly NpcReplayEvent[]>>();
function cachedOwnerStepEvents(profile: NpcProfile, ownerId: string, stepStart: number): readonly NpcReplayEvent[] {
  let steps = ownerStepEventCache.get(profile);
  if (!steps) ownerStepEventCache.set(profile, steps = new Map());
  let events = steps.get(stepStart);
  if (!events) {
    // Replay only moves forward: earlier steps of this profile are done.
    for (const key of steps.keys()) if (key < stepStart) steps.delete(key);
    events = generateNpcOwnerReplayEvents(profile, ownerId, stepStart, stepStart + NPC_REPLAY_GENERATION_STEP_MS);
    steps.set(stepStart, events);
  }
  return events;
}

export type RuntimeReconcileEvent =
  | { kind: 'npc-economy'; events: readonly NpcReplayEmission[] }
  | { kind: 'npc-building'; planetId: string; assetRole: BuildingRole; at: number }
  | { kind: 'npc-science'; ownerId: string; scienceId: ScienceId; at: number }
  | { kind: 'npc-fleet-production'; ownerId: string; planetId: string; at: number; completed: FleetProductionCompletion[] }
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
  const owners = context.mode === 'production' ? getReplayNpcOwnerIds(state) : [];
  if (!owners.length) {
    const result = reconcileRuntimeSlice(state, context);
    if (context.mode === 'production') {
      const cleaned = reconcileNpcScienceAt(result.state, context.now).state;
      if (cleaned !== result.state) { result.state = cleaned; result.changed = true; }
    }
    if (context.mode === 'production' && state.npcReplay && state.npcReplay.targetAt > state.npcReplay.processedThroughAt) {
      result.state = { ...result.state, npcReplay: { version: 1, processedThroughAt: context.now, targetAt: context.now } };
      result.changed = true;
    }
    return result;
  }
  const from = state.npcReplay?.processedThroughAt ?? Math.max(0, Math.floor(state.resourceClock.lastReconciledAt));
  const frozen = state.npcReplay && state.npcReplay.targetAt > from ? state.npcReplay.targetAt : context.now;
  const targetAt = Math.max(from, Math.floor(frozen));
  const windowEnd = Math.min(targetAt, from + NPC_REPLAY_WINDOW_MS);
  const result = reconcileRuntimeSlice(state, { ...context, now: windowEnd }, { from, owners, targetAt });
  return result;
}

function reconcileRuntimeSlice(
  state: SaveState,
  context: BuildingApplicationContext,
  replay?: { from: number; owners: string[]; targetAt: number },
): RuntimeReconcileResult {
  // Aid flights whose sender, recipient or request no longer stand turn back before anything else settles.
  let next = projectNpcScienceLedger(reconcileAidMembership(state, context.now));
  const events: RuntimeReconcileEvent[] = [];
  const timeScale = CAMPAIGN_SPEED_SCALE[state.worldConfig?.world.campaignSpeed ?? 'standard'];
  const replayOwners = new Set(replay?.owners);
  if (replay && next.npc) next = { ...next, npc: initializeNpcReplaySessionsAt(next.npc, replay.from, replay.owners) };
  // NPC sessions and decisions in [from, now + 1), generated on demand an hour
  // at a time: a bounded slice usually consumes minutes of a 24-hour window.
  // Generation is a pure function of the slice-start profiles and the
  // half-open interval, and compareNpcEvents is a total order, so the
  // concatenated hours equal one generation of the whole window.
  const economicEvents: NpcReplayEvent[] = [];
  const npcAtSliceStart = replay ? next.npc : undefined;
  const economicEnd = context.now + 1;
  let economicGeneratedTo = replay?.from ?? economicEnd;
  // Owner order is irrelevant: each step is sorted by the total event order.
  const replayOwnerOrder = replay ? [...new Set(replay.owners)] : [];
  const ensureNextEconomicEvent = (index: number) => {
    while (economicEvents.length <= index && npcAtSliceStart && economicGeneratedTo < economicEnd) {
      // Whole aligned steps are generated (and cached per unchanged profile
      // across slices), then clipped to [generatedTo, end).
      const stepStart = Math.floor(economicGeneratedTo / NPC_REPLAY_GENERATION_STEP_MS) * NPC_REPLAY_GENERATION_STEP_MS;
      const to = Math.min(economicEnd, stepStart + NPC_REPLAY_GENERATION_STEP_MS);
      const step: NpcReplayEvent[] = [];
      for (const ownerId of replayOwnerOrder) {
        const profile = npcAtSliceStart.profiles[ownerId];
        if (!profile) continue;
        for (const event of cachedOwnerStepEvents(profile, ownerId, stepStart)) {
          if (event.at >= economicGeneratedTo && event.at < to) step.push(event);
        }
      }
      for (const event of step.sort(compareNpcEvents)) economicEvents.push(event);
      economicGeneratedTo = to;
    }
  };
  let economicIndex = 0;
  let processedGroups = 0;
  const settleNpcEconomies = (at: number, ownerIds?: ReadonlySet<string>) => {
    if (!replay || !next.espionage?.targets) return;
    const before = next.espionage.targets;
    const targets = { ...before };
    const settled = new Set<string>();
    let changed = false;
    for (const [id, target] of Object.entries(targets)) {
      if (!replayOwners.has(target.ownerId) || (ownerIds && !ownerIds.has(target.ownerId))) continue;
      const result = settleNpcPlanet(target, at, { timeScale });
      settled.add(target.ownerId);
      const production = settleNpcFleetProduction(result.target, target.ownerId, at);
      if (production.completed.length) events.push({ kind: 'npc-fleet-production', ownerId: target.ownerId, planetId: id, at, completed: production.completed });
      targets[id] = production.target;
      changed ||= production.target !== target;
      for (const assetRole of result.completedRoles) events.push({ kind: 'npc-building', planetId: id, assetRole, at });
    }
    if (changed) next = { ...next, espionage: { ...next.espionage, targets } };
    const science = pauseNpcScienceForSettlement(next.npcScience, before, settled, at, targets);
    if (science !== next.npcScience) next = { ...next, npcScience: science };
  };
  const completeNpcScience = (at: number, ownerIds?: ReadonlySet<string>) => {
    const result = reconcileNpcScienceAt(next, at, ownerIds);
    next = result.state;
    for (const completion of result.completed) events.push({ kind: 'npc-science', ...completion });
  };
  /**
   * Settles the given owners at `at` unless already settled there.
   *
   * Only owners that the work at a checkpoint can read or write need their
   * economy brought to that timestamp first. Everyone else accrues exactly the
   * same integer credits later (at their own completion/session/burn point, a
   * touching checkpoint or the slice end): accrual is split-invariant, the
   * property the per-chunk and per-window boundaries already rely on.
   */
  const settleNpcOwnersAt = (at: number, ownerIds: ReadonlySet<string>, settled: Set<string>) => {
    const pending = new Set<string>();
    for (const ownerId of ownerIds) if (replayOwners.has(ownerId) && !settled.has(ownerId)) pending.add(ownerId);
    if (!pending.size) return;
    for (const ownerId of pending) settled.add(ownerId);
    settleNpcEconomies(at, pending);
  };
  /**
   * Owners whose targets flights, raids or burns may read or write at this
   * checkpoint: due pirate-roll owners (loot wallet, population, hangar),
   * owners with a stored overpopulation episode (burns move fleets that
   * scores and raids read) and every owner a live flight names as origin or
   * destination. Flights only change targets they name, so an owner outside
   * this set is neither read nor written by arrivals, returns or battles.
   */
  const ownersTouchedAtCheckpoint = (at: number): Set<string> => {
    const owners = new Set<string>();
    for (let index = raidIndex; raidDueEvents[index]?.at === at; index++) owners.add(raidDueEvents[index]!.ownerId);
    const targets = next.espionage?.targets ?? {};
    for (const target of Object.values(targets)) if (target.overpopulation) owners.add(target.ownerId);
    for (const flight of next.flights.records) {
      if (flight.phase !== 'outbound' && flight.phase !== 'arrived' && flight.phase !== 'returning') continue;
      if (flight.destinationOwnerId) owners.add(flight.destinationOwnerId);
      const destination = flight.destinationPlanetId ? targets[flight.destinationPlanetId] : undefined;
      if (destination) owners.add(destination.ownerId);
      const origin = targets[flight.originPlanetId];
      if (origin) owners.add(origin.ownerId);
    }
    return owners;
  };
  // Establish legacy overpopulation episodes at the committed prefix, never at
  // a later caller-dependent decision time. Existing clocks/queues are retained.
  if (replay) settleNpcEconomies(replay.from);
  if (replay) completeNpcScience(replay.from);
  const startingPirate = next.pirate ?? createDefaultPirateState();
  let pirateCursor = startingPirate.raidProcessedAt ?? context.now;
  if (!Number.isSafeInteger(pirateCursor) || pirateCursor < 0) pirateCursor = context.now;
  // Due pirate rolls in (after, now], selected an hour at a time from the
  // state snapshot taken when the list was (re)started: selection is a pure
  // function of that state and the window, and the (at, cycle, owner) order is
  // total, so the hours concatenate to the one selection of the whole window.
  let raidDueEvents: PirateDueRoll[] = [];
  let raidIndex = 0;
  let raidSelectionState = next;
  let raidSelectedTo = pirateCursor;
  const restartRaidSelection = (after: number) => {
    raidDueEvents = [];
    raidIndex = 0;
    raidSelectionState = next;
    raidSelectedTo = after;
  };
  const ensureRaidEvent = (index: number) => {
    while (raidDueEvents.length <= index && raidSelectedTo < context.now) {
      const to = Math.min(context.now, raidSelectedTo + NPC_REPLAY_GENERATION_STEP_MS);
      for (const event of selectDuePirateRolls(raidSelectionState, raidSelectedTo, to, context.mode, context.testTimeScale)) raidDueEvents.push(event);
      raidSelectedTo = to;
    }
  };
  // Rolls in this pass append to one private copy of the roll ledger.
  const pirateRollScope: PirateRollWriteScope = {};
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

  const nextLeadershipCheckpoint = (after: number): number | undefined => {
    if (!replay) return undefined;
    let earliest: number | undefined;
    for (const alliance of next.command.alliances) {
      if (alliance.members.length < 2 || next.npc?.profiles[alliance.leaderOwnerId]?.session.active) continue;
      const leader = alliance.members.find((member) => member.ownerId === alliance.leaderOwnerId);
      const due = Math.max(replay.from, Math.max(leader?.lastActiveAt ?? 0, alliance.leaderSince) + LEADER_ABSENCE_MS + 1);
      if (due > after && due <= context.now) earliest = Math.min(earliest ?? due, due);
    }
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
    initializeAsteroidGasForSimulationAt(at);
  };

  // Gas accrues in integer rate x milliseconds with a carried remainder, so
  // advancing it at every movement or once later gives the same reserve. It is
  // advanced before arrivals read it and for everyone at the slice end; a
  // movement only has to give a not-yet-initialized asteroid its baseline now.
  const initializeAsteroidGasForSimulationAt = (at: number) => {
    const simulation = next.asteroidSimulation;
    if (!simulation || !asteroidGasNeedsInitialization) return;
    let changed = false;
    const asteroids = simulation.asteroids.map((asteroid) => {
      if (initializeAsteroidGasState(asteroid, at) === asteroid) return asteroid;
      changed = true;
      return advanceAsteroidGasAt(asteroid, at);
    });
    if (changed) next = { ...next, asteroidSimulation: { ...simulation, asteroids } };
  };

  // Spawns start initialized and nothing un-initializes gas, so only a save
  // whose asteroids lack gas state at the slice start needs per-move baselines.
  const asteroidGasNeedsInitialization = (next.asteroidSimulation?.asteroids ?? [])
    .some((asteroid) => initializeAsteroidGasState(asteroid, context.now) !== asteroid);

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
    ensureRaidEvent(raidIndex);
    while (raidIndex < raidDueEvents.length && raidDueEvents[raidIndex]!.at <= processedThrough) {
      raidIndex++;
      ensureRaidEvent(raidIndex);
    }
    while (npcIndex < npcDueEvents.length && npcDueEvents[npcIndex]!.at <= processedThrough) npcIndex++;
    const pirateCheckpoint = raidDueEvents[raidIndex]?.at;
    const npcCheckpoint = npcDueEvents[npcIndex]?.at;
    const nextAsteroidCheckpoint = next.asteroidSimulation
      ? getNextUniverseAsteroidTransitionAt(next.asteroidSimulation, context.now)
      : null;
    const asteroidCheckpoint = nextAsteroidCheckpoint ?? undefined;
    const workCheckpoint = nextDueWorkCheckpoint(processedThrough);
    ensureNextEconomicEvent(economicIndex);
    while (economicIndex < economicEvents.length && economicEvents[economicIndex]!.at <= processedThrough) {
      economicIndex++;
      ensureNextEconomicEvent(economicIndex);
    }
    const sessionCheckpoint = economicEvents[economicIndex]?.at;
    let economyCheckpoint: number | undefined;
    if (replay) for (const target of Object.values(next.espionage?.targets ?? {})) {
      if (!replayOwners.has(target.ownerId)) continue;
      const due = getNextNpcEconomyCheckpoint(target, processedThrough);
      if (due !== null && due > processedThrough && due <= context.now) economyCheckpoint = Math.min(economyCheckpoint ?? due, due);
      const productionDue = getNextNpcFleetProductionCheckpoint(target, target.ownerId, processedThrough, context.now);
      if (productionDue !== undefined) economyCheckpoint = Math.min(economyCheckpoint ?? productionDue, productionDue);
    }
    const scienceCheckpoint = replay ? getNextNpcScienceCheckpoint(next, processedThrough, context.now) : undefined;
    const leadershipCheckpoint = nextLeadershipCheckpoint(processedThrough);
    const checkpoint = [flightCheckpoint, asteroidCheckpoint, pirateCheckpoint, npcCheckpoint, workCheckpoint, sessionCheckpoint, economyCheckpoint, scienceCheckpoint, leadershipCheckpoint]
      .filter((point): point is number => point !== undefined)
      .reduce<number | undefined>((min, point) => min === undefined ? point : Math.min(min,point), undefined);
    if (checkpoint === undefined) break;
    if (replay && processedGroups >= NPC_REPLAY_MAX_GROUPS) {
      context = { ...context, now: Math.max(replay.from, processedThrough) };
      break;
    }
    processedGroups++;
    const otherCheckpoint = [flightCheckpoint, pirateCheckpoint, npcCheckpoint, workCheckpoint, sessionCheckpoint, economyCheckpoint, scienceCheckpoint, leadershipCheckpoint]
      .reduce<number | undefined>((min, point) => point === undefined ? min : min === undefined ? point : Math.min(min, point), undefined);
    if (asteroidCheckpoint === checkpoint && (otherCheckpoint === undefined || otherCheckpoint > checkpoint)) {
      // Asteroid-only moments change nothing the other clocks read (their next
      // times are fixed "first after" points), so each timestamp is applied
      // exactly as its own group would, up to the next competing event. A tie
      // with that event is left to the ordinary group: asteroids still go first.
      let at = checkpoint;
      while (true) {
        processedThrough = at;
        applyAsteroidTransitionsAt(at);
        const following = next.asteroidSimulation ? getNextUniverseAsteroidTransitionAt(next.asteroidSimulation, context.now) : null;
        if (following === null || (otherCheckpoint !== undefined && following >= otherCheckpoint)) break;
        at = following;
      }
      continue;
    }
    const asteroidIsDue = asteroidCheckpoint === checkpoint;
    const flightIsDue = flightCheckpoint === checkpoint;
    const pirateIsDue = pirateCheckpoint === checkpoint;
    const npcIsDue = npcCheckpoint === checkpoint;
    const workIsDue = workCheckpoint === checkpoint;
    const economicIsDue = sessionCheckpoint === checkpoint;
    const dueOwners = new Set<string>();
    // Replay owners settled at this checkpoint. Only these can be read or
    // written below; see settleNpcOwnersAt for why the rest may wait.
    const settledOwners = new Set<string>();
    if (leadershipCheckpoint === checkpoint) next = { ...next, command: settleLeadership(next.command, checkpoint,
      Object.values(next.npc?.profiles ?? {}).filter((profile) => profile.session.active).map((profile) => profile.ownerId)) };
    if (replay) {
      if (scienceCheckpoint === checkpoint) for (const [ownerId, science] of Object.entries(next.npcScience?.owners ?? {})) {
        if (science.queue[0]?.finishAt === checkpoint) dueOwners.add(ownerId);
      }
      for (const target of Object.values(next.espionage?.targets ?? {})) {
        const due = getNextNpcEconomyCheckpoint(target, processedThrough);
        if (due === checkpoint) dueOwners.add(target.ownerId);
        if (getNextNpcFleetProductionCheckpoint(target, target.ownerId, processedThrough, context.now) === checkpoint) dueOwners.add(target.ownerId);
      }
      for (let index = economicIndex; economicEvents[index]?.at === checkpoint; index++) dueOwners.add(economicEvents[index]!.ownerId);
      if (flightIsDue || pirateIsDue || npcIsDue) {
        for (const ownerId of ownersTouchedAtCheckpoint(checkpoint)) dueOwners.add(ownerId);
        if (npcIsDue) for (const ownerId of replayOwners) dueOwners.add(ownerId);
      }
      settleNpcOwnersAt(checkpoint, dueOwners, settledOwners);
      // Old income ends here; owner knowledge changes before arrivals, raids and decisions.
      if (scienceCheckpoint === checkpoint) completeNpcScience(checkpoint);
    }
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
        restartRaidSelection(Math.max(pirateCursor, checkpoint - 1));
      }
      ensureRaidEvent(raidIndex);
      next = reconcileAllPlanetOverpopulation(next, checkpoint).state;
      if (pirateIsDue || raidDueEvents[raidIndex]?.at === checkpoint) {
        while (true) {
          ensureRaidEvent(raidIndex);
          if (raidDueEvents[raidIndex]?.at !== checkpoint) break;
          const event = raidDueEvents[raidIndex++]!;
          // Rolls re-selected after an arrival may name an owner not settled yet.
          if (replay) settleNpcOwnersAt(checkpoint, new Set([event.ownerId]), settledOwners);
          next = resolveDuePirateRoll(next, event, context.mode, context.testTimeScale, pirateRollScope);
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
        // An NPC victory inside catch-up can precede the committed raid cursor;
        // rolls at or before that cursor were already settled and are never reselected.
        restartRaidSelection(Math.max(pirateCursor, checkpoint));
      }
      // A Hall lost to an arrival at this checkpoint must stop the charge clock from here on, not from `now`.
      next = syncAidState(next, { now: checkpoint, mode: context.mode, testTimeScale: context.testTimeScale });
    }
    // Existing asteroid/raid/battle micro-order above is unchanged. NPC session
    // boundaries and decisions observe timer completions and arrival effects.
    if (replay && (flightIsDue || pirateIsDue || npcIsDue)) {
      // Re-settle everyone settled above plus owners named by flights created
      // here, so arrival effects (losses, returns) start their episodes now.
      for (const ownerId of ownersTouchedAtCheckpoint(checkpoint)) settledOwners.add(ownerId);
      settleNpcEconomies(checkpoint, settledOwners);
      // A battle can remove a payer. Drop its paid work before any new command.
      completeNpcScience(checkpoint, settledOwners);
    }
    if (economicIsDue && next.npc && next.espionage?.targets) {
      const group = [];
      while (economicEvents[economicIndex]?.at === checkpoint) group.push(economicEvents[economicIndex++]!);
      const applied = applyNpcReplayEventsAt(next.npc, checkpoint, group, { targets: next.espionage.targets, timeScale, science: next.npcScience, world: next });
      next = { ...(applied.world ?? next), npc: applied.state, npcScience: applied.science ?? next.npcScience, espionage: { ...(applied.world?.espionage ?? next.espionage), targets: { ...applied.targets } } };
      if (applied.emitted.length) events.push({ kind: 'npc-economy', events: applied.emitted });
    }
  }

  const finalOverpopulation = reconcileAllPlanetOverpopulation(next, context.now);
  next = finalOverpopulation.state;
  if (replay) settleNpcEconomies(context.now);
  reconcilePlanetWork(context.now, finalOverpopulation.blockedPlanetIds);
  advanceAsteroidGasForSimulationAt(context.now);
  if (processFlightsAt(context.now)) {
    // Covers legacy arrived-phase flights processed only by the final sweep.
    for (const event of selectDuePirateRolls(next, Math.max(pirateCursor, context.now - 1),
      context.now, context.mode, context.testTimeScale)) {
      next = resolveDuePirateRoll(next, event, context.mode, context.testTimeScale, pirateRollScope);
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
  const currentScore = selectOwnerScore(next, next.profile.playerId)?.resourcePoints ?? 0;
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
  if (replay) next = { ...next, npcReplay: { version: 1, processedThroughAt: context.now, targetAt: replay.targetAt } };
  // Archive records nothing reads any more leave the save after each pass.
  next = pruneCampaignHistory(next);

  return {
    changed: next !== state,
    state: next,
    events,
    credit: selectedCredit ?? emptyCredit(),
  };
}
