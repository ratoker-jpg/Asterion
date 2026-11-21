import { calculateRouteDistance } from '../domain/flights/distance.ts';
import type { FlightRuntimeOptions, FlightCommandResult, DispatchFlightCommand, FlightError } from './flights.ts';
import { dispatchFlight, getAvailableFleetForPlanet, getPlayerFlightSlotUsage, isRecyclerShip, previewFlight } from './flights.ts';
import { forecastAsteroidAt } from './asteroid-gas-collection.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { RuntimeMode, TestTimeScale } from '../domain/runtime/mode.ts';
import { advanceUniverseAsteroidSimulationAt } from '../domain/universe/asteroid-simulation.ts';
import { UNIVERSE_SYSTEM_COUNT } from '../domain/universe/grid.ts';
import { MAX_GALAXY_COUNT } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';

export const DEFAULT_ASTEROID_GAS_BATCH_RECYCLERS = 10;

export type AsteroidGasBatchScan = {
  galaxy: number;
  fromSystem: number;
  toSystem: number;
};

export type AsteroidGasBatchRuntime = {
  now: number;
  mode: RuntimeMode;
  testTimeScale?: TestTimeScale;
};

export type AsteroidGasBatchOptions = {
  /** Applied to every scanned asteroid. Omitted options default to 10 recyclers per asteroid. */
  quantityPerTarget?: number;
  /** Explicit selected-row quantities, keyed by `targetId`. Missing rows are left unselected. */
  quantitiesById?: Readonly<Record<string, number>>;
};

export type AsteroidGasBatchScanError = 'invalid-galaxy' | 'invalid-system-range' | 'invalid-runtime-time' | 'simulation-ahead-of-runtime';

export type AsteroidGasBatchScanTarget = {
  targetId: string;
  spawnIndex: number;
  name: string;
  coordinate: UniverseCoordinate;
  /** Presence only; the asteroid scrap amount remains hidden, as it does elsewhere in the UI. */
  hasDebris: boolean;
};

export type AsteroidGasBatchBlockReason =
  | 'invalid-quantity'
  | 'no-source'
  | 'target-moves-before-arrival'
  | 'active-flight'
  | 'flight-refused'
  | 'request-already-used'
  | 'conflicting-quantity-options';

export type AsteroidGasBatchRowStatus = 'ready' | 'unselected' | 'active' | 'blocked';

export type AsteroidGasBatchPreview =
  | { ok: true; flight: { arrivalAt: number; routeDistance: number; capacity: number } }
  | { ok: false; error: FlightError };

export type AsteroidGasBatchTarget = AsteroidGasBatchScanTarget & {
  requestedQuantity: number | null;
  acceptedQuantity: number | null;
  originPlanetId: string | null;
  routeDistance: number | null;
  status: AsteroidGasBatchRowStatus;
  blockReason?: AsteroidGasBatchBlockReason;
  activeFlightId?: string;
  preview: AsteroidGasBatchPreview | null;
  error?: FlightError;
  command?: DispatchFlightCommand;
};

export type AsteroidGasBatchSource = {
  planetId: string;
  name: string;
  coordinate: UniverseCoordinate;
  /** Free recyclers at plan time, after existing flight reservations. */
  availableRecyclers: number;
  /** Recyclers assigned by accepted rows in this plan. */
  assignedRecyclers: number;
  /** Honest free count after this plan's accepted assignments. */
  remainingRecyclers: number;
};

export type AsteroidGasBatchPlan = {
  scan: AsteroidGasBatchScan;
  scanError: AsteroidGasBatchScanError | null;
  /** Selected IDs absent from the live scan, for safe live re-planning notices. */
  missingTargetIds: string[];
  targets: AsteroidGasBatchTarget[];
  sources: AsteroidGasBatchSource[];
  /** Accepted row commands in the same order as their ready target rows. */
  commands: DispatchFlightCommand[];
};

const ACTIVE_FLIGHT_PHASES = new Set(['outbound', 'arrived', 'returning']);

function configuredGalaxyCount(state: SaveState): number {
  const value = state.worldConfig?.world.galaxyCount;
  return Number.isSafeInteger(value) ? Math.min(MAX_GALAXY_COUNT, Math.max(1, Math.floor(value!))) : 1;
}

function scanError(state: SaveState, scan: AsteroidGasBatchScan, runtime: AsteroidGasBatchRuntime): AsteroidGasBatchScanError | null {
  if (!Number.isFinite(runtime.now)) return 'invalid-runtime-time';
  if (!Number.isSafeInteger(scan.galaxy) || scan.galaxy < 1 || scan.galaxy > configuredGalaxyCount(state)) return 'invalid-galaxy';
  if (!Number.isSafeInteger(scan.fromSystem) || !Number.isSafeInteger(scan.toSystem)
    || scan.fromSystem < 1 || scan.toSystem > UNIVERSE_SYSTEM_COUNT || scan.fromSystem > scan.toSystem) return 'invalid-system-range';
  const processedThroughAt = state.asteroidSimulation?.processedThroughAt;
  if (Number.isFinite(processedThroughAt) && runtime.now < processedThroughAt!) return 'simulation-ahead-of-runtime';
  return null;
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function coordinateOfPlanet(state: SaveState, planetId: string): UniverseCoordinate {
  const planet = state.planets[planetId];
  const valid = (value: number | undefined, fallback: number) => Number.isSafeInteger(value) && (value ?? 0) >= 1 ? value! : fallback;
  return {
    galaxy: valid(planet?.universeGalaxy, 1),
    system: valid(planet?.universeSystem, 1),
    position: valid(planet?.universePosition, 1),
  };
}

function coordinatesEqual(left: UniverseCoordinate, right: UniverseCoordinate): boolean {
  return left.galaxy === right.galaxy && left.system === right.system && left.position === right.position;
}

function countRecyclers(state: SaveState, planetId: string): number {
  const fleet = getAvailableFleetForPlanet(state, planetId);
  return Object.entries(fleet.ships).reduce((total, [shipId, quantity]) => (
    isRecyclerShip(shipId as ShipId, state.profile.factionId) ? total + safeCount(quantity) : total
  ), 0);
}

function sourceSnapshots(state: SaveState): AsteroidGasBatchSource[] {
  return Object.keys(state.planets)
    .sort((left, right) => Number(right === state.currentPlanetId) - Number(left === state.currentPlanetId) || left.localeCompare(right))
    .map((planetId) => {
      const availableRecyclers = countRecyclers(state, planetId);
      return {
        planetId,
        name: state.planets[planetId]!.name,
        coordinate: coordinateOfPlanet(state, planetId),
        availableRecyclers,
        assignedRecyclers: 0,
        remainingRecyclers: availableRecyclers,
      };
    });
}

function targetId(spawnIndex: number): string {
  return `asteroid:${spawnIndex}`;
}

function asteroidName(spawnIndex: number): string {
  return `Астероид ${String(spawnIndex + 1).padStart(4, '0')}`;
}

function targetDebrisPresence(state: SaveState, spawnIndex: number): boolean {
  const value = state.asteroidDebrisBySpawnIndex?.[String(spawnIndex)];
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function asteroidTargets(state: SaveState, scan: AsteroidGasBatchScan, runtime: AsteroidGasBatchRuntime): AsteroidGasBatchScanTarget[] {
  const simulation = state.asteroidSimulation;
  if (!simulation) return [];
  const advanced = advanceUniverseAsteroidSimulationAt(simulation, runtime.now, configuredGalaxyCount(state)).state;
  return advanced.asteroids
    .filter((asteroid) => asteroid.coordinate.galaxy === scan.galaxy
      && asteroid.coordinate.system >= scan.fromSystem && asteroid.coordinate.system <= scan.toSystem)
    .map((asteroid) => ({
      targetId: targetId(asteroid.spawnIndex),
      spawnIndex: asteroid.spawnIndex,
      name: asteroidName(asteroid.spawnIndex),
      coordinate: { ...asteroid.coordinate },
      hasDebris: targetDebrisPresence(state, asteroid.spawnIndex),
    }));
}

function routeDistance(origin: UniverseCoordinate, target: UniverseCoordinate): number | null {
  try { return calculateRouteDistance(origin, target); }
  catch { return null; }
}

function nearestRouteDistance(
  sources: readonly AsteroidGasBatchSource[],
  target: UniverseCoordinate,
  quantity: number | null,
): number | null {
  const viable = quantity !== null && quantity > 0
    ? sources.filter((source) => source.availableRecyclers >= quantity)
    : sources;
  const distances = viable
    .map((source) => routeDistance(source.coordinate, target))
    .filter((distance): distance is number => distance !== null);
  return distances.length > 0 ? Math.min(...distances) : null;
}

function sortTargets(
  targets: readonly AsteroidGasBatchScanTarget[],
  sources: readonly AsteroidGasBatchSource[],
  quantityFor: (target: AsteroidGasBatchScanTarget) => number | null,
): AsteroidGasBatchScanTarget[] {
  return [...targets].sort((left, right) => {
    if (left.hasDebris !== right.hasDebris) return Number(right.hasDebris) - Number(left.hasDebris);
    const leftDistance = nearestRouteDistance(sources, left.coordinate, quantityFor(left));
    const rightDistance = nearestRouteDistance(sources, right.coordinate, quantityFor(right));
    if (leftDistance !== rightDistance) {
      if (leftDistance === null) return 1;
      if (rightDistance === null) return -1;
      return leftDistance - rightDistance;
    }
    return left.spawnIndex - right.spawnIndex;
  });
}

/** Inclusive scan of active asteroids; gas yield and scrap quantity stay hidden. */
export function scanAsteroidGasTargets(
  state: SaveState,
  scan: AsteroidGasBatchScan,
  runtime: AsteroidGasBatchRuntime,
): AsteroidGasBatchScanTarget[] {
  if (scanError(state, scan, runtime)) return [];
  const sources = sourceSnapshots(state);
  return sortTargets(
    asteroidTargets(state, scan, runtime),
    sources,
    () => DEFAULT_ASTEROID_GAS_BATCH_RECYCLERS,
  );
}

function requestedQuantity(target: AsteroidGasBatchScanTarget, options: AsteroidGasBatchOptions): number | null {
  if (options.quantitiesById) {
    return Object.prototype.hasOwnProperty.call(options.quantitiesById, target.targetId)
      ? options.quantitiesById[target.targetId] ?? null
      : null;
  }
  return options.quantityPerTarget ?? DEFAULT_ASTEROID_GAS_BATCH_RECYCLERS;
}

function quantityError(quantity: number | null): boolean {
  return quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0);
}

function activePlayerGasFlightForTarget(state: SaveState, target: AsteroidGasBatchScanTarget) {
  const active = (state.flights?.records ?? []).filter((flight) => (
    (flight.ownerSide === undefined || flight.ownerSide === 'player')
    && flight.missionId === 'gas'
    && ACTIVE_FLIGHT_PHASES.has(flight.phase)
  ));
  // New batch commands preserve the stable target id in their request id.
  // Older gas records store no spawn index, so their coordinate is the only
  // available duplicate key and remains a conservative fallback.
  return active.find((flight) => flight.requestId.startsWith('asteroid-gas-batch-')
      && flight.requestId.endsWith(`-${target.spawnIndex}`))
    ?? active.find((flight) => coordinatesEqual(flight.destinationCoordinate, target.coordinate));
}

function recyclerSelection(state: SaveState, planetId: string, quantity: number): Partial<Record<ShipId, number>> | null {
  const free = getAvailableFleetForPlanet(state, planetId).ships;
  const factionId = state.profile.factionId;
  const candidates = (Object.keys(free) as ShipId[])
    .filter((shipId) => isRecyclerShip(shipId, factionId))
    .sort((left, right) => left.localeCompare(right));
  const selected: Partial<Record<ShipId, number>> = {};
  let remaining = quantity;
  for (const shipId of candidates) {
    const count = Math.min(remaining, safeCount(free[shipId]));
    if (count > 0) selected[shipId] = count;
    remaining -= count;
    if (remaining <= 0) return selected;
  }
  return null;
}

function candidatesByRoute(
  state: SaveState,
  sources: readonly AsteroidGasBatchSource[],
  target: UniverseCoordinate,
): Array<{ source: AsteroidGasBatchSource; distance: number }> {
  return sources.flatMap((source) => {
    const distance = routeDistance(source.coordinate, target);
    return distance === null ? [] : [{ source, distance }];
  }).sort((left, right) => left.distance - right.distance
    || Number(right.source.planetId === state.currentPlanetId) - Number(left.source.planetId === state.currentPlanetId)
    || left.source.planetId.localeCompare(right.source.planetId));
}

function currentNearestViableRoute(
  state: SaveState,
  sources: readonly AsteroidGasBatchSource[],
  target: UniverseCoordinate,
  quantity: number | null,
): number | null {
  const candidates = candidatesByRoute(state, sources, target);
  const viable = quantity !== null && quantity > 0
    ? candidates.find((candidate) => countRecyclers(state, candidate.source.planetId) >= quantity)
    : candidates[0];
  return viable?.distance ?? null;
}

function flightLimitError(state: SaveState): FlightError {
  const slots = getPlayerFlightSlotUsage(state);
  return {
    code: 'flight-limit-reached',
    message: `Достигнут лимит одновременных полётов: ${slots.used} из ${slots.limit}. Дождитесь возвращения флота или изучите «Компьютерные системы».`,
  };
}

function commandFor(
  target: AsteroidGasBatchScanTarget,
  originPlanetId: string,
  selectedShips: Partial<Record<ShipId, number>>,
  runtime: AsteroidGasBatchRuntime,
): DispatchFlightCommand {
  return {
    requestId: `asteroid-gas-batch-${runtime.now}-${target.spawnIndex}`,
    missionId: 'gas',
    originPlanetId,
    destination: { kind: 'coordinate', coordinate: { ...target.coordinate } },
    targetKind: 'asteroid',
    selectedShips,
    departedAt: runtime.now,
  };
}

function flightOptions(runtime: AsteroidGasBatchRuntime): FlightRuntimeOptions {
  return {
    now: runtime.now,
    mode: runtime.mode,
    ...(runtime.testTimeScale ? { testTimeScale: runtime.testTimeScale } : {}),
  };
}

function safePreview(result: FlightCommandResult): AsteroidGasBatchPreview {
  return result.ok
    ? {
      ok: true,
      flight: {
        arrivalAt: result.flight.arrivalAt,
        routeDistance: result.flight.routeDistance,
        capacity: result.flight.gasCapacity ?? 0,
      },
    }
    : { ok: false, error: result.error };
}

/**
 * Plans accepted rows in priority order. Each accepted command is applied only
 * to a temporary projection after preview so later rows see canonical ship,
 * fuel, and flight-slot reservations. The caller still sends `commands` once
 * through its normal live flight lifecycle.
 */
export function planAsteroidGasBatch(
  state: SaveState,
  scan: AsteroidGasBatchScan,
  options: AsteroidGasBatchOptions,
  runtime: AsteroidGasBatchRuntime,
): AsteroidGasBatchPlan {
  const error = scanError(state, scan, runtime);
  const sources = sourceSnapshots(state);
  const rawTargets = error ? [] : asteroidTargets(state, scan, runtime);
  const conflictingOptions = options.quantityPerTarget !== undefined && options.quantitiesById !== undefined;
  const quantityFor = (target: AsteroidGasBatchScanTarget) => requestedQuantity(target, options);
  const sortedTargets = sortTargets(rawTargets, sources, quantityFor);
  const liveSelectedIds = new Set(sortedTargets.map((target) => target.targetId));
  const missingTargetIds = options.quantitiesById
    ? Object.entries(options.quantitiesById)
      .filter(([, quantity]) => typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0)
      .map(([id]) => id)
      .filter((id) => !liveSelectedIds.has(id))
      .sort()
    : [];
  const plannedAssignments = new Map(sources.map((source) => [source.planetId, 0]));
  // Several candidate sources can have the same ETA. Forecast each target/ETA
  // only once while keeping the canonical asteroid simulation as the source
  // of truth.
  const arrivalForecasts = new Map<string, number | null>();
  const commands: DispatchFlightCommand[] = [];
  const rows: AsteroidGasBatchTarget[] = [];
  let projectedState = state;

  for (const target of sortedTargets) {
    const quantity = quantityFor(target);
    const base = {
      ...target,
      requestedQuantity: quantity,
      acceptedQuantity: null,
      originPlanetId: null,
      routeDistance: currentNearestViableRoute(projectedState, sources, target.coordinate, quantity),
      status: 'unselected' as const,
      preview: null,
    };
    if (conflictingOptions) {
      rows.push({ ...base, status: 'blocked', blockReason: 'conflicting-quantity-options' });
      continue;
    }
    // New batch flights retain a stable spawn id in their request id. Older
    // gas records retain only a destination coordinate, used as fallback.
    const activeFlight = activePlayerGasFlightForTarget(projectedState, target);
    if (activeFlight) {
      rows.push({ ...base, status: 'active', blockReason: 'active-flight', activeFlightId: activeFlight.id });
      continue;
    }
    if (quantity === null || quantity === 0) {
      rows.push({ ...base, acceptedQuantity: 0 });
      continue;
    }
    if (quantityError(quantity)) {
      rows.push({ ...base, status: 'blocked', blockReason: 'invalid-quantity' });
      continue;
    }

    const slots = getPlayerFlightSlotUsage(projectedState);
    if (slots.free <= 0) {
      rows.push({ ...base, status: 'blocked', blockReason: 'flight-refused', error: flightLimitError(projectedState) });
      continue;
    }

    const orderedSources = candidatesByRoute(projectedState, sources, target.coordinate);
    let attemptedSource = false;
    let firstFailure: FlightCommandResult | null = null;
    let missedTargetAtArrival = false;
    let accepted: { command: DispatchFlightCommand; preview: FlightCommandResult; source: AsteroidGasBatchSource; distance: number } | null = null;
    for (const candidate of orderedSources) {
      const available = countRecyclers(projectedState, candidate.source.planetId);
      if (available < quantity) continue;
      const ships = recyclerSelection(projectedState, candidate.source.planetId, quantity);
      if (!ships) continue;
      attemptedSource = true;
      const command = commandFor(target, candidate.source.planetId, ships, runtime);
      const reusedRequest = projectedState.flights.records.find((flight) => flight.requestId === command.requestId);
      if (reusedRequest) {
        firstFailure ??= {
          ok: false,
          state: projectedState,
          error: { code: 'invalid-command', message: 'Этот запрос на отправку уже использован.' },
        };
        continue;
      }
      const preview = previewFlight(projectedState, command, flightOptions(runtime));
      if (!preview.ok) {
        firstFailure ??= preview;
        if (preview.error.code === 'flight-limit-reached') break;
        continue;
      }
      const forecastKey = `${target.spawnIndex}:${preview.flight.arrivalAt}`;
      if (!arrivalForecasts.has(forecastKey)) {
        arrivalForecasts.set(forecastKey, forecastAsteroidAt(
          state.asteroidSimulation,
          target.coordinate,
          preview.flight.arrivalAt,
          configuredGalaxyCount(state),
        )?.spawnIndex ?? null);
      }
      if (arrivalForecasts.get(forecastKey) !== target.spawnIndex) {
        // Another viable source may have a different ETA that still intersects
        // this selected asteroid at the scanned coordinate.
        missedTargetAtArrival = true;
        continue;
      }
      const applied = dispatchFlight(projectedState, command, flightOptions(runtime));
      if (!applied.ok) {
        firstFailure ??= applied;
        continue;
      }
      if (!applied.created) {
        firstFailure ??= {
          ok: false,
          state: projectedState,
          error: { code: 'invalid-command', message: 'Этот запрос на отправку уже использован.' },
        };
        continue;
      }
      projectedState = applied.state;
      accepted = { command, preview, source: candidate.source, distance: candidate.distance };
      break;
    }

    if (accepted) {
      commands.push(accepted.command);
      plannedAssignments.set(accepted.source.planetId,
        (plannedAssignments.get(accepted.source.planetId) ?? 0) + quantity);
      rows.push({
        ...base,
        acceptedQuantity: quantity,
        originPlanetId: accepted.source.planetId,
        routeDistance: accepted.distance,
        status: 'ready',
        preview: safePreview(accepted.preview),
        command: accepted.command,
      });
    } else if (!attemptedSource) {
      rows.push({
        ...base,
        status: 'blocked',
        blockReason: 'no-source',
        error: { code: 'insufficient-ships', message: 'Недостаточно свободных переработчиков на ваших планетах.' },
      });
    } else if (missedTargetAtArrival && !firstFailure) {
      rows.push({
        ...base,
        status: 'blocked',
        blockReason: 'target-moves-before-arrival',
        error: {
          code: 'target-not-available',
          message: `${target.name} покинет выбранные координаты до прибытия переработчиков. Повторно просканируйте диапазон.`,
        },
      });
    } else {
      const failure = firstFailure;
      rows.push({
        ...base,
        status: 'blocked',
        blockReason: failure?.ok === false && failure.error.code === 'invalid-command'
          ? 'request-already-used'
          : 'flight-refused',
        preview: failure ? safePreview(failure) : null,
        ...(failure && !failure.ok ? { error: failure.error } : {}),
      });
    }
  }

  const finalizedSources = sources.map((source) => {
    const assignedRecyclers = plannedAssignments.get(source.planetId) ?? 0;
    return {
      ...source,
      assignedRecyclers,
      remainingRecyclers: Math.max(0, source.availableRecyclers - assignedRecyclers),
    };
  });
  return {
    scan: { ...scan },
    scanError: error,
    missingTargetIds,
    targets: rows,
    sources: finalizedSources,
    commands,
  };
}
