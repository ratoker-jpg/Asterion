import type { NpcProfile } from '../domain/npc/types.ts';
import { battleReportTime, reportRetentionCutoff } from './history-retention.ts';
import { ownerBattleReports, ownerFlights, ownerSpyReports, publicDebrisEntries, publicPlayerPlanetsKey } from './npc-knowledge-index.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import { isAttackCombatShip } from './attack.ts';
import { activeSpyMissionForTarget, getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { getFlightSlotUsage, isFlightLimitExempt } from '../domain/flights/limit.ts';
import type { FlightDestination, TargetRelation } from '../domain/flights/types.ts';
import { createUniverseSystem, getUniverseSystemTimedKey, MAX_PLANETS_PER_OWNER, nextColonyPointThreshold, SYSTEM_COUNT } from '../domain/universe/runtime.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { evaluatePlanetAttackEligibility } from './attack-eligibility.ts';
import type { UniverseCoordinate, UniverseObjectKind, UniversePersistedPlayerPlanet, UniverseRegisteredPlanet } from '../domain/universe/types.ts';
import { explorationNodeId, visibleExplorationContacts } from '../domain/exploration/model.ts';
import { EXPLORATION_ARTS } from '../exploration-art.ts';
import { getOwnerRelation } from './owner-relations.ts';
import { getNpcMissionAvailableFleet, getNpcMissionPlanningFleet, isNpcRecyclerShip, type NpcMissionDispatchCommand, type NpcMissionId } from './npc-missions.ts';
import { findDebrisNearSystem } from '../domain/espionage/orbital-debris.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { SaveState } from './contracts.ts';
import { productionExplorationNpcSources } from './exploration-npc.ts';

export type NpcMissionCandidatePayload = Readonly<Record<string, string | number | boolean | null>>;

export type NpcMissionCandidate = Readonly<{
  id: string;
  kind: NpcMissionId;
  weight: number;
  payload: NpcMissionCandidatePayload;
}>;

const ACTIVE_FLIGHT_PHASES = new Set(['outbound', 'arrived', 'returning']);
const OBSERVABLE_BATTLE_TYPES = new Set(['attack', 'raid']);

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Each owner's planets by id, built once per immutable targets object.
const npcTargetsByOwner = new WeakMap<object, Map<string, SpyTargetState[]>>();

function ownNpcTargets(state: SaveState, ownerId: string): SpyTargetState[] {
  const targets = getEspionageTargets(state.espionage);
  let byOwner = npcTargetsByOwner.get(targets);
  if (!byOwner) {
    byOwner = new Map();
    for (const target of Object.values(targets)) {
      if (target.kind !== 'npc') continue;
      const owned = byOwner.get(target.ownerId);
      if (owned) owned.push(target);
      else byOwner.set(target.ownerId, [target]);
    }
    for (const owned of byOwner.values()) owned.sort((left, right) => compareIds(left.id, right.id));
    npcTargetsByOwner.set(targets, byOwner);
  }
  return [...(byOwner.get(ownerId) ?? [])];
}

function activeNpcFlights(state: SaveState, ownerId: string) {
  return ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc'
    && ACTIVE_FLIGHT_PHASES.has(flight.phase));
}

function hasFlightSlot(state: SaveState, ownerId: string, missionId: NpcMissionId): boolean {
  if (isFlightLimitExempt(missionId)) return true;
  const ownerTargets = ownNpcTargets(state, ownerId);
  const science = state.npcScience?.owners[ownerId]?.levels
    ?? ownerTargets[0]?.ownerProfile?.scienceLevels
    ?? {};
  const flights = activeNpcFlights(state, ownerId)
    .map((flight) => ({ ...flight, ownerSide: 'player' as const }));
  return getFlightSlotUsage(flights, science[6] ?? 0).free > 0;
}

const ONE_SPY_PROBE: Partial<Record<ShipId, number>> = Object.freeze({ 'spy-probe': 1 });
/**
 * Probes one owner keeps out at once (owner 31.10.2026: 4 402 probes were in
 * flight in a 100-NPC world, 44 a bot): a few per planet, enough to watch its
 * neighbours and targets, not every planet of the map.
 */
export const NPC_PROBES_IN_FLIGHT = Object.freeze({ base: 4, perPlanet: 1, max: 10 });

function probesInFlight(state: SaveState, ownerId: string): number {
  return activeNpcFlights(state, ownerId).filter((flight) => flight.missionId === 'espionage' || flight.missionId === 'exploration-recon').length;
}
// One origin offers the same ship selection to every target: serialize it once.
const shipsPayloads = new WeakMap<object, string>();
function shipsPayload(selectedShips: Partial<Record<ShipId, number>>): string {
  let text = shipsPayloads.get(selectedShips);
  if (text === undefined) {
    text = JSON.stringify(Object.fromEntries(Object.entries(selectedShips)
      .filter(([, count]) => Number.isSafeInteger(count) && Number(count) > 0)
      .sort(([left], [right]) => compareIds(left, right))));
    shipsPayloads.set(selectedShips, text);
  }
  return text;
}

function addCandidate(
  candidates: NpcMissionCandidate[],
  ownerId: string,
  missionId: NpcMissionId,
  originPlanetId: string,
  destination: UniverseCoordinate,
  selectedShips: Partial<Record<ShipId, number>>,
  options: {
    destinationPlanetId?: string;
    operationId?: string;
    targetKind?: UniverseObjectKind;
    targetRelation?: TargetRelation;
    debris?: number;
  } = {},
): void {
  const payload: Record<string, string | number | boolean | null> = {
    missionId,
    originPlanetId,
    destinationGalaxy: destination.galaxy,
    destinationSystem: destination.system,
    destinationPosition: destination.position,
    selectedShips: shipsPayload(selectedShips),
  };
  if (options.destinationPlanetId) payload.destinationPlanetId = options.destinationPlanetId;
  if (options.operationId) payload.operationId = options.operationId;
  if (options.targetKind) payload.targetKind = options.targetKind;
  if (options.targetRelation) payload.targetRelation = options.targetRelation;
  if (options.debris !== undefined) payload.debris = options.debris;
  const destinationKey = options.destinationPlanetId ?? options.operationId
    ?? `${destination.galaxy}:${destination.system}:${destination.position}`;
  candidates.push({
    id: `npc-mission:${ownerId}:${missionId}:${originPlanetId}:${destinationKey}`,
    kind: missionId,
    // Equal legal actions keep this layer free of unapproved balance rules.
    weight: 1,
    payload,
  });
}

function legalRelation(state: SaveState, ownerId: string, target: Pick<SpyTargetState, 'ownerId'>): TargetRelation | null {
  const relation = getOwnerRelation(state, ownerId, target.ownerId);
  return relation === 'enemy' || relation === 'neutral' ? relation : null;
}

function missionOwnerId(report: SpyReportSnapshot, missions: readonly { id: string; ownerId: string }[]): string | undefined {
  if (typeof report.ownerId === 'string' && report.ownerId.length > 0) return report.ownerId;
  return missions.find((mission) => mission.id === report.missionId)?.ownerId;
}

function coordinateFromBattleLabel(value: unknown): UniverseCoordinate | null {
  if (typeof value !== 'string') return null;
  const match = /^\[(\d+):(\d+):(\d+)\]$/.exec(value.trim());
  if (!match) return null;
  const coordinate = { galaxy: Number(match[1]), system: Number(match[2]), position: Number(match[3]) };
  return Object.values(coordinate).every((part) => Number.isSafeInteger(part) && part > 0) ? coordinate : null;
}

function coordinateKey(coordinate: UniverseCoordinate): string {
  return `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;
}

function observedPlanetIds(state: SaveState, ownerId: string, at: number): Set<string> {
  const observed = new Set<string>();
  const missions = state.espionage?.missions ?? [];
  // Reports past the retention window are skipped, whether or not a prune has removed them yet.
  const cutoff = reportRetentionCutoff(at);
  for (const report of ownerSpyReports(state.espionage?.reports ?? [], missions, ownerId)) {
    if (report.createdAt > at || report.createdAt < cutoff) continue;
    observed.add(report.targetPlanetId);
  }

  const { targetsByCoordinate } = publicMapInputs(state);
  for (const report of ownerBattleReports(state.combat.reports, ownerId)) {
    if (!OBSERVABLE_BATTLE_TYPES.has(report.missionType)) continue;
    const timestamp = battleReportTime(report);
    if (!Number.isFinite(timestamp) || timestamp > at || timestamp < cutoff) continue;
    const isAttacker = report.attacker.playerId === ownerId;
    const isDefender = report.defender.playerId === ownerId;
    if (!isAttacker && !isDefender) continue;
    const opponent = isAttacker ? report.defender : report.attacker;
    const coordinate = coordinateFromBattleLabel(opponent.coordinates);
    if (!coordinate) continue;
    for (const id of targetsByCoordinate.get(coordinateKey(coordinate)) ?? []) observed.add(id);
  }
  return observed;
}

function publicPlayerPlanets(state: SaveState): UniversePersistedPlayerPlanet[] {
  return Object.entries(state.planets).flatMap(([id, planet]) => {
    if (planet.universeGalaxy === undefined || planet.universeSystem === undefined || planet.universePosition === undefined) return [];
    return [{
      id,
      name: planet.name,
      coordinate: { galaxy: planet.universeGalaxy, system: planet.universeSystem, position: planet.universePosition },
      isHomeworld: id === 'helion-01',
    }];
  });
}

function registeredPlanets(state: SaveState): UniverseRegisteredPlanet[] {
  return Object.values(getEspionageTargets(state.espionage)).flatMap((target) => {
    if (target.kind !== 'player' && target.kind !== 'npc') return [];
    return [{
      id: target.id,
      coordinate: { ...target.coordinate },
      name: target.name,
      kind: target.kind,
      ownerId: target.ownerId,
    }];
  });
}

function ownerSystems(targets: readonly SpyTargetState[]): Map<string, { galaxy: number; system: number }> {
  const systems = new Map<string, { galaxy: number; system: number }>();
  for (const target of targets) {
    for (let system = Math.max(1, target.coordinate.system - 5);
      system <= Math.min(SYSTEM_COUNT, target.coordinate.system + 5); system += 1) {
      const key = `${target.coordinate.galaxy}:${system}`;
      systems.set(key, { galaxy: target.coordinate.galaxy, system });
    }
  }
  return systems;
}

/**
 * Systems are pure of the map inputs and of which timed objects (pirates,
 * unique worlds, anomalies) are up at the moment (getUniverseSystemTimedKey):
 * a build is shared by every decision with the same inputs, at this moment
 * or a later one, instead of rebuilding ten systems per look every second.
 */
type PublicTarget = Pick<SpyTargetState, 'id' | 'ownerId' | 'coordinate' | 'kind'>;
type PublicMapInputs = { playerPlanets: UniversePersistedPlayerPlanet[]; registered: UniverseRegisteredPlanet[];
  defeats: unknown[]; signature: string;
  /** Every planet's public identity, by id (policy never sees force or wallets). */
  allTargets: PublicTarget[];
  /** Planet ids at each coordinate (battle reports name coordinates). */
  targetsByCoordinate: Map<string, string[]> };
let mapInputs: { planets: unknown; planetsKey: string; targets: unknown; defeats: unknown; playerId: string; value: PublicMapInputs } | null = null;
let systemCache: { signature: string; systems: Map<string, ReturnType<typeof createUniverseSystem>> } | null = null;
const SYSTEM_CACHE_LIMIT = 4_096;

function publicMapInputs(state: SaveState): PublicMapInputs {
  const targets = getEspionageTargets(state.espionage);
  const defeatedCycles = state.pirate?.contact.defeatedCycles;
  if (mapInputs && (mapInputs.planets === state.planets || mapInputs.planetsKey === publicPlayerPlanetsKey(state.planets))
    && mapInputs.defeats === defeatedCycles && mapInputs.playerId === state.profile.playerId
    && (mapInputs.targets === targets || samePublicTargets(mapInputs.targets as typeof targets, targets))) {
    mapInputs.targets = targets;
    mapInputs.planets = state.planets;
    return mapInputs.value;
  }
  const playerPlanets = publicPlayerPlanets(state);
  const registered = registeredPlanets(state);
  const defeats = Object.values(defeatedCycles ?? {});
  const signature = JSON.stringify([playerPlanets.map((planet) => [planet.id, planet.name, coordinateKey(planet.coordinate)]),
    registered.map((planet) => [planet.id, planet.ownerId, planet.name, planet.kind, coordinateKey(planet.coordinate)]), defeats]);
  const allTargets: PublicTarget[] = [
    ...Object.values(targets).map(({ id, ownerId, coordinate, kind }) => ({ id, ownerId, coordinate, kind })),
    ...playerPlanets.map(({ id, coordinate }) => ({ id, coordinate, ownerId: state.profile.playerId, kind: 'player' as const })),
  ].sort((left, right) => compareIds(left.id, right.id));
  const targetsByCoordinate = new Map<string, string[]>();
  for (const target of Object.values(targets)) {
    const key = coordinateKey(target.coordinate);
    const bucket = targetsByCoordinate.get(key) ?? [];
    bucket.push(target.id);
    targetsByCoordinate.set(key, bucket);
  }
  for (const planet of playerPlanets) {
    const key = coordinateKey(planet.coordinate);
    targetsByCoordinate.set(key, [...(targetsByCoordinate.get(key) ?? []), planet.id]);
  }
  const value = { playerPlanets, registered, defeats, signature, allTargets, targetsByCoordinate };
  mapInputs = { planets: state.planets, planetsKey: publicPlayerPlanetsKey(state.planets), targets, defeats: defeatedCycles, playerId: state.profile.playerId, value };
  return value;
}

/** Income settlement replaces targets every moment; what the map shows of them rarely changes. */
function samePublicTargets(left: Readonly<Record<string, SpyTargetState>>, right: Readonly<Record<string, SpyTargetState>>): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  if (leftIds.length !== rightIds.length) return false;
  for (let index = 0; index < leftIds.length; index += 1) {
    const id = leftIds[index]!;
    if (rightIds[index] !== id) return false;
    const a = left[id]!;
    const b = right[id]!;
    if (a === b) continue;
    if (a.kind !== b.kind || a.ownerId !== b.ownerId || a.name !== b.name || a.coordinate !== b.coordinate) return false;
  }
  return true;
}

function publicSystems(state: SaveState, ownerTargets: readonly SpyTargetState[], at: number) {
  const { playerPlanets, registered, defeats, signature } = publicMapInputs(state);
  if (!systemCache || systemCache.signature !== signature || systemCache.systems.size > SYSTEM_CACHE_LIMIT) {
    systemCache = { signature, systems: new Map() };
  }
  const cache = systemCache.systems;
  return [...ownerSystems(ownerTargets).values()].map(({ galaxy, system }) => {
    const key = `${galaxy}:${system}:${getUniverseSystemTimedKey(galaxy, system, at,
      defeats as Parameters<typeof getUniverseSystemTimedKey>[3])}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const built = buildPublicSystem(state, galaxy, system, at, playerPlanets, registered, defeats);
    cache.set(key, built);
    return built;
  });
}

function buildPublicSystem(state: SaveState, galaxy: number, system: number, at: number,
  playerPlanets: UniversePersistedPlayerPlanet[], registered: UniverseRegisteredPlanet[], defeats: unknown[]) {
  return createUniverseSystem({
    mode: 'production',
    galaxy,
    system,
    nowMs: at,
    galaxyCount: Math.max(1, galaxy),
    playerPlanets,
    registeredPlanets: registered,
    pirateContactDefeats: defeats as Parameters<typeof createUniverseSystem>[0]['pirateContactDefeats'],
    asteroidStates: state.asteroidSimulation?.asteroids ?? [],
    assets: { uniqueArts: EXPLORATION_ARTS.unique, anomalyArts: EXPLORATION_ARTS.anomaly },
    skipAsteroids: true,
  });
}

function systemDistance(left: UniverseCoordinate, right: UniverseCoordinate): number {
  return left.galaxy === right.galaxy ? Math.abs(left.system - right.system) : 1_000 + Math.abs(left.galaxy - right.galaxy);
}

function availableExpeditionShip(available: Partial<Record<ShipId, number>>, factionId: SpyTargetState['raceId']): Partial<Record<ShipId, number>> | null {
  const preferred = available.scout && available.scout > 0 ? 'scout' : SHIP_IDS.find((shipId) =>
    available[shipId] && available[shipId]! > 0 && isAttackCombatShip(shipId, factionId));
  return preferred ? { [preferred]: 1 } : null;
}

/** Just enough recyclers (largest holds first) to carry `debris`, or all that are left. */
function recyclersForDebris(available: Partial<Record<ShipId, number>>, raceId: SpyTargetState['raceId'], debris: number): Partial<Record<ShipId, number>> {
  const catalog = getFactionShipCatalog(raceId);
  const hulls = (Object.entries(available) as [ShipId, number][]).filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, count, cargo: catalog.find((entity) => entity.id === id)?.ship?.cargo ?? 0 }))
    .filter((hull) => hull.cargo > 0)
    .sort((left, right) => right.cargo - left.cargo || compareIds(left.id, right.id));
  const chosen: Partial<Record<ShipId, number>> = {};
  let left = debris;
  for (const hull of hulls) {
    if (left <= 0) break;
    const count = Math.min(hull.count, Math.ceil(left / hull.cargo));
    chosen[hull.id] = count;
    left -= count * hull.cargo;
  }
  return chosen;
}

/** Enumerates only missions that can be grounded in this owner's assets and observations. */
export function getNpcMissionCandidates(
  state: SaveState,
  profile: NpcProfile,
  at: number,
): NpcMissionCandidate[] {
  if (!Number.isSafeInteger(at) || at < 0 || !profile.ownerId || profile.ownerId === state.profile.playerId) return [];
  const ownerId = profile.ownerId;
  const ownerTargets = ownNpcTargets(state, ownerId);
  if (!ownerTargets.length) return [];

  // Policy receives public identity/coordinates only. Actual force and wallet
  // remain exclusively in execution and the owner's observation snapshots.
  const { allTargets } = publicMapInputs(state);
  const observed = observedPlanetIds(state, ownerId, at);
  const systems = publicSystems(state, ownerTargets, at);
  const realSources = productionExplorationNpcSources(state).filter((source) => source.ownerId === ownerId);
  const ownerCoordinates = realSources.length ? realSources.map((source) => source.coordinate) : ownerTargets.map((target) => target.coordinate);
  const nodes = systems.flatMap((system) => system.positions);
  const contacts = visibleExplorationContacts(nodes, ownerCoordinates, at, nodes.length)
    .filter((node) => node.kind === 'unique' || node.kind === 'anomaly');
  const contactById = contacts.flatMap((node) => {
    const id = explorationNodeId(node);
    return id ? [{ node, id }] : [];
  }).sort((left, right) => compareIds(left.id, right.id));
  const candidateList: NpcMissionCandidate[] = [];
  const ownerPlanetCount = ownerTargets.length;
  const reservedColonize = new Set(state.flights.records
    .filter((flight) => flight.ownerId === ownerId && flight.missionId === 'colonize' && ACTIVE_FLIGHT_PHASES.has(flight.phase))
    .map((flight) => coordinateKey(flight.destinationCoordinate)));
  const publicEmptyCoordinates = systems.flatMap((system) => system.positions
    .filter((node) => node.kind === 'empty')
    .map((node) => node.coordinate))
    .filter((coordinate) => !reservedColonize.has(coordinateKey(coordinate)))
    .sort((left, right) => compareIds(coordinateKey(left), coordinateKey(right)));

  // A target is spied from the nearest own planet that has a probe. Any
  // galaxy is in reach (only the flight is longer); distance enters the
  // owner's estimate, and the rule is the same for every owner.
  const probeOrigins = ownerTargets.filter((origin) => (getNpcMissionAvailableFleet(state, ownerId, origin.id)?.['spy-probe'] ?? 0) > 0);
  const nearestProbeOrigin = (coordinate: UniverseCoordinate) => probeOrigins.reduce<SpyTargetState | undefined>((best, origin) =>
    !best || systemDistance(origin.coordinate, coordinate) < systemDistance(best.coordinate, coordinate) ? origin : best, undefined);
  // The owner's next colony opens at a total-point threshold (owner rule, same as the player's).
  let colonyOpenCache: boolean | undefined;
  const colonyOpen = () => colonyOpenCache ??= (() => {
    const threshold = nextColonyPointThreshold(ownerPlanetCount + reservedColonize.size);
    return threshold !== null && (selectOwnerScore(state, ownerId)?.totalPoints ?? 0) >= threshold;
  })();
  const attackScoreCache = new Map<string, { totalPoints: number; resourcePoints: number } | undefined>();
  const probesRoom = Math.min(NPC_PROBES_IN_FLIGHT.max, NPC_PROBES_IN_FLIGHT.base + NPC_PROBES_IN_FLIGHT.perPlanet * ownerTargets.length)
    - probesInFlight(state, ownerId);
  for (const origin of ownerTargets) {
    const available = getNpcMissionPlanningFleet(state, ownerId, origin.id);
    if (!available) continue;

    if ((available['spy-probe'] ?? 0) > 0 && hasFlightSlot(state, ownerId, 'espionage') && probesRoom > 0) {
      for (const target of allTargets) {
        if (target.id === origin.id || (target.kind !== 'player' && target.kind !== 'npc') || target.ownerId === ownerId) continue;
        const relation = legalRelation(state, ownerId, target);
        if (!relation) continue;
        if (nearestProbeOrigin(target.coordinate)?.id !== origin.id) continue;
        if (activeSpyMissionForTarget(state.espionage?.missions ?? [], ownerId, target.id)) continue;
        addCandidate(candidateList, ownerId, 'espionage', origin.id, target.coordinate, ONE_SPY_PROBE, {
          destinationPlanetId: target.id,
          targetRelation: relation,
        });
      }
    }

    if ((available['spy-probe'] ?? 0) > 0 && hasFlightSlot(state, ownerId, 'exploration-recon') && probesRoom > 0) {
      for (const { node, id } of contactById) {
        const reconAlreadyActive = ownerFlights(state.flights.records, ownerId).some((flight) => flight.ownerSide === 'npc'
          && flight.missionId === 'exploration-recon'
          && flight.operationId === id && ACTIVE_FLIGHT_PHASES.has(flight.phase));
        if (reconAlreadyActive) continue;
        addCandidate(candidateList, ownerId, 'exploration-recon', origin.id, node.coordinate, ONE_SPY_PROBE, {
          operationId: id,
          targetKind: node.kind,
        });
      }
    }

    const attackShips = Object.fromEntries(SHIP_IDS
      .filter((shipId) => (available[shipId] ?? 0) > 0 && isAttackCombatShip(shipId, origin.raceId))
      .map((shipId) => [shipId, available[shipId]!])) as Partial<Record<ShipId, number>>;
    if (Object.keys(attackShips).length && hasFlightSlot(state, ownerId, 'attack')) {
      for (const target of allTargets) {
        if (!observed.has(target.id) || (target.kind !== 'player' && target.kind !== 'npc')) continue;
        const relation = legalRelation(state, ownerId, target);
        if (!relation) continue;
        // The same launch gate as dispatch: an inadmissible target is never a candidate.
        if (!evaluatePlanetAttackEligibility(state, ownerId, target.ownerId, attackScoreCache).allowed) continue;
        addCandidate(candidateList, ownerId, 'attack', origin.id, target.coordinate, attackShips, {
          destinationPlanetId: target.id,
          targetRelation: relation,
        });
      }
    }

    if ((available.colonizer ?? 0) > 0 && ownerPlanetCount < MAX_PLANETS_PER_OWNER && colonyOpen()
      && hasFlightSlot(state, ownerId, 'colonize')) {
      for (const coordinate of publicEmptyCoordinates) {
        addCandidate(candidateList, ownerId, 'colonize', origin.id, coordinate, { colonizer: 1 }, { targetKind: 'empty' });
      }
    }

    // Debris shown on the public map near this planet (the player's «Найти
    // обломки»): recyclers go to the richest few, carrying what they can.
    const recyclers = Object.fromEntries(SHIP_IDS.filter((shipId) => (available[shipId] ?? 0) > 0 && isNpcRecyclerShip(shipId, origin.raceId))
      .map((shipId) => [shipId, available[shipId]!])) as Partial<Record<ShipId, number>>;
    if (Object.keys(recyclers).length && hasFlightSlot(state, ownerId, 'recycle')) {
      const nearby = findDebrisNearSystem(publicDebrisEntries(state.espionage), origin.coordinate)
        .sort((left, right) => right.debris - left.debris || compareIds(coordinateKey(left.coordinate), coordinateKey(right.coordinate)))
        .slice(0, 3);
      // Each field gets the recyclers it needs, richest first, so one look can
      // clear several fields instead of sending every hull to one.
      const remaining: Partial<Record<ShipId, number>> = { ...recyclers };
      for (const { coordinate, debris } of nearby) {
        const assigned = recyclersForDebris(remaining, origin.raceId, debris);
        if (!Object.keys(assigned).length) break;
        for (const [id, count] of Object.entries(assigned) as [ShipId, number][]) remaining[id] = (remaining[id] ?? 0) - count;
        addCandidate(candidateList, ownerId, 'recycle', origin.id, coordinate, assigned, { debris });
      }
    }

    const expeditionShips = availableExpeditionShip(available, origin.raceId);
    if (expeditionShips && hasFlightSlot(state, ownerId, 'expedition')) {
      for (const { node, id } of contactById) {
        if (state.exploration?.contacts?.[id]?.claim) continue;
        addCandidate(candidateList, ownerId, 'expedition', origin.id, node.coordinate, expeditionShips, {
          operationId: id,
          targetKind: node.kind,
        });
      }
    }
  }

  return candidateList.sort((left, right) => compareIds(left.id, right.id));
}

function isMissionId(value: unknown): value is NpcMissionId {
  return value === 'espionage' || value === 'colonize' || value === 'attack'
    || value === 'expedition' || value === 'exploration-recon' || value === 'recycle';
}

function coordinateFromPayload(payload: NpcMissionCandidatePayload): UniverseCoordinate | null {
  const galaxy = payload.destinationGalaxy;
  const system = payload.destinationSystem;
  const position = payload.destinationPosition;
  if (!Number.isSafeInteger(galaxy) || !Number.isSafeInteger(system) || !Number.isSafeInteger(position)
    || Number(galaxy) < 1 || Number(system) < 1 || Number(position) < 1) return null;
  return { galaxy: Number(galaxy), system: Number(system), position: Number(position) };
}

function selectedShipsFromPayload(payload: NpcMissionCandidatePayload): Partial<Record<ShipId, number>> | null {
  if (typeof payload.selectedShips !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(payload.selectedShips);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const ships: Partial<Record<ShipId, number>> = {};
    for (const [rawId, rawCount] of Object.entries(parsed)) {
      if (!SHIP_IDS.includes(rawId as ShipId) || !Number.isSafeInteger(rawCount) || Number(rawCount) <= 0) return null;
      ships[rawId as ShipId] = Number(rawCount);
    }
    return Object.keys(ships).length ? ships : null;
  } catch {
    return null;
  }
}

/** Converts a selected policy candidate into the shared NPC mission command. */
export function candidateToNpcMissionCommand(
  candidate: NpcMissionCandidate,
  ownerId: string,
  requestId: string,
): NpcMissionDispatchCommand | null {
  if (!isMissionId(candidate.kind) || candidate.payload.missionId !== candidate.kind
    || typeof candidate.payload.originPlanetId !== 'string' || !candidate.payload.originPlanetId
    || !ownerId || !requestId.trim()) return null;
  const coordinate = coordinateFromPayload(candidate.payload);
  const selectedShips = selectedShipsFromPayload(candidate.payload);
  if (!coordinate || !selectedShips) return null;

  const destinationPlanetId = candidate.payload.destinationPlanetId;
  const operationId = candidate.payload.operationId;
  const targetKind = candidate.payload.targetKind;
  const targetRelation = candidate.payload.targetRelation;
  let destination: FlightDestination;
  if (candidate.kind === 'espionage' || candidate.kind === 'attack') {
    if (typeof destinationPlanetId !== 'string' || !destinationPlanetId
      || (targetRelation !== 'enemy' && targetRelation !== 'neutral')) return null;
    destination = { kind: 'planet', planetId: destinationPlanetId, coordinate };
  } else {
    destination = { kind: 'coordinate', coordinate };
  }
  if ((candidate.kind === 'expedition' || candidate.kind === 'exploration-recon')
    && (typeof operationId !== 'string' || !operationId)) return null;
  if (candidate.kind === 'colonize' && targetKind !== 'empty') return null;
  if ((candidate.kind === 'expedition' || candidate.kind === 'exploration-recon')
    && targetKind !== 'unique' && targetKind !== 'anomaly') return null;

  return {
    ownerId,
    originPlanetId: candidate.payload.originPlanetId,
    requestId,
    missionId: candidate.kind,
    selectedShips,
    destination,
    ...(typeof operationId === 'string' ? { operationId } : {}),
    ...(typeof destinationPlanetId === 'string' ? { targetPlanetId: destinationPlanetId } : {}),
    ...(typeof targetKind === 'string' ? { targetKind: targetKind as UniverseObjectKind } : {}),
    ...(targetRelation === 'enemy' || targetRelation === 'neutral' ? { targetRelation } : {}),
  };
}
