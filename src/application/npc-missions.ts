import { ownerFlights } from './npc-knowledge-index.ts';
import { calculateFleetPopulation, createEmptyFleetState, getSolarSatelliteFleetCount, removeSolarSatellitesFromFleet, resolveSavedFleetState } from '../domain/fleet/runtime.ts';
import { calculatePlanetCapacity, calculatePlanetPopulation } from '../domain/fleet/overpopulation.ts';
import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import { isNpcPlanetBlocked, startNpcOverpopulationAt } from './npc-economy.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { selectOwnerAlliance } from '../domain/command/selectors.ts';
import { createExplorationState, getOrMaterializeExplorationContact, launchExplorationScore, recordHighestExplorationScore } from '../domain/exploration/ledger.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { evaluatePlanetAttackEligibility } from './attack-eligibility.ts';
import { isAttackCombatShip, normalizeAttackRounds, createBot01IncomingAttackSnapshot } from './attack.ts';
import { createColonyPlanetRuntime } from './owned-planets.ts';
import { npcColonyIdentity } from './npc-identity.ts';
import { collectAsteroidGas } from './asteroid-gas-collection.ts';
import { getOwnerRelation } from './owner-relations.ts';
import { getExplorationTarget } from './exploration.ts';
import { creditNpcExplorationReturn } from './exploration-bot01.ts';
import { syncSpyTargetCommanderCounts } from '../domain/espionage/runtime.ts';
import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { getEspionageTargets, activeSpyMissionForTarget, createSeededEspionageRng, espionageRollSeed, hunterDetects, normalizeRngRoll, repeatReportLosesProbe, resolveSpyReportQuality, SPY_REPORT_COOLDOWN_MS } from '../domain/espionage/runtime.ts';
import { addDebris, getCappedDelivery, getCargoUsed, getFleetCargoCapacity, normalizeTransportCargo, type TransportCargo } from '../domain/flights/cargo.ts';
import { collectOrbitalDebrisAtCoordinate, getOrbitalDebrisAtCoordinate } from '../domain/espionage/orbital-debris.ts';
import { isFlightLimitExempt, npcFreeFlightSlots } from '../domain/flights/limit.ts';
import { beginFlightReturn, dispatchFlight, getFlightByRequestId, MAX_SPACE_FLIGHT_DURATION_MS, MIN_SPACE_FLIGHT_DURATION_MS, SPACE_FLIGHT_DURATION_STEP_MS } from '../domain/flights/runtime.ts';
import { isFlightCoordinate } from '../domain/flights/distance.ts';
import { createUniverseSystem, MAX_PLANETS_PER_OWNER, nextColonyPointThreshold } from '../domain/universe/runtime.ts';
import { createDefaultEspionageState } from '../domain/espionage/runtime.ts';
import { spyReportPopulation } from '../domain/espionage/population.ts';
import { getOwnerShipUpgradeLevels, getPlanetResources } from './contracts.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { SaveState } from './contracts.ts';
import type { FlightDestination, FlightRecord, FlightScienceLevels, FlightState, MissionId, TargetRelation } from '../domain/flights/types.ts';
import type { SpyMission, SpyOwnerProfile, SpyReportSnapshot, SpyTargetRelation, SpyTargetState } from '../domain/espionage/types.ts';
import type { UniverseCoordinate, UniverseObjectKind } from '../domain/universe/types.ts';
import type { ScienceLevels } from '../domain/buildings/resource-zone.ts';
import type { SimulatorMaxRounds } from '../domain/combat/simulator.ts';

export type NpcMissionId = 'espionage' | 'colonize' | 'attack' | 'expedition' | 'exploration-recon' | 'recycle';

export type NpcMissionDispatchCommand = Readonly<{
  ownerId: string;
  originPlanetId: string;
  requestId: string;
  missionId: NpcMissionId;
  selectedShips: Partial<Record<ShipId, number>>;
  destination: FlightDestination;
  operationId?: string;
  targetPlanetId?: string;
  targetKind?: UniverseObjectKind;
  targetRelation?: TargetRelation;
  maxRounds?: SimulatorMaxRounds;
  /** Attack only: commanders flown along (the leading one's ability applies). */
  selectedCommanders?: Partial<Record<CommanderId, number>>;
  /** Attack only: the owner's «Боевой приоритет» for this attack. */
  attackPriority?: readonly CommanderId[];
}>;

export type NpcMissionResult = Readonly<{
  state: SaveState;
  ok: boolean;
  reason: string | null;
  flight?: FlightRecord;
  created?: boolean;
}>;

/** Execution-only target lookup; public player planets need not be copied into the NPC target registry. */
export function getNpcMissionTarget(state: SaveState, targetPlanetId: string): SpyTargetState | undefined {
  const planet = state.planets[targetPlanetId];
  if (!planet) return getEspionageTargets(state.espionage)[targetPlanetId];
  if (planet.universeGalaxy === undefined || planet.universeSystem === undefined || planet.universePosition === undefined) return undefined;
  const resources = getPlanetResources(state, targetPlanetId);
  const fleetPopulation = calculateFleetPopulation(planet.fleet, state.profile.factionId);
  const defensePopulation = calculateDefensePopulation(planet.defense, state.profile.factionId);
  return {
    id: targetPlanetId,
    name: planet.name,
    coordinate: { galaxy: planet.universeGalaxy, system: planet.universeSystem, position: planet.universePosition },
    ownerId: state.profile.playerId,
    ownerName: state.profile.displayName,
    raceId: state.profile.factionId,
    alliance: selectOwnerAlliance(state.command, state.profile.playerId),
    kind: 'player',
    espionageLevel: Math.max(0, Math.floor(state.science.levels[5] ?? 0)),
    resources: { ...resources, debris: planet.recycling.availableDebris, developmentEnergy: planet.availableEnergy ?? planet.energy },
    buildings: { ...planet.buildings },
    fleet: planet.fleet,
    defense: planet.defense,
    commanders: Object.fromEntries(Object.entries(planet.fleet.commanders).map(([id, count]) => [
      id, { level: 0, count: safeCount(count) },
    ])),
    population: { total: fleetPopulation + defensePopulation, fleet: fleetPopulation, defense: defensePopulation },
    hunterLevel: 0,
    ownerProfile: {
      scienceLevels: { ...state.science.levels },
      shipLevels: getOwnerShipUpgradeLevels(state),
      commanderLevels: {},
    },
    repair: planet.repair,
    productionBots: planet.productionBots,
    solarSatellites: planet.solarSatellites,
  };
}

function safeCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function ownerProfile(state: SaveState, target: SpyTargetState): SpyOwnerProfile {
  const ledgerLevels = state.npcScience?.owners[target.ownerId]?.levels;
  return {
    scienceLevels: (ledgerLevels ?? target.ownerProfile?.scienceLevels ?? {}) as ScienceLevels,
    shipLevels: { ...(target.ownerProfile?.shipLevels ?? {}) },
    commanderLevels: { ...(target.ownerProfile?.commanderLevels ?? {}) },
  };
}

function validNpcOrigin(state: SaveState, ownerId: string, originPlanetId: string): SpyTargetState | undefined {
  const target = getEspionageTargets(state.espionage)[originPlanetId];
  return target?.kind === 'npc' && target.ownerId === ownerId ? target : undefined;
}

/** The policy view of ships free for this owner's next real mission. */
export function getNpcMissionAvailableFleet(
  state: SaveState,
  ownerId: string,
  originPlanetId: string,
): Readonly<Record<ShipId, number>> {
  const origin = validNpcOrigin(state, ownerId, originPlanetId);
  if (!origin) return Object.fromEntries(SHIP_IDS.map((id) => [id, 0])) as Record<ShipId, number>;
  const fleet = resolveSavedFleetState(origin.fleet, origin.raceId);
  // Launches physically debit the NPC planet fleet, so this is already the
  // authoritative free fleet. Subtracting active flights would reserve twice.
  return { ...fleet.ships };
}

function normalizeShips(
  raw: Partial<Record<ShipId, number>>,
  factionId: CombatFactionId,
): Partial<Record<ShipId, number>> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const catalogIds = new Set(getFactionShipCatalog(factionId).map(({ id }) => id));
  const result: Partial<Record<ShipId, number>> = {};
  for (const [rawId, rawCount] of Object.entries(raw)) {
    if (!catalogIds.has(rawId as ShipId) || !Number.isSafeInteger(rawCount) || Number(rawCount) <= 0) return null;
    result[rawId as ShipId] = Number(rawCount);
  }
  return Object.keys(result).length ? result : null;
}

function activeFlightsForOwner(state: SaveState, ownerId: string): FlightRecord[] {
  // The owner index is built once per flight list; scanning every record on
  // each launch attempt grew with the whole world's traffic.
  return ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc');
}

function flightSlotsAvailable(state: SaveState, ownerId: string, profile: SpyOwnerProfile, missionId: MissionId): boolean {
  if (isFlightLimitExempt(missionId)) return true;
  return npcFreeFlightSlots(ownerFlights(state.flights.records, ownerId), profile.scienceLevels[6]) > 0;
}

function registeredTargets(state: SaveState) {
  return Object.values(getEspionageTargets(state.espionage)).map((target) => ({
    id: target.id,
    coordinate: { ...target.coordinate },
    name: target.name,
    kind: (target.kind ?? 'npc') as 'player' | 'npc',
    ownerId: target.ownerId,
  }));
}

function publicPlayerPlanets(state: SaveState) {
  return Object.entries(state.planets).flatMap(([id, planet]) => {
    if (planet.universeGalaxy === undefined || planet.universeSystem === undefined || planet.universePosition === undefined) return [];
    return [{
      id,
      name: planet.name,
      coordinate: { galaxy: planet.universeGalaxy, system: planet.universeSystem, position: planet.universePosition },
      ownerId: state.profile.playerId,
      isHomeworld: id === 'helion-01',
    }];
  });
}

function universeNodeAt(state: SaveState, coordinate: UniverseCoordinate, at: number) {
  const system = createUniverseSystem({
    mode: 'production',
    galaxy: coordinate.galaxy,
    system: coordinate.system,
    nowMs: at,
    galaxyCount: 1,
    playerPlanets: publicPlayerPlanets(state),
    registeredPlanets: registeredTargets(state),
  });
  return system.positions.find((node) => node.coordinate.position === coordinate.position);
}

function coordinateOccupied(state: SaveState, coordinate: UniverseCoordinate, at: number, exceptFlightId?: string): boolean {
  const node = universeNodeAt(state, coordinate, at);
  if (!node || node.kind !== 'empty') return true;
  // A departure is not a colony. Competing owners may lawfully travel to the
  // same empty coordinate; its first successful arrival claims the real slot.
  return false;
}

function flyingColonizers(state: SaveState, ownerId: string): number {
  return state.flights.records.filter((flight) => flight.ownerSide === 'npc' && flight.ownerId === ownerId
    && flight.missionId === 'colonize' && (flight.phase === 'outbound' || flight.phase === 'arrived')).length;
}

function ownerPlanetCount(state: SaveState, ownerId: string): number {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.ownerId === ownerId).length;
}

function setTarget(state: SaveState, target: SpyTargetState): SaveState {
  const espionage = state.espionage ?? createDefaultEspionageState();
  const targets = { ...getEspionageTargets(espionage), [target.id]: target };
  return { ...state, espionage: { ...espionage, targets } };
}

function setFlight(state: SaveState, flight: FlightRecord): SaveState {
  const flights: FlightState = {
    ...state.flights,
    records: state.flights.records.map((item) => item.id === flight.id ? flight : item),
  };
  return { ...state, flights };
}

function fail(state: SaveState, reason: string): NpcMissionResult {
  return { state, ok: false, reason };
}

/** Dispatch one real NPC mission through the shared flight runtime. */
export function dispatchNpcMission(
  state: SaveState,
  command: NpcMissionDispatchCommand,
  at: number,
  timeScale: number,
): NpcMissionResult {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(timeScale) || timeScale <= 0) return fail(state, 'invalid-time');
  if (!command.requestId.trim()) return fail(state, 'request-id-required');
  const existing = getFlightByRequestId(state.flights, command.requestId);
  if (existing) {
    return existing.ownerSide === 'npc' && existing.ownerId === command.ownerId && existing.originPlanetId === command.originPlanetId
      ? { state, ok: true, reason: null, flight: existing, created: false }
      : fail(state, 'request-id-owned-by-another-flight');
  }
  const origin = validNpcOrigin(state, command.ownerId, command.originPlanetId);
  if (!origin) return fail(state, 'npc-origin-not-found');
  const profile = ownerProfile(state, origin);
  if (!flightSlotsAvailable(state, command.ownerId, profile, command.missionId)) return fail(state, 'flight-limit-reached');
  const selectedShips = normalizeShips(command.selectedShips, origin.raceId);
  if (!selectedShips) return fail(state, 'invalid-ship-selection');
  const freeShips = getNpcMissionAvailableFleet(state, command.ownerId, origin.id);
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) {
    if ((freeShips[shipId] ?? 0) < count) return fail(state, 'insufficient-ships');
  }

  const destination = command.destination;
  if (!isFlightCoordinate(destination.coordinate)) return fail(state, 'invalid-coordinate');
  let target: SpyTargetState | undefined;
  let relation: TargetRelation | undefined;
  let explorationNode: ReturnType<typeof getExplorationTarget>;
  let operationId: string | undefined;
  if (command.missionId === 'espionage' || command.missionId === 'attack') {
    const targetId = command.targetPlanetId ?? (destination.kind === 'planet' ? destination.planetId : undefined);
    target = targetId ? getNpcMissionTarget(state, targetId) : undefined;
    if (!target || (target.kind !== 'player' && target.kind !== 'npc')
      || !sameCoordinate(target.coordinate, destination.coordinate)) return fail(state, 'target-not-available');
    relation = getOwnerRelation(state, command.ownerId, target.ownerId);
    if (command.targetRelation !== undefined && command.targetRelation !== relation) return fail(state, 'target-relation-changed');
    if (relation !== 'enemy' && relation !== 'neutral') return fail(state, 'target-relation-blocked');
    if (command.missionId === 'espionage') {
      if (destination.kind !== 'planet' || destination.planetId !== target.id
        || Object.keys(selectedShips).length !== 1 || selectedShips['spy-probe'] !== 1) return fail(state, 'invalid-espionage-composition');
      if (activeSpyMissionForTarget(state.espionage?.missions ?? [], command.ownerId, target.id)) return fail(state, 'spy-target-already-active');
    } else {
      if (!evaluatePlanetAttackEligibility(state, command.ownerId, target.ownerId).allowed) return fail(state, 'attack-not-allowed');
      if (Object.keys(selectedShips).some((shipId) => !isAttackCombatShip(shipId as ShipId, origin.raceId))) return fail(state, 'invalid-attack-composition');
      if (command.maxRounds !== undefined && ![5, 8, 12].includes(command.maxRounds)) return fail(state, 'invalid-round-limit');
      if (!takeCommanders(origin, command.selectedCommanders)) return fail(state, 'insufficient-commanders');
    }
  }
  let recycleCapacity: number | undefined;
  let recycleTargetKind: UniverseObjectKind | undefined;
  if (command.missionId === 'recycle') {
    // Recyclers only, to public debris (the map shows it to everyone), as the player's.
    if (destination.kind !== 'coordinate' || Object.keys(selectedShips).length === 0
      || Object.keys(selectedShips).some((shipId) => !isNpcRecyclerShip(shipId as ShipId, origin.raceId))) return fail(state, 'invalid-recycle-composition');
    if (getOrbitalDebrisAtCoordinate(state.espionage ?? createDefaultEspionageState(), destination.coordinate) <= 0) return fail(state, 'target-not-available');
    const catalog = Object.fromEntries(getFactionShipCatalog(origin.raceId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
    recycleCapacity = getFleetCargoCapacity(selectedShips, catalog);
    if (recycleCapacity <= 0) return fail(state, 'invalid-recycle-composition');
    // What lies at the coordinate, as the player's recycler records it.
    const atTarget = Object.values(getEspionageTargets(state.espionage)).find((item) => sameCoordinate(item.coordinate, destination.coordinate));
    const atPlayer = Object.values(state.planets).some((planet) => planet.universeGalaxy === destination.coordinate.galaxy
      && planet.universeSystem === destination.coordinate.system && planet.universePosition === destination.coordinate.position);
    recycleTargetKind = atTarget ? (atTarget.kind === 'player' ? 'player' : 'npc') : atPlayer ? 'player' : 'empty';
  }
  if (command.missionId === 'colonize') {
    if (destination.kind !== 'coordinate' || !isFlightCoordinate(destination.coordinate)
      || !selectedColonizerOnly(selectedShips) || (command.targetKind !== undefined && command.targetKind !== 'empty' && command.targetKind !== 'asteroid')) {
      return fail(state, 'invalid-colonization-command');
    }
    if (ownerPlanetCount(state, command.ownerId) >= MAX_PLANETS_PER_OWNER) return fail(state, 'planet-limit-reached');
    // The same total-point gate as the player's, counting colonizers already flying.
    const threshold = nextColonyPointThreshold(ownerPlanetCount(state, command.ownerId) + flyingColonizers(state, command.ownerId));
    if (threshold === null) return fail(state, 'planet-limit-reached');
    if ((selectOwnerScore(state, command.ownerId)?.totalPoints ?? 0) < threshold) return fail(state, 'colony-points-required');
    if (coordinateOccupied(state, destination.coordinate, at)) return fail(state, 'target-occupied');
  }
  if (command.missionId === 'expedition' || command.missionId === 'exploration-recon') {
    operationId = command.operationId ?? (destination.kind === 'operation' ? destination.operationId : undefined);
    explorationNode = operationId ? getExplorationTarget(state, operationId, at, 'production') : undefined;
    if (destination.kind !== 'coordinate' || !explorationNode || !sameCoordinate(explorationNode.coordinate, destination.coordinate)
      || (command.targetKind !== undefined && command.targetKind !== explorationNode.kind)) return fail(state, 'target-not-available');
    if (command.missionId === 'exploration-recon'
      && (Object.keys(selectedShips).length !== 1 || selectedShips['spy-probe'] !== 1)) return fail(state, 'invalid-recon-composition');
    if (command.missionId === 'expedition' && state.exploration?.contacts[explorationNode.id]?.claim) return fail(state, 'target-occupied');
    if (command.missionId === 'exploration-recon') {
      const contactId = explorationNode.id;
      const last = [...(state.exploration?.reconReports ?? [])].reverse()
        .find((report) => report.contactId === contactId && report.ownerId === command.ownerId);
      if (last && at - last.resolvedAt < 120_000) return fail(state, 'spy-report-cooldown');
      if (state.flights.records.some((flight) => flight.missionId === 'exploration-recon'
        && flight.ownerSide === 'npc' && flight.ownerId === command.ownerId && flight.operationId === operationId
        && ['outbound', 'returning'].includes(flight.phase))) return fail(state, 'spy-target-already-active');
    }
  }

  const science = profile.scienceLevels;
  const attackCommanders = command.missionId === 'attack' ? takeCommanders(origin, command.selectedCommanders) ?? {} : {};
  const snapshot = command.missionId === 'attack'
    ? {
      ...createBot01IncomingAttackSnapshot(origin, profile, command.attackPriority),
      maxRounds: normalizeAttackRounds(command.maxRounds),
    }
    : undefined;
  const domainResult = dispatchFlight(state.flights, {
    requestId: command.requestId,
    missionId: command.missionId,
    ownerSide: 'npc',
    ownerId: command.ownerId,
    originPlanetId: origin.id,
    originCoordinate: origin.coordinate,
    destination,
    selectedShips,
    departedAt: at,
    factionId: origin.raceId,
    science: science as FlightScienceLevels,
    operationId,
    targetKind: command.targetKind ?? recycleTargetKind ?? explorationNode?.kind ?? target?.kind,
    ...(command.missionId === 'expedition' || command.missionId === 'exploration-recon' ? {
      targetRelation: 'neutral' as const,
    } : {}),
    ...(target ? {
      destinationPlanetId: target.id,
      destinationOwnerId: target.ownerId,
      targetPlanetName: target.name,
      targetOwnerName: target.ownerName,
      targetRelation: relation,
    } : {}),
    ...(command.missionId === 'espionage' ? { spyMissionId: `spy-${command.requestId}` } : {}),
    ...(snapshot ? { attackSnapshot: snapshot } : {}),
    ...(Object.keys(attackCommanders).length ? { selectedCommanders: attackCommanders } : {}),
    ...(command.missionId === 'colonize' ? { populationReserved: 12 } : {}),
    ...(command.missionId === 'recycle' ? { recycleCapacity, cargo: { metal: 0, minerals: 0, gas: 0, debris: 0 } } : {}),
    speedCommanderLevels: { typhoon: profile.commanderLevels.typhoon ?? 0 },
  });
  const duration = Math.max(1, Math.round(domainResult.flight.oneWayDurationMs / timeScale));
  // Only exploration launches record the owner's score; price that one owner alone.
  const ownResourcePoints = explorationNode ? selectOwnerScore(state, command.ownerId)?.resourcePoints ?? 0 : 0;
  const explorationLaunchResourcePoints = command.missionId === 'expedition' || command.missionId === 'exploration-recon'
    ? launchExplorationScore(state.exploration ?? createExplorationState(), command.ownerId, ownResourcePoints)
    : undefined;
  if (explorationNode && duration + at >= explorationNode.special!.expiresAt) return fail(state, 'target-not-available');
  const flight: FlightRecord = {
    ...domainResult.flight,
    ...(explorationNode ? { explorationFactionId: origin.raceId, explorationLaunchResourcePoints } : {}),
    oneWayDurationMs: duration,
    arrivalAt: at + duration,
  };
  const gasAvailable = origin.resources.gas;
  if (gasAvailable < flight.gasCost) return fail(state, 'insufficient-gas');

  const ships = { ...origin.fleet.ships };
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) {
    ships[shipId] = Math.max(0, (ships[shipId] ?? 0) - count);
  }
  const commanders = { ...origin.fleet.commanders };
  for (const [id, count] of Object.entries(attackCommanders) as [CommanderId, number][]) commanders[id] = Math.max(0, (commanders[id] ?? 0) - count);
  const debitedOrigin: SpyTargetState = {
    ...syncSpyTargetCommanderCounts(origin, { ...origin.fleet, ships, commanders }, origin.ownerProfile),
    resources: { ...origin.resources, gas: gasAvailable - flight.gasCost },
  };
  let next = setTarget({ ...state, flights: domainResult.state }, debitedOrigin);
  next = setFlight(next, flight);
  if (explorationNode && operationId) {
    const exploration = state.exploration ?? createExplorationState();
    const scored = recordHighestExplorationScore(exploration, command.ownerId, ownResourcePoints);
    const materialized = getOrMaterializeExplorationContact(scored, explorationNode).state;
    next = { ...next, exploration: materialized };
  }
  if (command.missionId === 'espionage' && target && relation) {
    const mission: SpyMission = {
      id: flight.spyMissionId!,
      flightId: flight.id,
      ownerId: command.ownerId,
      originPlanetId: origin.id,
      targetPlanetId: target.id,
      targetPlanetName: target.name,
      targetOwnerId: target.ownerId,
      targetOwnerName: target.ownerName,
      targetRaceId: target.raceId,
      targetAlliance: target.alliance,
      targetRelation: relation as SpyTargetRelation,
      targetCoordinate: { ...target.coordinate },
      spyLevel: Math.max(0, Math.floor(profile.scienceLevels[5] ?? 0)),
      targetEspionageLevel: Math.max(0, Math.floor(target.ownerProfile?.scienceLevels[5] ?? target.espionageLevel)),
      status: 'transit',
      sentAt: at,
      arrivalAt: flight.arrivalAt,
      reportIds: [],
    };
    const espionage = next.espionage ?? createDefaultEspionageState();
    next = { ...next, espionage: { ...espionage, missions: [...espionage.missions, mission] } };
  }
  return { state: next, ok: true, reason: null, flight, created: true };
}

/** A recycler hull of the owner's race (the catalog role names it), as for the player. */
export function isNpcRecyclerShip(shipId: ShipId, raceId: SpyTargetState['raceId']): boolean {
  const entity = getFactionShipCatalog(raceId).find((candidate) => candidate.id === shipId);
  return Boolean(entity?.role.toLocaleLowerCase().includes('переработчик'));
}

/**
 * Recyclers reach their coordinate: they collect up to their capacity from
 * the debris there (the shared collector, first come first served) and turn
 * home with it.
 */
export function resolveNpcRecycleArrival(state: SaveState, flight: FlightRecord, at: number): NpcMissionResult {
  if (flight.ownerSide !== 'npc' || !flight.ownerId || flight.missionId !== 'recycle' || flight.phase !== 'outbound' || at < flight.arrivalAt) {
    return fail(state, 'invalid-arrival');
  }
  const collected = collectOrbitalDebrisAtCoordinate(state.espionage ?? createDefaultEspionageState(), flight.destinationCoordinate, flight.recycleCapacity ?? 0);
  const withDebris: SaveState = { ...state, espionage: collected.espionage };
  const returning = beginFlightReturn(withDebris.flights, flight.id, flight.arrivalAt, 'normal-return');
  const turned = returning.records.find((record) => record.id === flight.id)!;
  const arrived: FlightRecord = {
    ...turned,
    arrivedAt: flight.arrivalAt,
    cargo: { metal: 0, minerals: 0, gas: 0, debris: collected.collected },
    cargoState: 'delivered',
    completionReason: 'normal-return',
  };
  return { state: setFlight({ ...withDebris, flights: returning }, arrived), ok: true, reason: null, flight: arrived };
}

/** The flat gas fee of «Космический рейс», the same as the player's. */
export const NPC_SPACE_FLIGHT_GAS_FEE = 100;

export type NpcSpaceFlightCommand = Readonly<{
  requestId: string;
  ownerId: string;
  originPlanetId: string;
  selectedShips: Partial<Record<ShipId, number>>;
  cargo: TransportCargo;
  /** One leg; the fleet is back after twice this. */
  oneWayDurationMs: number;
}>;

/**
 * «Космический рейс» for an NPC, under the player's rules: the fleet and its
 * loaded cargo leave the planet and come back after two legs of a chosen
 * length (5 min – 11 h 59 min); 100 gas whatever the fleet. While away they
 * are out of reach of any attack on the planet.
 */
export function dispatchNpcSpaceFlight(state: SaveState, command: NpcSpaceFlightCommand, at: number): NpcMissionResult {
  if (!Number.isSafeInteger(at) || at < 0) return fail(state, 'invalid-time');
  if (!command.requestId.trim()) return fail(state, 'request-id-required');
  const existing = getFlightByRequestId(state.flights, command.requestId);
  if (existing) {
    return existing.ownerSide === 'npc' && existing.ownerId === command.ownerId && existing.originPlanetId === command.originPlanetId
      ? { state, ok: true, reason: null, flight: existing, created: false }
      : fail(state, 'request-id-owned-by-another-flight');
  }
  const origin = validNpcOrigin(state, command.ownerId, command.originPlanetId);
  if (!origin) return fail(state, 'npc-origin-not-found');
  const profile = ownerProfile(state, origin);
  if (!flightSlotsAvailable(state, command.ownerId, profile, 'space-flight')) return fail(state, 'flight-limit-reached');
  const duration = command.oneWayDurationMs;
  if (!Number.isSafeInteger(duration) || duration < MIN_SPACE_FLIGHT_DURATION_MS || duration > MAX_SPACE_FLIGHT_DURATION_MS
    || duration % SPACE_FLIGHT_DURATION_STEP_MS !== 0) return fail(state, 'invalid-duration');
  const selectedShips = normalizeShips(command.selectedShips, origin.raceId);
  if (!selectedShips || selectedShips['solar-satellite']) return fail(state, 'invalid-ship-selection');
  const freeShips = getNpcMissionAvailableFleet(state, command.ownerId, origin.id);
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) {
    if ((freeShips[shipId] ?? 0) < count) return fail(state, 'insufficient-ships');
  }
  const cargo = normalizeTransportCargo(command.cargo);
  const catalog = Object.fromEntries(getFactionShipCatalog(origin.raceId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
  if (getCargoUsed(cargo) > getFleetCargoCapacity(selectedShips, catalog)) return fail(state, 'insufficient-cargo-capacity');
  if (cargo.debris > 0 || cargo.metal > origin.resources.metal || cargo.minerals > origin.resources.minerals) return fail(state, 'invalid-cargo');
  if (origin.resources.gas < cargo.gas + NPC_SPACE_FLIGHT_GAS_FEE) return fail(state, 'insufficient-gas');
  const domainResult = dispatchFlight(state.flights, {
    requestId: command.requestId,
    missionId: 'space-flight',
    ownerSide: 'npc',
    ownerId: command.ownerId,
    originPlanetId: origin.id,
    originCoordinate: origin.coordinate,
    destination: { kind: 'space', coordinate: { ...origin.coordinate } },
    selectedShips,
    departedAt: at,
    factionId: origin.raceId,
    science: profile.scienceLevels as FlightScienceLevels,
    cargo,
    durationMs: duration,
  });
  const flight = domainResult.flight;
  const ships = { ...origin.fleet.ships };
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) ships[shipId] = Math.max(0, (ships[shipId] ?? 0) - count);
  const debitedOrigin: SpyTargetState = {
    ...origin,
    fleet: { ...origin.fleet, ships },
    resources: {
      ...origin.resources,
      metal: origin.resources.metal - cargo.metal,
      minerals: origin.resources.minerals - cargo.minerals,
      gas: origin.resources.gas - cargo.gas - flight.gasCost,
    },
  };
  const next = setFlight(setTarget({ ...state, flights: domainResult.state }, debitedOrigin), flight);
  return { state: next, ok: true, reason: null, flight, created: true };
}

export type NpcTransportCommand = Readonly<{
  requestId: string;
  ownerId: string;
  originPlanetId: string;
  destinationPlanetId: string;
  selectedShips: Partial<Record<ShipId, number>>;
  cargo: TransportCargo;
}>;

/**
 * Transport between two of the owner's own planets, by the player's rules:
 * cargo holds, route time and gas; the cargo lands in the destination's
 * stores (what does not fit stays aboard and comes back) and the ships return.
 */
export function dispatchNpcTransport(state: SaveState, command: NpcTransportCommand, at: number, timeScale: number): NpcMissionResult {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(timeScale) || timeScale <= 0) return fail(state, 'invalid-time');
  if (!command.requestId.trim()) return fail(state, 'request-id-required');
  const existing = getFlightByRequestId(state.flights, command.requestId);
  if (existing) {
    return existing.ownerSide === 'npc' && existing.ownerId === command.ownerId && existing.originPlanetId === command.originPlanetId
      ? { state, ok: true, reason: null, flight: existing, created: false }
      : fail(state, 'request-id-owned-by-another-flight');
  }
  const origin = validNpcOrigin(state, command.ownerId, command.originPlanetId);
  const target = validNpcOrigin(state, command.ownerId, command.destinationPlanetId);
  if (!origin) return fail(state, 'npc-origin-not-found');
  if (!target || target.id === origin.id) return fail(state, 'target-not-available');
  const profile = ownerProfile(state, origin);
  if (!flightSlotsAvailable(state, command.ownerId, profile, 'transport')) return fail(state, 'flight-limit-reached');
  const selectedShips = normalizeShips(command.selectedShips, origin.raceId);
  if (!selectedShips || Object.keys(selectedShips).some((id) => id !== 'transporter' && id !== 'mega-transporter')) return fail(state, 'invalid-ship-selection');
  const freeShips = getNpcMissionAvailableFleet(state, command.ownerId, origin.id);
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) {
    if ((freeShips[shipId] ?? 0) < count) return fail(state, 'insufficient-ships');
  }
  const cargo = normalizeTransportCargo(command.cargo);
  const catalog = Object.fromEntries(getFactionShipCatalog(origin.raceId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
  if (getCargoUsed(cargo) <= 0 || getCargoUsed(cargo) > getFleetCargoCapacity(selectedShips, catalog)) return fail(state, 'insufficient-cargo-capacity');
  if (cargo.debris > 0 || cargo.metal > origin.resources.metal || cargo.minerals > origin.resources.minerals) return fail(state, 'invalid-cargo');
  const domainResult = dispatchFlight(state.flights, {
    requestId: command.requestId,
    missionId: 'transport',
    ownerSide: 'npc',
    ownerId: command.ownerId,
    originPlanetId: origin.id,
    originCoordinate: origin.coordinate,
    destination: { kind: 'planet', planetId: target.id, coordinate: { ...target.coordinate } },
    destinationPlanetId: target.id,
    destinationOwnerId: target.ownerId,
    targetPlanetName: target.name,
    targetOwnerName: target.ownerName,
    targetRelation: 'self',
    targetKind: 'npc',
    selectedShips,
    departedAt: at,
    factionId: origin.raceId,
    science: profile.scienceLevels as FlightScienceLevels,
    cargo,
    speedCommanderLevels: { typhoon: profile.commanderLevels.typhoon ?? 0 },
  });
  const duration = Math.max(1, Math.round(domainResult.flight.oneWayDurationMs / timeScale));
  const flight: FlightRecord = { ...domainResult.flight, oneWayDurationMs: duration, arrivalAt: at + duration, cargoState: 'loaded' };
  if (origin.resources.gas < cargo.gas + flight.gasCost) return fail(state, 'insufficient-gas');
  const ships = { ...origin.fleet.ships };
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) ships[shipId] = Math.max(0, (ships[shipId] ?? 0) - count);
  const debitedOrigin: SpyTargetState = {
    ...origin,
    fleet: { ...origin.fleet, ships },
    resources: {
      ...origin.resources,
      metal: origin.resources.metal - cargo.metal,
      minerals: origin.resources.minerals - cargo.minerals,
      gas: origin.resources.gas - cargo.gas - flight.gasCost,
    },
  };
  return { state: setFlight(setTarget({ ...state, flights: domainResult.state }, debitedOrigin), flight), ok: true, reason: null, flight, created: true };
}

export type NpcDeploymentCommand = Readonly<{
  requestId: string;
  ownerId: string;
  originPlanetId: string;
  destinationPlanetId: string;
  selectedShips: Partial<Record<ShipId, number>>;
  /** Commanders flown with the fleet, as the player's deployment carries them. */
  selectedCommanders?: Partial<Record<CommanderId, number>>;
}>;

/** Valid positive commander counts the planet has at home, or null for an impossible request. */
function takeCommanders(origin: SpyTargetState, raw: Partial<Record<CommanderId, number>> | undefined): Partial<Record<CommanderId, number>> | null {
  const selected: Partial<Record<CommanderId, number>> = {};
  for (const [id, count] of Object.entries(raw ?? {}) as [CommanderId, number][]) {
    if (!COMMANDER_IDS.includes(id) || !Number.isSafeInteger(count) || count < 0) return null;
    if (count === 0) continue;
    if ((origin.fleet.commanders?.[id] ?? 0) < count) return null;
    selected[id] = count;
  }
  return selected;
}

/** Population the destination hangar has free right now, the only room a deployment is checked against. */
export function npcDeploymentFreeCapacity(target: SpyTargetState): number {
  const fleet = removeSolarSatellitesFromFleet(target.fleet).fleet;
  const satellites = Math.max(Math.max(0, Math.floor(target.solarSatellites ?? 0)), getSolarSatelliteFleetCount(target.fleet));
  const population = calculatePlanetPopulation(fleet, satellites, target.raceId);
  return Math.max(0, calculatePlanetCapacity(migrateBuildingLevels(target.buildings).hangar ?? 0) - population);
}

/**
 * «Дислокация» between two of the owner's own planets, by the player's rules
 * (`dispatchFlightCommand`): no solar satellites, the destination must not be
 * in an overpopulation episode, and the fleet must fit the destination's free
 * hangar room at dispatch. Room is checked against the planet as it is now,
 * not against other deployments already on their way, exactly as for the
 * player: several parallel deployments may land together and overfill it.
 */
export function dispatchNpcDeployment(state: SaveState, command: NpcDeploymentCommand, at: number, timeScale: number): NpcMissionResult {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(timeScale) || timeScale <= 0) return fail(state, 'invalid-time');
  if (!command.requestId.trim()) return fail(state, 'request-id-required');
  const existing = getFlightByRequestId(state.flights, command.requestId);
  if (existing) {
    return existing.ownerSide === 'npc' && existing.ownerId === command.ownerId && existing.originPlanetId === command.originPlanetId
      ? { state, ok: true, reason: null, flight: existing, created: false }
      : fail(state, 'request-id-owned-by-another-flight');
  }
  const origin = validNpcOrigin(state, command.ownerId, command.originPlanetId);
  const target = validNpcOrigin(state, command.ownerId, command.destinationPlanetId);
  if (!origin) return fail(state, 'npc-origin-not-found');
  if (!target || target.id === origin.id) return fail(state, 'target-not-available');
  const profile = ownerProfile(state, origin);
  if (!flightSlotsAvailable(state, command.ownerId, profile, 'deployment')) return fail(state, 'flight-limit-reached');
  const selectedCommanders = takeCommanders(origin, command.selectedCommanders);
  if (!selectedCommanders) return fail(state, 'insufficient-commanders');
  const hasCommanders = Object.keys(selectedCommanders).length > 0;
  // Ships, commanders or both, as the player's deployment allows.
  const selectedShips = Object.keys(command.selectedShips).length || !hasCommanders ? normalizeShips(command.selectedShips, origin.raceId) : {};
  if (!selectedShips || selectedShips['solar-satellite']) return fail(state, 'invalid-ship-selection');
  const freeShips = getNpcMissionAvailableFleet(state, command.ownerId, origin.id);
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) {
    if ((freeShips[shipId] ?? 0) < count) return fail(state, 'insufficient-ships');
  }
  if (isNpcPlanetBlocked(target)) return fail(state, 'target-overpopulated');
  const empty = createEmptyFleetState();
  const population = calculateFleetPopulation({ ships: { ...empty.ships, ...selectedShips }, commanders: { ...empty.commanders, ...selectedCommanders } }, origin.raceId);
  if (population > npcDeploymentFreeCapacity(target)) return fail(state, 'capacity-exceeded');
  const domainResult = dispatchFlight(state.flights, {
    requestId: command.requestId,
    missionId: 'deployment',
    ownerSide: 'npc',
    ownerId: command.ownerId,
    originPlanetId: origin.id,
    originCoordinate: origin.coordinate,
    destination: { kind: 'planet', planetId: target.id, coordinate: { ...target.coordinate } },
    destinationPlanetId: target.id,
    destinationOwnerId: target.ownerId,
    targetPlanetName: target.name,
    targetOwnerName: target.ownerName,
    targetRelation: 'self',
    targetKind: 'npc',
    selectedShips,
    ...(hasCommanders ? {
      selectedCommanders,
      // Levels are owner-wide; the flight keeps the snapshot like the player's.
      selectedCommanderLevels: Object.fromEntries(Object.keys(selectedCommanders).map((id) => [id, Math.max(0, Math.floor(profile.commanderLevels[id as CommanderId] ?? 0))])),
    } : {}),
    departedAt: at,
    factionId: origin.raceId,
    science: profile.scienceLevels as FlightScienceLevels,
    populationReserved: population,
    speedCommanderLevels: { typhoon: profile.commanderLevels.typhoon ?? 0 },
  });
  const duration = Math.max(1, Math.round(domainResult.flight.oneWayDurationMs / timeScale));
  const flight: FlightRecord = { ...domainResult.flight, oneWayDurationMs: duration, arrivalAt: at + duration };
  if (origin.resources.gas < flight.gasCost) return fail(state, 'insufficient-gas');
  const ships = { ...origin.fleet.ships };
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) ships[shipId] = Math.max(0, (ships[shipId] ?? 0) - count);
  const commanders = { ...origin.fleet.commanders };
  for (const [id, count] of Object.entries(selectedCommanders) as [CommanderId, number][]) commanders[id] = Math.max(0, (commanders[id] ?? 0) - count);
  const debitedOrigin: SpyTargetState = {
    ...syncSpyTargetCommanderCounts(origin, { ...origin.fleet, ships, commanders }, origin.ownerProfile),
    resources: { ...origin.resources, gas: origin.resources.gas - flight.gasCost },
  };
  return { state: setFlight(setTarget({ ...state, flights: domainResult.state }, debitedOrigin), flight), ok: true, reason: null, flight, created: true };
}

/**
 * The deployed fleet joins its destination at arrival. Any excess over the
 * hangar starts the overpopulation window at that very moment (the player's
 * linear 10-minute burn), not at whenever the planet is settled next.
 * A destination lost on the way sends the fleet home.
 */
export function resolveNpcDeploymentArrival(state: SaveState, flight: FlightRecord, at: number): NpcMissionResult {
  if (flight.ownerSide !== 'npc' || !flight.ownerId || flight.missionId !== 'deployment' || flight.phase !== 'outbound' || at < flight.arrivalAt) {
    return fail(state, 'invalid-arrival');
  }
  const target = flight.destinationPlanetId ? validNpcOrigin(state, flight.ownerId, flight.destinationPlanetId) : undefined;
  if (!target || !sameCoordinate(target.coordinate, flight.destinationCoordinate)) {
    const returningState = beginFlightReturn(state.flights, flight.id, flight.arrivalAt, 'target-unavailable');
    const returning = returningState.records.find((item) => item.id === flight.id)!;
    const updated: FlightRecord = { ...returning, arrivedAt: flight.arrivalAt, completionReason: 'target-unavailable' };
    return { state: setFlight({ ...state, flights: returningState }, updated), ok: false, reason: 'target-unavailable', flight: updated };
  }
  const ships = { ...target.fleet.ships };
  for (const [id, raw] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
    const count = safeCount(raw);
    if (count) ships[id] = (ships[id] ?? 0) + count;
  }
  const commanders = { ...target.fleet.commanders };
  for (const [id, raw] of Object.entries(flight.selectedCommanders ?? {}) as [CommanderId, number][]) {
    const count = safeCount(raw);
    if (count) commanders[id] = (commanders[id] ?? 0) + count;
  }
  // Levels are owner-wide; a destination profile behind the flight's snapshot takes the higher one.
  const levels = { ...(target.ownerProfile?.commanderLevels ?? {}) } as Partial<Record<CommanderId, number>>;
  for (const [id, level] of Object.entries(flight.selectedCommanderLevels ?? {}) as [CommanderId, number][]) levels[id] = Math.max(levels[id] ?? 0, level ?? 0);
  const ownerProfile = { scienceLevels: {}, shipLevels: {}, ...(target.ownerProfile ?? {}), commanderLevels: levels };
  const landed = startNpcOverpopulationAt(syncSpyTargetCommanderCounts({ ...target, ownerProfile }, { ...target.fleet, ships, commanders }, ownerProfile), flight.arrivalAt);
  const completed: FlightRecord = { ...flight, phase: 'completed', arrivedAt: flight.arrivalAt, completedAt: flight.arrivalAt, completionReason: 'deployed' };
  return { state: setFlight(setTarget(state, landed), completed), ok: true, reason: null, flight: completed };
}

export type NpcGasCommand = Readonly<{
  requestId: string;
  ownerId: string;
  originPlanetId: string;
  coordinate: UniverseCoordinate;
  selectedShips: Partial<Record<ShipId, number>>;
}>;

/**
 * «Добыча газа» for an NPC, by the player's rules: recyclers only, to a
 * coordinate (the asteroid must be there at arrival, checked only then), a
 * slot, route time and gas. The owner aims where its forecast puts the asteroid.
 */
export function dispatchNpcGas(state: SaveState, command: NpcGasCommand, at: number, timeScale: number): NpcMissionResult {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(timeScale) || timeScale <= 0) return fail(state, 'invalid-time');
  if (!command.requestId.trim()) return fail(state, 'request-id-required');
  const existing = getFlightByRequestId(state.flights, command.requestId);
  if (existing) {
    return existing.ownerSide === 'npc' && existing.ownerId === command.ownerId && existing.originPlanetId === command.originPlanetId
      ? { state, ok: true, reason: null, flight: existing, created: false }
      : fail(state, 'request-id-owned-by-another-flight');
  }
  const origin = validNpcOrigin(state, command.ownerId, command.originPlanetId);
  if (!origin) return fail(state, 'npc-origin-not-found');
  if (!isFlightCoordinate(command.coordinate)) return fail(state, 'invalid-coordinate');
  const profile = ownerProfile(state, origin);
  if (!flightSlotsAvailable(state, command.ownerId, profile, 'gas')) return fail(state, 'flight-limit-reached');
  const selectedShips = normalizeShips(command.selectedShips, origin.raceId);
  if (!selectedShips || Object.keys(selectedShips).some((shipId) => !isNpcRecyclerShip(shipId as ShipId, origin.raceId))) return fail(state, 'invalid-gas-composition');
  const freeShips = getNpcMissionAvailableFleet(state, command.ownerId, origin.id);
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) {
    if ((freeShips[shipId] ?? 0) < count) return fail(state, 'insufficient-ships');
  }
  const catalog = Object.fromEntries(getFactionShipCatalog(origin.raceId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
  const gasCapacity = getFleetCargoCapacity(selectedShips, catalog);
  if (gasCapacity <= 0) return fail(state, 'invalid-gas-composition');
  const domainResult = dispatchFlight(state.flights, {
    requestId: command.requestId,
    missionId: 'gas',
    ownerSide: 'npc',
    ownerId: command.ownerId,
    originPlanetId: origin.id,
    originCoordinate: origin.coordinate,
    destination: { kind: 'coordinate', coordinate: { ...command.coordinate } },
    targetKind: 'asteroid',
    selectedShips,
    departedAt: at,
    factionId: origin.raceId,
    science: profile.scienceLevels as FlightScienceLevels,
    cargo: { metal: 0, minerals: 0, gas: 0, debris: 0 },
    gasCapacity,
    speedCommanderLevels: { typhoon: profile.commanderLevels.typhoon ?? 0 },
  });
  const duration = Math.max(1, Math.round(domainResult.flight.oneWayDurationMs / timeScale));
  const flight: FlightRecord = { ...domainResult.flight, oneWayDurationMs: duration, arrivalAt: at + duration, cargoState: 'loaded' };
  if (origin.resources.gas < flight.gasCost) return fail(state, 'insufficient-gas');
  const ships = { ...origin.fleet.ships };
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) ships[shipId] = Math.max(0, (ships[shipId] ?? 0) - count);
  const debitedOrigin: SpyTargetState = {
    ...origin,
    fleet: { ...origin.fleet, ships },
    resources: { ...origin.resources, gas: origin.resources.gas - flight.gasCost },
  };
  return { state: setFlight(setTarget({ ...state, flights: domainResult.state }, debitedOrigin), flight), ok: true, reason: null, flight, created: true };
}

/** Recyclers reach the coordinate: gas and scrap from the asteroid there (if any) ride home. */
export function resolveNpcGasArrival(state: SaveState, flight: FlightRecord, at: number): NpcMissionResult {
  if (flight.ownerSide !== 'npc' || !flight.ownerId || flight.missionId !== 'gas' || flight.phase !== 'outbound' || at < flight.arrivalAt) {
    return fail(state, 'invalid-arrival');
  }
  const collection = collectAsteroidGas(state, flight.destinationCoordinate, flight.arrivalAt, flight.gasCapacity ?? 0);
  const returning = beginFlightReturn(collection.state.flights, flight.id, flight.arrivalAt, 'normal-return');
  const turned = returning.records.find((record) => record.id === flight.id)!;
  const arrived: FlightRecord = {
    ...turned,
    arrivedAt: flight.arrivalAt,
    cargo: { metal: 0, minerals: 0, gas: collection.gasCollected, debris: collection.scrapCollected },
    cargoState: 'loaded',
    completionReason: collection.found ? 'normal-return' : 'target-unavailable',
  };
  return { state: setFlight({ ...collection.state, flights: returning }, arrived), ok: collection.found,
    reason: collection.found ? null : 'target-unavailable', flight: arrived };
}

/** Unloads an NPC transport into its own destination planet; anything that does not fit flies back. */
export function resolveNpcTransportArrival(state: SaveState, flight: FlightRecord, at: number): NpcMissionResult {
  if (flight.ownerSide !== 'npc' || !flight.ownerId || flight.missionId !== 'transport' || flight.phase !== 'outbound' || at < flight.arrivalAt) {
    return fail(state, 'invalid-arrival');
  }
  const target = flight.destinationPlanetId ? validNpcOrigin(state, flight.ownerId, flight.destinationPlanetId) : undefined;
  let next = state;
  let remaining: TransportCargo = { ...(flight.cargo ?? { metal: 0, minerals: 0, gas: 0, debris: 0 }) };
  if (target) {
    const delivery = getCappedDelivery({ metal: target.resources.metal, minerals: target.resources.minerals, gas: target.resources.gas },
      getStorageCapacities(target.buildings), remaining);
    next = setTarget(next, { ...target, resources: { ...target.resources, ...delivery.resources } });
    remaining = { metal: remaining.metal - (delivery.resources.metal - target.resources.metal),
      minerals: remaining.minerals - (delivery.resources.minerals - target.resources.minerals),
      gas: remaining.gas - (delivery.resources.gas - target.resources.gas), debris: 0 };
  }
  const returning = beginFlightReturn(next.flights, flight.id, flight.arrivalAt, target ? 'normal-return' : 'target-unavailable');
  const turned = returning.records.find((record) => record.id === flight.id)!;
  const leftover = getCargoUsed(remaining) > 0;
  const arrived: FlightRecord = {
    ...turned,
    arrivedAt: flight.arrivalAt,
    cargo: remaining,
    // Leftover cargo rides home and is credited by the ordinary NPC return.
    cargoState: leftover ? 'loaded' : 'delivered',
    deliveredAt: flight.arrivalAt,
    completionReason: target ? 'normal-return' : 'target-unavailable',
  };
  return { state: setFlight({ ...next, flights: returning }, arrived), ok: Boolean(target), reason: target ? null : 'target-unavailable', flight: arrived };
}

/** Apply an NPC probe arrival or colony landing at the canonical event time. */
export function resolveNpcMissionArrival(
  state: SaveState,
  flight: FlightRecord,
  at: number,
  timeScale: number,
  requestReport = false,
): NpcMissionResult {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(timeScale) || timeScale <= 0
    || flight.ownerSide !== 'npc' || !flight.ownerId || at < flight.arrivalAt
    || !['outbound', 'arrived'].includes(flight.phase)) return fail(state, 'invalid-arrival');
  const origin = validNpcOrigin(state, flight.ownerId, flight.originPlanetId);
  if (!origin) return fail(state, 'npc-origin-not-found');
  if (flight.missionId === 'colonize') {
    if (ownerPlanetCount(state, flight.ownerId) >= MAX_PLANETS_PER_OWNER
      || coordinateOccupied(state, flight.destinationCoordinate, at, flight.id)) {
      const returningState = beginFlightReturn(state.flights, flight.id, at, 'target-occupied');
      const returning = returningState.records.find((item) => item.id === flight.id)!;
      const updated: FlightRecord = { ...returning, arrivedAt: flight.arrivalAt, completionReason: 'target-occupied' };
      const next = setFlight({ ...state, flights: returningState }, updated);
      return { state: next, ok: false, reason: 'target-occupied', flight: updated };
    }
    const coordinate = flight.destinationCoordinate;
    const planetId = `planet-${coordinate.galaxy}-${coordinate.system}-${coordinate.position}`;
    if (getEspionageTargets(state.espionage)[planetId]) return fail(state, 'target-occupied');
    const profile = ownerProfile(state, origin);
    const colonyBase = createColonyPlanetRuntime({
      ...state,
      science: { ...state.science, levels: profile.scienceLevels },
    }, coordinate);
    const colonyProfile: SpyOwnerProfile = {
      scienceLevels: { ...profile.scienceLevels },
      shipLevels: { ...profile.shipLevels },
      commanderLevels: { ...profile.commanderLevels },
    };
    // The owner names its colony and picks its look, as a player does in the planet editor.
    const identity = npcColonyIdentity(state, flight.ownerId, coordinate);
    const colony: SpyTargetState = {
      id: planetId,
      name: identity?.name ?? colonyBase.name,
      ...(identity ? { skin: identity.skin } : {}),
      coordinate: { ...coordinate },
      ownerId: flight.ownerId,
      ownerName: origin.ownerName,
      raceId: origin.raceId,
      alliance: origin.alliance,
      kind: 'npc',
      espionageLevel: Math.max(0, Math.floor(profile.scienceLevels[5] ?? 0)),
      resources: {
        metal: colonyBase.resources?.metal ?? 500,
        minerals: colonyBase.resources?.minerals ?? 500,
        gas: colonyBase.resources?.gas ?? 500,
        debris: 0,
        developmentEnergy: colonyBase.availableEnergy ?? colonyBase.energy,
      },
      buildings: colonyBase.buildings,
      fleet: colonyBase.fleet,
      defense: colonyBase.defense,
      commanders: {},
      population: { total: 0, fleet: 0, defense: 0 },
      hunterLevel: 0,
      ownerProfile: colonyProfile,
      repair: colonyBase.repair,
      buildingQueue: [],
      productionBots: colonyBase.productionBots,
      solarSatellites: 0,
      resourceClock: { lastReconciledAt: at, remainder: { metal: 0, minerals: 0, gas: 0 } },
    };
    const completed: FlightRecord = {
      ...flight,
      phase: 'completed',
      arrivedAt: flight.arrivalAt,
      completedAt: at,
      completionReason: 'colonized',
    };
    const next = setFlight(setTarget(state, colony), completed);
    return { state: next, ok: true, reason: null, flight: completed };
  }
  if (flight.missionId !== 'espionage') return fail(state, 'mission-arrival-owned-by-another-resolver');
  const mission = state.espionage?.missions.find((item) => item.id === flight.spyMissionId && item.ownerId === flight.ownerId);
  const target = mission ? getNpcMissionTarget(state, mission.targetPlanetId) : undefined;
  if (!mission || !target || target.ownerId !== mission.targetOwnerId || !sameCoordinate(target.coordinate, flight.destinationCoordinate)) {
    const returningState = beginFlightReturn(state.flights, flight.id, at, 'target-unavailable');
    const returning = returningState.records.find((item) => item.id === flight.id)!;
    const updated: FlightRecord = { ...returning, arrivedAt: flight.arrivalAt, completionReason: 'target-unavailable' };
    const next = setFlight({ ...state, flights: returningState }, updated);
    return { state: next, ok: false, reason: 'target-unavailable', flight: updated };
  }
  const relation = getOwnerRelation(state, flight.ownerId, target.ownerId);
  if (relation !== 'enemy' && relation !== 'neutral') {
    const returningState = beginFlightReturn(state.flights, flight.id, at, 'target-unavailable');
    const returning = returningState.records.find((item) => item.id === flight.id)!;
    const updated: FlightRecord = { ...returning, arrivedAt: flight.arrivalAt, completionReason: 'target-unavailable' };
    const next = setFlight({ ...state, flights: returningState }, updated);
    return { state: next, ok: false, reason: 'target-relation-blocked', flight: updated };
  }
  const attempt = mission.reportIds.length + 1;
  if (flight.phase === 'arrived' && mission.status === 'orbiting') {
    if (!requestReport) return { state, ok: true, reason: null, flight };
    if (mission.nextReportAt !== undefined && at < mission.nextReportAt) return fail(state, 'spy-report-cooldown');
    // The player's rule: a repeated report from orbit costs the probe 30% of the time.
    const lossRoll = normalizeRngRoll(Math.floor(createSeededEspionageRng(espionageRollSeed(mission.id, 'repeat-loss', attempt))() * 100));
    if (repeatReportLosesProbe(lossRoll)) {
      const lost: SpyMission = { ...mission, status: 'destroyed', destroyedAt: at, nextReportAt: undefined };
      const completed: FlightRecord = { ...flight, phase: 'completed', arrivedAt: flight.arrivalAt, completedAt: at, completionReason: 'spy-destroyed' };
      const espionage = state.espionage ?? createDefaultEspionageState();
      const next = setFlight({ ...state, espionage: { ...espionage, missions: espionage.missions.map((item) => item.id === mission.id ? lost : item) } }, completed);
      return { state: next, ok: true, reason: null, flight: completed };
    }
  }
  const hunterRoll = normalizeRngRoll(Math.floor(createSeededEspionageRng(espionageRollSeed(mission.id, 'hunter', attempt))() * 100));
  const espionage = state.espionage ?? createDefaultEspionageState();
  if (hunterDetects(target.hunterLevel, hunterRoll)) {
    const destroyed: SpyMission = { ...mission, status: 'destroyed', destroyedAt: at, nextReportAt: undefined };
    const notice = {
      id: `spy-hunter-${mission.id}-${attempt}`,
      missionId: mission.id,
      ownerId: target.ownerId,
      createdAt: at,
      targetPlanetId: target.id,
      targetPlanetName: target.name,
      targetOwnerName: target.ownerName,
      targetCoordinate: { ...target.coordinate },
      hunterLevel: target.hunterLevel,
    };
    const completed: FlightRecord = { ...flight, phase: 'completed', arrivedAt: flight.arrivalAt, completedAt: at, completionReason: 'spy-destroyed' };
    const next = setFlight({ ...state, espionage: {
      ...espionage,
      missions: espionage.missions.map((item) => item.id === mission.id ? destroyed : item),
      hunterNotices: [...espionage.hunterNotices, notice],
    } }, completed);
    return { state: next, ok: true, reason: null, flight: completed };
  }
  const profile = ownerProfile(state, origin);
  const targetProfile = ownerProfile(state, target);
  const spyLevel = Math.max(0, Math.floor(profile.scienceLevels[5] ?? 0));
  const targetEspionageLevel = Math.max(0, Math.floor(targetProfile.scienceLevels[5] ?? target.espionageLevel));
  const roll = normalizeRngRoll(Math.floor(createSeededEspionageRng(espionageRollSeed(mission.id, 'report', attempt))() * 100));
  const delta = spyLevel - targetEspionageLevel;
  const quality = resolveSpyReportQuality(delta, roll);
  const reportId = `spy-report-${mission.id}-${attempt}`;
  const report: SpyReportSnapshot & { ownerId: string } = {
    id: reportId,
    missionId: mission.id,
    ownerId: flight.ownerId,
    createdAt: at,
    sourcePlanetId: mission.originPlanetId,
    targetPlanetId: target.id,
    targetPlanetName: target.name,
    targetOwnerId: target.ownerId,
    targetOwnerName: target.ownerName,
    targetRaceId: target.raceId,
    targetRelation: relation as SpyTargetRelation,
    targetCoordinate: { ...target.coordinate },
    spyLevel,
    targetEspionageLevel,
    delta,
    roll,
    quality,
    resources: { ...target.resources },
    firstReport: mission.reportIds.length === 0,
    ...(quality !== 'basic' ? { defense: { ...target.defense.defenses } } : {}),
    ...(quality === 'full' ? {
      fleet: { ...target.fleet.ships },
      fleetLevels: Object.fromEntries(Object.keys(target.fleet.ships).map((id) => [id, targetProfile.shipLevels[id as ShipId] ?? 0])),
      commanders: Object.fromEntries(Object.entries(target.commanders).map(([id, commander]) => [
        id,
        commander ? { ...commander, level: targetProfile.commanderLevels[id as keyof SpyOwnerProfile['commanderLevels']] ?? commander.level } : commander,
      ])),
      population: spyReportPopulation(target, state.flights.records),
    } : {}),
  };
  const updatedMission: SpyMission = {
    ...mission,
    targetRelation: relation as SpyTargetRelation,
    targetOwnerId: target.ownerId,
    targetOwnerName: target.ownerName,
    targetRaceId: target.raceId,
    targetAlliance: target.alliance,
    targetEspionageLevel,
    status: 'orbiting',
    arrivedAt: flight.arrivalAt,
    spyLevel,
    lastReportAt: at,
    nextReportAt: at + SPY_REPORT_COOLDOWN_MS,
    reportIds: [...mission.reportIds, reportId],
  };
  const qualityLevel = quality === 'basic' ? 1 / 3 : quality === 'detailed' ? 2 / 3 : 1;
  const profileState = state.npc?.profiles[flight.ownerId];
  const nextNpc = profileState ? {
    ...state.npc!,
    profiles: {
      ...state.npc!.profiles,
      [flight.ownerId]: {
        ...profileState,
        knowledge: {
          ...profileState.knowledge,
          [`target:${target.id}`]: { level: qualityLevel, confidence: qualityLevel, observedAt: at },
        },
      },
    },
  } : state.npc;
  const arrived: FlightRecord = { ...flight, phase: 'arrived', arrivedAt: flight.arrivalAt, completionReason: 'arrived' };
  const next = setFlight({
    ...state,
    ...(nextNpc ? { npc: nextNpc } : {}),
    espionage: {
      ...espionage,
      missions: espionage.missions.map((item) => item.id === mission.id ? updatedMission : item),
      reports: [...espionage.reports, report],
    },
  }, arrived);
  return { state: next, ok: true, reason: null, flight: arrived };
}

/** Credit surviving ships and owner-scoped cargo once at the saved return time. */
export function settleNpcMissionReturn(
  state: SaveState,
  flight: FlightRecord,
  at: number,
): Readonly<{ state: SaveState; flight: FlightRecord }> {
  if (flight.ownerSide !== 'npc' || !flight.ownerId || flight.npcReturnCreditedAt !== undefined
    || flight.phase !== 'returning' || flight.returnAt === undefined || at < flight.returnAt) return { state, flight };
  const source = validNpcOrigin(state, flight.ownerId, flight.originPlanetId);
  let next = state;
  if (source) {
    const ships = { ...source.fleet.ships };
    const battleReport = flight.attackResolution
      ? state.combat.reports.find((report) => report.id === flight.attackResolution?.reportId)
      : undefined;
    const survivors: Partial<Record<ShipId, number>> = battleReport
      ? Object.fromEntries(Object.entries(flight.selectedShips).map(([rawId, rawCount]) => {
        const id = rawId as ShipId;
        const survivorStack = battleReport.attackerForce.stacks.find((stack) => stack.entityId === id);
        return [id, survivorStack ? survivorStack.countAfter : 0];
      })) as Partial<Record<ShipId, number>>
      : flight.selectedShips;
    for (const [id, raw] of Object.entries(survivors) as [ShipId, number][]) {
      const count = safeCount(raw);
      if (count) ships[id] = (ships[id] ?? 0) + count;
    }
    // Commanders flown along come home too; after a battle only those that survived it.
    const commanders = { ...source.fleet.commanders };
    for (const [id, raw] of Object.entries(flight.selectedCommanders ?? {}) as [CommanderId, number][]) {
      const survived = battleReport ? battleReport.attackerForce.stacks.find((stack) => stack.entityId === id)?.countAfter ?? 0 : safeCount(raw);
      if (survived > 0) commanders[id] = (commanders[id] ?? 0) + survived;
    }
    const homeFleet = { ...source.fleet, ships, commanders };
    let resources = { metal: source.resources.metal, minerals: source.resources.minerals, gas: source.resources.gas };
    // A space flight brings its own loaded cargo home, recyclers their debris;
    // loot comes from attacks.
    // Gas from an asteroid rides home with its scrap (the scrap goes to the recycling store).
    const loot = flight.missionId === 'gas' && flight.cargoState === 'loaded' && flight.cargo
      ? { ...flight.cargo }
      : (flight.missionId === 'space-flight' || flight.missionId === 'transport') && flight.cargoState === 'loaded' && flight.cargo
      ? { ...flight.cargo, debris: 0 }
      : flight.missionId === 'recycle' && flight.cargo
        ? { metal: 0, minerals: 0, gas: 0, debris: flight.cargo.debris }
        : flight.attackResolution?.loot;
    if (loot) {
      const capacities = getStorageCapacities(source.buildings);
      const safeCapacities = {
        ...capacities,
        metal: Math.max(capacities.metal, resources.metal),
        minerals: Math.max(capacities.minerals, resources.minerals),
        gas: Math.max(capacities.gas, resources.gas),
      };
      const delivery = getCappedDelivery(resources, safeCapacities, loot);
      resources = delivery.resources;
      // Debris brought home goes to the recycling store, as the player's does;
      // the orbit field (resources.debris) is debris anyone may collect.
      const recycling = source.recycling ?? { availableDebris: 0, jobs: [] };
      const updated: SpyTargetState = {
        ...syncSpyTargetCommanderCounts(source, homeFleet, source.ownerProfile),
        resources: { ...source.resources, ...resources },
        ...(loot.debris > 0 ? { recycling: { ...recycling, availableDebris: addDebris(recycling.availableDebris, loot.debris) } } : {}),
      };
      next = setTarget(next, updated);
    } else {
      next = setTarget(next, syncSpyTargetCommanderCounts(source, homeFleet, source.ownerProfile));
    }
  }
  if (flight.missionId === 'expedition' && source) {
    // Existing exploration settlement owns escrow and storage accounting; it is
    // called only after owner validation, then this adapter adds the ship receipt.
    next = creditNpcExplorationReturn(next, flight, flight.returnAt);
  }
  // Cargo that rode home is back in the stores: the record no longer holds it.
  const carriedHome = (flight.missionId === 'space-flight' || flight.missionId === 'transport' || flight.missionId === 'gas')
    && flight.cargoState === 'loaded' && source !== undefined;
  const settled: FlightRecord = { ...flight, npcReturnCreditedAt: flight.returnAt,
    ...(carriedHome ? { cargoState: 'returned' as const, cargoResolvedAt: flight.returnAt } : {}) };
  return { state: setFlight(next, settled), flight: settled };
}

function selectedColonizerOnly(ships: Partial<Record<ShipId, number>>): boolean {
  return Object.keys(ships).length === 1 && ships.colonizer === 1;
}

function sameCoordinate(left: UniverseCoordinate, right: UniverseCoordinate): boolean {
  return left.galaxy === right.galaxy && left.system === right.system && left.position === right.position;
}
