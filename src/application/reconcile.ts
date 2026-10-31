import { settleNpcSpaceport, syncNpcOwnerShipLevels } from './npc-spaceport.ts';
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
import type { FlightRecord } from '../domain/flights/types.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { getNextNpcFleetOverflowCheckpoint, getNextNpcSatelliteCheckpoint, settleNpcFleetProduction } from './npc-fleet-production.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import type { ScienceId } from '../domain/science/types.ts';
import type { SpaceportUpgradeTrack } from '../domain/buildings/spaceport-upgrades.ts';
import type { SaveState } from './contracts.ts';
import { reconcileResourceIncome } from './resource-clock.ts';
import type { ResourceCreditResult } from '../domain/resources/credit.ts';
import type { FleetProductionCompletion } from '../domain/fleet/production.ts';
import { reconcileFlights, type FlightReconcileEvent } from './flights.ts';
import { currentSunRaidState, publishSunBrightness, reconcileSunRaids, type SunRaidNotice } from './sun-raid.ts';
import { projectSun } from '../domain/sun-raid/rules.ts';
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
import { generateNpcOwnerReplayEvents, applyNpcReplayEventsAt, initializeNpcReplaySessionsAt, isNpcDecisionIdle, type NpcReplayEmission, type NpcReplayEvent } from './npc-replay.ts';
import { compareNpcEvents } from '../domain/npc/events.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { settleNpcRecycling, getNextNpcEconomyCheckpoint, getNpcOverpopulationUnlockAt, settleNpcPlanet } from './npc-economy.ts';
import { getNextNpcScienceCheckpoint, pauseNpcScienceForSettlement, projectNpcScienceLedger, reconcileNpcScienceAt } from './npc-science.ts';
import { getReplayNpcOwnerIds, isNpcCatchupPending, NPC_CATCHUP_COMMAND_GRACE_MS, NPC_REPLAY_GENERATION_STEP_MS, NPC_REPLAY_MAX_GROUPS, NPC_REPLAY_WINDOW_MS } from './npc-catchup.ts';
import { accumulateWorldCatchupSummary, countNewWorldBattles, startWorldCatchupSummary } from './world-catchup-summary.ts';
import type { WorldCatchupSummary } from '../domain/npc/world-catchup-summary.ts';
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

/**
 * Where each planet sits in the targets object and which planets each owner
 * holds, built once per immutable targets object: settling a few owners
 * visits their planets only, in the order a full scan would.
 */
type TargetOwnerIndex = { position: Map<string, number>; byOwner: Map<string, string[]> };
const targetOwnerIndexCache = new WeakMap<object, TargetOwnerIndex>();
function targetOwnerIndex(targets: Readonly<Record<string, { ownerId: string }>>): TargetOwnerIndex {
  let index = targetOwnerIndexCache.get(targets);
  if (index) return index;
  index = { position: new Map(), byOwner: new Map() };
  let position = 0;
  for (const id in targets) {
    index.position.set(id, position++);
    const ownerId = targets[id]!.ownerId;
    const owned = index.byOwner.get(ownerId);
    if (owned) owned.push(id);
    else index.byOwner.set(ownerId, [id]);
  }
  targetOwnerIndexCache.set(targets, index);
  return index;
}

/**
 * A planet's next own replay moment after `after` (up to `through`): its
 * economy checkpoint (a building, recycling pickup, burn end or Spaceport
 * upgrade), its next solar satellite, or the unit that overfills its hangar.
 * Ship, defence and commander units are not moments of their own: a queue
 * completes by time and every reader (a battle or spy probe at the planet,
 * the owner's decision, the end of the slice) settles the owner first.
 * Solar satellites add energy that can start a waiting building, so they keep
 * theirs; overpopulation starts at the overfilling unit and ends at the burn
 * that clears it.
 *
 * Each part is a fixed set of times, so the next one after `after` stays the
 * same while `after` moves up to it: kept per immutable planet.
 */
type TargetCheckpointMemo = {
  economyAfter: number; economy: number | null;
  satelliteAfter: number; satelliteThrough: number; satellite: number | undefined;
  overflow: number | undefined;
  unlock: number | null;
};
const targetCheckpointMemo = new WeakMap<SpyTargetState, TargetCheckpointMemo>();
function nextNpcTargetCheckpoint(target: SpyTargetState, after: number, through: number): number | undefined {
  let memo = targetCheckpointMemo.get(target);
  if (!memo) {
    memo = { economyAfter: Number.NaN, economy: null, satelliteAfter: Number.NaN, satelliteThrough: Number.NaN, satellite: undefined,
      overflow: getNextNpcFleetOverflowCheckpoint(target, target.ownerId, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
      unlock: getNpcOverpopulationUnlockAt(target) };
    targetCheckpointMemo.set(target, memo);
  }
  // The economy time is the first one at or after `after` (getNextNpcEconomyCheckpoint).
  if (!(memo.economyAfter <= after && (memo.economy === null || memo.economy >= after))) {
    memo.economy = getNextNpcEconomyCheckpoint(target, after);
    memo.economyAfter = after;
  }
  if (!(memo.satelliteAfter <= after && memo.satelliteThrough === through && (memo.satellite === undefined || memo.satellite > after))) {
    memo.satellite = getNextNpcSatelliteCheckpoint(target, target.ownerId, after, through);
    memo.satelliteAfter = after;
    memo.satelliteThrough = through;
  }
  let next: number | undefined;
  if (memo.economy !== null && memo.economy > after && memo.economy <= through) next = memo.economy;
  if (memo.satellite !== undefined) next = Math.min(next ?? memo.satellite, memo.satellite);
  if (memo.overflow !== undefined && memo.overflow > after && memo.overflow <= through) next = Math.min(next ?? memo.overflow, memo.overflow);
  if (memo.unlock !== null && memo.unlock > after && memo.unlock <= through) next = Math.min(next ?? memo.unlock, memo.unlock);
  return next;
}

let footprintMemo: { planets: unknown; targets: Readonly<Record<string, SpyTargetState>>; playerId: string; footprint: string } | null = null;

/** Same planets, owners and coordinate objects in the same order (what a raid footprint reads). */
function sameTargetPlaces(left: Readonly<Record<string, SpyTargetState>>, right: Readonly<Record<string, SpyTargetState>>): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  if (leftIds.length !== rightIds.length) return false;
  for (let index = 0; index < leftIds.length; index += 1) {
    const id = leftIds[index]!;
    if (rightIds[index] !== id) return false;
    const a = left[id]!;
    const b = right[id]!;
    if (a !== b && (a.ownerId !== b.ownerId || a.coordinate !== b.coordinate)) return false;
  }
  return true;
}

/** Targets objects a full settlement produced, with its moment and owners. */
const fullySettledTargets = new WeakMap<object, { at: number; owners: string }>();

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
      result.state = { ...result.state, npcReplay: { version: 1, processedThroughAt: context.now, targetAt: context.now,
        ...(state.npcReplay.summary ? { summary: { ...state.npcReplay.summary, finishedAt: state.npcReplay.summary.finishedAt ?? context.now } } : {}) } };
      result.changed = true;
    }
    return result;
  }
  const from = state.npcReplay?.processedThroughAt ?? Math.max(0, Math.floor(state.resourceClock.lastReconciledAt));
  const frozen = state.npcReplay && state.npcReplay.targetAt > from ? state.npcReplay.targetAt : context.now;
  const targetAt = Math.max(from, Math.floor(frozen));
  const windowEnd = Math.min(targetAt, from + NPC_REPLAY_WINDOW_MS);
  const summary = catchupSummaryFor(state, from, targetAt);
  const result = reconcileRuntimeSlice(state, { ...context, now: windowEnd }, { from, owners, targetAt, summary });
  const replay = result.state.npcReplay;
  if (replay?.summary && replay.summary.finishedAt === undefined && replay.processedThroughAt >= replay.targetAt) {
    result.state = { ...result.state, npcReplay: { ...replay, summary: { ...replay.summary, finishedAt: replay.processedThroughAt } } };
  }
  return result;
}

/**
 * The world news a replay slice adds to. Live play (gaps under the command
 * grace) collects nothing; a real catch-up starts a fresh summary unless one
 * is already running. A save that resumes a catch-up with no summary began it
 * in an older version, so its news is marked incomplete.
 */
function catchupSummaryFor(state: SaveState, from: number, targetAt: number): WorldCatchupSummary | undefined {
  const current = state.npcReplay?.summary;
  if (current && current.finishedAt === undefined) return current;
  const pending = isNpcCatchupPending(state);
  // A target frozen over a finished summary covers only the minutes the last
  // catch-up itself took (a longer gap starts a fresh summary when frozen):
  // the player is still reading that summary, so it stays.
  if (pending && current) return current;
  if (!pending && targetAt - from <= NPC_CATCHUP_COMMAND_GRACE_MS) return current;
  // The news of the same absence end exactly here (the cloud server lived its first part and
  // the player replays the rest on this computer): they go on.
  if (current && current.finishedAt === from) {
    const { finishedAt: _closed, ...open } = current;
    return open;
  }
  return startWorldCatchupSummary(state, from, !pending);
}

function reconcileRuntimeSlice(
  state: SaveState,
  context: BuildingApplicationContext,
  replay?: { from: number; owners: string[]; targetAt: number; summary?: WorldCatchupSummary },
): RuntimeReconcileResult {
  // Aid flights whose sender, recipient or request no longer stand turn back before anything else settles.
  let next = projectNpcScienceLedger(reconcileAidMembership(state, context.now));
  const events: RuntimeReconcileEvent[] = [];
  const timeScale = CAMPAIGN_SPEED_SCALE[state.worldConfig?.world.campaignSpeed ?? 'standard'];
  const replayOwners = new Set(replay?.owners);
  const replayOwnersKey = replay ? [...replayOwners].sort().join(' ') : '';
  // Interactive calls keep the per-call NPC_REPLAY_MAX_GROUPS budget; offline
  // catch-up contexts may batch more groups into one call (same group order).
  const replayMaxGroups = replay
    ? Math.max(1, Math.floor(context.replayMaxGroups ?? NPC_REPLAY_MAX_GROUPS))
    : NPC_REPLAY_MAX_GROUPS;
  if (replay && next.npc) next = { ...next, npc: initializeNpcReplaySessionsAt(next.npc, replay.from, replay.owners) };
  // World news of a running catch-up. Battle reports are archived after every
  // replay group, so each group's new reports are counted just before that.
  let worldSummary = replay?.summary && replay.summary.finishedAt === undefined ? replay.summary : undefined;
  const countedBattles = worldSummary ? new Set(state.combat.reports.map((report) => report.id)) : undefined;
  let lastCountedReports: SaveState['combat']['reports'] | undefined;
  const countWorldBattles = () => {
    if (!worldSummary || !countedBattles || next.combat.reports === lastCountedReports) return;
    lastCountedReports = next.combat.reports;
    worldSummary = countNewWorldBattles(worldSummary, next.combat.reports, countedBattles, next.profile.playerId);
  };
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
    const index = targetOwnerIndex(before);
    const targets = { ...before };
    const settled = new Set<string>();
    let changed = false;
    // Planets in save order, as a scan of every target would visit them.
    const ids: string[] = [];
    if (ownerIds) {
      for (const ownerId of ownerIds) if (replayOwners.has(ownerId)) for (const id of index.byOwner.get(ownerId) ?? []) ids.push(id);
      if (ownerIds.size > 1) ids.sort((left, right) => index.position.get(left)! - index.position.get(right)!);
    } else {
      for (const [ownerId, owned] of index.byOwner) if (replayOwners.has(ownerId)) for (const id of owned) ids.push(id);
      ids.sort((left, right) => index.position.get(left)! - index.position.get(right)!);
    }
    for (const id of ids) {
      const target = targets[id]!;
      const settledPlanet = settleNpcPlanet(target, at, { timeScale });
      const result = { ...settledPlanet, target: settleNpcSpaceport(settleNpcRecycling(settledPlanet.target, at), at) };
      settled.add(target.ownerId);
      const production = settleNpcFleetProduction(result.target, target.ownerId, at);
      if (production.completed.length) events.push({ kind: 'npc-fleet-production', ownerId: target.ownerId, planetId: id, at, completed: production.completed });
      // Units that just completed may overfill the hangar: overpopulation
      // starts now, not at whenever this planet happens to be settled next.
      // `completed` lists whole orders only; single units of a running order
      // land in the fleet too, so any production change re-settles.
      targets[id] = production.changed ? settleNpcPlanet(production.target, at, { timeScale }).target : production.target;
      changed ||= targets[id] !== target;
      for (const assetRole of result.completedRoles) events.push({ kind: 'npc-building', planetId: id, assetRole, at });
    }
    // Upgrade levels are owner-wide: a finished upgrade reaches all of the owner's planets now.
    if (syncNpcOwnerShipLevels(targets, settled, (ownerId) => index.byOwner.get(ownerId) ?? [])) changed = true;
    if (changed) next = { ...next, espionage: { ...next.espionage, targets } };
    const science = pauseNpcScienceForSettlement(next.npcScience, before, settled, at, targets);
    if (science !== next.npcScience) next = { ...next, npcScience: science };
    if (!ownerIds && next.espionage?.targets) fullySettledTargets.set(next.espionage.targets, { at, owners: replayOwnersKey });
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
   * scores and raids read) and the owners the checkpoint's flights name as
   * origin or destination: before it, of the flights that act now; after it,
   * of every flight it created, changed or removed. Flights only change
   * targets they name, so an owner outside this set is neither read nor
   * written by arrivals, returns or battles (settling everyone with a flight
   * in the air was most of a late-game catch-up).
   */
  const ownersTouchedAtCheckpoint = (at: number, recordsBefore?: readonly FlightRecord[]): Set<string> => {
    const owners = new Set<string>();
    for (let index = raidIndex; raidDueEvents[index]?.at === at; index++) owners.add(raidDueEvents[index]!.ownerId);
    const targets = next.espionage?.targets ?? {};
    for (const target of Object.values(targets)) if (target.overpopulation) owners.add(target.ownerId);
    const name = (flight: FlightRecord) => {
      if (flight.destinationOwnerId) owners.add(flight.destinationOwnerId);
      const destination = flight.destinationPlanetId ? targets[flight.destinationPlanetId] : undefined;
      if (destination) owners.add(destination.ownerId);
      const origin = targets[flight.originPlanetId];
      if (origin) owners.add(origin.ownerId);
    };
    const live = (flight: FlightRecord) => flight.phase === 'outbound' || flight.phase === 'arrived' || flight.phase === 'returning';
    // A Sun raid gathering that ends here sends ships home: every live flight may be one of them.
    const gatheringEnds = (next.sunRaid?.raids ?? []).some((raid) => raid.status === 'gathering' && raid.gatherEndsAt === at);
    if (gatheringEnds) {
      for (const flight of next.flights.records) if (live(flight)) name(flight);
    } else if (recordsBefore) {
      // After the checkpoint: the owners of every flight it created, changed or removed.
      const records = next.flights.records;
      if (records.length === recordsBefore.length) {
        // Updated in place (the common case): compare slot by slot. A moved
        // record would name a few owners more, which settling allows.
        for (let index = 0; index < records.length; index += 1) {
          if (records[index] !== recordsBefore[index]) { name(records[index]!); name(recordsBefore[index]!); }
        }
      } else {
        const before = new Set(recordsBefore);
        const after = new Set(records);
        for (const flight of records) if (!before.has(flight)) name(flight);
        for (const flight of recordsBefore) if (!after.has(flight)) name(flight);
      }
    } else {
      // Before it: the owners of the flights that act now (arrive, return or leave an expedition).
      for (const flight of next.flights.records) if (live(flight) && flightEventAt(flight) === at) name(flight);
    }
    return owners;
  };
  // Establish legacy overpopulation episodes at the committed prefix, never at
  // a later caller-dependent decision time. Existing clocks/queues are retained.
  // NPC solar income reads the published Sun brightness: start from the
  // brightness of the slice's first moment, never the wall clock's.
  if (replay) publishSunBrightness(next, replay.from);
  // The previous slice ended by settling every owner at this very moment; when
  // nothing has touched the planets since, settling them again changes nothing.
  const settledAtStart = replay && next.espionage?.targets ? fullySettledTargets.get(next.espionage.targets) : undefined;
  if (replay && !(settledAtStart?.at === replay.from && settledAtStart.owners === replayOwnersKey)) settleNpcEconomies(replay.from);
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
    // Pure of planet coordinates and target owners/coordinates, which income
    // settlement keeps: reuse the last footprint while those are unchanged.
    const targets = getEspionageTargets(value.espionage);
    const memo = footprintMemo;
    if (memo && memo.planets === value.planets && memo.playerId === value.profile.playerId
      && (memo.targets === targets || sameTargetPlaces(memo.targets, targets))) {
      memo.targets = targets;
      return memo.footprint;
    }
    const footprint = computeRaidSystemFootprint(value);
    footprintMemo = { planets: value.planets, targets, playerId: value.profile.playerId, footprint };
    return footprint;
  };
  const computeRaidSystemFootprint = (value: SaveState): string => {
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

  // Flight times are pure of the records and exploration contacts; both are
  // immutable, so the sorted list is rebuilt only when either changes.
  let flightTimes: { records: unknown; exploration: unknown; sunRaid: unknown; times: number[] } | null = null;
  const nextDueFlightCheckpoint = (after: number): number | undefined => {
    if (!flightTimes || flightTimes.records !== next.flights.records || flightTimes.exploration !== next.exploration || flightTimes.sunRaid !== next.sunRaid) {
      flightTimes = { records: next.flights.records, exploration: next.exploration, sunRaid: next.sunRaid, times: collectFlightTimes() };
    }
    const times = flightTimes.times;
    let low = 0;
    let high = times.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (times[middle]! <= after) low = middle + 1;
      else high = middle;
    }
    const earliest = times[low];
    return earliest !== undefined && earliest <= context.now ? earliest : undefined;
  };
  /** When a flight next does something: arrival, return, or an expedition's leave time. */
  const flightEventAt = (flight: FlightRecord): number | undefined => flight.phase === 'outbound'
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
  const collectFlightTimes = (): number[] => {
    const times: number[] = [];
    for (const flight of next.flights.records) {
      const checkpoint = flightEventAt(flight);
      if (checkpoint === undefined || !Number.isFinite(checkpoint)) continue;
      times.push(checkpoint);
    }
    // A Sun raid gathering ends at its own moment: disbanded, its ships go home.
    for (const raid of next.sunRaid?.raids ?? []) if (raid.status === 'gathering' && raid.gatherEndsAt !== undefined) times.push(raid.gatherEndsAt);
    return times.sort((left, right) => left - right);
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

  /**
   * Sun brightness moves at recovery steps (and at raid battles, which are
   * flight arrivals). Each step is a moment of its own: owners in that system
   * earn up to it at the old brightness, the new one applies from it on.
   */
  const nextSunStepAt = (after: number): number | undefined => {
    if (!replay) return undefined;
    let earliest: number | undefined;
    for (const sun of Object.values(currentSunRaidState(next).suns)) {
      const step = projectSun(sun, after).nextStepAt;
      if (step !== undefined && step > after && step <= context.now) earliest = Math.min(earliest ?? step, step);
    }
    return earliest;
  };
  const sunSystemsChangingAt = (at: number, after: number): Set<string> => {
    const systems = new Set<string>();
    for (const [key, sun] of Object.entries(currentSunRaidState(next).suns)) if (projectSun(sun, after).nextStepAt === at) systems.add(key);
    for (const flight of next.flights.records) {
      if (flight.missionId === 'sun-attack' && flight.phase === 'outbound' && flight.arrivalAt === at) {
        systems.add(`${flight.destinationCoordinate.galaxy}:${flight.destinationCoordinate.system}`);
      }
    }
    return systems;
  };

  /** Owners of planets that deciding NPC probes may report on again at `at`. */
  const repeatSpyReportTargetOwners = (at: number): Set<string> => {
    const owners = new Set<string>();
    const deciding = new Set<string>();
    for (let index = economicIndex; economicEvents[index]?.at === at; index++) deciding.add(economicEvents[index]!.ownerId);
    for (const mission of next.espionage?.missions ?? []) {
      if (mission.status !== 'orbiting' || !mission.ownerId || !deciding.has(mission.ownerId)
        || mission.nextReportAt === undefined || at < mission.nextReportAt) continue;
      const owner = next.planets[mission.targetPlanetId] ? next.profile.playerId : next.espionage?.targets?.[mission.targetPlanetId]?.ownerId;
      if (owner) owners.add(owner);
    }
    return owners;
  };
  let spiedPlayerAt: number | undefined;

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
    // An owner that found nothing to do skips its attention moments until its
    // idle time; applying them would only move its cursor, so they form no group.
    const skipsEconomicEvent = (event: NpcReplayEvent) => {
      const profile = next.npc?.profiles[event.ownerId];
      return event.at <= processedThrough || (profile !== undefined && isNpcDecisionIdle(profile, event));
    };
    while (economicIndex < economicEvents.length && skipsEconomicEvent(economicEvents[economicIndex]!)) {
      economicIndex++;
      ensureNextEconomicEvent(economicIndex);
    }
    const sessionCheckpoint = economicEvents[economicIndex]?.at;
    let economyCheckpoint: number | undefined;
    if (replay) for (const target of Object.values(next.espionage?.targets ?? {})) {
      if (!replayOwners.has(target.ownerId)) continue;
      const due = nextNpcTargetCheckpoint(target, processedThrough, context.now);
      if (due !== undefined) economyCheckpoint = Math.min(economyCheckpoint ?? due, due);
    }
    const scienceCheckpoint = replay ? getNextNpcScienceCheckpoint(next, processedThrough, context.now) : undefined;
    const leadershipCheckpoint = nextLeadershipCheckpoint(processedThrough);
    const sunCheckpoint = nextSunStepAt(processedThrough);
    const checkpoint = [flightCheckpoint, asteroidCheckpoint, pirateCheckpoint, npcCheckpoint, workCheckpoint, sessionCheckpoint, economyCheckpoint, scienceCheckpoint, leadershipCheckpoint, sunCheckpoint]
      .filter((point): point is number => point !== undefined)
      .reduce<number | undefined>((min, point) => min === undefined ? point : Math.min(min,point), undefined);
    if (checkpoint === undefined) break;
    if (replay && processedGroups >= replayMaxGroups) {
      context = { ...context, now: Math.max(replay.from, processedThrough) };
      break;
    }
    processedGroups++;
    const otherCheckpoint = [flightCheckpoint, pirateCheckpoint, npcCheckpoint, workCheckpoint, sessionCheckpoint, economyCheckpoint, scienceCheckpoint, leadershipCheckpoint, sunCheckpoint]
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
    // Flight records before this checkpoint's arrivals, raids and burns (see ownersTouchedAtCheckpoint).
    let recordsAtCheckpoint: readonly FlightRecord[] | undefined;
    // Replay owners settled at this checkpoint. Only these can be read or
    // written below; see settleNpcOwnersAt for why the rest may wait.
    const settledOwners = new Set<string>();
    if (leadershipCheckpoint === checkpoint) next = { ...next, command: settleLeadership(next.command, checkpoint,
      Object.values(next.npc?.profiles ?? {}).filter((profile) => profile.session.active).map((profile) => profile.ownerId)) };
    if (replay) {
      if (scienceCheckpoint === checkpoint) for (const [ownerId, science] of Object.entries(next.npcScience?.owners ?? {})) {
        if (science.queue[0]?.finishAt === checkpoint) dueOwners.add(ownerId);
      }
      // Only replay owners are settled, and each of their planet times is at
      // or after the checkpoint, so the earliest one names the due owners.
      if (economyCheckpoint === checkpoint) for (const target of Object.values(next.espionage?.targets ?? {})) {
        if (replayOwners.has(target.ownerId) && nextNpcTargetCheckpoint(target, processedThrough, context.now) === checkpoint) dueOwners.add(target.ownerId);
      }
      for (let index = economicIndex; economicEvents[index]?.at === checkpoint; index++) dueOwners.add(economicEvents[index]!.ownerId);
      // A repeated report from orbit reads the target planet as it stands at
      // this decision, so its owner is settled here too: otherwise the report
      // shows resources as of wherever a catch-up slice last settled them.
      if (economicIsDue) for (const ownerId of repeatSpyReportTargetOwners(checkpoint)) {
        if (ownerId === next.profile.playerId) spiedPlayerAt = checkpoint;
        else dueOwners.add(ownerId);
      }
      const sunSystems = sunCheckpoint === checkpoint || flightIsDue ? sunSystemsChangingAt(checkpoint, processedThrough) : null;
      if (sunSystems?.size) for (const target of Object.values(next.espionage?.targets ?? {})) {
        if (sunSystems.has(`${target.coordinate.galaxy}:${target.coordinate.system}`)) dueOwners.add(target.ownerId);
      }
      if (flightIsDue || pirateIsDue || npcIsDue) {
        for (const ownerId of ownersTouchedAtCheckpoint(checkpoint)) dueOwners.add(ownerId);
        recordsAtCheckpoint = next.flights.records;
        if (npcIsDue) for (const ownerId of replayOwners) dueOwners.add(ownerId);
      }
      settleNpcOwnersAt(checkpoint, dueOwners, settledOwners);
      // Old income ends here; owner knowledge changes before arrivals, raids and decisions.
      if (scienceCheckpoint === checkpoint) completeNpcScience(checkpoint);
      if (sunCheckpoint === checkpoint) {
        // A recovery step: the new brightness applies from this moment on.
        publishSunBrightness(next, checkpoint);
        settleNpcEconomies(checkpoint, settledOwners);
      }
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
      for (const ownerId of ownersTouchedAtCheckpoint(checkpoint, recordsAtCheckpoint)) settledOwners.add(ownerId);
      settleNpcEconomies(checkpoint, settledOwners);
      // A battle can remove a payer. Drop its paid work before any new command.
      completeNpcScience(checkpoint, settledOwners);
    }
    if (economicIsDue && next.npc && next.espionage?.targets) {
      // The player's planets are settled by the work branches above; a
      // decision moment alone does not settle them unless a probe reads them.
      if (spiedPlayerAt === checkpoint && !workIsDue && !flightIsDue && !pirateIsDue && !npcIsDue) {
        reconcilePlanetWork(checkpoint, new Set(Object.entries(next.planets)
          .filter(([, planet]) => planet.overpopulation?.blocked === true).map(([planetId]) => planetId)));
      }
      const group = [];
      while (economicEvents[economicIndex]?.at === checkpoint) group.push(economicEvents[economicIndex++]!);
      const applied = applyNpcReplayEventsAt(next.npc, checkpoint, group, { targets: next.espionage.targets, timeScale, science: next.npcScience, world: next });
      next = { ...(applied.world ?? next), npc: applied.state, npcScience: applied.science ?? next.npcScience, espionage: { ...(applied.world?.espionage ?? next.espionage), targets: { ...applied.targets } } };
      if (applied.emitted.length) events.push({ kind: 'npc-economy', events: applied.emitted });
      // A fleet the owner sends out can end an overpopulation lock. The lock
      // ends at this decision, not at whenever the planet is settled next
      // (which would depend on where a catch-up slice happened to end).
      const groupOwners = new Set(group.map((event) => event.ownerId));
      const lockedOwners = new Set<string>();
      for (const target of Object.values(next.espionage?.targets ?? {})) {
        if (target.overpopulation && groupOwners.has(target.ownerId)) lockedOwners.add(target.ownerId);
      }
      if (lockedOwners.size) {
        settleNpcEconomies(checkpoint, lockedOwners);
        completeNpcScience(checkpoint, lockedOwners);
      }
    }
    // Archive limits hold after every group, so what NPCs can still read never
    // depends on where a catch-up slice ended.
    if (replay) {
      countWorldBattles();
      next = pruneCampaignHistory(next, checkpoint);
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
  if (replay) {
    // World news is counted before pruning, so nothing archived in this slice is lost.
    countWorldBattles();
    const summary = worldSummary ? accumulateWorldCatchupSummary(worldSummary, state, next) : replay.summary;
    next = { ...next, npcReplay: { version: 1, processedThroughAt: context.now, targetAt: replay.targetAt, ...(summary ? { summary } : {}) } };
  }
  // Archive records nothing reads any more leave the save after each pass.
  next = pruneCampaignHistory(next);

  return {
    changed: next !== state,
    state: next,
    events,
    credit: selectedCredit ?? emptyCredit(),
  };
}
