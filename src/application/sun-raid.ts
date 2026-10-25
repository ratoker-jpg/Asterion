import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { TEST_ALLY_OWNER_ID, TEST_BOT_OWNER_ID } from '../domain/command/catalog.ts';
import { getCombatFactionName, isCombatFactionId, type CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionCombatEntity, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { SHIP_IDS, SOLAR_SATELLITE_ID, type ShipId } from '../domain/combat/ids.ts';
import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { addDebris } from '../domain/flights/cargo.ts';
import { DEFAULT_COMBAT_PRIORITY } from '../domain/combat/priority.ts';
import { resolveCombat } from '../domain/combat/resolver.ts';
import { createDefaultCombatTechnologies, type CombatTechnologyLevels } from '../domain/combat/technologies.ts';
import type { BattleForceSnapshot, BattleReport } from '../domain/combat/report.ts';
import type { CombatInput, CombatStackInput } from '../domain/combat/simulator.ts';
import { setSunBrightnessOverrides } from '../domain/energy/runtime.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import { calculateFleetPopulation } from '../domain/fleet/runtime.ts';
import { createFlightRecord } from '../domain/flights/runtime.ts';
import type { FlightRecord, FlightState } from '../domain/flights/types.ts';
import { scaleRuntimeDuration, type RuntimeMode } from '../domain/runtime/mode.ts';
import { SOLAR_CRYSTALS, SUN_RAID_CONFIG } from '../domain/sun-raid/config.ts';
import {
  activeGateOf,
  addCrystal,
  appendSunEvents,
  applyRaidVictoryToSun,
  checkGateStart,
  checkRaidLaunch,
  createDefaultSunRaidState,
  gateProgressPercent,
  getHolderCrystals,
  holderKey,
  materializeSun,
  mergeSideShipLevels,
  mergeSideTechnologies,
  parseHolderKey,
  resolveGateBreach,
  projectSun,
  readSun,
  removeCrystal,
  rollCrystal,
  sameHolder,
  sunKey,
} from '../domain/sun-raid/rules.ts';
import type {
  CampaignResult,
  CrystalHolder,
  GateProject,
  SunFlightSnapshot,
  SunRaidEvent,
  SunRaidRecord,
  SunRaidState,
} from '../domain/sun-raid/types.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import { calculateAttackDebris, technologiesFromScience } from './attack.ts';
import { battleDebrisRoll } from '../domain/combat/debris.ts';
import { recordBattleScoreAward } from '../domain/rating/scoring.ts';
import {
  getOwnerShipUpgradeLevel,
  getOwnerShipUpgradeLevels,
  getPlanetResources,
  replaceAlliedPlanetState,
  replacePlanetResources,
  replacePlanetState,
  type SaveState,
} from './contracts.ts';
import { syncPlanetEnergySources } from './energy.ts';
import { getAvailableFleetForPlanet } from './flights.ts';

/** UI event: open «Командование → Операции» (from the fleet mission tile). */
export const OPEN_SUN_OPERATIONS_EVENT = 'asterion:open-sun-operations';

/**
 * `timeScale` is the NPC replay's campaign scale: NPC commands pass it so their
 * Sun flights and Gates run on the same clock as every other NPC flight.
 */
export type SunRuntimeOptions = { now: number; mode: RuntimeMode; testTimeScale?: number; timeScale?: number };

function scaleSunDuration(durationMs: number, options: SunRuntimeOptions): number {
  if (options.timeScale !== undefined && Number.isFinite(options.timeScale) && options.timeScale > 0) {
    return Math.max(1, Math.round(Math.max(1, Math.round(durationMs)) / options.timeScale));
  }
  return scaleRuntimeDuration(durationMs, options.mode, options.testTimeScale);
}

/** Reason codes shared with FlightErrorCode, so the Fleets screen gets the real cause. */
export type SunFailureCode =
  | 'invalid-command'
  | 'mission-not-supported'
  | 'target-not-available'
  | 'wrong-ship-composition'
  | 'insufficient-ships'
  | 'insufficient-commanders'
  | 'capacity-exceeded'
  | 'insufficient-gas'
  | 'flight-limit-reached';

type SunFailure = { code: SunFailureCode; message: string };

export type SunActionResult =
  | { ok: true; state: SaveState; notice: string; raidId?: string; flightId?: string }
  | { ok: false; state: SaveState; error: string; code?: SunFailureCode };

export type SunRaidNotice = { tone: 'info' | 'success' | 'error'; text: string; galaxy?: number; system?: number };

const SUN_RAID_RECORD_LIMIT = 200;
const ACTIVE_PHASES = new Set<FlightRecord['phase']>(['outbound', 'arrived', 'returning']);
const SUN_MISSIONS = new Set<FlightRecord['missionId']>(['sun-attack', 'sun-support']);

const pad2 = (value: number) => String(value).padStart(2, '0');
export const formatSun = (galaxy: number, system: number) => `[${galaxy}:${pad2(system)}]`;

export function sunOperationId(galaxy: number, system: number): string {
  return `sun:${galaxy}:${system}`;
}

/** Suns sit at the centre of the system; routes address the system through position 1. */
export function sunRouteCoordinate(galaxy: number, system: number): UniverseCoordinate {
  return { galaxy, system, position: 1 };
}

export function currentSunRaidState(state: SaveState): SunRaidState {
  return state.sunRaid ?? createDefaultSunRaidState();
}

function withSunRaid(state: SaveState, sunRaid: SunRaidState): SaveState {
  return { ...state, sunRaid };
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function isSunFlight(flight: FlightRecord): boolean {
  return SUN_MISSIONS.has(flight.missionId);
}

/** Civil hulls never join a Sun battle: only combat ships and commander ships fly there. */
export const SUN_CIVIL_SHIP_IDS: ReadonlySet<ShipId> = new Set<ShipId>(['spy-probe', 'colonizer', 'recycler', 'transporter', 'mega-transporter', SOLAR_SATELLITE_ID]);

export function isSunCombatHull(id: ShipId): boolean {
  return SHIP_IDS.includes(id) && !SUN_CIVIL_SHIP_IDS.has(id);
}

/** Population of a Sun fleet (combat ships and commander ships) for one race. */
export function sunFleetPopulation(
  ships: Partial<Record<ShipId, number>>,
  factionId: CombatFactionId,
  commanders: Partial<Record<CommanderId, number>> = {},
): number {
  let total = 0;
  for (const [id, count] of Object.entries(ships) as [ShipId, number][]) {
    if (!SHIP_IDS.includes(id) || id === SOLAR_SATELLITE_ID) continue;
    const entity = getFactionCombatEntity(factionId, id);
    total += Math.max(0, Math.floor(entity.population ?? 0)) * safeCount(count);
  }
  for (const [id, count] of Object.entries(commanders) as [CommanderId, number][]) {
    if (!COMMANDER_IDS.includes(id) || safeCount(count) <= 0) continue;
    total += Math.max(0, Math.floor(getFactionCombatEntity(factionId, id).population ?? 0)) * Math.min(1, safeCount(count));
  }
  return total;
}

function normalizeCommanders(commanders: Partial<Record<CommanderId, number>> | undefined): Partial<Record<CommanderId, number>> {
  return Object.fromEntries((Object.entries(commanders ?? {}) as [CommanderId, number][])
    .filter(([id, count]) => COMMANDER_IDS.includes(id) && safeCount(count) > 0)
    .map(([id]) => [id, 1])) as Partial<Record<CommanderId, number>>;
}

/** Sun debris lie on the system's «zero» position: the Sun itself. */
export function sunDebrisCoordinate(galaxy: number, system: number): UniverseCoordinate {
  return { galaxy, system, position: 0 };
}

export function sunDebrisLedgerKey(galaxy: number, system: number): string {
  return `sun-debris-${galaxy}-${system}`;
}

/** Free debris orbiting a Sun (left by Sun battles). */
export function getSunDebris(state: SaveState, galaxy: number, system: number): number {
  return Math.max(0, Math.floor(state.espionage?.orbitalDebris?.[sunDebrisLedgerKey(galaxy, system)]?.debris ?? 0));
}

/** Parses `sun:G:S` operation ids. */
export function parseSunOperationId(value: string | undefined): { galaxy: number; system: number } | null {
  const match = typeof value === 'string' ? /^sun:(\d+):(\d+)$/.exec(value) : null;
  return match ? { galaxy: Number(match[1]), system: Number(match[2]) } : null;
}

function normalizeSelection(ships: Partial<Record<ShipId, number>>): Partial<Record<ShipId, number>> {
  return Object.fromEntries((Object.entries(ships) as [ShipId, number][])
    .filter(([id, count]) => SHIP_IDS.includes(id) && id !== SOLAR_SATELLITE_ID && safeCount(count) > 0)
    .map(([id, count]) => [id, safeCount(count)])) as Partial<Record<ShipId, number>>;
}

/* ------------------------------------------------------------------ owners */

type SunOwner = {
  ownerId: string;
  ownerName: string;
  ownerSide: 'player' | 'bot01' | 'npc';
  /** An autonomous NPC owner: its own planet in espionage targets, the same gas price as the player's. */
  autonomous?: boolean;
  factionId: CombatFactionId;
  planetId: string;
  planetName: string;
  coordinate: UniverseCoordinate;
  technologies: CombatTechnologyLevels;
  shipLevels: Partial<Record<ShipId, number>>;
  scienceLevels: Partial<Record<number, number>>;
  available: Partial<Record<ShipId, number>>;
  availableCommanders: Partial<Record<CommanderId, number>>;
  commanderLevels: Partial<Record<CommanderId, number>>;
};

function shipLevelsOnly(levels: Record<string, number>): Partial<Record<ShipId, number>> {
  return Object.fromEntries(Object.entries(levels).filter(([id]) => SHIP_IDS.includes(id as ShipId))) as Partial<Record<ShipId, number>>;
}

function playerOwner(state: SaveState, planetId: string): SunOwner | null {
  const planet = state.planets[planetId];
  if (!planet) return null;
  return {
    ownerId: state.profile.playerId,
    ownerName: state.profile.displayName,
    ownerSide: 'player',
    factionId: state.profile.factionId,
    planetId,
    planetName: planet.name,
    coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
    technologies: technologiesFromScience(state.science.levels),
    shipLevels: shipLevelsOnly(getOwnerShipUpgradeLevels(state)),
    scienceLevels: state.science.levels,
    available: getAvailableFleetForPlanet(state, planetId).ships,
    availableCommanders: getAvailableFleetForPlanet(state, planetId).commanders,
    commanderLevels: Object.fromEntries(COMMANDER_IDS.map((id) => [id, getOwnerShipUpgradeLevel(state, id)])) as Partial<Record<CommanderId, number>>,
  };
}

function bot01Owner(state: SaveState, target: SpyTargetState): SunOwner {
  const profile = state.espionage?.bot01Profile;
  return {
    ownerId: target.ownerId,
    ownerName: target.ownerName,
    ownerSide: 'bot01',
    factionId: target.raceId,
    planetId: target.id,
    planetName: target.name,
    coordinate: { ...target.coordinate },
    technologies: profile ? technologiesFromScience(profile.scienceLevels) : createDefaultCombatTechnologies(),
    shipLevels: { ...(profile?.shipLevels ?? {}) },
    scienceLevels: profile?.scienceLevels ?? {},
    available: { ...target.fleet.ships },
    availableCommanders: {},
    commanderLevels: { ...(profile?.commanderLevels ?? {}) },
  };
}

/** A real autonomous NPC on one of its own planets: its own science, ship levels and free hangar. */
function npcTargetOwner(target: SpyTargetState): SunOwner {
  const profile = target.ownerProfile;
  // Ships in flight are already off the planet: NPC dispatch detaches them.
  return {
    ownerId: target.ownerId,
    ownerName: target.ownerName,
    ownerSide: 'npc',
    autonomous: true,
    factionId: target.raceId,
    planetId: target.id,
    planetName: target.name,
    coordinate: { ...target.coordinate },
    technologies: technologiesFromScience(profile?.scienceLevels ?? {}),
    shipLevels: { ...(profile?.shipLevels ?? {}) },
    scienceLevels: profile?.scienceLevels ?? {},
    available: { ...target.fleet.ships },
    availableCommanders: {},
    commanderLevels: { ...(profile?.commanderLevels ?? {}) },
  };
}

/** The Sun-raid view of an autonomous NPC planet, or null when it is not that owner's. */
export function sunOwnerForNpcPlanet(state: SaveState, ownerId: string, planetId: string): SunOwner | null {
  const target = getEspionageTargets(state.espionage)[planetId];
  return target && target.kind === 'npc' && target.ownerId === ownerId ? npcTargetOwner(target) : null;
}

function allyOwner(state: SaveState): SunOwner | null {
  const planet = Object.values(state.alliedPlanets ?? {}).find((item) => item.ownerId === TEST_ALLY_OWNER_ID);
  if (!planet) return null;
  return {
    ownerId: planet.ownerId,
    ownerName: planet.displayName,
    ownerSide: 'npc',
    factionId: isCombatFactionId(planet.raceId) ? planet.raceId : 'aegis',
    planetId: planet.id,
    planetName: planet.name,
    coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
    technologies: createDefaultCombatTechnologies(),
    shipLevels: {},
    scienceLevels: {},
    available: { ...planet.fleet.ships },
    availableCommanders: {},
    commanderLevels: {},
  };
}

function allianceOf(state: SaveState, ownerId: string) {
  return selectOwnerMembership(state.command, ownerId);
}

/* ----------------------------------------------------------------- flights */

function flightsOfRaid(state: SaveState, raidId: string, side?: 'attacker' | 'defender'): FlightRecord[] {
  return state.flights.records.filter((flight) => isSunFlight(flight) && flight.sunRaid?.raidId === raidId
    && (side === undefined || flight.sunRaid.side === side));
}

export type SunSideSummary = { flights: FlightRecord[]; population: number; participants: number };

/** Committed population of each side of a raid (fleets in the air or holding at the Sun). */
export function selectRaidSides(state: SaveState, raidId: string): { attackers: SunSideSummary; defenders: SunSideSummary } {
  const summarize = (side: 'attacker' | 'defender'): SunSideSummary => {
    const flights = flightsOfRaid(state, raidId, side).filter((flight) => flight.phase === 'outbound' || flight.phase === 'arrived');
    return {
      flights,
      population: flights.reduce((total, flight) => total + (flight.sunRaid?.population ?? 0), 0),
      participants: new Set(flights.map((flight) => flight.sunRaid?.ownerId)).size,
    };
  };
  return { attackers: summarize('attacker'), defenders: summarize('defender') };
}

function createSunFlight(
  owner: SunOwner,
  input: {
    missionId: 'sun-attack' | 'sun-support';
    raidId: string;
    galaxy: number;
    system: number;
    ships: Partial<Record<ShipId, number>>;
    commanders?: Partial<Record<CommanderId, number>>;
    requestId: string;
    departedAt: number;
    allianceId: string | null;
  },
  options: SunRuntimeOptions,
): FlightRecord {
  const commanders = normalizeCommanders(input.commanders);
  const destination = { kind: 'operation' as const, operationId: sunOperationId(input.galaxy, input.system), coordinate: sunRouteCoordinate(input.galaxy, input.system) };
  const base = createFlightRecord({
    requestId: input.requestId,
    missionId: input.missionId,
    ...(owner.ownerSide === 'player' ? {} : { ownerSide: owner.ownerSide }),
    ...(owner.autonomous ? { ownerId: owner.ownerId } : {}),
    originPlanetId: owner.planetId,
    originCoordinate: owner.coordinate,
    destination,
    selectedShips: input.ships,
    ...(Object.keys(commanders).length ? { selectedCommanders: commanders } : {}),
    speedCommanderLevels: { typhoon: owner.commanderLevels.typhoon ?? 0 },
    departedAt: input.departedAt,
    factionId: owner.factionId,
    science: owner.scienceLevels as import('../domain/flights/types.ts').FlightScienceLevels,
    targetPlanetName: `Солнце ${formatSun(input.galaxy, input.system)}`,
  });
  // A raid always takes exactly 3 h each way (scaled like every timer); support
  // uses the ordinary route so defenders inside the galaxy can arrive in time.
  const oneWayDurationMs = input.missionId === 'sun-attack'
    ? scaleSunDuration(SUN_RAID_CONFIG.flightOneWayMs, options)
    : scaleSunDuration(base.oneWayDurationMs, options);
  const snapshot: SunFlightSnapshot = {
    version: 1,
    raidId: input.raidId,
    side: input.missionId === 'sun-attack' ? 'attacker' : 'defender',
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    factionId: owner.factionId,
    allianceId: input.allianceId,
    technologies: owner.technologies,
    shipLevels: owner.shipLevels,
    ...(Object.keys(commanders).length ? { commanderLevels: Object.fromEntries(Object.keys(commanders).map((id) => [id, Math.max(0, Math.floor(owner.commanderLevels[id as CommanderId] ?? 0))])) } : {}),
    population: sunFleetPopulation(input.ships, owner.factionId, commanders),
  };
  return {
    ...base,
    routeDistance: Math.max(1, base.routeDistance),
    oneWayDurationMs,
    arrivalAt: input.departedAt + oneWayDurationMs,
    gasCost: owner.ownerSide === 'player' || owner.autonomous ? base.gasCost : 0,
    sunRaid: snapshot,
  };
}

function appendFlight(flights: FlightState, flight: FlightRecord): FlightState {
  return { records: [...flights.records, flight], requestIndex: { ...flights.requestIndex, [flight.requestId]: flight.id } };
}

function validateShipsDetailed(owner: SunOwner, ships: Partial<Record<ShipId, number>>, commanders: Partial<Record<CommanderId, number>> = {}): SunFailure | null {
  const selection = normalizeSelection(ships);
  const selectedCommanders = normalizeCommanders(commanders);
  if (!Object.keys(selection).length && !Object.keys(selectedCommanders).length) return { code: 'wrong-ship-composition', message: 'Выберите боевые корабли.' };
  if (Object.keys(selection).some((id) => SUN_CIVIL_SHIP_IDS.has(id as ShipId))) {
    return { code: 'wrong-ship-composition', message: 'К Солнцу летят только боевые корабли: зонды, колонизаторы, транспорты и переработчики не допускаются.' };
  }
  const catalog = new Set(getFactionShipCatalog(owner.factionId).map((entity) => entity.id));
  for (const [id, count] of Object.entries(selection) as [ShipId, number][]) {
    if (!catalog.has(id)) return { code: 'wrong-ship-composition', message: 'Этот корабль недоступен вашей расе.' };
    if ((owner.available[id] ?? 0) < count) return { code: 'insufficient-ships', message: 'На планете недостаточно свободных кораблей.' };
  }
  for (const id of Object.keys(selectedCommanders) as CommanderId[]) {
    if ((owner.availableCommanders[id] ?? 0) < 1) return { code: 'insufficient-commanders', message: 'Выбранный командирский корабль недоступен на этой планете.' };
  }
  return null;
}

function validateShips(owner: SunOwner, ships: Partial<Record<ShipId, number>>, commanders: Partial<Record<CommanderId, number>> = {}): string | null {
  return validateShipsDetailed(owner, ships, commanders)?.message ?? null;
}

/** Takes NPC fixture ships off their planet for the flight; survivors come back on return. */
function detachNpcShips(state: SaveState, owner: SunOwner, ships: Partial<Record<ShipId, number>>, sign: -1 | 1): SaveState {
  if (owner.ownerSide === 'player') return state;
  const apply = (fleet: Partial<Record<ShipId, number>>) => {
    const next = { ...fleet };
    for (const [id, count] of Object.entries(ships) as [ShipId, number][]) next[id] = Math.max(0, (next[id] ?? 0) + sign * safeCount(count));
    return next;
  };
  if (owner.ownerSide === 'bot01' || owner.autonomous) {
    const target = getEspionageTargets(state.espionage)[owner.planetId];
    if (!target || !state.espionage) return state;
    const fleet = { ...target.fleet, ships: apply(target.fleet.ships) as typeof target.fleet.ships };
    const fleetPopulation = calculateFleetPopulation(fleet, target.raceId);
    const defensePopulation = calculateDefensePopulation(target.defense, target.raceId);
    const updated: SpyTargetState = { ...target, fleet, population: { total: fleetPopulation + defensePopulation, fleet: fleetPopulation, defense: defensePopulation } };
    const targets = { ...getEspionageTargets(state.espionage), [target.id]: updated };
    return { ...state, espionage: { ...state.espionage, targets, ...(state.espionage.bot01Planets ? { bot01Planets: targets } : {}) } };
  }
  const planet = state.alliedPlanets?.[owner.planetId];
  if (!planet) return state;
  return replaceAlliedPlanetState(state, owner.planetId, { ...planet, fleet: { ...planet.fleet, ships: apply(planet.fleet.ships) as typeof planet.fleet.ships } });
}

/** Charges an autonomous NPC the flight's gas on its own planet; false when it cannot pay. */
function chargeNpcGas(state: SaveState, owner: SunOwner, gasCost: number): SaveState | null {
  if (!owner.autonomous || gasCost === 0) return state;
  const target = getEspionageTargets(state.espionage)[owner.planetId];
  if (!target || !state.espionage || target.resources.gas < gasCost) return null;
  const targets = { ...getEspionageTargets(state.espionage), [target.id]: { ...target, resources: { ...target.resources, gas: target.resources.gas - gasCost } } };
  return { ...state, espionage: { ...state.espionage, targets } };
}

function ownerHasPlanetInGalaxy(state: SaveState, owner: SunOwner, galaxy: number): boolean {
  if (owner.ownerSide === 'player') return Object.values(state.planets).some((planet) => (planet.universeGalaxy ?? 1) === galaxy);
  return Object.values(getEspionageTargets(state.espionage)).some((target) => target.ownerId === owner.ownerId && target.coordinate.galaxy === galaxy);
}

/* ------------------------------------------------------------ launch rules */

/** Raid ids stay short enough for the save (NPC request ids are long JSON keys). */
function raidIdFor(requestId: string): string {
  if (requestId.length <= 100) return `sun-raid-${requestId}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < requestId.length; index += 1) hash = Math.imul(hash ^ requestId.charCodeAt(index), 16_777_619) >>> 0;
  return `sun-raid-npc-${hash.toString(36)}-${requestId.length}`;
}

export type RaidLaunchInput = { galaxy: number; system: number; originPlanetId: string; ships: Partial<Record<ShipId, number>>; commanders?: Partial<Record<CommanderId, number>>; requestId: string };

/**
 * Starts a command raid: the alliance leadership sends the first fleet from
 * «Операции». The battle happens when this fleet arrives (3 h later).
 */
export function launchSunRaid(state: SaveState, input: RaidLaunchInput, options: SunRuntimeOptions): SunActionResult {
  const owner = playerOwner(state, input.originPlanetId);
  if (!owner) return { ok: false, state, error: 'Планета отправления не найдена.' };
  return launchRaidFor(state, owner, input, options);
}

/** Population an owner already pledged to a raid, over all of its planets. */
export function ownerRaidPledge(state: SaveState, raidId: string, ownerId: string): number {
  return flightsOfRaid(state, raidId, 'attacker')
    .filter((flight) => flight.sunRaid?.ownerId === ownerId && ACTIVE_PHASES.has(flight.phase))
    .reduce((total, flight) => total + (flight.sunRaid?.population ?? 0), 0);
}

/** Room left for one more pledge: the participant's 75 000 and the side's 225 000. */
export function raidPledgeRoom(state: SaveState, raid: SunRaidRecord, ownerId: string): number {
  const committed = selectRaidSides(state, raid.id).attackers.population;
  return Math.max(0, Math.min(SUN_RAID_CONFIG.participantPopulationCap - ownerRaidPledge(state, raid.id, ownerId),
    SUN_RAID_CONFIG.populationCapPerSide - committed));
}

/**
 * Puts one participant's ships into a gathering raid: they leave the planet
 * and wait for the launch; gas is paid now and returned if the raid disbands.
 */
function pledgeToRaid(state: SaveState, owner: SunOwner, raid: SunRaidRecord, ships: Partial<Record<ShipId, number>>,
  commanders: Partial<Record<CommanderId, number>>, requestId: string, options: SunRuntimeOptions): { ok: true; state: SaveState; flight: FlightRecord } | { ok: false; error: string } {
  const population = sunFleetPopulation(ships, owner.factionId, commanders);
  if (population <= 0) return { ok: false, error: 'Выберите боевые корабли для рейда.' };
  const room = raidPledgeRoom(state, raid, owner.ownerId);
  if (population > room) {
    return { ok: false, error: `Свободно ${room.toLocaleString('ru-RU')} населения: один участник вносит не больше ${SUN_RAID_CONFIG.participantPopulationCap.toLocaleString('ru-RU')}, рейд — ровно ${SUN_RAID_CONFIG.populationCapPerSide.toLocaleString('ru-RU')}.` };
  }
  const shipError = validateShips(owner, ships, commanders);
  if (shipError) return { ok: false, error: shipError };
  const created = createSunFlight(owner, {
    missionId: 'sun-attack', raidId: raid.id, galaxy: raid.galaxy, system: raid.system, ships, commanders,
    requestId, departedAt: options.now, allianceId: raid.allianceId,
  }, options);
  // Until the gathering is full the fleet waits: its arrival is only provisional.
  const flight: FlightRecord = { ...created, arrivalAt: (raid.gatherEndsAt ?? options.now) + created.oneWayDurationMs };
  let next: SaveState = state;
  if (owner.ownerSide === 'player') {
    const resources = getPlanetResources(next, owner.planetId);
    if (resources.gas < flight.gasCost) return { ok: false, error: `Недостаточно газа: нужно ${flight.gasCost.toLocaleString('ru-RU')}.` };
    next = replacePlanetResources(next, owner.planetId, { ...resources, gas: resources.gas - flight.gasCost });
  }
  if (owner.autonomous) {
    const charged = chargeNpcGas(next, owner, flight.gasCost);
    if (!charged) return { ok: false, error: 'Недостаточно газа.' };
    next = charged;
  }
  next = { ...next, flights: appendFlight(next.flights, flight) };
  next = detachNpcShips(next, owner, ships, -1);
  return { ok: true, state: next, flight };
}

/** The gathering holds the full side: every pledged fleet takes off together now. */
function launchIfGathered(state: SaveState, raidId: string, at: number): SaveState {
  const sunRaid = currentSunRaidState(state);
  const raid = sunRaid.raids.find((item) => item.id === raidId);
  if (!raid || raid.status !== 'gathering') return state;
  const committed = selectRaidSides(state, raid.id).attackers.population;
  if (committed < SUN_RAID_CONFIG.populationCapPerSide - SUN_RAID_CONFIG.raidLaunchTolerance) return state;
  const pledged = flightsOfRaid(state, raid.id, 'attacker').filter((flight) => flight.phase === 'outbound');
  const oneWay = pledged[0]?.oneWayDurationMs ?? 0;
  const arrivesAt = at + oneWay;
  const ids = new Set(pledged.map((flight) => flight.id));
  const records = state.flights.records.map((flight) => ids.has(flight.id) ? { ...flight, departedAt: at, arrivalAt: arrivesAt } : flight);
  const participants = new Set(pledged.map((flight) => flight.sunRaid?.ownerId)).size;
  const event: SunRaidEvent = {
    id: `${raid.id}:launched`, at, kind: 'raid-launched', galaxy: raid.galaxy, system: raid.system,
    text: `[${raid.allianceTag}] рейд на Солнце ${formatSun(raid.galaxy, raid.system)} собран (${participants} участн., ${committed.toLocaleString('ru-RU')}) и вылетел.`,
  };
  return withSunRaid({ ...state, flights: { ...state.flights, records } }, appendSunEvents({
    ...sunRaid, raids: sunRaid.raids.map((item) => item.id === raid.id ? { ...raid, status: 'incoming' as const, arrivesAt } : item),
  }, [event]));
}

/** Not full in 30 minutes: the raid disbands, every ship and its gas go back. */
function disbandRaid(state: SaveState, raid: SunRaidRecord, at: number): SaveState {
  let next = state;
  for (const flight of flightsOfRaid(state, raid.id, 'attacker').filter((item) => item.phase === 'outbound')) {
    const owner = ownerOfFlight(next, flight);
    if (owner) {
      next = detachNpcShips(next, owner, flight.selectedShips, 1);
      if (owner.autonomous && flight.gasCost > 0) next = chargeNpcGas(next, owner, -flight.gasCost) ?? next;
    } else if ((flight.ownerSide === undefined || flight.ownerSide === 'player') && next.planets[flight.originPlanetId] && flight.gasCost > 0) {
      const resources = getPlanetResources(next, flight.originPlanetId);
      next = replacePlanetResources(next, flight.originPlanetId, { ...resources, gas: resources.gas + flight.gasCost });
    }
    next = { ...next, flights: { ...next.flights, records: next.flights.records.map((item) => item.id === flight.id
      ? { ...item, phase: 'completed' as const, completedAt: at, completionReason: 'recalled' as const } : item) } };
  }
  const sunRaid = currentSunRaidState(next);
  const event: SunRaidEvent = {
    id: `${raid.id}:disbanded`, at, kind: 'raid-defended', galaxy: raid.galaxy, system: raid.system,
    text: `[${raid.allianceTag}] сбор рейда на Солнце ${formatSun(raid.galaxy, raid.system)} не набрал ${SUN_RAID_CONFIG.populationCapPerSide.toLocaleString('ru-RU')} — рейд распущен.`,
  };
  return withSunRaid(next, appendSunEvents({
    ...sunRaid, raids: sunRaid.raids.map((item) => item.id === raid.id ? { ...raid, status: 'disbanded' as const, closedAt: at } : item),
  }, [event]));
}

function launchRaidFor(state: SaveState, owner: SunOwner, input: RaidLaunchInput, options: SunRuntimeOptions): SunActionResult {
  const sunRaid = currentSunRaidState(state);
  const existing = state.flights.records.find((flight) => flight.requestId === input.requestId);
  if (existing) return { ok: true, state, notice: 'Рейд уже объявлен.', raidId: existing.sunRaid?.raidId, flightId: existing.id };
  const membership = allianceOf(state, owner.ownerId);
  const ships = normalizeSelection(input.ships);
  const commanders = normalizeCommanders(input.commanders);
  const population = sunFleetPopulation(ships, owner.factionId, commanders);
  const check = checkRaidLaunch({
    state: sunRaid,
    allianceId: membership?.alliance.id ?? null,
    role: membership?.role ?? null,
    galaxy: input.galaxy,
    system: input.system,
    population,
    now: options.now,
  });
  if (!check.ok) return { ok: false, state, error: check.message };
  const alliance = membership!.alliance;
  const raidId = raidIdFor(input.requestId);
  const gatherEndsAt = options.now + scaleSunDuration(SUN_RAID_CONFIG.raidGatherMs, options);
  const raid: SunRaidRecord = {
    id: raidId,
    galaxy: input.galaxy,
    system: input.system,
    allianceId: alliance.id,
    allianceName: alliance.name,
    allianceTag: alliance.tag,
    initiatorOwnerId: owner.ownerId,
    initiatorName: owner.ownerName,
    launchedAt: options.now,
    arrivesAt: gatherEndsAt + scaleSunDuration(SUN_RAID_CONFIG.flightOneWayMs, options),
    status: 'gathering',
    gatherEndsAt,
  };
  const event: SunRaidEvent = {
    id: `${raidId}:declared`, at: options.now, kind: 'raid-launched', galaxy: input.galaxy, system: input.system,
    text: `[${alliance.tag}] ${owner.ownerName} объявил сбор рейда на Солнце ${formatSun(input.galaxy, input.system)}: 30 мин на ${SUN_RAID_CONFIG.populationCapPerSide.toLocaleString('ru-RU')} населения.`,
  };
  const declared = withSunRaid(state, appendSunEvents({ ...sunRaid, raids: [...sunRaid.raids, raid] }, [event]));
  const pledge = pledgeToRaid(declared, owner, raid, ships, commanders, input.requestId, options);
  if (!pledge.ok) return { ok: false, state, error: pledge.error };
  return {
    ok: true,
    state: launchIfGathered(pledge.state, raidId, options.now),
    notice: `Сбор рейда на Солнце ${formatSun(input.galaxy, input.system)} объявлен: 30 мин, нужно ${SUN_RAID_CONFIG.populationCapPerSide.toLocaleString('ru-RU')} населения от союза (до ${SUN_RAID_CONFIG.participantPopulationCap.toLocaleString('ru-RU')} от каждого).`,
    raidId,
    flightId: pledge.flight.id,
  };
}

export type RaidJoinInput = { raidId: string; originPlanetId: string; ships: Partial<Record<ShipId, number>>; commanders?: Partial<Record<CommanderId, number>>; requestId: string };

/** A member of the raiding alliance adds ships from one of its planets to the gathering. */
function joinRaidFor(state: SaveState, owner: SunOwner, input: RaidJoinInput, options: SunRuntimeOptions): SunActionResult {
  const existing = state.flights.records.find((flight) => flight.requestId === input.requestId);
  if (existing) return { ok: true, state, notice: 'Флот уже в сборе.', raidId: existing.sunRaid?.raidId, flightId: existing.id };
  const raid = currentSunRaidState(state).raids.find((item) => item.id === input.raidId);
  if (!raid || raid.status !== 'gathering' || (raid.gatherEndsAt ?? 0) <= options.now) return { ok: false, state, error: 'Сбор этого рейда уже закрыт.' };
  if (allianceOf(state, owner.ownerId)?.alliance.id !== raid.allianceId) return { ok: false, state, error: 'В рейд вступают только участники союза, который его объявил.' };
  const pledge = pledgeToRaid(state, owner, raid, normalizeSelection(input.ships), normalizeCommanders(input.commanders), input.requestId, options);
  if (!pledge.ok) return { ok: false, state, error: pledge.error };
  const next = launchIfGathered(pledge.state, raid.id, options.now);
  const launched = currentSunRaidState(next).raids.find((item) => item.id === raid.id)?.status === 'incoming';
  return {
    ok: true,
    state: next,
    raidId: raid.id,
    flightId: pledge.flight.id,
    notice: launched
      ? `Рейд на Солнце ${formatSun(raid.galaxy, raid.system)} собран и вылетел. Прибытие через 3 ч.`
      : `${owner.ownerName}: флот вступил в сбор рейда на Солнце ${formatSun(raid.galaxy, raid.system)}.`,
  };
}

/** The player joins the gathering raid of its alliance from one of its planets. */
export function joinSunRaid(state: SaveState, input: RaidJoinInput, options: SunRuntimeOptions): SunActionResult {
  const owner = playerOwner(state, input.originPlanetId);
  if (!owner) return { ok: false, state, error: 'Планета отправления не найдена.' };
  return joinRaidFor(state, owner, input, options);
}

/** An autonomous NPC member joins the gathering raid of its alliance. */
export function joinNpcSunRaid(state: SaveState, ownerId: string, input: RaidJoinInput, options: SunRuntimeOptions): SunActionResult {
  const owner = sunOwnerForNpcPlanet(state, ownerId, input.originPlanetId);
  if (!owner) return { ok: false, state, error: 'Планета отправления не найдена.' };
  return joinRaidFor(state, owner, input, options);
}

/** An autonomous NPC leader or deputy declares a raid from one of its planets, by the player's rules. */
export function launchNpcSunRaid(state: SaveState, ownerId: string, input: RaidLaunchInput, options: SunRuntimeOptions): SunActionResult {
  const owner = sunOwnerForNpcPlanet(state, ownerId, input.originPlanetId);
  if (!owner) return { ok: false, state, error: 'Планета отправления не найдена.' };
  return launchRaidFor(state, owner, input, options);
}

export type SupportInput = { raidId: string; originPlanetId: string; ships: Partial<Record<ShipId, number>>; commanders?: Partial<Record<CommanderId, number>>; requestId: string; departedAt?: number };

function supportCheckDetailed(state: SaveState, owner: SunOwner, raid: SunRaidRecord | undefined, ships: Partial<Record<ShipId, number>>, options: SunRuntimeOptions, fixture: boolean, commanders: Partial<Record<CommanderId, number>> = {}): SunFailure | null {
  if (!raid || raid.status !== 'incoming') return { code: 'target-not-available', message: 'Входящей атаки на это Солнце уже нет.' };
  const membership = allianceOf(state, owner.ownerId);
  if (membership?.alliance.id === raid.allianceId) return { code: 'target-not-available', message: 'Нельзя защищать Солнце от рейда собственного союза.' };
  if (!fixture && !ownerHasPlanetInGalaxy(state, owner, raid.galaxy)) {
    return { code: 'target-not-available', message: 'Защищать Солнце может только владелец планеты в этой галактике.' };
  }
  const population = sunFleetPopulation(ships, owner.factionId, commanders);
  if (population <= 0) return { code: 'wrong-ship-composition', message: 'Выберите боевые корабли для защиты.' };
  const committed = selectRaidSides(state, raid.id).defenders.population;
  const remaining = SUN_RAID_CONFIG.populationCapPerSide - committed;
  if (population > remaining) {
    return { code: 'capacity-exceeded', message: `Лимит защиты — ${SUN_RAID_CONFIG.populationCapPerSide.toLocaleString('ru-RU')}: свободно ${Math.max(0, remaining).toLocaleString('ru-RU')} населения.` };
  }
  const preview = createSunFlight(owner, {
    missionId: 'sun-support', raidId: raid.id, galaxy: raid.galaxy, system: raid.system, ships, commanders,
    requestId: 'preview', departedAt: options.now, allianceId: null,
  }, options);
  if (preview.arrivalAt > raid.arrivesAt) return { code: 'target-not-available', message: 'Флот не успеет: он прибудет позже атакующих.' };
  return null;
}

function supportCheck(state: SaveState, owner: SunOwner, raid: SunRaidRecord | undefined, ships: Partial<Record<ShipId, number>>, options: SunRuntimeOptions, fixture: boolean, commanders: Partial<Record<CommanderId, number>> = {}): string | null {
  return supportCheckDetailed(state, owner, raid, ships, options, fixture, commanders)?.message ?? null;
}

/** «Поддержка солнца»: any owner of a planet in the Sun's galaxy, regardless of alliance. */
export function sendSunSupport(state: SaveState, input: SupportInput, options: SunRuntimeOptions): SunActionResult {
  const owner = playerOwner(state, input.originPlanetId);
  if (!owner) return { ok: false, state, error: 'Планета отправления не найдена.', code: 'invalid-command' };
  return sendSupportFor(state, owner, input, options, false);
}

/** An autonomous NPC sends «Поддержка солнца» from one of its planets, by the player's rules. */
export function sendNpcSunSupport(state: SaveState, ownerId: string, input: SupportInput, options: SunRuntimeOptions): SunActionResult {
  const owner = sunOwnerForNpcPlanet(state, ownerId, input.originPlanetId);
  if (!owner) return { ok: false, state, error: 'Планета отправления не найдена.', code: 'invalid-command' };
  return sendSupportFor(state, owner, input, options, false);
}

function sendSupportFor(state: SaveState, owner: SunOwner, input: SupportInput, options: SunRuntimeOptions, fixture: boolean): SunActionResult {
  const existing = state.flights.records.find((flight) => flight.requestId === input.requestId);
  if (existing) return { ok: true, state, notice: 'Флот поддержки уже отправлен.', flightId: existing.id };
  const sunRaid = currentSunRaidState(state);
  const raid = sunRaid.raids.find((item) => item.id === input.raidId);
  const ships = normalizeSelection(input.ships);
  const commanders = normalizeCommanders(input.commanders);
  const shipError = validateShipsDetailed(owner, ships, commanders);
  if (shipError) return { ok: false, state, error: shipError.message, code: shipError.code };
  const departedAt = input.departedAt ?? options.now;
  const error = supportCheckDetailed(state, owner, raid, ships, { ...options, now: departedAt }, fixture, commanders);
  if (error) return { ok: false, state, error: error.message, code: error.code };
  const membership = allianceOf(state, owner.ownerId);
  const flight = createSunFlight(owner, {
    missionId: 'sun-support', raidId: raid!.id, galaxy: raid!.galaxy, system: raid!.system, ships, commanders,
    requestId: input.requestId, departedAt, allianceId: membership?.alliance.id ?? null,
  }, options);
  let next: SaveState = { ...state, flights: appendFlight(state.flights, flight) };
  if (owner.ownerSide === 'player') {
    const resources = getPlanetResources(next, owner.planetId);
    if (resources.gas < flight.gasCost) return { ok: false, state, error: `Недостаточно газа: нужно ${flight.gasCost.toLocaleString('ru-RU')}.`, code: 'insufficient-gas' };
    next = replacePlanetResources(next, owner.planetId, { ...resources, gas: resources.gas - flight.gasCost });
  }
  if (owner.autonomous) {
    const charged = chargeNpcGas(next, owner, flight.gasCost);
    if (!charged) return { ok: false, state, error: 'Недостаточно газа.', code: 'insufficient-gas' };
    next = charged;
  }
  next = detachNpcShips(next, owner, ships, -1);
  return { ok: true, state: next, notice: `${owner.ownerName}: флот поддержки летит к Солнцу ${formatSun(raid!.galaxy, raid!.system)}.`, flightId: flight.id };
}

export type SunLaunchPreview = {
  population: number;
  cap: number;
  committed: number;
  remaining: number;
  oneWayMs: number;
  arrivesAt: number;
  gasCost: number;
  error: string | null;
};

/** Live numbers of the launch dialog: population counter, travel time, fuel and the blocking reason. */
export function previewSunLaunch(
  state: SaveState,
  input: { kind: 'attack' | 'support' | 'join'; galaxy: number; system: number; raidId?: string; originPlanetId: string; ships: Partial<Record<ShipId, number>>; commanders?: Partial<Record<CommanderId, number>> },
  options: SunRuntimeOptions,
): SunLaunchPreview {
  const owner = playerOwner(state, input.originPlanetId);
  const ships = normalizeSelection(input.ships);
  const commanders = normalizeCommanders(input.commanders);
  const cap = SUN_RAID_CONFIG.populationCapPerSide;
  if (!owner) return { population: 0, cap, committed: 0, remaining: cap, oneWayMs: 0, arrivesAt: options.now, gasCost: 0, error: 'Планета отправления не найдена.' };
  const population = sunFleetPopulation(ships, owner.factionId, commanders);
  const raid = input.raidId ? currentSunRaidState(state).raids.find((item) => item.id === input.raidId) : undefined;
  const committed = input.kind === 'support' && raid ? selectRaidSides(state, raid.id).defenders.population
    : input.kind === 'join' && raid ? selectRaidSides(state, raid.id).attackers.population : 0;
  // A participant's own room in a raid: its 75 000 and what the gathering still needs.
  const ownRoom = input.kind === 'attack' ? SUN_RAID_CONFIG.participantPopulationCap
    : input.kind === 'join' && raid ? raidPledgeRoom(state, raid, owner.ownerId) : Math.max(0, cap - committed);
  const flight = Object.keys(ships).length || Object.keys(commanders).length
    ? createSunFlight(owner, {
      missionId: input.kind === 'support' ? 'sun-support' : 'sun-attack', raidId: raid?.id ?? 'preview',
      galaxy: input.galaxy, system: input.system, ships, commanders, requestId: 'preview', departedAt: options.now, allianceId: null,
    }, options)
    : null;
  let error = validateShips(owner, ships, commanders);
  if (!error && input.kind === 'attack') {
    const membership = allianceOf(state, owner.ownerId);
    const check = checkRaidLaunch({
      state: currentSunRaidState(state), allianceId: membership?.alliance.id ?? null, role: membership?.role ?? null,
      galaxy: input.galaxy, system: input.system, population, now: options.now,
    });
    error = check.ok ? null : check.message;
  }
  if (!error && input.kind === 'support') error = supportCheck(state, owner, raid, ships, options, false, commanders);
  if (!error && input.kind === 'join') {
    if (!raid || raid.status !== 'gathering' || (raid.gatherEndsAt ?? 0) <= options.now) error = 'Сбор этого рейда уже закрыт.';
    else if (allianceOf(state, owner.ownerId)?.alliance.id !== raid.allianceId) error = 'В рейд вступают только участники союза, который его объявил.';
    else if (population > ownRoom) error = `Свободно ${ownRoom.toLocaleString('ru-RU')} населения: один участник вносит не больше ${SUN_RAID_CONFIG.participantPopulationCap.toLocaleString('ru-RU')}.`;
  }
  if (!error && flight && getPlanetResources(state, owner.planetId).gas < flight.gasCost) error = `Недостаточно газа: нужно ${flight.gasCost.toLocaleString('ru-RU')}.`;
  const oneWayMs = input.kind !== 'support'
    ? scaleSunDuration(SUN_RAID_CONFIG.flightOneWayMs, options)
    : flight?.oneWayDurationMs ?? 0;
  return {
    population,
    cap,
    committed,
    remaining: Math.max(0, Math.min(ownRoom, cap - committed)),
    oneWayMs,
    arrivesAt: options.now + oneWayMs,
    gasCost: flight?.gasCost ?? 0,
    error,
  };
}

/* -------------------------------------------------------------- resolution */

type SideParticipant = { flight: FlightRecord; snapshot: SunFlightSnapshot; population: number };

function sideInput(participants: readonly SideParticipant[]) {
  const stacks = new Map<ShipId, number>();
  for (const { flight } of participants) {
    for (const [id, count] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
      if (safeCount(count) > 0) stacks.set(id, (stacks.get(id) ?? 0) + safeCount(count));
    }
  }
  const lead = [...participants].sort((left, right) => right.population - left.population || left.flight.id.localeCompare(right.flight.id))[0];
  const factionId = lead?.snapshot.factionId ?? 'aegis';
  const levels = mergeSideShipLevels(participants.map((item) => item.snapshot.shipLevels));
  const technologies = mergeSideTechnologies(participants.map((item) => item.snapshot.technologies));
  const catalog = new Set(getFactionShipCatalog(factionId).map((entity) => entity.id));
  const ships: CombatStackInput[] = [...stacks.entries()]
    .filter(([id]) => catalog.has(id))
    .sort(([left], [right]) => SHIP_IDS.indexOf(left) - SHIP_IDS.indexOf(right))
    .map(([id, count]) => ({ entityId: id, count, level: levels[id] ?? 0 }));
  // Commander ships: one per commander type, the highest level sent by any participant
  // fights; the highest-level commander overall leads the side and heads the priority.
  const commanderSources = new Map<CommanderId, { level: number; flightId: string }>();
  for (const { flight, snapshot } of participants) {
    for (const id of Object.keys(flight.selectedCommanders ?? {}) as CommanderId[]) {
      if (safeCount(flight.selectedCommanders?.[id]) <= 0) continue;
      const level = Math.max(0, Math.floor(snapshot.commanderLevels?.[id] ?? 0));
      const known = commanderSources.get(id);
      if (!known || level > known.level || (level === known.level && flight.id < known.flightId)) commanderSources.set(id, { level, flightId: flight.id });
    }
  }
  const commanders: CombatStackInput[] = [...commanderSources.entries()]
    .sort(([leftId, left], [rightId, right]) => right.level - left.level || COMMANDER_IDS.indexOf(leftId) - COMMANDER_IDS.indexOf(rightId))
    .map(([id, source]) => ({ entityId: id, count: 1, level: source.level }));
  const priority = commanders.map((stack) => stack.entityId as CommanderId);
  return { lead, factionId, technologies, ships, commanders, commanderSources, priority };
}

function sidePriority(priority: readonly CommanderId[], fallback: readonly CommanderId[]): CommanderId[] {
  return [...priority, ...fallback.filter((id) => !priority.includes(id))];
}

/** Splits the destroyed hulls of a merged stack back to each fleet (largest remainder, stable order). */
function commanderLosses(participants: readonly SideParticipant[], force: BattleForceSnapshot, sources: ReadonlyMap<CommanderId, { flightId: string }>): Map<string, Partial<Record<CommanderId, number>>> {
  const survivors = new Map(participants.map((item) => [item.flight.id, normalizeCommanders(item.flight.selectedCommanders)]));
  for (const stack of force.stacks) {
    const id = stack.entityId as CommanderId;
    if (!COMMANDER_IDS.includes(id) || safeCount(stack.destroyed) <= 0) continue;
    const source = sources.get(id);
    const owned = source ? survivors.get(source.flightId) : undefined;
    if (owned) delete owned[id];
  }
  return survivors;
}

function distributeLosses(participants: readonly SideParticipant[], force: BattleForceSnapshot): Map<string, Partial<Record<ShipId, number>>> {
  const survivors = new Map(participants.map((item) => [item.flight.id, { ...item.flight.selectedShips } as Partial<Record<ShipId, number>>]));
  for (const stack of force.stacks) {
    if (COMMANDER_IDS.includes(stack.entityId as CommanderId)) continue;
    const id = stack.entityId as ShipId;
    let destroyed = safeCount(stack.destroyed);
    if (!destroyed) continue;
    const holders = participants.filter((item) => safeCount(item.flight.selectedShips[id]) > 0);
    const total = holders.reduce((sum, item) => sum + safeCount(item.flight.selectedShips[id]), 0);
    if (!total) continue;
    const shares = holders.map((item) => {
      const exact = (destroyed * safeCount(item.flight.selectedShips[id])) / total;
      return { id: item.flight.id, floor: Math.floor(exact), remainder: exact - Math.floor(exact), max: safeCount(item.flight.selectedShips[id]) };
    });
    let left = destroyed - shares.reduce((sum, share) => sum + share.floor, 0);
    for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id))) {
      if (left <= 0) break;
      if (share.floor < share.max) { share.floor += 1; left -= 1; }
    }
    for (const share of shares) {
      const ships = survivors.get(share.id)!;
      ships[id] = Math.max(0, safeCount(ships[id]) - Math.min(share.max, share.floor));
    }
    destroyed = 0;
  }
  for (const [flightId, ships] of survivors) survivors.set(flightId, normalizeSelection(ships));
  return survivors;
}

function applyPlayerLosses(state: SaveState, flight: FlightRecord, survivors: Partial<Record<ShipId, number>>, survivingCommanders: Partial<Record<CommanderId, number>> = {}): SaveState {
  if (flight.ownerSide !== undefined && flight.ownerSide !== 'player') return state;
  const planet = state.planets[flight.originPlanetId];
  if (!planet) return state;
  const ships = { ...planet.fleet.ships };
  for (const [id, count] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
    const lost = Math.max(0, safeCount(count) - safeCount(survivors[id]));
    if (lost) ships[id] = Math.max(0, safeCount(ships[id]) - lost);
  }
  const commanders = { ...planet.fleet.commanders };
  for (const id of Object.keys(normalizeCommanders(flight.selectedCommanders)) as CommanderId[]) {
    if (!survivingCommanders[id]) commanders[id] = Math.max(0, safeCount(commanders[id]) - 1);
  }
  return replacePlanetState(state, flight.originPlanetId, { ...planet, fleet: { ...planet.fleet, ships, commanders } });
}

function participantLabel(participants: readonly SideParticipant[], fallback: string): string {
  const names = [...new Set(participants.map((item) => item.snapshot.ownerName))];
  if (!names.length) return fallback;
  return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`;
}

function worldSeed(state: SaveState): string {
  return state.worldConfig?.seed ?? 'LEGACY01';
}

function playerHolders(state: SaveState): CrystalHolder[] {
  const membership = allianceOf(state, state.profile.playerId);
  return [
    { kind: 'owner', id: state.profile.playerId },
    ...(membership ? [{ kind: 'alliance' as const, id: membership.alliance.id }] : []),
  ];
}

/** Resolves one raid at its battle moment. Idempotent: a resolved raid is never fought again. */
function resolveRaid(state: SaveState, raid: SunRaidRecord, at: number, options: SunRuntimeOptions, notices: SunRaidNotice[]): SaveState {
  const toParticipant = (flight: FlightRecord): SideParticipant => ({ flight, snapshot: flight.sunRaid!, population: sunFleetPopulation(flight.selectedShips, flight.sunRaid!.factionId, flight.selectedCommanders) });
  const attackers = flightsOfRaid(state, raid.id, 'attacker')
    .filter((flight) => (flight.phase === 'outbound' || flight.phase === 'arrived') && flight.arrivalAt <= at)
    .map(toParticipant);
  const defenders = flightsOfRaid(state, raid.id, 'defender')
    .filter((flight) => flight.phase === 'arrived' && (flight.arrivedAt ?? flight.arrivalAt) <= at)
    .map(toParticipant);
  let sunRaid = currentSunRaidState(state);
  const sun = readSun(sunRaid, raid.galaxy, raid.system);
  const before = projectSun(sun, at).brightness;
  const sunLabel = formatSun(raid.galaxy, raid.system);
  const playerId = state.profile.playerId;
  const playerInvolved = [...attackers, ...defenders].some((item) => item.snapshot.ownerId === playerId)
    || allianceOf(state, playerId)?.alliance.id === raid.allianceId;

  if (!attackers.length) {
    const resolved: SunRaidRecord = {
      ...raid, status: 'resolved', closedAt: at,
      result: { winner: 'defender', resolvedAt: at, brightnessBefore: before, brightnessAfter: before, frozen: false, attackerPopulation: 0, defenderPopulation: 0, defenders: defenders.length },
    };
    sunRaid = { ...sunRaid, raids: sunRaid.raids.map((item) => item.id === raid.id ? resolved : item) };
    let next = withSunRaid(state, sunRaid);
    next = releaseFlights(next, defenders.map((item) => item.flight), at, null);
    return next;
  }

  const attack = sideInput(attackers);
  const defense = sideInput(defenders);
  // The local player represents their side in the report (mail, battle points, «my battle» filters).
  const playerAttacks = attackers.some((item) => item.snapshot.ownerId === playerId) || allianceOf(state, playerId)?.alliance.id === raid.allianceId;
  const playerDefends = defenders.some((item) => item.snapshot.ownerId === playerId);
  const input: CombatInput = {
    scenarioId: `sun-raid:${raid.id}`,
    timestamp: new Date(at).toISOString(),
    seed: `sun-raid:${worldSeed(state)}:${raid.id}`,
    profileId: 'asterion-attack-v1',
    maxRounds: SUN_RAID_CONFIG.maxRounds,
    attackerPriority: sidePriority(attack.priority, DEFAULT_COMBAT_PRIORITY.attack),
    defenderPriority: sidePriority(defense.priority, DEFAULT_COMBAT_PRIORITY.defense),
    attackerTechnologies: attack.technologies,
    defenderTechnologies: defense.technologies,
    technologyMode: 'independent',
    executionMode: 'production',
    attacker: {
      participant: {
        side: 'attacker', playerId: playerAttacks ? playerId : raid.initiatorOwnerId,
        playerName: `[${raid.allianceTag}] ${participantLabel(attackers, raid.initiatorName)}`,
        planetName: `Рейд на Солнце ${sunLabel}`,
        coordinates: sunLabel, race: getCombatFactionName(attack.factionId),
      },
      factionId: attack.factionId, ships: attack.ships, commanders: attack.commanders,
      commander: attack.commanders[0] ?? null,
      activeCommanderId: (attack.commanders[0]?.entityId as CommanderId | undefined) ?? null,
    },
    defender: {
      participant: {
        side: 'defender', playerId: playerDefends ? playerId : defense.lead?.snapshot.ownerId ?? `sun:${raid.galaxy}:${raid.system}`,
        playerName: participantLabel(defenders, 'Солнце без защиты'),
        planetName: `Солнце ${sunLabel}`,
        coordinates: sunLabel, race: getCombatFactionName(defense.factionId),
      },
      factionId: defense.factionId, ships: defense.ships, commanders: defense.commanders,
      commander: defense.commanders[0] ?? null,
      activeCommanderId: (defense.commanders[0]?.entityId as CommanderId | undefined) ?? null,
    },
  };
  const reportId = `battle-sun-${raid.id}`;
  const report = resolveCombat(input, { reportId, missionType: 'attack', allowPopulationOverflow: true });
  const attackerSurvivors = distributeLosses(attackers, report.attackerForce);
  const defenderSurvivors = distributeLosses(defenders, report.defenderForce);
  const attackerCommanderSurvivors = commanderLosses(attackers, report.attackerForce, attack.commanderSources);
  const defenderCommanderSurvivors = commanderLosses(defenders, report.defenderForce, defense.commanderSources);
  const winner = report.winner;
  // Debris of a Sun battle drift at the Sun (position 0), by the common battle
  // scrap rule (25–35% of destroyed life, one roll per battle).
  const debris = Math.max(0, Math.floor(calculateAttackDebris(report, attack.factionId, defense.factionId, battleDebrisRoll(reportId))));

  // Sun and crystal outcome.
  const holder: CrystalHolder = { kind: 'alliance', id: raid.allianceId };
  let after = before;
  let frozen = false;
  let crystalRoll: NonNullable<SunRaidRecord['result']>['crystalRoll'] = undefined;
  const events: SunRaidEvent[] = [];
  if (winner === 'attacker') {
    const dimmed = applyRaidVictoryToSun(sun, at, scaleSunDuration(SUN_RAID_CONFIG.recoverStepMs, options));
    sunRaid = { ...sunRaid, suns: { ...sunRaid.suns, [sunKey(raid.galaxy, raid.system)]: dimmed } };
    after = projectSun(dimmed, at).brightness;
    frozen = projectSun(dimmed, at).frozen;
    const roll = rollCrystal(`${worldSeed(state)}:${raid.id}`, getHolderCrystals(sunRaid, holder));
    crystalRoll = roll;
    if (roll.success && roll.crystal) sunRaid = addCrystal(sunRaid, holder, roll.crystal);
    events.push({ id: `${raid.id}:won`, at, kind: 'raid-won', galaxy: raid.galaxy, system: raid.system, text: `[${raid.allianceTag}] победил у Солнца ${sunLabel}: яркость ${before}% → ${after}%.` });
    events.push(roll.success && roll.crystal
      ? { id: `${raid.id}:crystal`, at, kind: 'crystal-found', galaxy: raid.galaxy, system: raid.system, text: `[${raid.allianceTag}] получил ${SOLAR_CRYSTALS[roll.crystal].name}.` }
      : { id: `${raid.id}:crystal`, at, kind: 'crystal-missed', galaxy: raid.galaxy, system: raid.system, text: roll.skipped ? `[${raid.allianceTag}]: все четыре кристалла уже собраны.` : `[${raid.allianceTag}]: кристалл не выпал (шанс ${Math.round(roll.chance * 100)}%).` });
    if (frozen) events.push({ id: `${raid.id}:frozen`, at, kind: 'sun-frozen', galaxy: raid.galaxy, system: raid.system, text: `Солнце ${sunLabel} заморожено и восстанавливается.` });
  } else {
    events.push({ id: `${raid.id}:defended`, at, kind: 'raid-defended', galaxy: raid.galaxy, system: raid.system, text: `Солнце ${sunLabel} выстояло против [${raid.allianceTag}].` });
  }
  const result = {
    winner,
    resolvedAt: at,
    brightnessBefore: before,
    brightnessAfter: after,
    frozen,
    attackerPopulation: attackers.reduce((sum, item) => sum + item.population, 0),
    defenderPopulation: defenders.reduce((sum, item) => sum + item.population, 0),
    defenders: new Set(defenders.map((item) => item.snapshot.ownerId)).size,
    ...(crystalRoll ? { crystalRoll } : {}),
    ...(playerInvolved ? { reportId } : {}),
  };
  sunRaid = appendSunEvents({ ...sunRaid, raids: sunRaid.raids.map((item) => item.id === raid.id ? { ...raid, status: 'resolved' as const, result } : item) }, events);

  let next = withSunRaid(state, sunRaid);
  for (const item of [...attackers, ...defenders]) {
    const survivors = (item.snapshot.side === 'attacker' ? attackerSurvivors : defenderSurvivors).get(item.flight.id) ?? {};
    const survivingCommanders = (item.snapshot.side === 'attacker' ? attackerCommanderSurvivors : defenderCommanderSurvivors).get(item.flight.id) ?? {};
    next = applyPlayerLosses(next, item.flight, survivors, survivingCommanders);
    next = { ...next, flights: { ...next.flights, records: next.flights.records.map((flight) => flight.id === item.flight.id ? { ...flight, selectedShips: survivors, selectedCommanders: survivingCommanders } : flight) } };
  }
  if (debris > 0 && next.espionage) {
    const key = sunDebrisLedgerKey(raid.galaxy, raid.system);
    const previous = next.espionage.orbitalDebris?.[key];
    next = {
      ...next,
      espionage: {
        ...next.espionage,
        orbitalDebris: {
          ...(next.espionage.orbitalDebris ?? {}),
          [key]: {
            id: previous?.id ?? `orbital-debris-${key}`,
            targetPlanetId: sunOperationId(raid.galaxy, raid.system),
            targetPlanetName: `Солнце ${sunLabel}`,
            targetOwnerId: 'neutral',
            targetCoordinate: sunDebrisCoordinate(raid.galaxy, raid.system),
            debris: addDebris(previous?.debris ?? 0, debris),
            createdAt: previous?.createdAt ?? at,
            reportId,
          },
        },
      },
    };
  }
  next = releaseFlights(next, [...attackers, ...defenders].map((item) => next.flights.records.find((flight) => flight.id === item.flight.id)!), at, raid.id);

  if (playerInvolved) {
    const enriched: BattleReport & { sunRaid: SunReportExtension } = {
      ...report,
      debris,
      sunRaid: {
        version: 1,
        galaxy: raid.galaxy,
        system: raid.system,
        allianceTag: raid.allianceTag,
        brightnessBefore: before,
        brightnessAfter: after,
        frozen,
        ...(crystalRoll ? { crystalRoll } : {}),
        attackers: attackers.length,
        defenders: defenders.length,
      },
    };
    next = {
      ...next,
      combat: { ...next.combat, reports: [...next.combat.reports.filter((item) => item.id !== reportId), enriched] },
      rating: recordBattleScoreAward(next.rating, enriched, playerId),
    };
  }
  const playerSide = playerInvolved
    ? (allianceOf(state, playerId)?.alliance.id === raid.allianceId || attackers.some((item) => item.snapshot.ownerId === playerId) ? 'attacker' : 'defender')
    : null;
  const won = playerSide !== null && playerSide === winner;
  notices.push({
    tone: playerSide === null ? 'info' : won ? 'success' : 'error',
    galaxy: raid.galaxy,
    system: raid.system,
    text: winner === 'attacker'
      ? `Солнце ${sunLabel}: рейд [${raid.allianceTag}] успешен, яркость ${before}% → ${after}%.${crystalRoll?.success && crystalRoll.crystal ? ` Получен ${SOLAR_CRYSTALS[crystalRoll.crystal].name}.` : ''}`
      : `Солнце ${sunLabel}: защитники отразили рейд [${raid.allianceTag}].`,
  });
  return next;
}

export type SunReportExtension = {
  version: 1;
  galaxy: number;
  system: number;
  allianceTag: string;
  brightnessBefore: number;
  brightnessAfter: number;
  frozen: boolean;
  crystalRoll?: NonNullable<SunRaidRecord['result']>['crystalRoll'];
  attackers: number;
  defenders: number;
};

/** Survivors fly home; a fleet without ships ends at the Sun. */
function releaseFlights(state: SaveState, flights: readonly FlightRecord[], at: number, raidId: string | null): SaveState {
  const ids = new Set(flights.map((flight) => flight.id));
  const records = state.flights.records.map((flight) => {
    if (!ids.has(flight.id)) return flight;
    const hasShips = Object.values(flight.selectedShips).some((count) => safeCount(count) > 0)
      || Object.values(flight.selectedCommanders ?? {}).some((count) => safeCount(count) > 0);
    const arrivedAt = flight.arrivedAt ?? Math.min(at, flight.arrivalAt);
    if (!hasShips) return { ...flight, phase: 'completed' as const, arrivedAt, completedAt: at, completionReason: 'mission-failed' as const };
    return { ...flight, phase: 'returning' as const, arrivedAt, returnAt: at + flight.oneWayDurationMs, completionReason: raidId ? 'normal-return' as const : 'target-unavailable' as const };
  });
  return { ...state, flights: { ...state.flights, records } };
}

function ownerOfFlight(state: SaveState, flight: FlightRecord): SunOwner | null {
  if (flight.ownerSide === 'bot01') {
    const target = getEspionageTargets(state.espionage)[flight.originPlanetId];
    return target ? bot01Owner(state, target) : null;
  }
  if (flight.ownerSide === 'npc') {
    const target = getEspionageTargets(state.espionage)[flight.originPlanetId];
    if (flight.ownerId && target?.kind === 'npc' && target.ownerId === flight.ownerId) return npcTargetOwner(target);
    return flight.ownerId && flight.ownerId !== TEST_ALLY_OWNER_ID ? null : allyOwner(state);
  }
  return null;
}

/* ------------------------------------------------------------------- gates */

type GateHost = { ownerId: string; ownerName: string; planetId: string; planetName: string };

function hostFor(state: SaveState, ownerId: string, preferredPlanetId?: string): GateHost | null {
  if (ownerId === state.profile.playerId) {
    const planetId = preferredPlanetId && state.planets[preferredPlanetId]
      ? preferredPlanetId
      : state.planets['helion-01'] ? 'helion-01' : Object.keys(state.planets).sort()[0];
    const planet = planetId ? state.planets[planetId] : undefined;
    return planet ? { ownerId, ownerName: state.profile.displayName, planetId: planetId!, planetName: planet.name } : null;
  }
  const allied = Object.values(state.alliedPlanets ?? {}).find((planet) => planet.ownerId === ownerId);
  if (allied) return { ownerId, ownerName: allied.displayName, planetId: allied.id, planetName: allied.name };
  // The Gate stands on the owner's main planet: an NPC's home world, else its oldest planet.
  const targets = getEspionageTargets(state.espionage);
  const owned = Object.values(targets).filter((item) => item.ownerId === ownerId).sort((a, b) => a.id.localeCompare(b.id));
  const target = (preferredPlanetId ? owned.find((item) => item.id === preferredPlanetId) : undefined)
    ?? owned.find((item) => item.id === `${ownerId}-planet`) ?? owned[0];
  return target ? { ownerId, ownerName: target.ownerName, planetId: target.id, planetName: target.name } : null;
}

function ownerDisplayName(state: SaveState, ownerId: string): string {
  if (ownerId === state.profile.playerId) return state.profile.displayName;
  return Object.values(getEspionageTargets(state.espionage)).find((item) => item.ownerId === ownerId)?.ownerName ?? ownerId;
}

/** The crystal holder an owner plays for: its alliance, or itself when solo. */
export function crystalHolderOf(state: SaveState, ownerId: string): { holder: CrystalHolder; holderName: string; isLeaderOrSolo: boolean } {
  const membership = allianceOf(state, ownerId);
  return membership
    ? { holder: { kind: 'alliance', id: membership.alliance.id }, holderName: `[${membership.alliance.tag}] ${membership.alliance.name}`, isLeaderOrSolo: membership.role === 'leader' }
    : { holder: { kind: 'owner', id: ownerId }, holderName: ownerDisplayName(state, ownerId), isLeaderOrSolo: true };
}

function hostPlanetExists(state: SaveState, gate: GateProject): boolean {
  if (gate.hostOwnerId === state.profile.playerId) return Boolean(state.planets[gate.hostPlanetId]);
  if (gate.hostOwnerId === TEST_ALLY_OWNER_ID || state.alliedPlanets?.[gate.hostPlanetId]) return true;
  return getEspionageTargets(state.espionage)[gate.hostPlanetId]?.ownerId === gate.hostOwnerId;
}

export type GateContext = {
  holder: CrystalHolder;
  holderName: string;
  crystals: readonly import('../domain/sun-raid/config.ts').SolarCrystalId[];
  canStart: boolean;
  reason: string | null;
  gate: GateProject | null;
  isLeaderOrSolo: boolean;
};

/** What the Gate card shows for the local player on one of their planets. */
export function selectGateContext(state: SaveState, now: number): GateContext {
  return selectOwnerGateContext(state, state.profile.playerId, now);
}

/** The same Gate rules for any owner (the player or an autonomous NPC). */
export function selectOwnerGateContext(state: SaveState, ownerId: string, now: number): GateContext {
  const sunRaid = currentSunRaidState(state);
  const { holder, holderName, isLeaderOrSolo } = crystalHolderOf(state, ownerId);
  const check = checkGateStart({ state: sunRaid, holder, isLeaderOrSolo, now });
  return {
    holder,
    holderName,
    crystals: getHolderCrystals(sunRaid, holder),
    canStart: check.ok,
    reason: check.ok ? null : check.message,
    gate: activeGateOf(sunRaid, holder) ?? sunRaid.gates.filter((gate) => sameHolder(gate.holder, holder)).at(-1) ?? null,
    isLeaderOrSolo,
  };
}

/** The leader (or a solo owner with four crystals) starts the Gate on their own planet. */
export function startGateConstruction(state: SaveState, planetId: string, options: SunRuntimeOptions): SunActionResult {
  const planet = state.planets[planetId];
  if (!planet) return { ok: false, state, error: 'Врата строятся только на своей планете.' };
  return startGateFor(state, { ownerId: state.profile.playerId, ownerName: state.profile.displayName, planetId, planetName: planet.name }, options);
}

/** An autonomous NPC (solo, or its alliance's leader) lays the Gate on its main planet. */
export function startNpcGateConstruction(state: SaveState, ownerId: string, options: SunRuntimeOptions): SunActionResult {
  const host = hostFor(state, ownerId);
  if (!host || ownerId === state.profile.playerId) return { ok: false, state, error: 'Главная планета не найдена.' };
  return startGateFor(state, host, options);
}

function startGateFor(state: SaveState, host: GateHost, options: SunRuntimeOptions): SunActionResult {
  const context = selectOwnerGateContext(state, host.ownerId, options.now);
  if (!context.canStart) return { ok: false, state, error: context.reason ?? 'Строительство недоступно.' };
  const sunRaid = currentSunRaidState(state);
  const planet = { name: host.planetName };
  const gate: GateProject = {
    id: `gate-${holderKey(context.holder).replace(':', '-')}-${options.now}`,
    holder: context.holder,
    holderName: context.holderName,
    hostOwnerId: host.ownerId,
    hostOwnerName: host.ownerName,
    hostPlanetId: host.planetId,
    hostPlanetName: host.planetName,
    startedAt: options.now,
    completesAt: options.now + scaleSunDuration(SUN_RAID_CONFIG.gateBuildMs, options),
    status: 'building',
    crystals: [...context.crystals],
    announcedMilestones: [],
  };
  const event: SunRaidEvent = { id: `${gate.id}:started`, at: options.now, kind: 'gate-started', text: `${context.holderName} начал строить Врата на ${planet.name}.` };
  return {
    ok: true,
    state: withSunRaid(state, appendSunEvents({ ...sunRaid, gates: [...sunRaid.gates, gate] }, [event])),
    notice: `Врата заложены на ${planet.name}. Достройка — победа в кампании.`,
  };
}

function reconcileGates(state: SaveState, now: number, notices: SunRaidNotice[]): SaveState {
  let sunRaid = currentSunRaidState(state);
  let changed = false;
  const events: SunRaidEvent[] = [];
  const gates = sunRaid.gates.map((gate) => {
    if (gate.status !== 'building') return gate;
    let next = gate;
    // 1. Transfer: an alliance Gate always stands on the current leader's planet.
    if (gate.holder.kind === 'alliance') {
      const alliance = state.command.alliances.find((item) => item.id === gate.holder.id);
      if (!alliance) {
        events.push({ id: `${gate.id}:cancelled`, at: now, kind: 'gate-cancelled', text: `Союз ${gate.holderName} распался: стройка Врат отменена.` });
        notices.push({ tone: 'error', text: `Стройка Врат ${gate.holderName} отменена: союз распался.` });
        // Crystals go to the last host as a solo owner.
        const owned = getHolderCrystals(sunRaid, gate.holder);
        for (const crystal of owned) sunRaid = addCrystal(removeCrystal(sunRaid, gate.holder, crystal), { kind: 'owner', id: gate.hostOwnerId }, crystal);
        changed = true;
        return { ...gate, status: 'cancelled' as const, endedAt: now };
      }
      if (alliance.leaderOwnerId !== gate.hostOwnerId) {
        const host = hostFor(state, alliance.leaderOwnerId);
        if (host) {
          next = { ...next, hostOwnerId: host.ownerId, hostOwnerName: host.ownerName, hostPlanetId: host.planetId, hostPlanetName: host.planetName };
          events.push({ id: `${gate.id}:transfer:${host.ownerId}:${now}`, at: now, kind: 'gate-transferred', text: `Стройка Врат перенесена на ${host.planetName} (${host.ownerName}).` });
          notices.push({ tone: 'info', text: `Врата ${gate.holderName}: стройка перенесена новому главе ${host.ownerName}.` });
          changed = true;
        }
      }
    }
    // 2. Milestones visible to everyone.
    const progress = gateProgressPercent(next, Math.min(now, next.completesAt));
    const reached = SUN_RAID_CONFIG.gateMilestones.filter((milestone) => progress >= milestone && !next.announcedMilestones.includes(milestone));
    if (reached.length) {
      const where = `${gate.hostPlanetName} (${gate.hostOwnerName})`;
      for (const milestone of reached) {
        if (milestone === 0) continue; // the start itself is already in the history as «gate-started»
        events.push({ id: `${gate.id}:m${milestone}`, at: Math.round(gate.startedAt + (gate.completesAt - gate.startedAt) * milestone / 100), kind: 'gate-progress', text: `Врата ${gate.holderName}: построено ${milestone}%.` });
      }
      const last = reached.at(-1)!;
      notices.push({ tone: 'info', text: last === 0 ? `${gate.holderName} начал строить Врата на ${where}.` : `Врата ${gate.holderName} на ${where}: ${last}%.` });
      next = { ...next, announcedMilestones: [...next.announcedMilestones, ...reached] };
      changed = true;
    }
    // 3. Completion = campaign victory.
    if (now >= next.completesAt && !sunRaid.campaignResult) {
      const playerWon = playerHolders(state).some((holder) => sameHolder(holder, next.holder));
      const result: CampaignResult = {
        version: 1, at: next.completesAt, winner: next.holder, winnerName: next.holderName,
        hostOwnerId: next.hostOwnerId, hostOwnerName: next.hostOwnerName, hostPlanetName: next.hostPlanetName, playerWon,
      };
      sunRaid = { ...sunRaid, campaignResult: result };
      events.push({ id: `${gate.id}:completed`, at: next.completesAt, kind: 'gate-completed', text: `${next.holderName} достроил Врата на ${next.hostPlanetName}. Кампания завершена.` });
      notices.push({ tone: playerWon ? 'success' : 'error', text: playerWon ? 'Врата достроены. Победа в кампании!' : `${next.holderName} достроил Врата. Кампания проиграна.` });
      changed = true;
      return { ...next, status: 'completed' as const, endedAt: next.completesAt };
    }
    return next;
  });
  if (!changed) return state;
  return withSunRaid(state, appendSunEvents({ ...sunRaid, gates }, events));
}

/**
 * A won attack on the Gate's host planet destroys the Gate, whoever attacked
 * (player, NPC or Test Mode Bot 01). What happens to the crystals follows the
 * owner rules of 25.10.2026 (`resolveGateBreach`): a solo attacker may steal
 * one, an alliance attacker destroys one, a solo holder keeps them half the time.
 */
function reconcileGateAssaults(state: SaveState, now: number, options: SunRuntimeOptions, notices: SunRaidNotice[]): SaveState {
  let sunRaid = currentSunRaidState(state);
  const building = sunRaid.gates.filter((gate) => gate.status === 'building');
  if (!building.length) return state;
  let changed = false;
  const events: SunRaidEvent[] = [];
  const reports = new Map(state.combat.reports.map((report) => [report.id, report]));
  const hostIds = new Set(building.map((gate) => gate.hostPlanetId));
  const assaults = state.flights.records.filter((flight) => flight.missionId === 'attack' && flight.attackResolution
    && flight.destinationPlanetId !== undefined && hostIds.has(flight.destinationPlanetId));
  const playerId = state.profile.playerId;
  const gates = sunRaid.gates.map((gate) => {
    if (gate.status !== 'building') return gate;
    const hostLost = !hostPlanetExists(state, gate);
    const assault = assaults
      .filter((flight) => flight.destinationPlanetId === gate.hostPlanetId
        && flight.attackResolution!.resolvedAt >= gate.startedAt && flight.attackResolution!.resolvedAt <= now
        && (reports.get(flight.attackResolution!.reportId)?.winner === 'attacker' || flight.attackResolution!.planetDestroyed))
      .sort((left, right) => left.attackResolution!.resolvedAt - right.attackResolution!.resolvedAt || left.id.localeCompare(right.id))[0];
    if (!assault && !hostLost) return gate;
    const attackerId = !assault ? 'unknown'
      : assault.ownerSide === 'bot01' ? TEST_BOT_OWNER_ID
      : assault.ownerSide === 'npc' ? assault.ownerId ?? 'unknown'
      : playerId;
    const attacker = assault ? crystalHolderOf(state, attackerId) : null;
    const attackerSolo = attacker?.holder.kind === 'owner';
    const outcome = attacker
      ? resolveGateBreach(gate.id, gate.holder, getHolderCrystals(sunRaid, gate.holder), attackerSolo, getHolderCrystals(sunRaid, attacker.holder))
      : { kind: 'kept' as const };
    if (outcome.kind !== 'kept') sunRaid = removeCrystal(sunRaid, gate.holder, outcome.crystal);
    if (outcome.kind === 'stolen' && attacker) sunRaid = addCrystal(sunRaid, attacker.holder, outcome.crystal);
    sunRaid = { ...sunRaid, gateCooldowns: { ...sunRaid.gateCooldowns, [holderKey(gate.holder)]: now + scaleSunDuration(SUN_RAID_CONFIG.gateRestartCooldownMs, options) } };
    const attackerName = !assault ? 'неизвестный враг' : assault.ownerSide === 'bot01' ? 'Бот 01' : ownerDisplayName(state, attackerId);
    const crystalText = outcome.kind === 'stolen' ? ` ${attackerName} похитил ${SOLAR_CRYSTALS[outcome.crystal].name}.`
      : outcome.kind === 'destroyed' ? ` ${SOLAR_CRYSTALS[outcome.crystal].name} уничтожен.`
      : assault ? ' Кристаллы уцелели.' : '';
    events.push({ id: `${gate.id}:destroyed`, at: now, kind: 'gate-destroyed', text: `Врата ${gate.holderName} разрушены (${attackerName}).${crystalText}` });
    const playerSide = playerHolders(state).some((holder) => sameHolder(holder, gate.holder));
    notices.push({ tone: playerSide ? 'error' : 'info', text: `Врата ${gate.holderName} разрушены.${crystalText}` });
    changed = true;
    return {
      ...gate,
      status: 'destroyed' as const,
      endedAt: now,
      destroyedBy: {
        ownerId: attackerId, ownerName: attackerName, holder: attacker?.holder ?? { kind: 'owner' as const, id: attackerId },
        ...(outcome.kind === 'stolen' ? { crystal: outcome.crystal } : {}),
        ...(outcome.kind !== 'kept' ? { outcome: outcome.kind, lostCrystal: outcome.crystal } : { outcome: 'kept' as const }),
        ...(assault?.attackResolution ? { reportId: assault.attackResolution.reportId } : {}),
      },
    };
  });
  if (!changed) return state;
  return withSunRaid(state, appendSunEvents({ ...sunRaid, gates }, events));
}

/**
 * Solo crystals are personal (owner rule 25.10.2026): an owner who joins an
 * alliance loses them, and a solo Gate it was building is cancelled.
 */
function burnSoloCrystalsOfAllianceMembers(state: SaveState, now: number, notices: SunRaidNotice[]): SaveState {
  let sunRaid = currentSunRaidState(state);
  let changed = false;
  const events: SunRaidEvent[] = [];
  for (const [key, crystals] of Object.entries(sunRaid.crystals)) {
    const holder = parseHolderKey(key);
    if (!holder || holder.kind !== 'owner' || !crystals.length || !allianceOf(state, holder.id)) continue;
    sunRaid = { ...sunRaid, crystals: { ...sunRaid.crystals, [key]: [] } };
    const name = ownerDisplayName(state, holder.id);
    events.push({ id: `crystals-burned:${holder.id}:${now}`, at: now, kind: 'gate-cancelled', text: `${name} вступил в союз: его кристаллы одиночки (${crystals.length}) рассыпались.` });
    if (holder.id === state.profile.playerId) notices.push({ tone: 'error', text: `Вы вступили в союз: кристаллы одиночки (${crystals.length}) рассыпались.` });
    changed = true;
  }
  const gates = sunRaid.gates.map((gate) => {
    if (gate.status !== 'building' || gate.holder.kind !== 'owner' || !allianceOf(state, gate.holder.id)) return gate;
    changed = true;
    events.push({ id: `${gate.id}:cancelled`, at: now, kind: 'gate-cancelled', text: `Врата ${gate.holderName} отменены: владелец вступил в союз.` });
    return { ...gate, status: 'cancelled' as const, endedAt: now };
  });
  if (!changed) return state;
  return withSunRaid(state, appendSunEvents({ ...sunRaid, gates }, events));
}

/* ------------------------------------------------------- energy & registry */

/** Publishes the dimmed Suns to the energy model (Suns at base brightness are omitted). */
export function publishSunBrightness(state: SaveState, now: number): void {
  const overrides: Record<string, number> = {};
  for (const [key, sun] of Object.entries(currentSunRaidState(state).suns)) {
    const brightness = projectSun(sun, now).brightness;
    if (brightness !== sun.baseEfficiency) overrides[key] = brightness;
  }
  setSunBrightnessOverrides(overrides);
}

function sunSignature(state: SaveState, now: number): string {
  return Object.entries(currentSunRaidState(state).suns)
    .map(([key, sun]) => `${key}=${projectSun(sun, now).brightness}`).sort().join('|');
}

function resyncSolarEnergy(state: SaveState, previous: string, now: number): SaveState {
  const signature = sunSignature(state, now);
  if (signature === previous) return state;
  publishSunBrightness(state, now);
  const before = new Map(previous.split('|').filter(Boolean).map((entry) => entry.split('=') as [string, string]));
  const after = new Map(signature.split('|').filter(Boolean).map((entry) => entry.split('=') as [string, string]));
  const touched = new Set([...before.keys(), ...after.keys()].filter((key) => before.get(key) !== after.get(key)));
  let next = state;
  for (const [planetId, planet] of Object.entries(state.planets)) {
    if (!touched.has(sunKey(planet.universeGalaxy ?? 1, planet.universeSystem ?? 1))) continue;
    next = replacePlanetState(next, planetId, syncPlanetEnergySources(planet, state.science.levels));
  }
  return next;
}

/* --------------------------------------------------------------- reconcile */

export type SunReconcileResult = { state: SaveState; changed: boolean; notices: SunRaidNotice[] };

/**
 * Advances every Sun flight, raid battle, return, Gate and recovery due by
 * `now`, in chronological order. Safe to call any number of times.
 */
export function reconcileSunRaids(state: SaveState, options: SunRuntimeOptions): SunReconcileResult {
  const now = options.now;
  const notices: SunRaidNotice[] = [];
  const startSignature = sunSignature(state, now);
  let next = state;
  publishSunBrightness(next, now);

  for (let guard = 0; guard < 500; guard += 1) {
    type Due = { at: number; order: number; apply: () => void };
    const due: Due[] = [];
    const sunRaid = currentSunRaidState(next);
    for (const flight of next.flights.records) {
      if (!isSunFlight(flight) || !ACTIVE_PHASES.has(flight.phase) || !flight.sunRaid) continue;
      if (flight.phase === 'outbound' && flight.arrivalAt <= now) {
        const raid = sunRaid.raids.find((item) => item.id === flight.sunRaid!.raidId);
        const order = flight.missionId === 'sun-support' ? 0 : 1;
        due.push({
          at: flight.arrivalAt, order, apply: () => {
            const holds = raid && raid.status === 'incoming' && flight.arrivalAt <= raid.arrivesAt;
            if (holds) {
              next = { ...next, flights: { ...next.flights, records: next.flights.records.map((item) => item.id === flight.id ? { ...item, phase: 'arrived' as const, arrivedAt: flight.arrivalAt, completionReason: 'arrived' as const } : item) } };
            } else {
              next = releaseFlights(next, [flight], flight.arrivalAt, null);
              if (flight.ownerSide === undefined || flight.ownerSide === 'player') notices.push({ tone: 'info', text: `Флот к Солнцу ${formatSun(flight.destinationCoordinate.galaxy, flight.destinationCoordinate.system)} опоздал и возвращается.` });
            }
          },
        });
      } else if (flight.phase === 'returning' && flight.returnAt !== undefined && flight.returnAt <= now) {
        due.push({
          at: flight.returnAt, order: 3, apply: () => {
            const current = next.flights.records.find((item) => item.id === flight.id)!;
            next = { ...next, flights: { ...next.flights, records: next.flights.records.map((item) => item.id === flight.id ? { ...item, phase: 'completed' as const, completedAt: flight.returnAt } : item) } };
            const owner = ownerOfFlight(next, current);
            if (owner) next = detachNpcShips(next, owner, current.selectedShips, 1);
          },
        });
      }
    }
    for (const raid of sunRaid.raids) {
      // A gathering that did not fill up by its deadline disbands first.
      if (raid.status === 'gathering' && raid.gatherEndsAt !== undefined && raid.gatherEndsAt <= now) {
        due.push({ at: raid.gatherEndsAt, order: -1, apply: () => { next = disbandRaid(next, raid, raid.gatherEndsAt!); } });
      }
      if (raid.status === 'incoming' && raid.arrivesAt <= now) {
        due.push({ at: raid.arrivesAt, order: 2, apply: () => { next = resolveRaid(next, raid, raid.arrivesAt, options, notices); } });
      }
    }
    if (!due.length) break;
    due.sort((left, right) => left.at - right.at || left.order - right.order);
    due[0]!.apply();
  }

  // Close raids whose attacking fleets are all home: the alliance may raid again.
  const sunRaid = currentSunRaidState(next);
  let closedAny = false;
  const raids = sunRaid.raids.map((raid) => {
    if (raid.status !== 'resolved' || raid.closedAt !== undefined) return raid;
    const attackers = flightsOfRaid(next, raid.id, 'attacker');
    if (attackers.some((flight) => ACTIVE_PHASES.has(flight.phase))) return raid;
    closedAny = true;
    return { ...raid, closedAt: Math.max(raid.result?.resolvedAt ?? raid.arrivesAt, ...attackers.map((flight) => flight.completedAt ?? 0)) };
  });
  if (closedAny) next = withSunRaid(next, { ...sunRaid, raids });
  // The save keeps the last 200 raid records (repository); the live world
  // keeps the same, so a reload never changes what the world remembers.
  if (currentSunRaidState(next).raids.length > SUN_RAID_RECORD_LIMIT) {
    next = withSunRaid(next, { ...currentSunRaidState(next), raids: currentSunRaidState(next).raids.slice(-SUN_RAID_RECORD_LIMIT) });
  }

  // Fold finished recovery steps into stored records so the save stays compact.
  const suns = currentSunRaidState(next).suns;
  let sunsChanged = false;
  const materialized = Object.fromEntries(Object.entries(suns).map(([key, sun]) => {
    const folded = materializeSun(sun, now);
    if (folded !== sun) sunsChanged = true;
    return [key, folded];
  }));
  if (sunsChanged) next = withSunRaid(next, { ...currentSunRaidState(next), suns: materialized });

  next = burnSoloCrystalsOfAllianceMembers(next, now, notices);
  next = reconcileGateAssaults(next, now, options, notices);
  next = reconcileGates(next, now, notices);
  next = resyncSolarEnergy(next, startSignature, now);
  return { state: next, changed: next !== state, notices };
}

/* --------------------------------------------------------------- selectors */

export type SunAlert = { raid: SunRaidRecord; arrivesInMs: number };

/** Incoming raids every owner of a planet in that galaxy is warned about (except the raiders themselves). */
export function selectIncomingSunAlerts(state: SaveState, now: number): SunAlert[] {
  const galaxies = new Set(Object.values(state.planets).map((planet) => planet.universeGalaxy ?? 1));
  const ownAlliance = allianceOf(state, state.profile.playerId)?.alliance.id;
  return currentSunRaidState(state).raids
    .filter((raid) => raid.status === 'incoming' && galaxies.has(raid.galaxy) && raid.allianceId !== ownAlliance)
    .map((raid) => ({ raid, arrivesInMs: Math.max(0, raid.arrivesAt - now) }))
    .sort((left, right) => left.raid.arrivesAt - right.raid.arrivesAt);
}

export type PlayerRaidRole = { allianceId: string | null; allianceTag: string | null; role: 'leader' | 'deputy' | 'member' | null; holder: CrystalHolder };

export function selectPlayerRaidRole(state: SaveState): PlayerRaidRole {
  const membership = allianceOf(state, state.profile.playerId);
  return {
    allianceId: membership?.alliance.id ?? null,
    allianceTag: membership?.alliance.tag ?? null,
    role: membership?.role ?? null,
    holder: membership ? { kind: 'alliance', id: membership.alliance.id } : { kind: 'owner', id: state.profile.playerId },
  };
}

/* ------------------------------------------------------ Test Mode fixtures */

function requireTest(state: SaveState, options: SunRuntimeOptions): SunActionResult | null {
  return options.mode === 'test' ? null : { ok: false, state, error: 'Сценарий доступен только в Test Mode.' };
}

function botSource(state: SaveState): SpyTargetState | null {
  return Object.values(getEspionageTargets(state.espionage))
    .filter((target) => target.ownerId === TEST_BOT_OWNER_ID)
    .sort((left, right) => {
      const pop = (target: SpyTargetState) => sunFleetPopulation(target.fleet.ships, target.raceId);
      return pop(right) - pop(left) || left.id.localeCompare(right.id);
    })[0] ?? null;
}

/** Combat ships of a fixture worth up to `target` population, cheapest hull count first. */
function pickFixtureShips(owner: SunOwner, target: number): Partial<Record<ShipId, number>> {
  const picked: Partial<Record<ShipId, number>> = {};
  let left = target;
  const options = (Object.entries(owner.available) as [ShipId, number][])
    .filter(([id, count]) => safeCount(count) > 0 && isSunCombatHull(id))
    .map(([id, count]) => ({ id, count: safeCount(count), population: getFactionCombatEntity(owner.factionId, id).population ?? 1 }))
    .sort((left, right) => right.population - left.population);
  for (const option of options) {
    const count = Math.min(option.count, Math.floor(left / Math.max(1, option.population)));
    if (count <= 0) continue;
    picked[option.id] = count;
    left -= count * option.population;
  }
  return picked;
}

/** Test: Bot 01 (leader of its fixture alliance) raids the given Sun — usually the player's home Sun. */
export function testBot01RaidSun(state: SaveState, galaxy: number, system: number, options: SunRuntimeOptions): SunActionResult {
  const denied = requireTest(state, options);
  if (denied) return denied;
  const source = botSource(state);
  if (!source) return { ok: false, state, error: 'У Бота 01 нет планет с флотом.' };
  if (!allianceOf(state, TEST_BOT_OWNER_ID)) return { ok: false, state, error: 'Бот 01 сейчас не состоит в союзе: рейд — командная операция.' };
  const owner = bot01Owner(state, source);
  const ships = pickFixtureShips(owner, 30_000);
  if (!Object.keys(ships).length) return { ok: false, state, error: 'У Бота 01 нет боевых кораблей.' };
  const result = launchRaidFor(state, owner, { galaxy, system, originPlanetId: source.id, ships, requestId: `bot01-sun-raid-${galaxy}-${system}-${options.now}` }, options);
  // The fixture skips the 30-minute gathering so the defence can be tested at once.
  return result.ok && result.raidId
    ? { ...result, state: forceRaidLaunch(result.state, result.raidId, options.now), notice: `Тест: Бот 01 объявил рейд на Солнце ${formatSun(galaxy, system)}. Отправьте поддержку.` }
    : result;
}

/** Test: Bot 01 sends defenders to the Sun the player's alliance is raiding. */
export function testBot01DefendSun(state: SaveState, raidId: string, options: SunRuntimeOptions): SunActionResult {
  const denied = requireTest(state, options);
  if (denied) return denied;
  const source = botSource(state);
  if (!source) return { ok: false, state, error: 'У Бота 01 нет планет с флотом.' };
  const owner = bot01Owner(state, source);
  const ships = pickFixtureShips(owner, 12_000);
  const result = sendSupportFor(state, owner, { raidId, originPlanetId: source.id, ships, requestId: `bot01-sun-support-${raidId}-${options.now}` }, { ...options }, true);
  return result.ok ? { ...result, notice: 'Тест: Бот 01 отправил защиту Солнца.' } : result;
}

const IRA_FIXTURE_SHIPS: Partial<Record<ShipId, number>> = { cruiser: 120, battleship: 40, destroyer: 25 };

/** Seeds Ira Vel's fixture planet with a small battle fleet (Test Mode only, once per call). */
function ensureIraFleet(state: SaveState): SaveState {
  const planet = Object.values(state.alliedPlanets ?? {}).find((item) => item.ownerId === TEST_ALLY_OWNER_ID);
  if (!planet) return state;
  const owner = allyOwner(state)!;
  if (sunFleetPopulation(pickFixtureShips(owner, 50_000), owner.factionId) >= 5_000) return state;
  const ships = { ...planet.fleet.ships };
  for (const [id, count] of Object.entries(IRA_FIXTURE_SHIPS) as [ShipId, number][]) ships[id] = (ships[id] ?? 0) + count;
  return replaceAlliedPlanetState(state, planet.id, { ...planet, fleet: { ...planet.fleet, ships } });
}

/** Test: Ira Vel supports a Sun under attack (defence side). */
export function testIraSupportSun(state: SaveState, raidId: string, options: SunRuntimeOptions): SunActionResult {
  const denied = requireTest(state, options);
  if (denied) return denied;
  const seeded = ensureIraFleet(state);
  const owner = allyOwner(seeded);
  if (!owner) return { ok: false, state, error: 'Планета Иры Вель не найдена.' };
  const ships = pickFixtureShips(owner, 20_000);
  const result = sendSupportFor(seeded, owner, { raidId, originPlanetId: owner.planetId, ships, requestId: `ira-sun-support-${raidId}-${options.now}` }, options, true);
  return result.ok ? { ...result, notice: 'Тест: Ира Вель отправила флот защиты к Солнцу.' } : result;
}

/** Test: Ira Vel joins the player's alliance raid (launches at the raid's own departure, arrives together). */
export function testIraJoinRaid(state: SaveState, raidId: string, options: SunRuntimeOptions): SunActionResult {
  const denied = requireTest(state, options);
  if (denied) return denied;
  const raid = currentSunRaidState(state).raids.find((item) => item.id === raidId);
  if (!raid || raid.status !== 'gathering') return { ok: false, state, error: 'Идущего сбора рейда нет.' };
  if (allianceOf(state, TEST_ALLY_OWNER_ID)?.alliance.id !== raid.allianceId) return { ok: false, state, error: 'Ира Вель не состоит в союзе рейда.' };
  const seeded = ensureIraFleet(state);
  const owner = allyOwner(seeded)!;
  const ships = pickFixtureShips(owner, Math.min(20_000, raidPledgeRoom(seeded, raid, owner.ownerId)));
  if (!Object.keys(ships).length) return { ok: false, state, error: 'Лимит участника или рейда исчерпан.' };
  const result = joinRaidFor(seeded, owner, { raidId, originPlanetId: owner.planetId, ships, requestId: `ira-sun-join-${raid.id}` }, options);
  return result.ok ? { ...result, notice: 'Тест: Ира Вель вступила в сбор рейда.' } : result;
}

/** Test only: the gathering takes off now, whatever it holds (QA of the battle path). */
export function testLaunchRaidNow(state: SaveState, raidId: string, options: SunRuntimeOptions): SunActionResult {
  const denied = requireTest(state, options);
  if (denied) return denied;
  const raid = currentSunRaidState(state).raids.find((item) => item.id === raidId);
  if (!raid || raid.status !== 'gathering') return { ok: false, state, error: 'Идущего сбора рейда нет.' };
  return { ok: true, state: forceRaidLaunch(state, raidId, options.now), notice: 'Тест: сбор завершён досрочно, рейд вылетел.' };
}

function forceRaidLaunch(state: SaveState, raidId: string, at: number): SaveState {
  const sunRaid = currentSunRaidState(state);
  const raid = sunRaid.raids.find((item) => item.id === raidId);
  if (!raid || raid.status !== 'gathering') return state;
  const pledged = flightsOfRaid(state, raid.id, 'attacker').filter((flight) => flight.phase === 'outbound');
  const arrivesAt = at + (pledged[0]?.oneWayDurationMs ?? 0);
  const ids = new Set(pledged.map((flight) => flight.id));
  return withSunRaid({ ...state, flights: { ...state.flights, records: state.flights.records.map((flight) => ids.has(flight.id) ? { ...flight, departedAt: at, arrivalAt: arrivesAt } : flight) } },
    { ...sunRaid, raids: sunRaid.raids.map((item) => item.id === raid.id ? { ...raid, status: 'incoming' as const, arrivesAt } : item) });
}

/** Test: hands one missing crystal to the player's holder (to check the Gate path quickly). */
export function testGrantCrystal(state: SaveState, options: SunRuntimeOptions): SunActionResult {
  const denied = requireTest(state, options);
  if (denied) return denied;
  const { holder } = selectPlayerRaidRole(state);
  const sunRaid = currentSunRaidState(state);
  const missing = (['crystal-1', 'crystal-2', 'crystal-3', 'crystal-4'] as const).find((id) => !getHolderCrystals(sunRaid, holder).includes(id));
  if (!missing) return { ok: false, state, error: 'Все четыре кристалла уже собраны.' };
  return { ok: true, state: withSunRaid(state, addCrystal(sunRaid, holder, missing)), notice: `Тест: выдан ${SOLAR_CRYSTALS[missing].name}.` };
}

/* ------------------------------------------------------- flight engine bridge */

export type SunDispatchCommand = {
  requestId: string;
  missionId: 'sun-support' | 'sun-attack';
  originPlanetId: string;
  destination?: { kind: string; coordinate: UniverseCoordinate; operationId?: string };
  operationId?: string;
  selectedShips: Partial<Record<ShipId, number>>;
  selectedCommanders?: Partial<Record<CommanderId, number>>;
  departedAt?: number;
};

export type SunDispatchOutcome =
  | { ok: true; state: SaveState; flight: FlightRecord; notice: string }
  | { ok: false; message: string; code: SunFailureCode };

/**
 * The «Флоты» screen sends Sun missions through `dispatchFlight`. Support is
 * open to every owner of a planet in the Sun's galaxy (alliance or not); a raid
 * is declared only from «Командование → Операции».
 */
export function dispatchSunMission(state: SaveState, command: SunDispatchCommand, options: SunRuntimeOptions): SunDispatchOutcome {
  if (command.missionId === 'sun-attack') return { ok: false, code: 'mission-not-supported', message: 'Рейд на Солнце объявляется только в «Командование → Операции».' };
  const sun = parseSunOperationId(command.operationId ?? command.destination?.operationId);
  if (!sun) return { ok: false, code: 'target-not-available', message: 'Выберите Солнце под атакой.' };
  const raid = currentSunRaidState(state).raids.find((item) => item.status === 'incoming' && item.galaxy === sun.galaxy && item.system === sun.system);
  if (!raid) return { ok: false, code: 'target-not-available', message: 'На это Солнце сейчас нет входящей атаки.' };
  const result = sendSunSupport(state, {
    raidId: raid.id,
    originPlanetId: command.originPlanetId,
    ships: command.selectedShips,
    commanders: command.selectedCommanders,
    requestId: command.requestId,
    departedAt: command.departedAt,
  }, options);
  if (!result.ok) return { ok: false, message: result.error, code: result.code ?? 'target-not-available' };
  const flight = result.state.flights.records.find((item) => item.requestId === command.requestId);
  return flight ? { ok: true, state: result.state, flight, notice: result.notice } : { ok: false, code: 'invalid-command', message: 'Флот поддержки не создан.' };
}

/** Suns of the player's galaxies that are under attack: the «Поддержка солнца» targets. */
export function selectSunSupportTargets(state: SaveState, now: number): Array<{ raid: SunRaidRecord; operationId: string; coordinate: UniverseCoordinate; label: string; arrivesInMs: number }> {
  return selectIncomingSunAlerts(state, now).map(({ raid, arrivesInMs }) => ({
    raid,
    operationId: sunOperationId(raid.galaxy, raid.system),
    coordinate: sunRouteCoordinate(raid.galaxy, raid.system),
    label: `Солнце ${formatSun(raid.galaxy, raid.system)} · [${raid.allianceTag}] · бой через ${Math.max(1, Math.ceil(arrivesInMs / 60_000))} мин`,
    arrivesInMs,
  }));
}
