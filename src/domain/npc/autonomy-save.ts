import { COMMANDER_COMBAT_CATALOG, type CatalogEntity } from '../combat/catalog.ts';
import { COMMANDER_IDS, isCommanderId } from '../combat/commanders.ts';
import { COMBAT_TECHNOLOGY_IDS } from '../combat/technologies.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { isCombatFactionId } from '../combat/factions.ts';
import { SHIP_IDS } from '../combat/ids.ts';
import { SIMULATOR_MAX_ROUNDS } from '../combat/config.ts';
import { isPirateMissionSnapshot } from '../pirates/mission.ts';
import { isFlightCoordinate } from '../flights/distance.ts';

type UnknownRecord = Record<string, unknown>;

const AUTONOMY_MISSIONS = new Set([
  'attack',
  'espionage',
  'colonize',
  'expedition',
  'exploration-recon',
  'pirate-recon',
  'pirate-elimination',
  'aid',
  'space-flight',
  'recycle',
  'sun-attack',
  'sun-support',
  'transport',
]);

const FLIGHT_PHASES = new Set(['outbound', 'returning', 'arrived', 'completed', 'failed']);
const FLIGHT_COMPLETION_REASONS = new Set([
  'normal', 'normal-return', 'recalled', 'colonized', 'target-occupied', 'target-unavailable',
  'arrived', 'deployed', 'spy-destroyed', 'origin-destroyed', 'mission-failed',
]);

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function timestamp(value: unknown): value is number {
  return safeInteger(value) && value >= 0;
}

function positiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function coordinate(value: unknown): boolean {
  return isFlightCoordinate(value);
}

function entriesAreNonNegativeIntegers(value: unknown, allowedIds: readonly string[]): value is UnknownRecord {
  const source = record(value);
  if (!source) return false;
  return Object.entries(source).every(([id, quantity]) => allowedIds.includes(id)
    && safeInteger(quantity) && quantity >= 0);
}

function catalogHasId(catalog: readonly CatalogEntity[], itemId: unknown): boolean {
  return typeof itemId === 'string' && catalog.some((entry) => entry.id === itemId);
}

function validCost(value: unknown): boolean {
  const cost = record(value);
  return Boolean(cost)
    && safeInteger(cost!.metal) && cost!.metal >= 0
    && safeInteger(cost!.minerals) && cost!.minerals >= 0
    && safeInteger(cost!.gas) && cost!.gas >= 0;
}

function validFleetProductionOrder(value: unknown, queueKind: 'ships' | 'defense' | 'commanders', factionId: string): value is UnknownRecord {
  const order = record(value);
  if (!order || order.queueKind !== queueKind || !nonEmptyString(order.id) || !nonEmptyString(order.itemId)) return false;
  if (!safeInteger(order.quantity) || order.quantity <= 0
    || !safeInteger(order.completedQuantity) || order.completedQuantity < 0 || order.completedQuantity > order.quantity
    || !timestamp(order.enqueuedAt) || !timestamp(order.startedAt) || !timestamp(order.finishAt)
    || order.startedAt < order.enqueuedAt
    || !safeInteger(order.effectiveDurationMs) || order.effectiveDurationMs <= 0
    || order.startedAt + order.effectiveDurationMs * order.quantity !== order.finishAt
    || !Number.isSafeInteger(order.startedAt + order.effectiveDurationMs * order.quantity)
    || !validCost(order.cost) || typeof order.refundEligible !== 'boolean') return false;

  if (!isCombatFactionId(factionId)) return false;
  const catalog = queueKind === 'ships'
    ? getFactionShipCatalog(factionId)
    : queueKind === 'defense'
      ? getFactionDefenseCatalog(factionId)
      : COMMANDER_COMBAT_CATALOG;
  if (!catalogHasId(catalog, order.itemId)) return false;

  if (queueKind === 'commanders') {
    return isCommanderId(order.itemId)
      && safeInteger(order.commanderLevelAtEnqueue)
      && order.commanderLevelAtEnqueue >= 0
      && order.commanderLevelAtEnqueue <= 40;
  }
  return order.commanderLevelAtEnqueue === undefined;
}

function validFleetProduction(value: unknown, factionId: unknown): boolean {
  const state = record(value);
  if (!state || !isCombatFactionId(factionId)
    || !Array.isArray(state.shipQueue)
    || !Array.isArray(state.defenseQueue)
    || !Array.isArray(state.commanderQueue)) return false;

  const orderIds = new Set<string>();
  for (const [key, queueKind] of [
    ['shipQueue', 'ships'],
    ['defenseQueue', 'defense'],
    ['commanderQueue', 'commanders'],
  ] as const) {
    for (const item of state[key] as unknown[]) {
      if (!validFleetProductionOrder(item, queueKind, factionId)) return false;
      const order = item as UnknownRecord;
      if (orderIds.has(order.id as string)) return false;
      orderIds.add(order.id as string);
    }
  }
  return true;
}

function validAttackSnapshot(value: unknown): boolean {
  const snapshot = record(value);
  if (!snapshot || snapshot.version !== 1 || !SIMULATOR_MAX_ROUNDS.includes(snapshot.maxRounds as never)
    || !isCombatFactionId(snapshot.attackerFactionId)) return false;
  const technologies = record(snapshot.attackerTechnologies);
  if (!technologies || !COMBAT_TECHNOLOGY_IDS.every((id) => safeInteger(technologies[id]) && (technologies[id] as number) >= 0)) return false;
  if (!entriesAreNonNegativeIntegers(snapshot.attackerShipLevels, SHIP_IDS)
    || !entriesAreNonNegativeIntegers(snapshot.attackerCommanderLevels, COMMANDER_IDS)) return false;
  if (!Array.isArray(snapshot.attackerPriority) || snapshot.attackerPriority.some((id) => !isCommanderId(id))) return false;
  return snapshot.defenderPriority === undefined
    || (Array.isArray(snapshot.defenderPriority) && snapshot.defenderPriority.every((id) => isCommanderId(id)));
}

function validDestination(value: unknown, flight: UnknownRecord): boolean {
  const destination = record(value);
  if (!destination || !['coordinate', 'planet', 'operation', 'space'].includes(String(destination.kind))
    || !coordinate(destination.coordinate)) return false;
  // Only «Космический рейс» flies without a destination, and it always does.
  if ((destination.kind === 'space') !== (flight.missionId === 'space-flight')) return false;
  if (destination.kind === 'planet') {
    return nonEmptyString(destination.planetId) && flight.destinationPlanetId === destination.planetId;
  }
  if (destination.kind === 'operation') return nonEmptyString(destination.operationId) && flight.operationId === destination.operationId;
  return true;
}

function validCargo(value: unknown): boolean {
  const cargo = record(value);
  return Boolean(cargo)
    && ['metal', 'minerals', 'gas', 'debris'].every((key) => safeInteger(cargo![key]) && (cargo![key] as number) >= 0);
}

function validBoundNpcFlight(value: unknown): boolean {
  const flight = record(value);
  if (!flight || flight.ownerSide !== 'npc' || !nonEmptyString(flight.ownerId)
    || !AUTONOMY_MISSIONS.has(String(flight.missionId))
    || !nonEmptyString(flight.id) || !nonEmptyString(flight.requestId)
    || !nonEmptyString(flight.originPlanetId)
    || !coordinate(flight.originCoordinate) || !coordinate(flight.destinationCoordinate)
    || !validDestination(flight.destination, flight)
    || !FLIGHT_PHASES.has(String(flight.phase))
    || !safeInteger(flight.populationReserved) || flight.populationReserved < 0
    // A space flight has no route: zero distance and speed, a chosen duration.
    || !(flight.missionId === 'space-flight' ? flight.routeDistance === 0 : positiveFiniteNumber(flight.routeDistance))
    || !(flight.missionId === 'space-flight' ? flight.effectiveSpeed === 0 : positiveFiniteNumber(flight.effectiveSpeed))
    || !safeInteger(flight.oneWayDurationMs) || flight.oneWayDurationMs <= 0
    || !timestamp(flight.departedAt) || !timestamp(flight.arrivalAt) || flight.arrivalAt <= flight.departedAt
    || !safeInteger(flight.gasCost) || flight.gasCost < 0
    || !entriesAreNonNegativeIntegers(flight.selectedShips, SHIP_IDS)) return false;

  const selectedShips = flight.selectedShips as UnknownRecord;
  // A launch always carries ships; after a battle the survivor manifest may be
  // empty (total loss) and the flight still completes as a legitimate record.
  if (flight.phase === 'outbound'
    && !Object.values(selectedShips).some((quantity) => typeof quantity === 'number' && quantity > 0)) return false;
  if (flight.selectedCommanders !== undefined && !entriesAreNonNegativeIntegers(flight.selectedCommanders, COMMANDER_IDS)) return false;
  if (flight.completionReason !== undefined && !FLIGHT_COMPLETION_REASONS.has(String(flight.completionReason))) return false;

  for (const key of ['returnAt', 'recalledAt', 'arrivedAt', 'completedAt'] as const) {
    if (flight[key] !== undefined && !timestamp(flight[key])) return false;
  }
  if (flight.npcReturnCreditedAt !== undefined
    && (!timestamp(flight.npcReturnCreditedAt) || flight.ownerSide !== 'npc')) return false;
  if (flight.phase === 'returning' && (!timestamp(flight.returnAt) || flight.returnAt < flight.departedAt)) return false;
  if (flight.phase === 'arrived' && !timestamp(flight.arrivedAt)) return false;
  if ((flight.phase === 'completed' || flight.phase === 'failed') && !timestamp(flight.completedAt)) return false;

  const missionId = flight.missionId;
  if (missionId === 'attack' && !validAttackSnapshot(flight.attackSnapshot)) return false;
  if (missionId === 'espionage' && !nonEmptyString(flight.spyMissionId)) return false;
  if (missionId === 'colonize' && (typeof selectedShips.colonizer !== 'number' || selectedShips.colonizer < 1)) return false;
  if (missionId === 'expedition') {
    if (!nonEmptyString(flight.operationId) || !isCombatFactionId(flight.explorationFactionId)
      || !safeInteger(flight.explorationLaunchResourcePoints) || flight.explorationLaunchResourcePoints < 0
      || (flight.attackSnapshot !== undefined && !validAttackSnapshot(flight.attackSnapshot))) return false;
  }
  if (missionId === 'exploration-recon') {
    if (!nonEmptyString(flight.operationId) || !['unique', 'anomaly'].includes(String(flight.targetKind))
      || selectedShips['spy-probe'] !== 1) return false;
  }
  if (missionId === 'pirate-recon' || missionId === 'pirate-elimination') {
    if (!isPirateMissionSnapshot(flight.pirateSnapshot, missionId)
      || (flight.pirateSnapshot as UnknownRecord).ownerId !== flight.ownerId) return false;
  }
  if ((missionId === 'space-flight' || missionId === 'recycle') && !validCargo(flight.cargo)) return false;
  if (missionId === 'aid') {
    const aid = record(flight.aid);
    if (!aid || aid.senderOwnerId !== flight.ownerId || !nonEmptyString(aid.requestId)
      || !nonEmptyString(aid.allianceId) || !nonEmptyString(aid.recipientOwnerId)
      || !['metal', 'minerals', 'gas', 'debris'].includes(String(aid.resource))
      || !validCargo(flight.cargo)) return false;
  }

  // Keep the launch ownerId authoritative across origin destruction or capture.
  // The flight runtime must fail safely against the live registry; save health
  // must not reject a legitimate physical flight or rebind it to a new owner.
  return true;
}

/**
 * Strict pre-migration guard for the new owner-scoped NPC autonomy payload.
 * Legacy NPC records without the new fields remain readable; the caller owns
 * schema-version policy and must run this before any lossy migration.
 */
export function validateNpcAutonomyPayload(parsed: Record<string, unknown>): boolean {
  const espionage = record(parsed.espionage);
  if (parsed.espionage !== undefined && !espionage) return false;
  const targets = espionage ? record(espionage.targets) : null;

  if (espionage && espionage.targets !== undefined && !targets) return false;
  for (const rawTarget of Object.values(targets ?? {})) {
    const target = record(rawTarget);
    if (!target) return false;
    if (target.fleetProduction !== undefined && !validFleetProduction(target.fleetProduction, target.raceId)) return false;
  }

  const flights = record(parsed.flights);
  if (!flights) return parsed.flights === undefined;
  if (flights.records !== undefined && !Array.isArray(flights.records)) return false;
  const knownFlightIds = new Set<string>();
  const knownRequestIds = new Set<string>();
  const ownerBoundFlightIds = new Set<string>();
  const ownerBoundRequestIds = new Set<string>();
  for (const rawFlight of (flights.records ?? []) as unknown[]) {
    const flight = record(rawFlight);
    // Older flight migrations already discard malformed non-record entries.
    // Keep that legacy behavior unless the payload exposes a new autonomy field.
    if (!flight) continue;

    const hasOwnerBinding = flight.ownerId !== undefined;
    const flightId = typeof flight.id === 'string' && flight.id.trim() ? flight.id : undefined;
    const requestId = typeof flight.requestId === 'string' && flight.requestId.trim() ? flight.requestId : undefined;
    if (hasOwnerBinding && ((flightId !== undefined && knownFlightIds.has(flightId))
      || (requestId !== undefined && knownRequestIds.has(requestId)))) return false;
    if (!hasOwnerBinding && ((flightId !== undefined && ownerBoundFlightIds.has(flightId))
      || (requestId !== undefined && ownerBoundRequestIds.has(requestId)))) return false;
    if (flightId !== undefined) knownFlightIds.add(flightId);
    if (requestId !== undefined) knownRequestIds.add(requestId);

    if (flight.ownerId !== undefined && (!nonEmptyString(flight.ownerId) || flight.ownerSide !== 'npc')) return false;
    if (flight.npcReturnCreditedAt !== undefined
      && (!timestamp(flight.npcReturnCreditedAt) || flight.ownerSide !== 'npc' || !nonEmptyString(flight.ownerId))) return false;

    if (flight.ownerId === undefined) continue;
    if (!validBoundNpcFlight(flight)) return false;
    ownerBoundFlightIds.add(flight.id as string);
    ownerBoundRequestIds.add(flight.requestId as string);
  }
  return true;
}
