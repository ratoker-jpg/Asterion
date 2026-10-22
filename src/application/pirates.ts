import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { calculateFleetPopulation } from '../domain/fleet/runtime.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { createUniverseSystem } from '../domain/universe/runtime.ts';
import type {
  UniverseCoordinate,
  UniversePersistedPlayerPlanet,
  UniverseRegisteredPlanet,
  UniverseSystem,
} from '../domain/universe/types.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { createFlightState, dispatchFlight as dispatchDomainFlight, getFlightByRequestId } from '../domain/flights/runtime.ts';
import { isFlightCoordinate } from '../domain/flights/distance.ts';
import type { AttackResolution } from '../domain/attack/types.ts';
import { calculatePirateEliminationPopulationBudget } from '../domain/pirates/profile.ts';
import { PIRATE_CATALOG } from '../domain/pirates/catalog.ts';
import { getHangarCapacity } from '../domain/buildings/balance-v1.ts';
import { pirateDebrisRewardMultiplier, pirateHangarFraction, reducePirateThreatAfterVictory } from '../domain/pirates/threat.ts';
import { PIRATE_ELIMINATION_DEFEAT_MULTIPLIER, PIRATE_ELIMINATION_DRAW_MULTIPLIER } from '../domain/pirates/debris.ts';
import {defaultPirateOwnerAdaptation,pirateAdaptiveFleetWeight,recordPirateAdaptiveOutcome} from '../domain/pirates/adaptive.ts';
import type { PiratePopulationBudget } from '../domain/pirates/profile.ts';
import { PIRATE_ELIMINATION_NO_TARGET_MESSAGE } from '../domain/pirates/encounter.ts';
import {
  getOrCreatePirateOwnerProfile,
  getPirateOwnerProfile,
  recordPirateContactDefeat,
} from '../domain/pirates/contact.ts';
import {
  PIRATE_RECON_COOLDOWN_MS,
  canDispatchPirateRecon,
  createPirateReconMissionSnapshot,
  pirateReconCooldownKey,
} from '../domain/pirates/recon.ts';
import {
  createPirateReconReport,
  pirateReconReportToReportItem,
  upsertPirateReconReport,
  type PirateReconReport,
} from '../domain/pirates/recon-report.ts';
import {
  createDefaultPirateState,
  isPirateMissionSnapshot,
  type PirateMissionSnapshot,
  type PirateState,
} from '../domain/pirates/mission.ts';
import type { PirateProfile } from '../domain/pirates/profile.ts';
import { scaleRuntimeDuration, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import {
  getAvailableFleetForPlanet,
  getReservedCommandersForPlanet,
  getReservedShipsForPlanet,
  type DispatchFlightCommand,
  type FlightCommandResult,
  type FlightRuntimeOptions,
} from './flights.ts';
import {
  createAttackLaunchSnapshot,
  getAttackCommanderSelection,
  normalizeAttackRounds,
  resolvePirateEliminationAtTarget,
} from './attack.ts';
import {
  getOwnerShipUpgradeLevel,
  getPlanetResources,
  replacePlanetResources,
  type SaveState,
} from './contracts.ts';

export type CurrentPirateContact = Readonly<{
  id: string;
  name: string;
  coordinate: Readonly<UniverseCoordinate>;
  contactCycleKey: string;
  cycleIndex: number;
  startAt: number;
  expiresAt: number;
}>;

export type PirateFlightResolutionResult = Readonly<{
  state: SaveState;
  status: 'combat' | 'recon-report' | 'no-target';
  notice: string;
  report?: BattleReport | PirateReconReport;
}>;

const ACTIVE_PIRATE_RECON_PHASES = new Set(['outbound', 'arrived', 'returning']);
const PIRATE_CYCLE_KEY_PATTERN = /^pirate-cycle-v1:\d+:\d+:\d+:\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statePirate(state: SaveState): PirateState {
  return state.pirate ?? createDefaultPirateState();
}

function withPirateState(state: SaveState, pirate: PirateState): SaveState {
  return { ...state, pirate };
}

function coordinateOfPlanet(planet: SaveState['planets'][string]): UniverseCoordinate {
  return {
    galaxy: Number.isSafeInteger(planet.universeGalaxy) && (planet.universeGalaxy ?? 0) >= 1 ? planet.universeGalaxy! : 1,
    system: Number.isSafeInteger(planet.universeSystem) && (planet.universeSystem ?? 0) >= 1 ? planet.universeSystem! : 1,
    position: Number.isSafeInteger(planet.universePosition) && (planet.universePosition ?? 0) >= 1 ? planet.universePosition! : 1,
  };
}

function persistedPlayerPlanets(state: SaveState): UniversePersistedPlayerPlanet[] {
  return Object.entries(state.planets).map(([id, planet]) => ({
    id,
    coordinate: coordinateOfPlanet(planet),
    name: planet.name,
    isHomeworld: id === 'helion-01',
    ownerId: state.profile.playerId,
  }));
}

function registeredUniverseTargets(state: SaveState): UniverseRegisteredPlanet[] {
  return Object.values(getEspionageTargets(state.espionage)).map((target) => ({
    id: target.id,
    coordinate: { ...target.coordinate },
    name: target.name,
    kind: target.kind ?? 'npc',
    ownerId: target.ownerId,
  }));
}

function systemForState(state: SaveState, galaxy: number, system: number, now: number, mode?: RuntimeMode): UniverseSystem {
  const pirate = statePirate(state);
  return createUniverseSystem({
    mode: mode ?? (Object.keys(state.alliedPlanets ?? {}).length > 0 ? 'test' : 'production'),
    galaxy,
    system,
    nowMs: now,
    galaxyCount: 1,
    playerPlanets: persistedPlayerPlanets(state),
    registeredPlanets: registeredUniverseTargets(state),
    pirateContactDefeats: Object.values(pirate.contact.defeatedCycles),
    // The save's asteroid positions (as on the Universe map) instead of
    // re-simulating every asteroid route on each 1 s render.
    ...(state.asteroidSimulation ? { asteroidStates: state.asteroidSimulation.asteroids } : {}),
  });
}

/**
 * Returns the active pirate contact for a system. `coordinate.position` is a
 * caller placeholder; the returned coordinate is the procedural contact slot.
 */
export function getCurrentPirateContact(
  state: SaveState,
  coordinate: UniverseCoordinate,
  now: number,
  mode?: RuntimeMode,
): CurrentPirateContact | null {
  if (!isFlightCoordinate(coordinate) || !Number.isSafeInteger(now) || now < 0) return null;
  const system = systemForState(state, coordinate.galaxy, coordinate.system, now, mode);
  const node = system.positions.find((candidate) => candidate.kind === 'pirate');
  const pirate = node?.pirate;
  if (!node || !pirate) return null;
  return Object.freeze({
    id: node.id,
    name: node.name,
    coordinate: Object.freeze({ ...node.coordinate }),
    contactCycleKey: pirate.contactCycleKey,
    cycleIndex: pirate.cycleIndex,
    startAt: pirate.startAt,
    expiresAt: pirate.expiresAt,
  });
}

/** Persist the player's immutable profile on first authoritative contact observation. */
export function ensurePirateOwnerProfile(
  state: SaveState,
  contactCycleKey: string,
): { state: SaveState; profile: PirateProfile } {
  const current = statePirate(state);
  const ownerId = state.profile.playerId;
  const existing = getPirateOwnerProfile(current.contact, ownerId, contactCycleKey);
  if (existing) return { state, profile: existing };
  if (!ownerId.trim() || !PIRATE_CYCLE_KEY_PATTERN.test(contactCycleKey)) {
    throw new TypeError('Pirate owner profile requires a valid player and contact cycle.');
  }
  const score = selectOwnerScores(state)[ownerId];
  const materialized = getOrCreatePirateOwnerProfile(current.contact, {
    ownerId,
    contactCycleKey,
    score: {
      resourcePoints: score?.resourcePoints ?? 0,
      battlePoints: score?.battlePoints ?? 0,
      totalPoints: (score?.resourcePoints ?? 0) + (score?.battlePoints ?? 0),
    },
  });
  return {
    state: withPirateState(state, Object.freeze({ ...current, contact: materialized.state })),
    profile: materialized.profile,
  };
}

function flightFailure(
  state: SaveState,
  code: 'invalid-coordinate' | 'target-not-available' | 'wrong-ship-composition' | 'insufficient-ships'
    | 'ship-already-reserved' | 'insufficient-commanders' | 'insufficient-gas' | 'mission-not-supported'
    | 'spy-report-cooldown' | 'invalid-round-limit' | 'target-overpopulated' | 'invalid-command',
  message: string,
): FlightCommandResult {
  return { ok: false, state, error: { code, message } };
}

function requestIdFor(command: DispatchFlightCommand): string {
  return (command.requestId ?? command.commandId ?? '').trim();
}

function normalizedSelection<TId extends string>(value: unknown, ids: readonly TId[]): Partial<Record<TId, number>> | null {
  if (!isRecord(value)) return null;
  const selected: Partial<Record<TId, number>> = {};
  for (const [rawId, rawCount] of Object.entries(value)) {
    if (!ids.includes(rawId as TId)
      || typeof rawCount !== 'number'
      || !Number.isSafeInteger(rawCount)
      || rawCount < 0) return null;
    if (rawCount > 0) selected[rawId as TId] = rawCount;
  }
  return selected;
}

function dispatchNotice(flight: { missionId: string; arrivalAt: number; gasCost: number }): string {
  return `Пиратский рейс ${flight.missionId === 'pirate-recon' ? 'разведки' : 'атаки'} отправлен: прибытие ${new Date(flight.arrivalAt).toLocaleString('ru-RU')} · газ ${flight.gasCost}.`;
}

function activePirateReconInFlight(state: SaveState, ownerId: string, contactCycleKey: string): boolean {
  return state.flights.records.some((flight) => flight.missionId === 'pirate-recon'
    && ACTIVE_PIRATE_RECON_PHASES.has(flight.phase)
    && flight.pirateSnapshot?.ownerId === ownerId
    && flight.pirateSnapshot.contactCycleKey === contactCycleKey);
}

/** Dispatches pirate operations through the shared flight route/fuel/reservation runtime. */
export function dispatchPirateFlight(
  state: SaveState,
  command: DispatchFlightCommand,
  options: FlightRuntimeOptions | number = {},
): FlightCommandResult {
  const runtimeOptions: FlightRuntimeOptions = typeof options === 'number' ? { now: options } : options;
  const requestId = requestIdFor(command);
  const flights = state.flights ?? createFlightState();
  if (requestId) {
    const existing = getFlightByRequestId(flights, requestId);
    if (existing) return { ok: true, state, flight: existing, created: false, notice: dispatchNotice(existing) };
  }
  if (!requestId || requestId.length > 160) return flightFailure(state, 'invalid-command', 'Для отправки требуется корректный requestId/commandId.');
  if (command.missionId !== 'pirate-recon' && command.missionId !== 'pirate-elimination') {
    return flightFailure(state, 'mission-not-supported', 'Эта миссия не относится к пиратским операциям.');
  }
  if (!command.destination || command.destination.kind !== 'coordinate' || !isFlightCoordinate(command.destination.coordinate)) {
    return flightFailure(state, 'invalid-coordinate', 'Координаты пиратского объекта некорректны.');
  }
  const coordinate = command.destination.coordinate;
  const departedAt = Number.isSafeInteger(command.departedAt)
    ? command.departedAt!
    : (Number.isSafeInteger(runtimeOptions.now) ? runtimeOptions.now! : Date.now());
  if (departedAt < 0) return flightFailure(state, 'invalid-command', 'Время отправки рейса некорректно.');

  const pirateContact = getCurrentPirateContact(state, coordinate, departedAt, runtimeOptions.mode);
  if (!pirateContact
    || pirateContact.contactCycleKey !== command.contactCycleKey
    || pirateContact.coordinate.galaxy !== coordinate.galaxy
    || pirateContact.coordinate.system !== coordinate.system
    || pirateContact.coordinate.position !== coordinate.position
    || command.targetKind !== 'pirate'
    || command.targetRelation !== 'neutral') {
    return flightFailure(state, 'target-not-available', 'Пиратский контакт по этому циклу и координатам больше недоступен.');
  }

  if (command.missionId === 'pirate-elimination' && !Object.values(state.planets).some((planet) =>
    (planet.universeGalaxy ?? 1) === coordinate.galaxy && (planet.universeSystem ?? 1) === coordinate.system)) {
    return flightFailure(state, 'target-not-available', 'Пиратский рейд доступен только в солнечных системах ваших колоний.');
  }

  const originPlanetId = command.originPlanetId ?? state.currentPlanetId;
  const origin = state.planets[originPlanetId];
  if (!origin) return flightFailure(state, 'invalid-command', 'Исходная колония не найдена.');
  const selectedShips = normalizedSelection(command.selectedShips, SHIP_IDS);
  const requestedCommanders = normalizedSelection(command.selectedCommanders ?? {}, COMMANDER_IDS);
  if (!selectedShips || !requestedCommanders) {
    return flightFailure(state, 'wrong-ship-composition', 'Состав кораблей или командиров некорректен.');
  }

  let selectedCommanders: Partial<Record<CommanderId, number>> = requestedCommanders;
  let attackSnapshot: ReturnType<typeof createAttackLaunchSnapshot> | undefined;
  const factionId = state.profile.factionId as CombatFactionId;
  const availableFleet = getAvailableFleetForPlanet(state, originPlanetId);
  const reservedShips = getReservedShipsForPlanet(state, originPlanetId);
  const reservedCommanders = getReservedCommandersForPlanet(state, originPlanetId);
  for (const [shipId, quantity] of Object.entries(selectedShips) as [ShipId, number][]) {
    if ((availableFleet.ships[shipId] ?? 0) < quantity) {
      return flightFailure(state,
        (reservedShips[shipId] ?? 0) > 0 ? 'ship-already-reserved' : 'insufficient-ships',
        (reservedShips[shipId] ?? 0) > 0 ? 'Выбранный корабль уже зарезервирован другим рейсом.' : 'На исходной колонии недостаточно выбранных кораблей.');
    }
  }
  for (const commanderId of COMMANDER_IDS) {
    if ((selectedCommanders[commanderId] ?? 0) > (availableFleet.commanders[commanderId] ?? 0)) {
      return flightFailure(state,
        (reservedCommanders[commanderId] ?? 0) > 0 ? 'ship-already-reserved' : 'insufficient-commanders',
        (reservedCommanders[commanderId] ?? 0) > 0 ? 'Выбранный командир уже зарезервирован другим рейсом.' : 'На исходной колонии недостаточно выбранных командиров.');
    }
  }

  if (command.missionId === 'pirate-recon') {
    if (Object.keys(selectedShips).length !== 1 || selectedShips['spy-probe'] !== 1
      || Object.keys(selectedCommanders).length > 0) {
      return flightFailure(state, 'wrong-ship-composition', 'Для разведки пиратского объекта нужен ровно один шпионский зонд.');
    }
  } else {
    if (Object.keys(selectedShips).some((shipId) =>
      getFactionShipCatalog(factionId).find((entity) => entity.id === shipId)?.category !== 'Боевой корабль')) {
      return flightFailure(state, 'wrong-ship-composition', 'Для уничтожения пиратов можно отправить только боевые корабли и командиров.');
    }
    const availableAttackCommanders = getAttackCommanderSelection(state, originPlanetId);
    selectedCommanders = command.selectedCommanders === undefined
      ? availableAttackCommanders
      : requestedCommanders;
    for (const commanderId of COMMANDER_IDS) {
      if ((selectedCommanders[commanderId] ?? 0) > (availableAttackCommanders[commanderId] ?? 0)) {
        return flightFailure(state,
          (reservedCommanders[commanderId] ?? 0) > 0 ? 'ship-already-reserved' : 'insufficient-commanders',
          (reservedCommanders[commanderId] ?? 0) > 0 ? 'Выбранный командир уже зарезервирован другим рейсом.' : 'На исходной колонии недостаточно выбранных командиров.');
      }
    }
    if (Object.keys(selectedShips).length === 0) {
      return flightFailure(state, 'wrong-ship-composition', 'Для атаки выберите хотя бы один боевой корабль.');
    }
    if (command.maxRounds !== undefined && ![5, 8, 12].includes(command.maxRounds)) {
      return flightFailure(state, 'invalid-round-limit', 'Число раундов атаки: только 5, 8 или 12.');
    }
    attackSnapshot = createAttackLaunchSnapshot(state, originPlanetId, normalizeAttackRounds(command.maxRounds), selectedCommanders);
  }

  const contactState = statePirate(state);
  const ownerId = state.profile.playerId;
  const cycleKey = pirateContact.contactCycleKey;
  const reconKey = pirateReconCooldownKey(ownerId, cycleKey);
  if (command.missionId === 'pirate-recon') {
    const availability = canDispatchPirateRecon({
      ownerId,
      contactCycleKey: cycleKey,
      now: departedAt,
      lastDispatchAt: contactState.reconLastDispatchAt[reconKey] !== undefined
        && contactState.reconLastDispatchAt[reconKey]! <= departedAt
        ? contactState.reconLastDispatchAt[reconKey]
        : undefined,
      inFlight: activePirateReconInFlight(state, ownerId, cycleKey),
    });
    if (!availability.allowed) {
      return flightFailure(state, 'spy-report-cooldown', availability.reason === 'in-flight'
        ? 'Шпионский зонд уже выполняет разведку этого пиратского контакта.'
        : `Разведка этого контакта будет доступна после ${new Date(availability.availableAt ?? departedAt + PIRATE_RECON_COOLDOWN_MS).toLocaleTimeString('ru-RU')}.`);
    }
  }

  const ensured = ensurePirateOwnerProfile(state, cycleKey);
  const profile = ensured.profile;
  const selectedFleet = createEmptyFleetState();
  Object.assign(selectedFleet.ships, selectedShips);
  Object.assign(selectedFleet.commanders, selectedCommanders);
  const populationReserved = calculateFleetPopulation(selectedFleet, factionId);
  const historicalHangarLevel = Math.max(
    statePirate(ensured.state).ownerMaxHangarLevel?.[ownerId] ?? 0,
    ...Object.values(ensured.state.planets).map((planet) => Math.max(0, Math.floor(planet.buildings.hangar ?? 0))),
  );
  const historicalHangarCapacity = getHangarCapacity(historicalHangarLevel);
  const ownerAdaptation=statePirate(ensured.state).ownerAdaptations?.[ownerId]??defaultPirateOwnerAdaptation();
  const adaptiveWeight=pirateAdaptiveFleetWeight(factionId,selectedShips,Math.round(populationReserved),historicalHangarCapacity);
  let eliminationBudget: PiratePopulationBudget | undefined;
  if (command.missionId === 'pirate-elimination') {
    eliminationBudget = calculatePirateEliminationPopulationBudget(Math.round(populationReserved), profile.shares,
      `pirate-elimination-v2:${ownerId}:${cycleKey}:${requestId}`,
      { ownerId, cycleKey, totalPoints: profile.score.totalPoints },ownerAdaptation.q);
    if (eliminationBudget.actualPopulation <= 0) {
      return flightFailure(ensured.state, 'wrong-ship-composition', 'Выбранный флот слишком мал, чтобы сформировать гарнизон пиратов.');
    }
  }

  const reconMission = command.missionId === 'pirate-recon'
    ? createPirateReconMissionSnapshot({
      missionId: `flight-${requestId}`,
      ownerId,
      contactCycleKey: cycleKey,
      dispatchedAt: departedAt,
    })
    : undefined;
  const snapshot: PirateMissionSnapshot = Object.freeze({
    version: 1,
    missionId: command.missionId,
    ownerId,
    contactCycleKey: cycleKey,
    coordinate: Object.freeze({ ...coordinate }),
    cycleIndex: pirateContact.cycleIndex,
    startAt: pirateContact.startAt,
    expiresAt: pirateContact.expiresAt,
    profile,
    ...(eliminationBudget ? {
      eliminationBudget,
      sentCombatPopulation: Math.round(populationReserved),
      historicalHangarCapacity,
      rewardMultiplier: pirateDebrisRewardMultiplier(Math.round(populationReserved), historicalHangarCapacity),
      defeatMultiplier:PIRATE_ELIMINATION_DEFEAT_MULTIPLIER,drawMultiplier:PIRATE_ELIMINATION_DRAW_MULTIPLIER,
      adaptiveWeight,adaptiveQ:ownerAdaptation.q,
    } : {}),
    ...(reconMission ? { reconMission } : {}),
  });
  const domainResult = dispatchDomainFlight(flights, {
    requestId,
    missionId: command.missionId,
    originPlanetId,
    originCoordinate: coordinateOfPlanet(origin),
    destination: { kind: 'coordinate', coordinate: { ...coordinate } },
    targetKind: 'pirate',
    targetRelation: 'neutral',
    targetPlanetName: pirateContact.name,
    selectedShips,
    selectedCommanders,
    ...(attackSnapshot ? { attackSnapshot } : {}),
    pirateSnapshot: snapshot,
    populationReserved,
    speedCommanderLevels: { typhoon: getOwnerShipUpgradeLevel(state, 'typhoon') },
    departedAt,
    factionId,
    science: state.science.levels,
  });
  const timeOptions: FlightRuntimeOptions = runtimeOptions;
  const duration = scaleRuntimeDuration(domainResult.flight.oneWayDurationMs, timeOptions.mode ?? 'production', timeOptions.testTimeScale);
  const flight = {
    ...domainResult.flight,
    oneWayDurationMs: duration,
    arrivalAt: domainResult.flight.departedAt + duration,
  };
  const sourceResources = getPlanetResources(ensured.state, originPlanetId);
  if (sourceResources.gas < flight.gasCost) {
    return flightFailure(ensured.state, 'insufficient-gas', 'Недостаточно газа для исходящего участка.');
  }
  const nextFlightState = {
    records: domainResult.state.records.map((record) => record.id === flight.id ? flight : record),
    requestIndex: domainResult.state.requestIndex,
  };
  let next: SaveState = { ...ensured.state, flights: nextFlightState };
  const maxPirate = statePirate(next);
  if (historicalHangarLevel > (maxPirate.ownerMaxHangarLevel?.[ownerId] ?? 0)) {
    next = withPirateState(next, Object.freeze({
      ...maxPirate, ownerMaxHangarLevel: Object.freeze({
        ...maxPirate.ownerMaxHangarLevel, [ownerId]: historicalHangarLevel,
      }),
    }));
  }
  next = replacePlanetResources(next, originPlanetId, {
    ...sourceResources,
    gas: Math.max(0, sourceResources.gas - flight.gasCost),
  });
  if(eliminationBudget){
    const pirate=statePirate(next);
    const last=Object.freeze({flightId:flight.id,coefficient:eliminationBudget.coefficient??0.9,
      sentPopulation:Math.round(populationReserved),at:departedAt});
    next=withPirateState(next,Object.freeze({...pirate,ownerAdaptations:Object.freeze({
      ...pirate.ownerAdaptations,[ownerId]:Object.freeze({...ownerAdaptation,lastRoll:last}),
    })}));
  }
  if (reconMission) {
    const pirate = statePirate(next);
    next = withPirateState(next, Object.freeze({
      ...pirate,
      reconLastDispatchAt: Object.freeze({ ...pirate.reconLastDispatchAt, [reconKey]: departedAt }),
    }));
  }
  return { ok: true, state: next, flight, created: domainResult.created, notice: dispatchNotice(flight) };
}

function withFlightResolution(state: SaveState, flightId: string, resolution: AttackResolution): SaveState {
  const flights = state.flights ?? createFlightState();
  const flight = flights.records.find((record) => record.id === flightId);
  if (!flight) return state;
  return {
    ...state,
    flights: {
      ...flights,
      records: flights.records.map((record) => record.id === flightId ? { ...record, attackResolution: resolution } : record),
    },
  };
}

function hasFullPirateVictory(report: BattleReport): boolean {
  const remainingPirateShips = report.defenderForce.stacks.filter((stack) =>
    PIRATE_CATALOG.some((ship) => ship.id === stack.entityId));
  return report.winner === 'attacker'
    && remainingPirateShips.length > 0
    && report.defenderForce.populationAfter === 0
    && remainingPirateShips.every((stack) => stack.countAfter === 0);
}

/** Applies one pirate arrival using the frozen dispatch snapshot and common attack accounting. */
export function resolvePirateFlightAtTarget(
  state: SaveState,
  flight: SaveState['flights']['records'][number],
  arrivalAt: number,
): PirateFlightResolutionResult {
  const noTarget = (nextState: SaveState = state): PirateFlightResolutionResult => Object.freeze({
    state: nextState,
    status: 'no-target',
    notice: PIRATE_ELIMINATION_NO_TARGET_MESSAGE,
  });
  if ((flight.missionId !== 'pirate-recon' && flight.missionId !== 'pirate-elimination')
    || !isPirateMissionSnapshot(flight.pirateSnapshot, flight.missionId)
    || !Number.isSafeInteger(arrivalAt)
    || arrivalAt < flight.arrivalAt) return noTarget();

  const snapshot = flight.pirateSnapshot;
  const contact = getCurrentPirateContact(state, snapshot.coordinate, arrivalAt);
  const currentCycleKey = contact?.contactCycleKey;
  const hasTarget = contact !== null
    && currentCycleKey === snapshot.contactCycleKey
    && contact.coordinate.galaxy === snapshot.coordinate.galaxy
    && contact.coordinate.system === snapshot.coordinate.system
    && contact.coordinate.position === snapshot.coordinate.position;

  if (flight.missionId === 'pirate-recon') {
    const mission = snapshot.reconMission;
    if (!mission) return noTarget();
    const report = createPirateReconReport({
      mission,
      coordinate: snapshot.coordinate,
      arrivedAt: arrivalAt,
      profile: snapshot.profile,
      ...(currentCycleKey ? { currentContactCycleKey: currentCycleKey } : {}),
    });
    const pirate = statePirate(state);
    const reports = upsertPirateReconReport(pirate.reconReports, report);
    const next = withPirateState(state, Object.freeze({ ...pirate, reconReports: Object.freeze(reports) }));
    const item = pirateReconReportToReportItem(report);
    return Object.freeze({
      state: next,
      status: report.outcome === 'no-target' ? 'no-target' : 'recon-report',
      notice: report.outcome === 'no-target' ? PIRATE_ELIMINATION_NO_TARGET_MESSAGE : item.body,
      report,
    });
  }

  if (!hasTarget) return noTarget();
  const resolved = resolvePirateEliminationAtTarget(state, flight, arrivalAt);
  if (!resolved) return noTarget();
  let next = withFlightResolution(resolved.state, flight.id, resolved.resolution);
  if(snapshot.adaptiveWeight!==undefined){
    const pirate=statePirate(next);
    const adaptive=pirate.ownerAdaptations?.[snapshot.ownerId]??defaultPirateOwnerAdaptation();
    const outcome=hasFullPirateVictory(resolved.report)?'win':
      resolved.report.winner==='draw'?'draw':'loss';
    const updated=recordPirateAdaptiveOutcome(adaptive,flight.id,snapshot.adaptiveWeight,outcome);
    if(updated!==adaptive)next=withPirateState(next,Object.freeze({...pirate,
      ownerAdaptations:Object.freeze({...pirate.ownerAdaptations,[snapshot.ownerId]:updated})}));
  }
  if (hasFullPirateVictory(resolved.report)) {
    const pirate = statePirate(next);
    const contactState = recordPirateContactDefeat(pirate.contact, {
      contactCycleKey: snapshot.contactCycleKey,
      galaxy: snapshot.coordinate.galaxy,
      system: snapshot.coordinate.system,
      cycleIndex: snapshot.cycleIndex,
      startAt: snapshot.startAt,
      coordinate: snapshot.coordinate,
      defeatedAt: arrivalAt,
    });
    const fraction = pirateHangarFraction(
      snapshot.sentCombatPopulation ?? 0, snapshot.historicalHangarCapacity ?? 0);
    const currentThreat = pirate.ownerThreats?.[snapshot.ownerId] ?? {
      version: 1 as const, ageHours: 0, integratedAt: snapshot.startAt,
    };
    const reducedThreat = reducePirateThreatAfterVictory(currentThreat, arrivalAt, fraction);
    next = withPirateState(next, Object.freeze({
      ...pirate,
      contact: contactState,
      ownerThreats: Object.freeze({
        ...pirate.ownerThreats, [snapshot.ownerId]: reducedThreat,
      }),
    }));
  }
  const resultLabel = resolved.report.winner === 'attacker' ? 'пираты разгромлены'
    : resolved.report.winner === 'defender' ? 'атака отбита' : 'ничья';
  return Object.freeze({
    state: next,
    status: 'combat',
    notice: `Бой с пиратами завершён: ${resultLabel}. Создан боевой отчёт; выживший флот возвращается.`,
    report: resolved.report,
  });
}
