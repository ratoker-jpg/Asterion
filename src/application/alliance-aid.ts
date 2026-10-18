import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { AID_TRANSPORT_SHIP_IDS } from '../domain/flights/aid-mission.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import {
  AID_MIN_REQUEST,
  MAX_AID_CHARGES,
  MAX_OPEN_REQUESTS,
  applyAidRegime,
  cancelResourceRequest,
  closeOrphanedRequests,
  closeRequestPlanetLost,
  createResourceRequest,
  grantAidChargesForTest,
  isAidPairValid,
  isRequestOpen,
  maxRequestAmount,
  projectAidLedger,
  selectActiveAidLedger,
  selectFulfillableRequests,
  selectOpenRequestsOf,
  selectRequestById,
  type AidChargeView,
} from '../domain/command/aid.ts';
import { TEST_ALLY_DISPLAY_NAME, TEST_ALLY_OWNER_ID } from '../domain/command/catalog.ts';
import { selectCommandHallLevel, selectOwnerMembership } from '../domain/command/selectors.ts';
import type { AidResource, CommandErrorCode, CommandState, ResourceRequest } from '../domain/command/types.ts';
import { aidInFlightUnits } from '../domain/flights/aid-mission.ts';
import { beginFlightReturn, recallFlight as recallDomainFlight } from '../domain/flights/runtime.ts';
import type { FlightRecord, FlightState } from '../domain/flights/types.ts';
import { withTestOwnerScoreFixtures } from '../domain/rating/fixtures.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { normalizeTestTimeScale, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import { TEST_MODE_ALLY_PLANET_FIXTURE } from '../domain/universe/runtime.ts';
import type { PlanetRuntime, SaveState } from './contracts.ts';
import { getAvailableFleetForPlanet } from './flights.ts';

/**
 * Application layer of the resource-aid stage: the glue between the pure
 * Command domain (requests, charges) and the SaveState (planets, scores,
 * flights). The physical shipping itself stays in `flights.ts`.
 */

export type AidContext = {
  now: number;
  mode: RuntimeMode;
  testTimeScale?: TestTimeScale;
};

export type AidActionResult =
  | { ok: true; state: SaveState; message: string; requestId?: string }
  | { ok: false; state: SaveState; code: CommandErrorCode; message: string };

export function aidTimeScale(context: Pick<AidContext, 'mode' | 'testTimeScale'>): number {
  return context.mode === 'test' ? normalizeTestTimeScale(context.testTimeScale) : 1;
}

function withCommand(state: SaveState, command: CommandState): SaveState {
  return command === state.command ? state : { ...state, command };
}

/** Resource points of one owner exactly as the rating computes them; the only input of the request size limit. */
export function selectOwnerResourcePoints(state: SaveState, ownerId: string, mode: RuntimeMode): number {
  // Test Mode adds the managed score of owners the pipeline cannot derive (Ira Vel); a real score always wins.
  return withTestOwnerScoreFixtures(selectOwnerScores(state), mode)[ownerId]?.resourcePoints ?? 0;
}

/**
 * Keeps the charge clock in step with the world: points the player's ledger at
 * the current Hall level and time scale, and closes requests whose author is
 * gone. Returns the same object when nothing changed, so the once-a-second
 * runtime tick never rewrites the save.
 */
export function syncAidState(state: SaveState, context: AidContext): SaveState {
  let command = state.command;
  command = applyAidRegime(
    command,
    state.profile.playerId,
    { hallLevel: selectCommandHallLevel(state.planets), timeScale: aidTimeScale(context) },
    context.now,
  );
  command = closeOrphanedRequests(command, context.now);
  return withCommand(state, command);
}

// ------------------------------------------------------------- membership

/** The request's planet still exists and still belongs to the request's author. */
export function isRequestPlanetAlive(state: SaveState, request: ResourceRequest): boolean {
  const planet = request.authorOwnerId === state.profile.playerId
    ? state.planets[request.planetId]
    : state.alliedPlanets?.[request.planetId];
  if (!planet) return false;
  if (request.authorOwnerId !== state.profile.playerId && (planet as { ownerId?: string }).ownerId !== request.authorOwnerId) return false;
  const at = coordinateOfPlanet(planet);
  return at.galaxy === request.coordinate.galaxy && at.system === request.coordinate.system && at.position === request.coordinate.position;
}

function isAidFlightStillValid(command: CommandState, flight: FlightRecord): boolean {
  const aid = flight.aid;
  if (!aid) return false;
  if (!isAidPairValid(command, aid)) return false;
  const request = selectRequestById(command, aid.requestId);
  return Boolean(request
    && isRequestOpen(request)
    && request.allianceId === aid.allianceId
    && request.authorOwnerId === aid.recipientOwnerId);
}

/**
 * Turns around every aid flight that has lost its footing: sender or
 * recipient left or was removed, the alliance is gone or the request closed.
 * The flight turns back at once with its cargo still aboard (the cargo state
 * stays `loaded`), and the normal return settlement hands the goods back to
 * the origin planet. Idempotent: a flight already returning is left alone.
 */
export function reconcileAidMembership(state: SaveState, now: number): SaveState {
  let settledCommand = closeOrphanedRequests(state.command, now);
  // A destroyed destination planet closes the request for good (no charge back); see the flight handling below.
  for (const request of settledCommand.requests) {
    if (request.status === 'open' && !isRequestPlanetAlive(state, request)) {
      settledCommand = closeRequestPlanetLost(settledCommand, request.id, now);
    }
  }
  let next = withCommand(state, settledCommand);
  let flights: FlightState = next.flights;
  let changed = false;
  for (const flight of next.flights.records) {
    if (flight.missionId !== 'aid' || flight.cargoState !== 'loaded') continue;
    if (flight.phase !== 'outbound' && flight.phase !== 'arrived') continue;
    const request = flight.aid ? selectRequestById(next.command, flight.aid.requestId) : null;
    const planetLost = Boolean(request && !isRequestPlanetAlive(next, request));
    if (!planetLost && isAidFlightStillValid(next.command, flight)) continue;
    const turned = flight.phase === 'outbound' && now < flight.arrivalAt
      ? recallDomainFlight(flights, flight.id, now)
      : beginFlightReturn(flights, flight.id, now, 'recalled');
    if (turned !== flights) {
      // Ships that were sent to a planet that no longer exists come back empty: the cargo is lost.
      flights = planetLost
        ? { ...turned, records: turned.records.map((record) => record.id === flight.id
          ? { ...record, cargoState: 'voided' as const, cargoResolvedAt: now }
          : record) }
        : turned;
      changed = true;
    }
  }
  return changed ? { ...next, flights } : next;
}

// --------------------------------------------------------------- requests

export type RequestPlanetOption = {
  id: string;
  name: string;
  coordinate: { galaxy: number; system: number; position: number };
};

function coordinateOfPlanet(planet: PlanetRuntime) {
  return {
    galaxy: planet.universeGalaxy ?? 1,
    system: planet.universeSystem ?? 1,
    position: planet.universePosition ?? 1,
  };
}

/** The player's own planets, the only legal destinations of the player's requests. */
export function selectRequestPlanetOptions(state: SaveState): RequestPlanetOption[] {
  return Object.entries(state.planets)
    .map(([id, planet]) => ({ id, name: planet.name, coordinate: coordinateOfPlanet(planet) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru') || (left.id < right.id ? -1 : 1));
}

/**
 * How much of the request would be lost to a full warehouse if it arrived now.
 * Debris has no storage limit, so it never overflows.
 */
export function previewRequestOverflow(
  state: SaveState,
  planetId: string,
  resource: AidResource,
  amount: number,
): { lost: number; free: number } {
  if (resource === 'debris') return { lost: 0, free: Number.POSITIVE_INFINITY };
  const planet = state.planets[planetId] ?? state.alliedPlanets?.[planetId];
  if (!planet) return { lost: 0, free: 0 };
  const caps = getStorageCapacities(planet.buildings);
  const current = (planetId === state.currentPlanetId && state.planets[planetId]
    ? { metal: state.metal, minerals: state.minerals, gas: state.gas }
    : planet.resources ?? { metal: 0, minerals: 0, gas: 0 })[resource];
  const free = Math.max(0, caps[resource] - current);
  return { lost: Math.max(0, amount - free), free };
}

export function createAidRequest(
  state: SaveState,
  input: { planetId: string; resource: AidResource; amount: number },
  context: AidContext,
): AidActionResult {
  const synced = syncAidState(state, context);
  const planet = synced.planets[input.planetId];
  if (!planet) {
    return { ok: false, state: synced, code: 'invalid_planet', message: 'Выберите одну из своих планет.' };
  }
  const ownerId = synced.profile.playerId;
  const result = createResourceRequest(synced.command, {
    ownerId,
    authorName: synced.profile.displayName,
    planet: { id: input.planetId, name: planet.name, coordinate: coordinateOfPlanet(planet) },
    resource: input.resource,
    amount: input.amount,
    resourcePoints: selectOwnerResourcePoints(synced, ownerId, context.mode),
    hallLevel: selectCommandHallLevel(synced.planets),
  }, context.now);
  if (!result.ok) return { ok: false, state: withCommand(synced, result.state), code: result.code, message: result.message };
  return {
    ok: true,
    state: withCommand(synced, result.state),
    requestId: result.requestId,
    message: 'Запрос создан. Союзники увидят его в «Запросах ресурсов».',
  };
}

export function cancelAidRequest(state: SaveState, requestId: string, context: AidContext): AidActionResult {
  const synced = syncAidState(state, context);
  const result = cancelResourceRequest(synced.command, synced.profile.playerId, requestId, context.now);
  if (!result.ok) return { ok: false, state: withCommand(synced, result.state), code: result.code, message: result.message };
  return { ok: true, state: withCommand(synced, result.state), message: 'Запрос отменён, заряд возвращён.' };
}

/** Units of the request that are in the air right now, derived from the live flight records. */
export function selectRequestInFlight(state: Pick<SaveState, 'flights'>, requestId: string): number {
  return aidInFlightUnits(state.flights.records, requestId);
}

export type RequestProgress = {
  requested: number;
  delivered: number;
  inFlight: number;
  /** Still free for new flights: requested − delivered − inFlight. */
  remainder: number;
};

export function selectRequestProgress(state: Pick<SaveState, 'flights'>, request: ResourceRequest): RequestProgress {
  const inFlight = request.status === 'open' ? selectRequestInFlight(state, request.id) : 0;
  return {
    requested: request.requested,
    delivered: request.delivered,
    inFlight,
    remainder: Math.max(0, request.requested - request.delivered - inFlight),
  };
}

// --------------------------------------------------------------- overview

export type AidRequestRow = {
  request: ResourceRequest;
  progress: RequestProgress;
  /** Own request that no aid flight has ever left for. */
  canCancel: boolean;
};

export type AidOverview = {
  hallOpen: boolean;
  inAlliance: boolean;
  charges: AidChargeView | null;
  maxCharges: number;
  openCount: number;
  maxOpen: number;
  minAmount: number;
  maxAmount: number;
  resourcePoints: number;
  planets: RequestPlanetOption[];
  mine: AidRequestRow[];
  closed: ResourceRequest[];
  incoming: AidRequestRow[];
  /**
   * The currently selected planet has at least one free transporter or mega-transporter.
   * The fleet window launches from the selected planet, so ships elsewhere do not count.
   */
  hasFreeTransporters: boolean;
  /** Free cargo hulls on the selected planet, by ship id. */
  freeTransporters: Readonly<Record<string, number>>;
  /** Name of the selected planet the aid flight would start from. */
  sourcePlanetName: string;
};

function freeTransportersOnCurrentPlanet(state: SaveState): Record<string, number> {
  const ships = state.planets[state.currentPlanetId] ? getAvailableFleetForPlanet(state, state.currentPlanetId).ships : {};
  return Object.fromEntries((AID_TRANSPORT_SHIP_IDS as readonly string[]).map((shipId) => [shipId, Math.max(0, ships[shipId as keyof typeof ships] ?? 0)]));
}

/** Everything the Requests screen shows, derived from the authoritative state at one instant. */
export function selectAidOverview(state: SaveState, context: AidContext): AidOverview {
  const ownerId = state.profile.playerId;
  const membership = selectOwnerMembership(state.command, ownerId);
  const ledger = selectActiveAidLedger(state.command, ownerId);
  const resourcePoints = selectOwnerResourcePoints(state, ownerId, context.mode);
  const row = (request: ResourceRequest): AidRequestRow => ({
    request,
    progress: selectRequestProgress(state, request),
    canCancel: request.authorOwnerId === ownerId && request.status === 'open' && !request.helpStarted,
  });
  const own = state.command.requests.filter((request) => request.authorOwnerId === ownerId);
  const transporters = freeTransportersOnCurrentPlanet(state);
  return {
    hallOpen: selectCommandHallLevel(state.planets) > 0,
    inAlliance: Boolean(membership),
    charges: ledger ? projectAidLedger(ledger, context.now) : null,
    maxCharges: MAX_AID_CHARGES,
    openCount: selectOpenRequestsOf(state.command, ownerId).length,
    maxOpen: MAX_OPEN_REQUESTS,
    minAmount: AID_MIN_REQUEST,
    maxAmount: maxRequestAmount(resourcePoints),
    resourcePoints,
    planets: selectRequestPlanetOptions(state),
    mine: own.filter((request) => request.status === 'open').map(row),
    closed: own.filter((request) => request.status !== 'open').sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0)).slice(0, 5),
    incoming: selectFulfillableRequests(state.command, ownerId).map(row),
    freeTransporters: transporters,
    hasFreeTransporters: Object.values(transporters).some((count) => count > 0),
    sourcePlanetName: state.planets[state.currentPlanetId]?.name ?? '',
  };
}

// ----------------------------------------------------- Test Mode: Ira Vel

export type IraAidFixtureResult = { ok: true; state: SaveState; message: string } | { ok: false; state: SaveState; message: string };

const IRA_PLANET_ID = TEST_MODE_ALLY_PLANET_FIXTURE.planet.id;
/** Enough for both QA directions: a few hundred thousand units of every resource and real cargo hulls. */
const QA_RESOURCE_FLOOR = 300_000;
const QA_MEGA_TRANSPORTERS = 12;

export function selectIraPlanet(state: SaveState) {
  return state.alliedPlanets?.[IRA_PLANET_ID] ?? null;
}

/**
 * Test Mode only, explicit QA action. Puts real mega-transporters and
 * resources on Ira Vel's planet so she can serve the player's request through
 * the ordinary flight runtime. It never runs by itself and is refused in
 * production; ships and goods then obey every normal rule (capacity, fuel,
 * reservation, storage).
 */
export function prepareIraAidFixture(state: SaveState, context: AidContext): IraAidFixtureResult {
  const ira = selectIraPlanet(state);
  if (context.mode !== 'test' || !ira) {
    return { ok: false, state, message: 'Сценарий Иры Вель доступен только в Test Mode.' };
  }
  const caps = getStorageCapacities(ira.buildings);
  const resources = ira.resources ?? { metal: 0, minerals: 0, gas: 0 };
  const catalog = getFactionShipCatalog(ira.raceId as CombatFactionId);
  const hasHull = catalog.some((entity) => entity.id === 'mega-transporter');
  if (!hasHull) return { ok: false, state, message: 'У расы Иры Вель нет мега-транспортёра.' };
  const next = {
    ...ira,
    resources: {
      metal: Math.min(caps.metal, Math.max(resources.metal, QA_RESOURCE_FLOOR)),
      minerals: Math.min(caps.minerals, Math.max(resources.minerals, QA_RESOURCE_FLOOR)),
      gas: Math.min(caps.gas, Math.max(resources.gas, QA_RESOURCE_FLOOR)),
    },
    recycling: { ...ira.recycling, availableDebris: Math.max(ira.recycling.availableDebris, QA_RESOURCE_FLOOR) },
    fleet: {
      ...ira.fleet,
      ships: {
        ...ira.fleet.ships,
        'mega-transporter': Math.max(ira.fleet.ships['mega-transporter'] ?? 0, QA_MEGA_TRANSPORTERS),
      },
    },
    aidQaFixtureAt: ira.aidQaFixtureAt ?? context.now,
  };
  return {
    ok: true,
    state: { ...state, alliedPlanets: { ...(state.alliedPlanets ?? {}), [IRA_PLANET_ID]: next } },
    message: `Тест: на планете ${ira.name} подготовлены мега-транспортёры (${QA_MEGA_TRANSPORTERS}) и запас ресурсов.`,
  };
}

/**
 * Test Mode only: Ira Vel files a request on her planet through the very same
 * domain rules as the player. She gets a charge by an explicit QA grant (her
 * Hall is not simulated), then the normal limits, charge spending and
 * ownership checks apply.
 */
export function createIraAidRequest(
  state: SaveState,
  input: { resource: AidResource; amount: number },
  context: AidContext,
): AidActionResult {
  const ira = selectIraPlanet(state);
  if (context.mode !== 'test' || !ira) {
    return { ok: false, state, code: 'not_allowed', message: 'Сценарий Иры Вель доступен только в Test Mode.' };
  }
  const granted = grantAidChargesForTest(state.command, TEST_ALLY_OWNER_ID, 1, context.now);
  const result = createResourceRequest(granted, {
    ownerId: TEST_ALLY_OWNER_ID,
    authorName: TEST_ALLY_DISPLAY_NAME,
    planet: { id: IRA_PLANET_ID, name: ira.name, coordinate: coordinateOfPlanet(ira) },
    resource: input.resource,
    amount: input.amount,
    resourcePoints: selectOwnerResourcePoints(state, TEST_ALLY_OWNER_ID, context.mode),
    // Explicit QA assumption: Ira's Hall is level 1; it is not simulated for NPCs.
    hallLevel: 1,
  }, context.now);
  if (!result.ok) return { ok: false, state, code: result.code, message: result.message };
  return {
    ok: true,
    state: withCommand(state, result.state),
    requestId: result.requestId,
    message: 'Тест: Ира Вель создала запрос на своей планете.',
  };
}
