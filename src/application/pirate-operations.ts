import type { SaveState } from './contracts.ts';
import type { UniverseCoordinate, UniversePersistedPlayerPlanet, UniverseRegisteredPlanet } from '../domain/universe/types.ts';
import {
  createUniverseSystem,
  getUniverseTimedObjectSchedule,
  PIRATE_QUIET_MS,
  SYSTEM_COUNT,
  UNIVERSE_NPC_OWNER_ID,
} from '../domain/universe/runtime.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { createPirateProfile, type PirateProfile } from '../domain/pirates/profile.ts';
import {
  pirateContactCycleKey,
  calculatePirateActivityRatio,
  resolvePirateRaidCycle,
  PIRATE_PLANET_BREAKER_APPEARANCE_CHANCE,
  type PirateRaidCycleOutcome,
} from '../domain/pirates/contact-rules.ts';
import type {
  PirateContactCycleSnapshot,
  PirateOperationsState,
  PirateOwnerContactState,
  PirateFlightNoticeSnapshot,
  PirateScheduleOverride,
} from '../domain/pirates/state.ts';
import { PIRATE_MISSING_TARGET_REPORT_TEXT } from '../domain/pirates/state.ts';
import type { OwnerScore } from '../domain/rating/types.ts';
import type { RuntimeMode } from '../domain/runtime/mode.ts';
import { resolvePirateRecon, pirateRaidPopulationMultiplier } from '../domain/pirates/contact-rules.ts';
import type { PirateReconReportSnapshot } from '../domain/pirates/state.ts';
import { createFlightState, dispatchFlight as dispatchDomainFlight } from '../domain/flights/runtime.ts';
import type { FlightRecord, PirateFlightSnapshot } from '../domain/flights/types.ts';
import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { calculateFleetPopulation, removeSolarSatellitesFromFleet, resolveSavedFleetState } from '../domain/fleet/runtime.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { technologiesFromScience } from './attack.ts';
import { getOwnerShipUpgradeLevels } from './contracts.ts';
import { PIRATE_BASE_SHIPS, PIRATE_CATALOG_BY_ID } from '../domain/pirates/catalog.ts';
import { canUsePiratePlanetBreaker } from '../domain/pirates/contact-rules.ts';
import { createSeededCombatRng } from '../domain/combat/resolver.ts';

const MAX_SCHEDULE_INDEX = 10_000;

export type PirateRaidDue = Readonly<{
  ownerId: string;
  contactCycleKey: string;
  checkedAt: number;
  outcome: PirateRaidCycleOutcome;
  profile: PirateProfile;
}>;

export type PirateRaidDispatchResult = Readonly<{ state: SaveState; flight?: FlightRecord }>;

type Colony = Readonly<{ id: string; ownerId: string; coordinate: UniverseCoordinate }>;
type OwnerColoniesBySystem = ReadonlyMap<string, ReadonlyMap<string, readonly Colony[]>>;

function systemKey(galaxy: number, system: number) {
  return `${galaxy}:${system}`;
}

function coordinateOfPlanet(state: SaveState, planetId: string): UniverseCoordinate | undefined {
  const planet = state.planets[planetId];
  if (!planet) return undefined;
  return {
    galaxy: Number.isSafeInteger(planet.universeGalaxy) && (planet.universeGalaxy ?? 0) > 0 ? planet.universeGalaxy! : 1,
    system: Number.isSafeInteger(planet.universeSystem) && (planet.universeSystem ?? 0) > 0 ? planet.universeSystem! : 1,
    position: Number.isSafeInteger(planet.universePosition) && (planet.universePosition ?? 0) > 0 ? planet.universePosition! : 1,
  };
}

function getOwnerColoniesBySystem(state: SaveState): OwnerColoniesBySystem {
  const grouped = new Map<string, Map<string, Colony[]>>();
  const add = (colony: Colony) => {
    const key = systemKey(colony.coordinate.galaxy, colony.coordinate.system);
    let owners = grouped.get(key);
    if (!owners) grouped.set(key, owners = new Map());
    let colonies = owners.get(colony.ownerId);
    if (!colonies) owners.set(colony.ownerId, colonies = []);
    if (!colonies.some((item) => item.id === colony.id)) colonies.push(colony);
  };

  for (const planetId of Object.keys(state.planets).sort()) {
    const coordinate = coordinateOfPlanet(state, planetId);
    if (coordinate) add({ id: planetId, ownerId: state.profile.playerId, coordinate });
  }
  const targets = getEspionageTargets(state.espionage);
  for (const target of Object.values(targets).sort((left, right) => left.id.localeCompare(right.id))) {
    if (!target.ownerId || target.ownerId === state.profile.playerId || (target.kind && target.kind !== 'player' && target.kind !== 'npc')) continue;
    add({ id: target.id, ownerId: target.ownerId, coordinate: target.coordinate });
  }

  for (const owners of grouped.values()) {
    for (const colonies of owners.values()) colonies.sort((left, right) => left.id.localeCompare(right.id));
  }
  return grouped;
}

function scheduleOverrideFor(operations: PirateOperationsState | undefined, galaxy: number, system: number): PirateScheduleOverride | undefined {
  return operations?.scheduleOverridesBySystem[systemKey(galaxy, system)];
}

function playerPlanetsForMap(state: SaveState): UniversePersistedPlayerPlanet[] {
  return Object.keys(state.planets).sort().flatMap((id) => {
    const planet = state.planets[id]!;
    const coordinate = coordinateOfPlanet(state, id);
    return coordinate ? [{
      id,
      coordinate,
      name: planet.name,
      isHomeworld: id === 'helion-01',
      ownerId: state.profile.playerId,
    }] : [];
  });
}

function registeredTargetsForMap(state: SaveState): UniverseRegisteredPlanet[] {
  const targets = getEspionageTargets(state.espionage);
  return Object.values(targets).map((target) => ({
    id: target.id,
    coordinate: target.coordinate,
    name: target.name,
    kind: target.kind ?? 'npc',
    ownerId: target.ownerId,
  }));
}

function profileForOwner(
  ownerId: string,
  cycleKey: string,
  scores: Readonly<Record<string, OwnerScore>>,
): PirateProfile {
  const ownerScore = scores[ownerId];
  return createPirateProfile({
    ownerId,
    contactCycleKey: cycleKey,
    score: {
      resourcePoints: ownerScore?.resourcePoints ?? 0,
      battlePoints: ownerScore?.battlePoints ?? 0,
      totalPoints: ownerScore?.totalPoints ?? 0,
    },
  });
}

function createCycleSnapshot(
  state: SaveState,
  galaxy: number,
  system: number,
  cycleIndex: number,
  mode: RuntimeMode,
  ownersBySystem: OwnerColoniesBySystem,
  scores: Readonly<Record<string, OwnerScore>>,
): PirateContactCycleSnapshot | undefined {
  const override = scheduleOverrideFor(state.pirateOperations, galaxy, system);
  const schedule = getUniverseTimedObjectSchedule('pirate', galaxy, system, cycleIndex, override);
  if (!schedule.present || schedule.expiresAt <= schedule.startAt) return undefined;
  const systemState = createUniverseSystem({
    mode,
    galaxy,
    system,
    nowMs: schedule.startAt + 1,
    galaxyCount: Math.max(1, galaxy),
    pirateScheduleOverride: override,
    playerPlanets: playerPlanetsForMap(state),
    registeredPlanets: registeredTargetsForMap(state),
  });
  const contact = systemState.positions.find((position) => position.kind === 'pirate');
  if (!contact?.pirate) return undefined;
  const cycleKey = pirateContactCycleKey(galaxy, system, schedule.cycleIndex);
  const owners = ownersBySystem.get(systemKey(galaxy, system));
  const ownerSnapshots: Record<string, PirateOwnerContactState> = {};
  for (const ownerId of [...(owners?.keys() ?? [])].sort()) {
    ownerSnapshots[ownerId] = { profile: profileForOwner(ownerId, cycleKey, scores) };
  }
  return {
    cycleKey,
    cycleIndex: schedule.cycleIndex,
    coordinate: contact.coordinate,
    startedAt: schedule.startAt,
    expiresAt: schedule.expiresAt,
    respawnAt: schedule.respawnAt,
    ownersById: ownerSnapshots,
  };
}

function cycleForSystem(state: SaveState, galaxy: number, system: number): PirateContactCycleSnapshot | undefined {
  const cycles = Object.values(state.pirateOperations?.cyclesByKey ?? {});
  return cycles.find((cycle) => cycle.coordinate.galaxy === galaxy && cycle.coordinate.system === system);
}

function scheduleCheckpoints(
  state: SaveState,
  after: number,
  through: number,
  ownersBySystem = getOwnerColoniesBySystem(state),
): number[] {
  if (!Number.isFinite(after) || !Number.isFinite(through) || through <= after) return [];
  const checkpoints = new Set<number>();
  for (const key of ownersBySystem.keys()) {
    const [rawGalaxy, rawSystem] = key.split(':');
    const galaxy = Number(rawGalaxy);
    const system = Number(rawSystem);
    if (!Number.isSafeInteger(galaxy) || !Number.isSafeInteger(system) || system > SYSTEM_COUNT) continue;
    const override = scheduleOverrideFor(state.pirateOperations, galaxy, system);
    for (let cycleIndex = 0; cycleIndex < MAX_SCHEDULE_INDEX; cycleIndex += 1) {
      const schedule = getUniverseTimedObjectSchedule('pirate', galaxy, system, cycleIndex, override);
      if (schedule.startAt > through) break;
      if (!schedule.present || schedule.expiresAt <= schedule.startAt) continue;
      if (schedule.startAt > after && schedule.startAt <= through) checkpoints.add(schedule.startAt);
      const ownerCheckAt = schedule.startAt + 15 * 60_000;
      if (ownerCheckAt > after && ownerCheckAt <= through && ownerCheckAt < schedule.expiresAt) checkpoints.add(ownerCheckAt);
    }
  }
  return [...checkpoints].sort((left, right) => left - right);
}

export function getNextPirateOperationsCheckpoint(
  state: SaveState,
  after: number,
  through: number,
): number | undefined {
  return scheduleCheckpoints(state, after, through)[0];
}

function findScheduleAt(
  state: SaveState,
  galaxy: number,
  system: number,
  at: number,
): ReturnType<typeof getUniverseTimedObjectSchedule> | undefined {
  const override = scheduleOverrideFor(state.pirateOperations, galaxy, system);
  for (let cycleIndex = 0; cycleIndex < MAX_SCHEDULE_INDEX; cycleIndex += 1) {
    const schedule = getUniverseTimedObjectSchedule('pirate', galaxy, system, cycleIndex, override);
    if (schedule.startAt > at) return undefined;
    if (at >= schedule.startAt && at < schedule.respawnAt) return schedule;
  }
  return undefined;
}

function ensureCurrentContactSnapshots(
  state: SaveState,
  now: number,
  mode: RuntimeMode,
  ownersBySystem: OwnerColoniesBySystem,
  scores: Readonly<Record<string, OwnerScore>>,
): SaveState {
  let ledger = state.pirateOperations;
  if (!ledger) return state;
  let cyclesByKey = ledger.cyclesByKey;
  let changed = false;
  for (const key of ownersBySystem.keys()) {
    const [galaxy, system] = key.split(':').map(Number);
    if (!Number.isSafeInteger(galaxy) || !Number.isSafeInteger(system)) continue;
    const schedule = findScheduleAt(state, galaxy, system, now);
    if (!schedule?.present || now >= schedule.expiresAt) continue;
    const cycleKey = pirateContactCycleKey(galaxy, system, schedule.cycleIndex);
    const existing = cyclesByKey[cycleKey];
    if (!existing) {
      const snapshot = createCycleSnapshot(state, galaxy, system, schedule.cycleIndex, mode, ownersBySystem, scores);
      if (snapshot) {
        cyclesByKey = { ...cyclesByKey, [cycleKey]: snapshot };
        changed = true;
      }
      continue;
    }
    const owners = ownersBySystem.get(key)!;
    let ownersById = existing.ownersById;
    for (const ownerId of owners.keys()) {
      if (ownersById[ownerId]?.profile) continue;
      ownersById = { ...ownersById, [ownerId]: { ...(ownersById[ownerId] ?? {}), profile: profileForOwner(ownerId, cycleKey, scores) } };
      changed = true;
    }
    if (ownersById !== existing.ownersById) cyclesByKey = { ...cyclesByKey, [cycleKey]: { ...existing, ownersById } };
  }
  if (!changed) return state;
  ledger = { ...ledger, cyclesByKey };
  return { ...state, pirateOperations: ledger };
}

export function reconcilePirateOperationsAt(
  inputState: SaveState,
  at: number,
  mode: RuntimeMode = 'production',
): { state: SaveState; raidLaunches: PirateRaidDue[] } {
  const baseState = inputState.pirateOperations ? inputState : {
    ...inputState,
    pirateOperations: { version: 1 as const, reconciledThrough: at, cyclesByKey: {}, scheduleOverridesBySystem: {}, reconReports: [], flightNotices: [] },
  };
  const ownersBySystem = getOwnerColoniesBySystem(baseState);
  const scores = selectOwnerScores(baseState);
  let state = ensureCurrentContactSnapshots(baseState, at, mode, ownersBySystem, scores);
  let ledger = state.pirateOperations!;
  const raidLaunches: PirateRaidDue[] = [];

  for (const key of ownersBySystem.keys()) {
    const [galaxy, system] = key.split(':').map(Number);
    if (!Number.isSafeInteger(galaxy) || !Number.isSafeInteger(system)) continue;
    const schedule = findScheduleAt(state, galaxy, system, at);
    if (!schedule?.present) continue;
    const cycleKey = pirateContactCycleKey(galaxy, system, schedule.cycleIndex);
    let cycle = ledger.cyclesByKey[cycleKey];
    if (!cycle || cycle.defeatedAt !== undefined || at < cycle.startedAt + 15 * 60_000 || at >= cycle.expiresAt) continue;
    const ownerColonies = ownersBySystem.get(key)!;
    let ownersById = cycle.ownersById;
    for (const [ownerId, colonies] of ownerColonies) {
      const owner = ownersById[ownerId] ?? {};
      if (owner.raidRoll || colonies.length === 0) continue;
      const profile = owner.profile ?? profileForOwner(ownerId, cycleKey, scores);
      const score = scores[ownerId];
      const outcome = resolvePirateRaidCycle({
        ownerId,
        galaxy,
        system,
        cycleIndex: cycle.cycleIndex,
        resourcePoints: score?.resourcePoints ?? 0,
        battlePoints: score?.battlePoints ?? 0,
        colonyIds: colonies.map((colony) => colony.id),
      });
      const requestId = outcome.rollSucceeded && outcome.targetPlanetId
        ? `pirate-raid:${cycleKey}:${encodeURIComponent(ownerId)}`
        : undefined;
      ownersById = {
        ...ownersById,
        [ownerId]: {
          ...owner,
          profile,
          raidRoll: {
            checkedAt: cycle.startedAt + 15 * 60_000,
            seed: JSON.stringify(['pirate-raid:v1', ownerId, cycleKey]),
            success: Boolean(outcome.rollSucceeded && outcome.targetPlanetId),
            ...(outcome.rollSucceeded && outcome.targetPlanetId && requestId
              ? { targetPlanetId: outcome.targetPlanetId, flightRequestId: requestId }
              : {}),
          },
        },
      };
      if (outcome.rollSucceeded && outcome.targetPlanetId) {
        raidLaunches.push({
          ownerId,
          contactCycleKey: cycleKey,
          checkedAt: cycle.startedAt + 15 * 60_000,
          outcome,
          profile,
        });
      }
    }
    cycle = { ...cycle, ownersById };
    ledger = { ...ledger, cyclesByKey: { ...ledger.cyclesByKey, [cycleKey]: cycle } };
    state = { ...state, pirateOperations: ledger };
  }

  const reconciledThrough = Math.max(ledger.reconciledThrough, Math.max(0, Math.floor(at)));
  if (ledger.reconciledThrough !== reconciledThrough) {
    ledger = { ...ledger, reconciledThrough };
    state = { ...state, pirateOperations: ledger };
  }
  return { state, raidLaunches };
}

export function markPirateContactDefeated(state: SaveState, contactCycleKey: string, defeatedAt: number): SaveState {
  const ledger = state.pirateOperations;
  const cycle = ledger?.cyclesByKey[contactCycleKey];
  if (!ledger || !cycle || cycle.defeatedAt !== undefined || defeatedAt < cycle.startedAt || defeatedAt >= cycle.expiresAt) return state;
  const nextStartAt = defeatedAt + PIRATE_QUIET_MS;
  const override: PirateScheduleOverride = {
    galaxy: cycle.coordinate.galaxy,
    system: cycle.coordinate.system,
    defeatedCycleIndex: cycle.cycleIndex,
    defeatedAt,
    nextCycleIndex: cycle.cycleIndex + 1,
    nextStartAt,
    nextSpawnChance: 0.9,
  };
  const defeated = { ...cycle, defeatedAt, expiresAt: defeatedAt, respawnAt: nextStartAt };
  return {
    ...state,
    pirateOperations: {
      ...ledger,
      cyclesByKey: { ...ledger.cyclesByKey, [contactCycleKey]: defeated },
      scheduleOverridesBySystem: {
        ...ledger.scheduleOverridesBySystem,
        [systemKey(cycle.coordinate.galaxy, cycle.coordinate.system)]: override,
      },
    },
  };
}

export function pirateContactCoordinateOverrides(operations: PirateOperationsState | undefined) {
  const coordinates: Record<string, { cycleIndex: number; coordinate: UniverseCoordinate }> = {};
  for (const cycle of Object.values(operations?.cyclesByKey ?? {})) {
    if (cycle.defeatedAt !== undefined) continue;
    coordinates[systemKey(cycle.coordinate.galaxy, cycle.coordinate.system)] = {
      cycleIndex: cycle.cycleIndex,
      coordinate: cycle.coordinate,
    };
  }
  return coordinates;
}

export function pirateScheduleOverrides(operations: PirateOperationsState | undefined) {
  return Object.fromEntries(Object.entries(operations?.scheduleOverridesBySystem ?? {}).map(([key, value]) => [key, value]));
}

export function pirateContactSystemOwners(state: SaveState, coordinate: UniverseCoordinate): readonly { ownerId: string; colonies: readonly Colony[] }[] {
  return [...(getOwnerColoniesBySystem(state).get(systemKey(coordinate.galaxy, coordinate.system)) ?? new Map())]
    .map(([ownerId, colonies]) => ({ ownerId, colonies }));
}

export function getPirateOwnerProfile(state: SaveState, cycleKey: string, ownerId: string): PirateProfile | undefined {
  return state.pirateOperations?.cyclesByKey[cycleKey]?.ownersById[ownerId]?.profile;
}

export function getPirateContactCycle(state: SaveState, cycleKey: string): PirateContactCycleSnapshot | undefined {
  return state.pirateOperations?.cyclesByKey[cycleKey];
}

export function materializePirateOwnerProfile(state: SaveState, cycleKey: string, ownerId: string): { state: SaveState; profile?: PirateProfile } {
  const ledger = state.pirateOperations;
  const cycle = ledger?.cyclesByKey[cycleKey];
  if (!ledger || !cycle || cycle.defeatedAt !== undefined) return { state };
  const existing = cycle.ownersById[ownerId]?.profile;
  if (existing) return { state, profile: existing };
  const profile = profileForOwner(ownerId, cycleKey, selectOwnerScores(state));
  const nextCycle = {
    ...cycle,
    ownersById: {
      ...cycle.ownersById,
      [ownerId]: { ...(cycle.ownersById[ownerId] ?? {}), profile },
    },
  };
  return {
    state: { ...state, pirateOperations: { ...ledger, cyclesByKey: { ...ledger.cyclesByKey, [cycleKey]: nextCycle } } },
    profile,
  };
}

export function beginPirateRecon(
  state: SaveState,
  cycleKey: string,
  ownerId: string,
  requestId: string,
  dispatchedAt: number,
): { state: SaveState; error?: string } {
  const ledger = state.pirateOperations;
  const cycle = ledger?.cyclesByKey[cycleKey];
  if (!ledger || !cycle || cycle.defeatedAt !== undefined || dispatchedAt < cycle.startedAt || dispatchedAt >= cycle.expiresAt) {
    return { state, error: 'Пиратский контакт уже исчез.' };
  }
  const owner = cycle.ownersById[ownerId] ?? {};
  if ((owner.recon?.cooldownUntil ?? 0) > dispatchedAt) return { state, error: 'Разведка этого контакта пока на перезарядке.' };
  const recon = {
    ...(owner.recon ?? { reports: [] }),
    cooldownUntil: dispatchedAt + 120_000,
    inFlight: { requestId, dispatchedAt },
  };
  const nextCycle = { ...cycle, ownersById: { ...cycle.ownersById, [ownerId]: { ...owner, recon } } };
  return { state: { ...state, pirateOperations: { ...ledger, cyclesByKey: { ...ledger.cyclesByKey, [cycleKey]: nextCycle } } } };
}

export function attachPirateReconFlightId(state: SaveState, cycleKey: string, ownerId: string, flightId: string): SaveState {
  const ledger = state.pirateOperations;
  const cycle = ledger?.cyclesByKey[cycleKey];
  const recon = cycle?.ownersById[ownerId]?.recon;
  if (!ledger || !cycle || !recon?.inFlight) return state;
  const nextCycle = {
    ...cycle,
    ownersById: {
      ...cycle.ownersById,
      [ownerId]: { ...cycle.ownersById[ownerId], recon: { ...recon, inFlight: { ...recon.inFlight, flightId } } },
    },
  };
  return { ...state, pirateOperations: { ...ledger, cyclesByKey: { ...ledger.cyclesByKey, [cycleKey]: nextCycle } } };
}

export function resolvePirateReconAtArrival(state: SaveState, flightId: string, now: number): SaveState {
  const flight = state.flights.records.find((item) => item.id === flightId);
  const snapshot = flight?.pirateSnapshot;
  if (!flight || snapshot?.kind !== 'recon' || !state.pirateOperations) return state;
  const cycle = state.pirateOperations.cyclesByKey[snapshot.contactCycleKey];
  const owner = cycle?.ownersById[snapshot.ownerId];
  const recon = owner?.recon;
  const existing = state.pirateOperations.reconReports.find((report) => report.id === `pirate-recon:${flight.id}`);
  if (snapshot.fullReport && !snapshot.profile) return state;
  const report: PirateReconReportSnapshot = existing ?? {
    id: `pirate-recon:${flight.id}`,
    ownerId: snapshot.ownerId,
    contactCycleKey: snapshot.contactCycleKey,
    createdAt: Math.max(0, Math.floor(now)),
    roll: snapshot.roll,
    fullReport: snapshot.fullReport,
    ...(snapshot.fullReport ? { profile: snapshot.profile! } : {}),
  };
  const matchingFlight = recon?.inFlight?.requestId === flight.requestId;
  const nextCycle = cycle && owner && recon && matchingFlight ? {
      ...cycle,
      ownersById: {
        ...cycle.ownersById,
        [snapshot.ownerId]: {
          ...owner,
          recon: {
            ...recon,
            inFlight: undefined,
            reports: recon.reports.some((item) => item.id === report.id)
              ? recon.reports
              : [...recon.reports, report].slice(-128),
          },
        },
      },
    }
    : cycle;
  const reconReports = existing
    ? state.pirateOperations.reconReports
    : [...state.pirateOperations.reconReports, report].slice(-2_000);
  return {
    ...state,
    pirateOperations: {
      ...state.pirateOperations,
      ...(nextCycle ? { cyclesByKey: { ...state.pirateOperations.cyclesByKey, [cycle!.cycleKey]: nextCycle } } : {}),
      reconReports,
    },
  };
}

export function savePirateContactMissingNotice(
  state: SaveState,
  flightId: string,
  createdAt: number,
): SaveState {
  const flight = state.flights.records.find((item) => item.id === flightId);
  const snapshot = flight?.pirateSnapshot;
  const ledger = state.pirateOperations;
  if (!flight || snapshot?.kind !== 'elimination' || !ledger) return state;
  const id = `pirate-flight:${flight.id}:target-missing`;
  if (ledger.flightNotices.some((notice) => notice.id === id)) return state;
  const notice: PirateFlightNoticeSnapshot = {
    id,
    ownerId: snapshot.ownerId,
    flightId: flight.id,
    contactCycleKey: snapshot.contactCycleKey,
    createdAt: Math.max(0, Math.floor(createdAt)),
    coordinate: flight.destinationCoordinate,
    kind: 'target-missing',
    message: PIRATE_MISSING_TARGET_REPORT_TEXT,
  };
  return {
    ...state,
    pirateOperations: { ...ledger, flightNotices: [...ledger.flightNotices, notice].slice(-2_000) },
  };
}

export function pirateReconOutcome(ownerId: string, cycle: PirateContactCycleSnapshot) {
  return resolvePirateRecon(ownerId, cycle.coordinate.galaxy, cycle.coordinate.system, cycle.cycleIndex);
}

export function pirateRaidMultiplierForOwner(state: SaveState, ownerId: string): number {
  const score = selectOwnerScores(state)[ownerId];
  return pirateRaidPopulationMultiplier(calculatePirateActivityRatio(score?.resourcePoints ?? 0, score?.battlePoints ?? 0));
}

export function targetCoordinateForPirateOwner(state: SaveState, ownerId: string, planetId: string): UniverseCoordinate | undefined {
  const ownCoordinate = coordinateOfPlanet(state, planetId);
  if (ownCoordinate && ownerId === state.profile.playerId) return ownCoordinate;
  const target = getEspionageTargets(state.espionage)[planetId];
  return target?.ownerId === ownerId ? target.coordinate : undefined;
}

export function isPirateRaidOwner(state: SaveState, ownerId: string): boolean {
  return ownerId === state.profile.playerId || ownerId === UNIVERSE_NPC_OWNER_ID
    || Boolean(Object.values(state.espionage?.targets ?? {}).some((target) => target.ownerId === ownerId));
}

function raidTargetSnapshot(state: SaveState, ownerId: string, planetId: string) {
  const own = ownerId === state.profile.playerId ? state.planets[planetId] : undefined;
  const registered = getEspionageTargets(state.espionage)[planetId];
  if (!own && (!registered || registered.ownerId !== ownerId)) return undefined;
  const factionId = (own ? state.profile.factionId : registered!.raceId) as CombatFactionId;
  const fleet = own
    ? removeSolarSatellitesFromFleet(resolveSavedFleetState(own.fleet, factionId)).fleet
    : registered!.fleet;
  const defense = own ? own.defense : registered!.defense;
  const fleetPopulation = calculateFleetPopulation(fleet, factionId);
  const defensePopulation = calculateDefensePopulation(defense, factionId);
  const ownersTargets = Object.values(getEspionageTargets(state.espionage))
    .filter((target) => target.ownerId === ownerId);
  const ownerPlanetCount = own ? Object.keys(state.planets).length : ownersTargets.length;
  const score = selectOwnerScores(state)[ownerId];
  const ownerProfile = registered?.ownerProfile
    ?? (ownerId === UNIVERSE_NPC_OWNER_ID ? state.espionage?.bot01Profile : undefined);
  const shipLevels = own ? getOwnerShipUpgradeLevels(state) : ownerProfile?.shipLevels ?? registered?.shipLevels ?? {};
  const commanderLevels: Partial<Record<CommanderId, number>> = own
    ? Object.fromEntries(COMMANDER_IDS.map((id) => [id, getOwnerShipUpgradeLevels(state)[id] ?? 0])) as Partial<Record<CommanderId, number>>
    : Object.fromEntries(COMMANDER_IDS.map((id) => [id, registered?.commanders[id]?.level ?? ownerProfile?.commanderLevels[id] ?? 0])) as Partial<Record<CommanderId, number>>;
  const technologies = technologiesFromScience(own ? state.science.levels : ownerProfile?.scienceLevels);
  const snapshot = {
    name: own?.name ?? registered!.name,
    ownerName: own ? state.profile.displayName : registered!.ownerName,
    factionId,
    ships: Object.fromEntries(SHIP_IDS.map((id) => [id, Math.max(0, Math.floor(fleet.ships[id] ?? 0))])) as Partial<Record<ShipId, number>>,
    defenses: Object.fromEntries(Object.entries(defense.defenses).map(([id, count]) => [id, Math.max(0, Math.floor(count))])) as Record<string, number>,
    commanders: Object.fromEntries(COMMANDER_IDS.map((id) => [id, Math.max(0, Math.floor(fleet.commanders[id] ?? registered?.commanders[id]?.count ?? 0))])) as Partial<Record<CommanderId, number>>,
    shipLevels: Object.fromEntries(SHIP_IDS.map((id) => [id, Math.max(0, Math.floor(shipLevels[id] ?? 0))])) as Partial<Record<ShipId, number>>,
    commanderLevels,
    technologies,
    buildings: { ...(own?.buildings ?? registered!.buildings) },
    buildingQueue: own
      ? [...(state.queues[planetId] ?? [])]
      : [...(registered!.buildingQueue ?? [])],
    ownerPlanetCount,
    ownerTotalPoints: score?.totalPoints ?? 0,
    population: fleetPopulation + defensePopulation,
    coordinate: own ? coordinateOfPlanet(state, planetId)! : registered!.coordinate,
    kind: own ? 'player' as const : registered!.kind ?? 'npc',
  };
  return snapshot;
}

/** Creates the persisted incoming raid from its roll-time owner/system snapshot. */
export function dispatchPirateRaidDue(state: SaveState, due: PirateRaidDue): PirateRaidDispatchResult {
  const owner = state.pirateOperations?.cyclesByKey[due.contactCycleKey]?.ownersById[due.ownerId];
  const requestId = owner?.raidRoll?.flightRequestId;
  if (!requestId || !due.outcome.targetPlanetId) return { state };
  const existing = state.flights.records.find((flight) => flight.requestId === requestId);
  if (existing) return { state, flight: existing };
  const target = raidTargetSnapshot(state, due.ownerId, due.outcome.targetPlanetId);
  if (!target) return { state };
  const multiplier = pirateRaidPopulationMultiplier(calculatePirateActivityRatio(
    due.profile.score.resourcePoints,
    due.profile.score.battlePoints,
  ));
  const selectedId = PIRATE_BASE_SHIPS.find((ship) => due.profile.shares[ship.id] === 100)?.id;
  if (!selectedId || selectedId === 'pirate-planet-breaker') return { state };
  const selectedShip = PIRATE_CATALOG_BY_ID[selectedId];
  const requestedPopulation = Math.round(target.population * multiplier);
  const lowerCount = Math.floor(requestedPopulation / selectedShip.population);
  const upperCount = lowerCount + (requestedPopulation % selectedShip.population === 0 ? 0 : 1);
  const lowerError = Math.abs(requestedPopulation - lowerCount * selectedShip.population);
  const upperError = Math.abs(upperCount * selectedShip.population - requestedPopulation);
  const count = Math.max(1, lowerError <= upperError ? lowerCount : upperCount);
  const composition: Partial<Record<keyof typeof PIRATE_CATALOG_BY_ID, number>> = { [selectedId]: count };
  let actualPopulation = count * selectedShip.population;
  const breakerSeed = JSON.stringify(['pirate-planet-breaker:v1', due.ownerId, due.contactCycleKey, due.outcome.targetPlanetId]);
  const breakerRoll = createSeededCombatRng(breakerSeed).next();
  const breakerEligible = canUsePiratePlanetBreaker(target.ownerTotalPoints, target.population);
  // Keep the rare special unit on one deterministic 5% slice of otherwise eligible raids.
  const planetBreakerLevel = breakerEligible && breakerRoll < PIRATE_PLANET_BREAKER_APPEARANCE_CHANCE ? due.profile.shipLevel : undefined;
  if (planetBreakerLevel !== undefined) {
    composition['pirate-planet-breaker'] = 1;
    actualPopulation += PIRATE_CATALOG_BY_ID['pirate-planet-breaker'].population;
  }
  const cycle = state.pirateOperations?.cyclesByKey[due.contactCycleKey];
  if (!cycle) return { state };
  const pirateSnapshot: PirateFlightSnapshot = {
    kind: 'raid',
    contactCycleKey: due.contactCycleKey,
    ownerId: due.ownerId,
    profile: due.profile,
    roll: due.outcome.roll,
    checkedAt: due.checkedAt,
    targetOwnerId: due.ownerId,
    targetPlanetId: due.outcome.targetPlanetId,
    targetPopulationAtDispatch: target.population,
    targetPopulationBudget: requestedPopulation,
    actualPopulation,
    shipComposition: composition,
    seed: JSON.stringify(['pirate-raid-flight:v1', due.ownerId, due.contactCycleKey, due.outcome.targetPlanetId]),
    targetSnapshot: {
      name: target.name,
      ownerName: target.ownerName,
      factionId: target.factionId,
      ships: target.ships,
      defenses: target.defenses as Partial<Record<import('../domain/combat/ids.ts').DefenseId, number>>,
      commanders: target.commanders,
      shipLevels: target.shipLevels,
      commanderLevels: target.commanderLevels,
      technologies: target.technologies,
      buildings: target.buildings,
      buildingQueue: target.buildingQueue,
      ownerPlanetCount: target.ownerPlanetCount,
      ownerTotalPoints: target.ownerTotalPoints,
    },
    ...(planetBreakerLevel !== undefined ? { planetBreakerLevel } : {}),
  };
  const targetCoordinate = target.coordinate;
  const flightState = state.flights ?? createFlightState();
  const dispatched = dispatchDomainFlight(flightState, {
    requestId,
    missionId: 'pirate-raid',
    ownerSide: 'pirates',
    originPlanetId: `pirate-origin-${encodeURIComponent(due.ownerId)}`,
    originCoordinate: cycle.coordinate,
    destination: { kind: 'planet', planetId: due.outcome.targetPlanetId, coordinate: targetCoordinate },
    selectedShips: {},
    targetKind: target.kind,
    destinationPlanetId: due.outcome.targetPlanetId,
    targetPlanetName: target.name,
    targetOwnerName: target.ownerName,
    destinationOwnerId: due.ownerId,
    departedAt: due.checkedAt,
    factionId: 'aegis',
    pirateSnapshot,
  });
  const nextState: SaveState = { ...state, flights: dispatched.state };
  const nextLedger = nextState.pirateOperations;
  const nextCycle = nextLedger?.cyclesByKey[due.contactCycleKey];
  const nextOwner = nextCycle?.ownersById[due.ownerId];
  if (nextLedger && nextCycle && nextOwner?.raidRoll?.flightRequestId === requestId) {
    return {
      state: {
        ...nextState,
        pirateOperations: {
          ...nextLedger,
          cyclesByKey: {
            ...nextLedger.cyclesByKey,
            [due.contactCycleKey]: {
              ...nextCycle,
              ownersById: {
                ...nextCycle.ownersById,
                [due.ownerId]: { ...nextOwner, raidRoll: { ...nextOwner.raidRoll!, flightId: dispatched.flight.id } },
              },
            },
          },
        },
      },
      flight: dispatched.flight,
    };
  }
  return { state: nextState, flight: dispatched.flight };
}
