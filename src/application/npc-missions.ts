import { calculateFleetPopulation, resolveSavedFleetState } from '../domain/fleet/runtime.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { selectOwnerAlliance } from '../domain/command/selectors.ts';
import { createExplorationState, getOrMaterializeExplorationContact, launchExplorationScore, recordHighestExplorationScore } from '../domain/exploration/ledger.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { isAttackCombatShip, normalizeAttackRounds, createBot01IncomingAttackSnapshot } from './attack.ts';
import { createColonyPlanetRuntime } from './owned-planets.ts';
import { getOwnerRelation } from './owner-relations.ts';
import { getExplorationTarget } from './exploration.ts';
import { creditNpcExplorationReturn } from './exploration-bot01.ts';
import { getEspionageTargets, activeSpyMissionForTarget, createSeededEspionageRng, espionageRollSeed, hunterDetects, normalizeRngRoll, resolveSpyReportQuality, SPY_REPORT_COOLDOWN_MS } from '../domain/espionage/runtime.ts';
import { addDebris, getCappedDelivery } from '../domain/flights/cargo.ts';
import { getFlightSlotUsage, isFlightLimitExempt } from '../domain/flights/limit.ts';
import { beginFlightReturn, dispatchFlight, getFlightByRequestId } from '../domain/flights/runtime.ts';
import { isFlightCoordinate } from '../domain/flights/distance.ts';
import { createUniverseSystem, MAX_PLANETS_PER_OWNER } from '../domain/universe/runtime.ts';
import { createDefaultEspionageState } from '../domain/espionage/runtime.ts';
import { getOwnerShipUpgradeLevels, getPlanetResources } from './contracts.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { SaveState } from './contracts.ts';
import type { FlightDestination, FlightRecord, FlightScienceLevels, FlightState, MissionId, TargetRelation } from '../domain/flights/types.ts';
import type { SpyMission, SpyOwnerProfile, SpyReportSnapshot, SpyTargetRelation, SpyTargetState } from '../domain/espionage/types.ts';
import type { UniverseCoordinate, UniverseObjectKind } from '../domain/universe/types.ts';
import type { ScienceLevels } from '../domain/buildings/resource-zone.ts';
import type { SimulatorMaxRounds } from '../domain/combat/simulator.ts';

export type NpcMissionId = 'espionage' | 'colonize' | 'attack' | 'expedition' | 'exploration-recon';

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
  return state.flights.records.filter((flight) => flight.ownerSide === 'npc' && flight.ownerId === ownerId);
}

function flightSlotsAvailable(state: SaveState, ownerId: string, profile: SpyOwnerProfile, missionId: MissionId): boolean {
  if (isFlightLimitExempt(missionId)) return true;
  const ownerFlights = activeFlightsForOwner(state, ownerId).map((flight) => ({ ...flight, ownerSide: 'player' as const }));
  return getFlightSlotUsage(ownerFlights, profile.scienceLevels[6]).free > 0;
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
      if (Object.keys(selectedShips).some((shipId) => !isAttackCombatShip(shipId as ShipId, origin.raceId))) return fail(state, 'invalid-attack-composition');
      if (command.maxRounds !== undefined && ![5, 8, 12].includes(command.maxRounds)) return fail(state, 'invalid-round-limit');
    }
  }
  if (command.missionId === 'colonize') {
    if (destination.kind !== 'coordinate' || !isFlightCoordinate(destination.coordinate)
      || !selectedColonizerOnly(selectedShips) || (command.targetKind !== undefined && command.targetKind !== 'empty' && command.targetKind !== 'asteroid')) {
      return fail(state, 'invalid-colonization-command');
    }
    if (ownerPlanetCount(state, command.ownerId) >= MAX_PLANETS_PER_OWNER) return fail(state, 'planet-limit-reached');
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
  const snapshot = command.missionId === 'attack'
    ? {
      ...createBot01IncomingAttackSnapshot(origin, profile),
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
    targetKind: command.targetKind ?? explorationNode?.kind ?? target?.kind,
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
    ...(command.missionId === 'colonize' ? { populationReserved: 12 } : {}),
    speedCommanderLevels: { typhoon: profile.commanderLevels.typhoon ?? 0 },
  });
  const duration = Math.max(1, Math.round(domainResult.flight.oneWayDurationMs / timeScale));
  const scores = selectOwnerScores(state);
  const explorationLaunchResourcePoints = command.missionId === 'expedition' || command.missionId === 'exploration-recon'
    ? launchExplorationScore(state.exploration ?? createExplorationState(), command.ownerId, scores[command.ownerId]?.resourcePoints ?? 0)
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
  const debitedOrigin: SpyTargetState = {
    ...origin,
    fleet: { ...origin.fleet, ships },
    resources: { ...origin.resources, gas: gasAvailable - flight.gasCost },
  };
  let next = setTarget({ ...state, flights: domainResult.state }, debitedOrigin);
  next = setFlight(next, flight);
  if (explorationNode && operationId) {
    const exploration = state.exploration ?? createExplorationState();
    const scored = recordHighestExplorationScore(exploration, command.ownerId, scores[command.ownerId]?.resourcePoints ?? 0);
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
    const colony: SpyTargetState = {
      id: planetId,
      name: colonyBase.name,
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
  const fleetPopulation = calculateFleetPopulation(target.fleet, target.raceId);
  const defensePopulation = calculateDefensePopulation(target.defense, target.raceId);
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
      population: { total: fleetPopulation + defensePopulation, fleet: fleetPopulation, defense: defensePopulation },
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
    let resources = { metal: source.resources.metal, minerals: source.resources.minerals, gas: source.resources.gas };
    const loot = flight.attackResolution?.loot;
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
      const updated: SpyTargetState = {
        ...source,
        fleet: { ...source.fleet, ships },
        resources: { ...source.resources, ...resources, debris: addDebris(source.resources.debris, loot.debris) },
      };
      next = setTarget(next, updated);
    } else {
      next = setTarget(next, { ...source, fleet: { ...source.fleet, ships } });
    }
  }
  if (flight.missionId === 'expedition' && source) {
    // Existing exploration settlement owns escrow and storage accounting; it is
    // called only after owner validation, then this adapter adds the ship receipt.
    next = creditNpcExplorationReturn(next, flight, flight.returnAt);
  }
  const settled: FlightRecord = { ...flight, npcReturnCreditedAt: flight.returnAt };
  return { state: setFlight(next, settled), flight: settled };
}

function selectedColonizerOnly(ships: Partial<Record<ShipId, number>>): boolean {
  return Object.keys(ships).length === 1 && ships.colonizer === 1;
}

function sameCoordinate(left: UniverseCoordinate, right: UniverseCoordinate): boolean {
  return left.galaxy === right.galaxy && left.system === right.system && left.position === right.position;
}
