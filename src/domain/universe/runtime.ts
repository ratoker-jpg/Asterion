import type {
  UniverseAction,
  UniverseActionState,
  UniverseAssetCatalog,
  UniverseAsteroidRuntimeState,
  InitializedUniverseAsteroidRuntimeState,
  UniverseCoordinate,
  UniverseMap,
  UniverseOwnerAlliance,
  UniverseOwnerProfile,
  UniverseOwnerPoints,
  UniverseFixtureDescriptor,
  UniverseFixtureMarker,
  UniversePersistedPlayerPlanet,
  UniverseRegisteredPlanet,
  UniversePlanetNode,
  UniversePoint,
  UniversePirateState,
  UniverseSystem,
  UniverseTimedObjectState,
} from './types.ts';
import { initializeAsteroidGasState } from './asteroid-gas.ts';
import { getPositionCoefficientPercent, getSunEfficiencyPercent } from '../energy/runtime.ts';
import type { RuntimeMode } from '../runtime/mode.ts';
import { DEFAULT_ALLIANCE_MEMBERS, DEFAULT_ALLIANCE_PROFILE } from '../command/catalog.ts';
import { CURRENT_COMMAND_ALLIANCE_ID } from '../command/selectors.ts';
import type { DiplomaticRelation } from '../command/types.ts';
import { CURRENT_PLAYER_FACTION_ID } from '../profile/repository.ts';

export const GALAXY = 1;
export const SYSTEM_COUNT = 40;
export const POSITION_COUNT = 24;
export const MAX_PLANETS_PER_OWNER = 7;

export const ASTEROID_SPAWN_INTERVAL_MS = 60 * 60 * 1_000;
export const ASTEROID_MIN_DWELL_MS = 15 * 60 * 1_000;
export const ASTEROID_MAX_DWELL_MS = 30 * 60 * 1_000;
export const ASTEROID_GAS_MIN = 1_000;
export const ASTEROID_GAS_MAX = 200_000;
export const ASTEROID_TRANSIT_MS = 4_000;
export const ASTEROID_SCHEDULE_EPOCH_MS = Date.UTC(2026, 0, 1);

export const PIRATE_MIN_LIFETIME_MS = 45 * 60 * 1_000;
export const PIRATE_MAX_LIFETIME_MS = 75 * 60 * 1_000;
export const PIRATE_QUIET_MS = 15 * 60 * 1_000;
export const PIRATE_ABSENCE_PROBABILITY = 0.1;
export const PIRATE_SCHEDULE_EPOCH_MS = Date.UTC(2026, 0, 1);

export const UNIQUE_MIN_LIFETIME_MS = 15 * 60 * 1_000;
export const UNIQUE_MAX_LIFETIME_MS = 20 * 60 * 1_000;
export const UNIQUE_QUIET_MS = 45 * 60 * 1_000;
export const UNIQUE_INITIAL_SPAWN_CHANCE = 0.25;
export const UNIQUE_SPAWN_CHANCE_STEP = 0.05;

export const ANOMALY_MIN_LIFETIME_MS = UNIQUE_MIN_LIFETIME_MS;
export const ANOMALY_MAX_LIFETIME_MS = UNIQUE_MAX_LIFETIME_MS;
export const ANOMALY_QUIET_MS = UNIQUE_QUIET_MS;
export const ANOMALY_INITIAL_SPAWN_CHANCE = 0.05;
export const ANOMALY_SPAWN_CHANCE_STEP = 0.025;

const DEFAULT_ASSETS: UniverseAssetCatalog = {
  planetArts: ['planet-default'],
  asteroidArts: ['asteroid-default'],
  pirateArts: ['pirate-default'],
  anomalyArts: ['anomaly-default'],
  uniqueArts: ['unique-default'],
  starArts: ['star-default'],
};

const NPC_OWNER_ID = 'npc-bot-01';
const TEST_MODE_ALLY_FIXTURE_MARKER: UniverseFixtureMarker = { id: 'test-mode-ally-ira-vel-v1', version: 1 };
const TEST_MODE_ALLY_PARTICIPANT = DEFAULT_ALLIANCE_MEMBERS.find((member) => member.id === 'member-ira-vel');

if (!TEST_MODE_ALLY_PARTICIPANT) throw new Error('Command fixture participant member-ira-vel is required for the universe ally fixture.');

export const TEST_MODE_ALLY_PLANET_FIXTURE: UniverseFixtureDescriptor = {
  marker: TEST_MODE_ALLY_FIXTURE_MARKER,
  // Position 2 is empty in the existing system-1 Test Mode atlas; position 4
  // is an uninhabited fixture and must remain available for that scenario.
  coordinate: { galaxy: GALAXY, system: 1, position: 2 },
  planet: { id: 'test-mode-ally-ira-vel-v1', name: 'Aster', art: 'planet-default' },
  owner: {
    id: TEST_MODE_ALLY_PARTICIPANT.id,
    displayName: TEST_MODE_ALLY_PARTICIPANT.callsign,
    raceId: CURRENT_PLAYER_FACTION_ID,
    alliance: {
      id: CURRENT_COMMAND_ALLIANCE_ID,
      name: DEFAULT_ALLIANCE_PROFILE.name,
      tag: DEFAULT_ALLIANCE_PROFILE.tag,
      emblem: { ...DEFAULT_ALLIANCE_PROFILE.emblem },
      glyph: DEFAULT_ALLIANCE_PROFILE.emblem.glyph,
    },
    planetIds: ['test-mode-ally-ira-vel-v1'],
  },
};

/** Resolves explicit universe fixtures; unrelated NPCs remain relation-neutral by default. */
export function resolveUniverseFixtures(mode: RuntimeMode): readonly UniverseFixtureDescriptor[] {
  return mode === 'test' ? [TEST_MODE_ALLY_PLANET_FIXTURE] : [];
}

const BOT_PLANET_PRESETS = [
  { name: 'Аурелия', artIndex: 12 },
  { name: 'Кальдера', artIndex: 13 },
  { name: 'Вейлора', artIndex: 14 },
  { name: 'Мицелия', artIndex: 15 },
  { name: 'Механика', artIndex: 16 },
  { name: 'Элизиум', artIndex: 17 },
  { name: 'Ноктис', artIndex: 18 },
] as const;

const SYSTEM_ONE_FIXTURES: Readonly<Record<number, { kind: UniversePlanetNode['kind']; name?: string; ownerId?: string; id?: string; artIndex?: number; known?: boolean; mode?: RuntimeMode; fixture?: UniverseFixtureMarker }>> = {
  1: { kind: 'player', id: 'player-planet-helion-01', ownerId: 'player-current', known: true },
  2: {
    kind: 'npc',
    id: TEST_MODE_ALLY_PLANET_FIXTURE.planet.id,
    name: TEST_MODE_ALLY_PLANET_FIXTURE.planet.name,
    ownerId: TEST_MODE_ALLY_PLANET_FIXTURE.owner.id,
    artIndex: 4,
    known: true,
    mode: 'test',
    fixture: TEST_MODE_ALLY_PLANET_FIXTURE.marker,
  },
  21: { kind: 'uninhabited', name: 'Необитаемый мир', artIndex: 8, known: true },
};

// Seeded once for a stable atlas: every bot system and position is sampled.
const npcRandom = mulberry32(10_701);
export const NPC_PLANET_FIXTURES = shuffle(Array.from({ length: SYSTEM_COUNT }, (_, index) => index + 1), npcRandom)
  .slice(0, MAX_PLANETS_PER_OWNER)
  .map((system, index) => {
    const slots = Array.from({ length: POSITION_COUNT }, (_, slot) => slot + 1)
      .filter((slot) => system !== 1 || !SYSTEM_ONE_FIXTURES[slot]);
    return {
      id: index === 0 ? 'npc-bot-01-prime' : `npc-bot-01-planet-${index + 1}`,
      system,
      position: slots[Math.floor(npcRandom() * slots.length)],
      name: BOT_PLANET_PRESETS[index].name,
      artIndex: BOT_PLANET_PRESETS[index].artIndex,
    };
  });

/** Stable seven-planet Bot 01 fixture consumed by the mod-test espionage slice. */
export const BOT_01_PLANET_FIXTURES = NPC_PLANET_FIXTURES;

const KIND_LABELS: Record<UniversePlanetNode['kind'], string> = {
  empty: 'Свободная позиция',
  player: 'Планета игрока',
  npc: 'Планета владельца',
  uninhabited: 'Необитаемая планета',
  unique: 'Уникальный объект',
  pirate: 'Пиратский объект',
  anomaly: 'Аномалия',
  asteroid: 'Астероид',
};

const KIND_DESCRIPTIONS: Record<UniversePlanetNode['kind'], string> = {
  empty: 'Свободная орбитальная позиция.',
  player: 'Ваша домашняя планета.',
  npc: 'Мир, принадлежащий владельцу этой планеты.',
  uninhabited: 'Необитаемый мир. Сведений о поселениях нет.',
  unique: 'Редкий мир, который ненадолго появляется в системе.',
  pirate: 'Отступник, временно занявший свободную координату.',
  anomaly: 'Необычный сигнал, который ненадолго проявился в системе.',
  asteroid: 'Движущийся объект. Траектория видна, запас газа скрыт до миссии переработчика.',
};

export type TimedObjectKind = 'pirate' | 'unique' | 'anomaly';
type TimedObjectSchedule = UniverseTimedObjectState & { startAt: number; present: boolean };
type TimedScheduleCache = { cycles: TimedObjectSchedule[]; nextStartAt: number; nextSpawnChance: number };
const timedScheduleCaches = new Map<string, TimedScheduleCache>();

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function seededRandom(...parts: number[]) {
  let seed = 2166136261;
  for (const part of parts) seed = Math.imul(seed ^ (Math.floor(part) >>> 0), 16777619);
  return mulberry32(seed >>> 0);
}

function randomInt(random: () => number, min: number, max: number) {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffle<T>(items: T[], random: () => number) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function pickAsset(assets: readonly string[], index: number, fallback: string) {
  return assets.length ? assets[Math.abs(index) % assets.length] : fallback;
}

function mergeAssets(assets?: Partial<UniverseAssetCatalog>): UniverseAssetCatalog {
  return {
    planetArts: assets?.planetArts?.length ? assets.planetArts : DEFAULT_ASSETS.planetArts,
    asteroidArts: assets?.asteroidArts?.length ? assets.asteroidArts : DEFAULT_ASSETS.asteroidArts,
    pirateArts: assets?.pirateArts?.length ? assets.pirateArts : DEFAULT_ASSETS.pirateArts,
    anomalyArts: assets?.anomalyArts?.length ? assets.anomalyArts : DEFAULT_ASSETS.anomalyArts,
    uniqueArts: assets?.uniqueArts?.length ? assets.uniqueArts : DEFAULT_ASSETS.uniqueArts,
    starArts: assets?.starArts?.length ? assets.starArts : DEFAULT_ASSETS.starArts,
  };
}

function normalizeNow(nowMs?: number) {
  return Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
}

export function formatUniverseCoordinate(coordinate: UniverseCoordinate) {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
}

export function universeCoordinateKey(coordinate: UniverseCoordinate) {
  return `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;
}

/** Stable screen position for a numbered coordinate, independent of time. */
export function getUniverseSlotPoint(slot: number): UniversePoint {
  return getOrbitPoint(slot, 0);
}

/** Fixed-pixel offset that places an asteroid's visual center over an occupied node's upper-left corner. */
const ASTEROID_OCCUPIED_ANCHOR_OFFSET = { x: -40, y: -42 };

function getUniverseAsteroidAnchorPoint(slot: number, attachedTo?: UniversePlanetNode): UniversePoint {
  const point = getUniverseSlotPoint(slot);
  if (!attachedTo || attachedTo.kind === 'empty') return point;
  return {
    x: point.x,
    y: point.y,
    offsetX: ASTEROID_OCCUPIED_ANCHOR_OFFSET.x,
    offsetY: ASTEROID_OCCUPIED_ANCHOR_OFFSET.y,
  };
}

function findAsteroidAttachmentTarget(
  coordinate: UniverseCoordinate,
  occupiedNodes: readonly UniversePlanetNode[] | undefined,
  asteroidId: string,
) {
  if (!occupiedNodes?.length) return undefined;
  const key = universeCoordinateKey(coordinate);
  return occupiedNodes.find((node) => node.id !== asteroidId && node.kind !== 'empty' && universeCoordinateKey(node.coordinate) === key);
}

/**
 * Move an asteroid through numbered coordinates. The galaxy boundary is
 * explicit: a second galaxy is used only when the caller says its data exists.
 */
export function advanceUniverseAsteroidCoordinate(
  coordinate: UniverseCoordinate,
  steps = 1,
  galaxyCount = 1,
): UniverseCoordinate | null {
  const safeSteps = Math.max(0, Math.floor(steps));
  const safeGalaxyCount = Math.max(1, Math.floor(galaxyCount));
  if (!Number.isInteger(coordinate.galaxy) || !Number.isInteger(coordinate.system) || !Number.isInteger(coordinate.position)) return null;
  if (coordinate.galaxy < 1 || coordinate.galaxy > safeGalaxyCount || coordinate.system < 1 || coordinate.system > SYSTEM_COUNT || coordinate.position < 1 || coordinate.position > POSITION_COUNT) return null;
  const positionsPerGalaxy = SYSTEM_COUNT * POSITION_COUNT;
  const linear = (coordinate.galaxy - 1) * positionsPerGalaxy
    + (coordinate.system - 1) * POSITION_COUNT
    + coordinate.position - 1
    + safeSteps;
  if (linear >= safeGalaxyCount * positionsPerGalaxy) return null;
  const galaxy = Math.floor(linear / positionsPerGalaxy) + 1;
  const galaxyOffset = linear % positionsPerGalaxy;
  return {
    galaxy,
    system: Math.floor(galaxyOffset / POSITION_COUNT) + 1,
    position: (galaxyOffset % POSITION_COUNT) + 1,
  };
}

function getOrbitPoint(slot: number, progress: number): UniversePoint {
  const safeSlot = Number.isFinite(slot) ? Math.min(POSITION_COUNT, Math.max(1, Math.floor(slot))) : 1;
  const ring = Math.floor((safeSlot - 1) / 6);
  const index = (safeSlot - 1) % 6;
  const radiusX = [19, 28, 36, 44][ring];
  const radiusY = [22, 27, 32, 37][ring];
  const offset = [-30, 0, -15, 15][ring];
  const angle = (((index + progress) * 60) + offset) * Math.PI / 180;

  return {
    x: 50 + Math.cos(angle) * radiusX,
    y: 52 + Math.sin(angle) * radiusY,
  };
}

/** The asteroid glides briefly between coordinate/target anchors at a dwell boundary. */
export function getUniverseAsteroidPoint(node: UniversePlanetNode, nowMs: number, occupiedNodes?: readonly UniversePlanetNode[]): UniversePoint {
  const currentTarget = findAsteroidAttachmentTarget(node.coordinate, occupiedNodes, node.id);
  const current = getUniverseAsteroidAnchorPoint(node.coordinate.position, currentTarget);
  const state = node.asteroid;
  if (!state?.nextCoordinate || !Number.isFinite(nowMs)) return current;
  const transitStart = state.nextMoveAt - ASTEROID_TRANSIT_MS;
  const progress = Math.min(1, Math.max(0, (nowMs - transitStart) / ASTEROID_TRANSIT_MS));
  if (progress <= 0) return current;
  const nextTarget = findAsteroidAttachmentTarget(state.nextCoordinate, occupiedNodes, node.id);
  const next = getUniverseAsteroidAnchorPoint(state.nextCoordinate.position, nextTarget);
  return {
    x: current.x + (next.x - current.x) * progress,
    y: current.y + (next.y - current.y) * progress,
    offsetX: (current.offsetX ?? 0) + ((next.offsetX ?? 0) - (current.offsetX ?? 0)) * progress,
    offsetY: (current.offsetY ?? 0) + ((next.offsetY ?? 0) - (current.offsetY ?? 0)) * progress,
  };
}

export function getUniverseObjectKindLabel(kind: UniversePlanetNode['kind']) {
  return KIND_LABELS[kind];
}

export type UniverseOwnerRelation = 'self' | 'ally' | 'enemy' | 'neutral';

export function getUniverseOwnerRelation(
  node: UniversePlanetNode,
  currentOwnerId: string,
  currentAlliance?: UniverseOwnerAlliance | null,
  targetOwner?: UniverseOwnerProfile,
  diplomacy?: readonly Pick<DiplomaticRelation, 'id' | 'tag' | 'status'>[],
): UniverseOwnerRelation {
  if (node.isHomeworld || node.ownerId === currentOwnerId) return 'self';

  const targetAlliance = targetOwner?.alliance;
  if (!currentAlliance || !targetAlliance) return 'neutral';
  if (currentAlliance.id === targetAlliance.id || currentAlliance.tag.toUpperCase() === targetAlliance.tag.toUpperCase()) return 'ally';

  const diplomaticRelation = diplomacy?.find((relation) => relation.id === targetAlliance.id
    || relation.tag.toUpperCase() === targetAlliance.tag.toUpperCase());
  return diplomaticRelation?.status === 'war' || diplomaticRelation?.status === 'hostile'
    ? 'enemy'
    : 'neutral';
}

export function getUniverseNodeCaption(node: UniversePlanetNode, currentPlayerName: string, ownerDisplayName = 'Владелец планеты') {
  if (node.isHomeworld) return `★ ${currentPlayerName}`;
  if (node.kind === 'npc') return ownerDisplayName;
  if (node.kind === 'uninhabited') return 'Необитаемая';
  if (node.kind === 'unique') return 'Уникальная';
  if (node.kind === 'pirate') return 'Отступник';
  if (node.kind === 'anomaly') return 'Аномалия';
  return node.name;
}

export function enforceUniversePlanetLimit(planetIds: readonly string[]) {
  const unique = [...new Set(planetIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
  return unique.slice(0, MAX_PLANETS_PER_OWNER);
}

export function normalizeUniverseOwnerProfile(profile: UniverseOwnerProfile): UniverseOwnerProfile {
  return {
    ...profile,
    displayName: profile.displayName.trim() || 'Неизвестный владелец',
    planetIds: enforceUniversePlanetLimit(profile.planetIds),
  };
}

export type CreateUniverseSystemOptions = {
  mode?: RuntimeMode;
  galaxy?: number;
  system: number;
  currentOwnerId?: string;
  currentPlanetName?: string;
  currentPlanetArt?: string;
  assets?: Partial<UniverseAssetCatalog>;
  nowMs?: number;
  galaxyCount?: number;
  /** When supplied, use persisted positions rather than a wall-clock projection. */
  asteroidStates?: readonly UniverseAsteroidRuntimeState[];
  playerPlanets?: readonly UniversePersistedPlayerPlanet[];
  registeredPlanets?: readonly UniverseRegisteredPlanet[];
};

function persistedPlanetFor(options: CreateUniverseSystemOptions, galaxy: number, system: number, slot: number) {
  return options.playerPlanets?.find((planet) => planet.coordinate.galaxy === galaxy
    && planet.coordinate.system === system
    && planet.coordinate.position === slot);
}

function registeredPlanetFor(options: CreateUniverseSystemOptions, galaxy: number, system: number, slot: number) {
  return options.registeredPlanets?.find((planet) => planet.coordinate.galaxy === galaxy
    && planet.coordinate.system === system
    && planet.coordinate.position === slot);
}

function botFixtureFor(system: number, slot: number, mode: RuntimeMode = 'test') {
  const npc = mode === 'test'
    ? NPC_PLANET_FIXTURES.find((planet) => planet.system === system && planet.position === slot)
    : undefined;
  return npc ? { ...npc, kind: 'npc' as const, ownerId: NPC_OWNER_ID, known: true } : undefined;
}

function fixtureFor(system: number, slot: number, mode: RuntimeMode = 'test', registeredPlanets?: readonly UniverseRegisteredPlanet[]) {
  const npc = botFixtureFor(system, slot, mode);
  // When an authoritative runtime registry is supplied, its presence is the
  // source of truth for Bot 01 planets. This prevents a destroyed target from
  // being recreated by the static Test Mode atlas on the next render/reload.
  if (npc && (registeredPlanets === undefined || registeredPlanets.some((planet) => planet.id === npc.id))) return npc;
  if (system === 1) {
    const fixture = SYSTEM_ONE_FIXTURES[slot];
    return fixture?.mode && fixture.mode !== mode ? undefined : fixture;
  }
  return undefined;
}

function isSuppressedBotFixture(options: CreateUniverseSystemOptions, galaxy: number, system: number, slot: number) {
  if (options.mode !== 'test' || options.registeredPlanets === undefined) return false;
  const npc = botFixtureFor(system, slot, options.mode);
  if (!npc) return false;
  return !options.playerPlanets?.some((planet) => planet.coordinate.galaxy === galaxy
    && planet.coordinate.system === system
    && planet.coordinate.position === slot)
    && !options.registeredPlanets.some((planet) => planet.coordinate.galaxy === galaxy
      && planet.coordinate.system === system
      && planet.coordinate.position === slot);
}

function generatedKind(): UniversePlanetNode['kind'] {
  return 'uninhabited';
}

function createPositionNode(
  galaxy: number,
  system: number,
  slot: number,
  options: CreateUniverseSystemOptions,
  assets: UniverseAssetCatalog,
): UniversePlanetNode {
  const persisted = persistedPlanetFor(options, galaxy, system, slot);
  const registered = persisted ? undefined : registeredPlanetFor(options, galaxy, system, slot);
  const coordinate = { galaxy, system, position: slot };
  if (isSuppressedBotFixture(options, galaxy, system, slot) && !persisted && !registered) {
    return {
      id: `universe-empty-${galaxy}-${system}-${slot}`,
      coordinate,
      kind: 'empty',
      name: 'Свободная позиция',
      art: '',
      statusLabel: KIND_LABELS.empty,
      description: KIND_DESCRIPTIONS.empty,
      known: true,
      positionCoefficientPercent: getPositionCoefficientPercent(slot),
    };
  }
  const fixture = persisted || registered
    ? undefined
    : fixtureFor(system, slot, options.mode, options.registeredPlanets);
  const kind = persisted ? 'player' : registered?.kind ?? fixture?.kind ?? generatedKind();
  const ownerId = persisted?.ownerId ?? registered?.ownerId ?? fixture?.ownerId;
  const isHomeworld = persisted?.isHomeworld ?? registered?.isHomeworld ?? (kind === 'player' && system === 1 && slot === 1);
  const name = persisted?.name?.trim() || (isHomeworld
    ? options.currentPlanetName?.trim() || 'Helion 01'
    : (registered?.name?.trim() || fixture?.name || `Планета ${String(system).padStart(2, '0')}-${String(slot).padStart(2, '0')}`));
  const art = persisted?.art?.trim() || registered?.art?.trim() || (isHomeworld
    ? options.currentPlanetArt?.trim() || pickAsset(assets.planetArts, slot, 'planet-home')
    : pickAsset(assets.planetArts, fixture?.artIndex ?? system * 5 + slot, 'planet-default'));
  const fixtureMarker = fixture && 'fixture' in fixture ? fixture.fixture : undefined;

  return {
    id: persisted?.id ?? registered?.id ?? fixture?.id ?? `universe-${galaxy}-${system}-${slot}`,
    coordinate,
    kind,
    name,
    art: kind === 'empty' ? '' : art,
    ownerId: kind === 'player' ? ownerId ?? options.currentOwnerId ?? 'player-current' : ownerId,
    isHomeworld,
    statusLabel: KIND_LABELS[kind],
    description: KIND_DESCRIPTIONS[kind],
    known: registered?.known ?? fixture?.known ?? true,
    ...(fixtureMarker ? { fixture: fixtureMarker } : {}),
    positionCoefficientPercent: getPositionCoefficientPercent(slot),
  };
}

function createUniverseSystemBase(options: CreateUniverseSystemOptions, assets: UniverseAssetCatalog): UniverseSystem {
  const galaxy = Math.max(1, Math.floor(options.galaxy ?? GALAXY));
  const system = Math.min(SYSTEM_COUNT, Math.max(1, Math.floor(options.system)));
  const random = mulberry32(10_000 + galaxy * 977 + system * 1_003);
  const fixtureSlots = Array.from({ length: POSITION_COUNT }, (_, index) => index + 1)
    .filter((slot) => fixtureFor(system, slot, options.mode, options.registeredPlanets) || isSuppressedBotFixture(options, galaxy, system, slot));
  const persistedSlots = (options.playerPlanets ?? [])
    .filter((planet) => planet.coordinate.galaxy === galaxy && planet.coordinate.system === system)
    .map((planet) => planet.coordinate.position);
  const registeredSlots = (options.registeredPlanets ?? [])
    .filter((planet) => planet.coordinate.galaxy === galaxy && planet.coordinate.system === system)
    .map((planet) => planet.coordinate.position);
  const planetCount = 8 + ((galaxy + system) % 7);
  const fixedSlots = [...new Set([...fixtureSlots, ...persistedSlots, ...registeredSlots])];
  const remainingSlots = shuffle(
    Array.from({ length: POSITION_COUNT }, (_, index) => index + 1).filter((slot) => !fixedSlots.includes(slot)),
    random,
  );
  const occupiedSlots = new Set([...fixedSlots, ...remainingSlots.slice(0, Math.max(0, planetCount - fixedSlots.length))]);
  const positions = Array.from({ length: POSITION_COUNT }, (_, index) => index + 1).map((slot) => occupiedSlots.has(slot)
    ? createPositionNode(galaxy, system, slot, options, assets)
    : {
      id: `universe-empty-${galaxy}-${system}-${slot}`,
      coordinate: { galaxy, system, position: slot },
      kind: 'empty' as const,
      name: 'Свободная позиция',
      art: '',
      statusLabel: KIND_LABELS.empty,
      description: KIND_DESCRIPTIONS.empty,
      known: true,
      positionCoefficientPercent: getPositionCoefficientPercent(slot),
    });

  return {
    galaxy,
    system,
    starArt: pickAsset(assets.starArts, system - 1, 'star-default'),
    sunEfficiencyPercent: getSunEfficiencyPercent(system),
    positions,
    asteroids: [],
  };
}

function asteroidSpawnIndexAt(nowMs: number) {
  return Math.floor((nowMs - ASTEROID_SCHEDULE_EPOCH_MS) / ASTEROID_SPAWN_INTERVAL_MS);
}

export function getUniverseAsteroidDwellMs(spawnIndex: number, movementIndex: number) {
  const random = seededRandom(0xA57E, spawnIndex, movementIndex);
  return randomInt(random, ASTEROID_MIN_DWELL_MS, ASTEROID_MAX_DWELL_MS);
}

export function getUniverseAsteroidState(spawnIndex: number, nowMs: number, galaxyCount = 1): InitializedUniverseAsteroidRuntimeState | null {
  const safeNow = normalizeNow(nowMs);
  if (!Number.isInteger(spawnIndex) || spawnIndex < 0) return null;
  const spawnedAt = ASTEROID_SCHEDULE_EPOCH_MS + spawnIndex * ASTEROID_SPAWN_INTERVAL_MS;
  if (spawnedAt > safeNow) return null;
  const random = seededRandom(0xA570, spawnIndex);
  let coordinate: UniverseCoordinate = { galaxy: GALAXY, system: 1, position: randomInt(random, 1, POSITION_COUNT) };
  let movementIndex = 0;
  let previousMoveAt = spawnedAt;
  let nextMoveAt = spawnedAt + getUniverseAsteroidDwellMs(spawnIndex, movementIndex);
  while (safeNow >= nextMoveAt) {
    previousMoveAt = nextMoveAt;
    const nextCoordinate = advanceUniverseAsteroidCoordinate(coordinate, 1, galaxyCount);
    if (!nextCoordinate) return null;
    coordinate = nextCoordinate;
    movementIndex += 1;
    nextMoveAt = previousMoveAt + getUniverseAsteroidDwellMs(spawnIndex, movementIndex);
  }
  const nextCoordinate = advanceUniverseAsteroidCoordinate(coordinate, 1, galaxyCount) ?? undefined;
  const gasRandom = seededRandom(0x6A5, spawnIndex);
  const gasYield = randomInt(gasRandom, ASTEROID_GAS_MIN, ASTEROID_GAS_MAX);
  return initializeAsteroidGasState({
    spawnIndex,
    spawnedAt,
    movementIndex,
    previousMoveAt,
    nextMoveAt,
    nextCoordinate,
    gasYield,
    coordinate,
  }, safeNow);
}

function advanceAsteroidAfterCollision(state: UniverseAsteroidRuntimeState, nowMs: number, galaxyCount: number): UniverseAsteroidRuntimeState | null {
  const coordinate = advanceUniverseAsteroidCoordinate(state.coordinate, 1, galaxyCount);
  if (!coordinate) return null;
  const movementIndex = state.movementIndex + 1;
  const nextMoveAt = nowMs + getUniverseAsteroidDwellMs(state.spawnIndex, movementIndex);
  return {
    ...state,
    coordinate,
    movementIndex,
    previousMoveAt: nowMs,
    nextMoveAt,
    nextCoordinate: advanceUniverseAsteroidCoordinate(coordinate, 1, galaxyCount) ?? undefined,
  };
}

/**
 * Resolve same-coordinate arrivals deterministically. The asteroid arriving
 * later keeps the coordinate; the earlier occupant is pushed one position
 * forward and receives a fresh dwell timer from the collision moment.
 */
export function resolveUniverseAsteroidCollisions(
  states: readonly UniverseAsteroidRuntimeState[],
  nowMs: number,
  galaxyCount = 1,
): UniverseAsteroidRuntimeState[] {
  const safeNow = normalizeNow(nowMs);
  const resolvedBySpawn = new Map<number, UniverseAsteroidRuntimeState>();
  const occupied = new Map<string, UniverseAsteroidRuntimeState>();
  const ordered = [...states].sort((left, right) => left.previousMoveAt - right.previousMoveAt || left.spawnIndex - right.spawnIndex);

  const place = (state: UniverseAsteroidRuntimeState): void => {
    const key = universeCoordinateKey(state.coordinate);
    const occupant = occupied.get(key);
    if (occupant && occupant.spawnIndex !== state.spawnIndex) {
      occupied.delete(key);
      const displaced = advanceAsteroidAfterCollision(occupant, safeNow, galaxyCount);
      if (displaced) place(displaced);
      else resolvedBySpawn.delete(occupant.spawnIndex);
    }
    occupied.set(key, state);
    resolvedBySpawn.set(state.spawnIndex, state);
  };

  for (const state of ordered) place({ ...state });
  return states.map((state) => resolvedBySpawn.get(state.spawnIndex)).filter((state): state is UniverseAsteroidRuntimeState => Boolean(state));
}

function createAsteroidNode(state: UniverseAsteroidRuntimeState, assets: UniverseAssetCatalog): UniversePlanetNode {
  return {
    id: `asteroid-${state.coordinate.galaxy}-${state.spawnIndex}`,
    coordinate: state.coordinate,
    kind: 'asteroid',
    name: `Астероид ${String(state.spawnIndex + 1).padStart(4, '0')}`,
    art: pickAsset(assets.asteroidArts, state.spawnIndex, 'asteroid-default'),
    statusLabel: KIND_LABELS.asteroid,
    description: KIND_DESCRIPTIONS.asteroid,
    known: true,
    asteroid: state,
  };
}

function createActiveAsteroidsBySystem(
  galaxy: number,
  nowMs: number,
  galaxyCount: number,
  assets: UniverseAssetCatalog,
  persistedStates?: readonly UniverseAsteroidRuntimeState[],
) {
  const grouped = Array.from({ length: SYSTEM_COUNT }, () => [] as UniversePlanetNode[]);
  let states: UniverseAsteroidRuntimeState[];
  if (persistedStates) {
    states = persistedStates.map((state) => ({
      ...state,
      coordinate: { ...state.coordinate },
      nextCoordinate: state.nextCoordinate ? { ...state.nextCoordinate } : undefined,
    }));
  } else {
    states = [];
    const currentSpawnIndex = asteroidSpawnIndexAt(nowMs);
    if (currentSpawnIndex < 0) return grouped;
    const maxRouteMs = galaxyCount * SYSTEM_COUNT * POSITION_COUNT * ASTEROID_MAX_DWELL_MS;
    const firstSpawnIndex = Math.max(0, currentSpawnIndex - Math.ceil(maxRouteMs / ASTEROID_SPAWN_INTERVAL_MS) - 1);
    for (let spawnIndex = firstSpawnIndex; spawnIndex <= currentSpawnIndex; spawnIndex += 1) {
      const state = getUniverseAsteroidState(spawnIndex, nowMs, galaxyCount);
      if (state) states.push(state);
    }
    states = resolveUniverseAsteroidCollisions(states, nowMs, galaxyCount);
  }
  for (const state of states) {
    if (state.coordinate.galaxy === galaxy) grouped[state.coordinate.system - 1].push(createAsteroidNode(state, assets));
  }
  return grouped;
}

function timedObjectConfig(kind: TimedObjectKind) {
  if (kind === 'pirate') return {
    epoch: PIRATE_SCHEDULE_EPOCH_MS,
    seed: 0xB1A,
    minLifetimeMs: PIRATE_MIN_LIFETIME_MS,
    maxLifetimeMs: PIRATE_MAX_LIFETIME_MS,
    quietMs: PIRATE_QUIET_MS,
    initialChance: 1 - PIRATE_ABSENCE_PROBABILITY,
    chanceStep: 0,
  };
  if (kind === 'unique') return {
    epoch: PIRATE_SCHEDULE_EPOCH_MS,
    seed: 0xC01,
    minLifetimeMs: UNIQUE_MIN_LIFETIME_MS,
    maxLifetimeMs: UNIQUE_MAX_LIFETIME_MS,
    quietMs: UNIQUE_QUIET_MS,
    initialChance: UNIQUE_INITIAL_SPAWN_CHANCE,
    chanceStep: UNIQUE_SPAWN_CHANCE_STEP,
  };
  return {
    epoch: PIRATE_SCHEDULE_EPOCH_MS,
    seed: 0xA01,
    minLifetimeMs: ANOMALY_MIN_LIFETIME_MS,
    maxLifetimeMs: ANOMALY_MAX_LIFETIME_MS,
    quietMs: ANOMALY_QUIET_MS,
    initialChance: ANOMALY_INITIAL_SPAWN_CHANCE,
    chanceStep: ANOMALY_SPAWN_CHANCE_STEP,
  };
}

function timedCacheKey(kind: TimedObjectKind, galaxy: number, system: number) {
  return `${kind}:${galaxy}:${system}`;
}

function ensureTimedCycles(kind: TimedObjectKind, galaxy: number, system: number, throughMs: number) {
  const config = timedObjectConfig(kind);
  const key = timedCacheKey(kind, galaxy, system);
  let cache = timedScheduleCaches.get(key);
  if (!cache) {
    const offsetRandom = seededRandom(config.seed, galaxy, system, 0);
    cache = {
      cycles: [],
      nextStartAt: config.epoch + randomInt(offsetRandom, 0, 60 * 60 * 1_000),
      nextSpawnChance: config.initialChance,
    };
    timedScheduleCaches.set(key, cache);
  }
  while (cache.nextStartAt <= throughMs + config.maxLifetimeMs) {
    const cycleIndex = cache.cycles.length;
    const random = seededRandom(config.seed, galaxy, system, cycleIndex + 1);
    const lifetimeMs = randomInt(random, config.minLifetimeMs, config.maxLifetimeMs);
    const startAt = cache.nextStartAt;
    const spawnChance = cache.nextSpawnChance;
    const present = random() < spawnChance;
    const expiresAt = present ? startAt + lifetimeMs : startAt;
    const respawnAt = (present ? expiresAt : startAt) + config.quietMs;
    cache.cycles.push({ cycleIndex, startAt, expiresAt, respawnAt, lifetimeMs, spawnChance, present });
    cache.nextSpawnChance = present || config.chanceStep === 0
      ? config.initialChance
      : Math.min(1, spawnChance + config.chanceStep);
    cache.nextStartAt = respawnAt;
  }
  return cache.cycles;
}

export type UniverseTimedObjectSchedule = TimedObjectSchedule;

export function getUniverseTimedObjectSchedule(kind: TimedObjectKind, galaxy: number, system: number, cycleIndex: number): UniverseTimedObjectSchedule {
  const config = timedObjectConfig(kind);
  const safeIndex = Math.max(0, Math.floor(cycleIndex));
  const cycles = ensureTimedCycles(kind, galaxy, system, config.epoch + (safeIndex + 1) * (config.maxLifetimeMs + config.quietMs));
  return cycles[safeIndex] ?? cycles[0];
}

function activeTimedObjectSchedule(kind: TimedObjectKind, galaxy: number, system: number, nowMs: number) {
  const cycles = ensureTimedCycles(kind, galaxy, system, nowMs);
  for (let index = cycles.length - 1; index >= 0; index -= 1) {
    const cycle = cycles[index];
    if (cycle.startAt > nowMs) continue;
    if (nowMs < cycle.respawnAt) return cycle;
  }
  return null;
}

function timedState(schedule: TimedObjectSchedule): UniverseTimedObjectState {
  return {
    cycleIndex: schedule.cycleIndex,
    expiresAt: schedule.expiresAt,
    respawnAt: schedule.respawnAt,
    lifetimeMs: schedule.lifetimeMs,
    spawnChance: schedule.spawnChance,
  };
}

function injectTimedObject(system: UniverseSystem, kind: TimedObjectKind, nowMs: number, assets: UniverseAssetCatalog): UniverseSystem {
  const schedule = activeTimedObjectSchedule(kind, system.galaxy, system.system, nowMs);
  if (!schedule?.present || nowMs >= schedule.expiresAt) return system;
  const emptySlots = system.positions.filter((node) => node.kind === 'empty');
  if (!emptySlots.length) return system;
  const random = seededRandom(timedObjectConfig(kind).seed + 0x55, system.galaxy, system.system, schedule.cycleIndex);
  const target = emptySlots[Math.floor(random() * emptySlots.length)];
  const state = timedState(schedule);
  const node: UniversePlanetNode = kind === 'pirate'
    ? {
      id: `pirate-${system.galaxy}-${system.system}`,
      coordinate: target.coordinate,
      kind: 'pirate',
      name: 'Пиратский объект «Клык»',
      art: pickAsset(assets.pirateArts, system.system + schedule.cycleIndex, 'pirate-default'),
      statusLabel: KIND_LABELS.pirate,
      description: KIND_DESCRIPTIONS.pirate,
      known: true,
      pirate: state as UniversePirateState,
    }
    : {
      id: `${kind}-${system.galaxy}-${system.system}`,
      coordinate: target.coordinate,
      kind,
      name: kind === 'unique' ? ['Осколки Эдема', 'Сердце Бездны', 'Кристаллический разлом'][(system.system + schedule.cycleIndex) % 3] : 'Аномалия «Люмен»',
      art: pickAsset(kind === 'unique' ? assets.uniqueArts : assets.anomalyArts, system.system + schedule.cycleIndex, `${kind}-default`),
      statusLabel: KIND_LABELS[kind],
      description: KIND_DESCRIPTIONS[kind],
      known: true,
      special: state,
    };
  return {
    ...system,
    positions: system.positions.map((item) => item.id === target.id ? node : item),
  };
}

export function createUniverseSystem(options: CreateUniverseSystemOptions): UniverseSystem {
  const assets = mergeAssets(options.assets);
  const nowMs = normalizeNow(options.nowMs);
  const galaxyCount = Math.max(1, Math.floor(options.galaxyCount ?? 1));
  const asteroidNodes = createActiveAsteroidsBySystem(
    Math.max(1, Math.floor(options.galaxy ?? GALAXY)), nowMs, galaxyCount, assets, options.asteroidStates,
  );
  let system = createUniverseSystemBase(options, assets);
  system = injectTimedObject(system, 'pirate', nowMs, assets);
  system = injectTimedObject(system, 'unique', nowMs, assets);
  system = injectTimedObject(system, 'anomaly', nowMs, assets);
  return {
    ...system,
    asteroids: asteroidNodes[system.system - 1],
  };
}

export function createUniverseMap(options: Omit<CreateUniverseSystemOptions, 'system'> = {}): UniverseMap {
  const galaxy = Math.max(1, Math.floor(options.galaxy ?? GALAXY));
  const nowMs = normalizeNow(options.nowMs);
  const galaxyCount = Math.max(1, Math.floor(options.galaxyCount ?? 1));
  const assets = mergeAssets(options.assets);
  const asteroidNodes = createActiveAsteroidsBySystem(galaxy, nowMs, galaxyCount, assets, options.asteroidStates);
  const systems = Array.from({ length: SYSTEM_COUNT }, (_, index) => {
    let system = createUniverseSystemBase({ ...options, galaxy, system: index + 1 }, assets);
    system = injectTimedObject(system, 'pirate', nowMs, assets);
    system = injectTimedObject(system, 'unique', nowMs, assets);
    system = injectTimedObject(system, 'anomaly', nowMs, assets);
    return { ...system, asteroids: asteroidNodes[index] };
  });
  return { galaxy, systems };
}

export function getUniverseActionState(
  action: UniverseAction,
  node: UniversePlanetNode,
  currentOwnerId: string,
  relation?: UniverseOwnerRelation,
): UniverseActionState {
  const label = action === 'spy' ? 'Отправить шпионский зонд' : action === 'attack' ? 'Начать атаку' : 'Отправить флот';
  if (node.kind !== 'player' && node.kind !== 'npc') {
    return {
      action,
      enabled: false,
      status: 'disabled',
      label,
      reason: 'Цель не является доступной планетой.',
    };
  }
  if (node.ownerId === currentOwnerId || node.isHomeworld) {
    if (action === 'fleet') {
      return {
        action,
        enabled: true,
        status: 'supported',
        label,
        reason: 'Своя планета принимает транспортировку.',
      };
    }
    return {
      action,
      enabled: false,
      status: 'disabled',
      label,
      reason: action === 'attack' ? 'Атака запрещена против своей планеты.' : 'Это ваша планета.',
    };
  }
  if (action === 'fleet' && node.fixture?.id === TEST_MODE_ALLY_PLANET_FIXTURE.marker.id) {
    return {
      action,
      enabled: true,
      status: 'supported',
      label,
      reason: 'Союзная планета принимает транспортировку.',
    };
  }
  if (action === 'fleet') {
    return {
      action,
      enabled: false,
      status: 'disabled',
      label,
      reason: 'Транспортировка доступна только на свою или явную союзную планету.',
    };
  }
  const targetRelation = relation ?? 'neutral';
  if (targetRelation === 'ally') {
    return {
      action,
      enabled: false,
      status: 'disabled',
      label,
      reason: action === 'attack' ? 'Атака запрещена против союзной планеты.' : 'Шпионаж запрещён против союзной планеты.',
    };
  }
  if (targetRelation === 'self') {
    return {
      action,
      enabled: false,
      status: 'disabled',
      label,
      reason: action === 'attack' ? 'Атака запрещена против своей планеты.' : 'Шпионаж запрещён против своей планеты.',
    };
  }
  return {
    action,
    enabled: true,
    status: 'supported',
    label,
    reason: targetRelation === 'enemy'
      ? action === 'attack' ? 'Вражеская цель доступна для атаки.' : 'Вражеская цель доступна для шпионажа.'
      : action === 'attack' ? 'Нейтральная цель доступна для атаки.' : 'Нейтральная цель доступна для шпионажа.',
  };
}

export function createUniverseNpcOwnerProfile(
  points?: UniverseOwnerPoints,
  registeredPlanetIds?: readonly string[],
): UniverseOwnerProfile {
  return normalizeUniverseOwnerProfile({
    id: NPC_OWNER_ID,
    displayName: 'Бот 01',
    raceId: 'veyra',
    ...(points ? { points } : {}),
    // The fixture list is only the default for callers that do not have a
    // runtime registry. UniverseView supplies the authoritative IDs after
    // reload so destroyed targets cannot reappear in the owner inspector.
    planetIds: registeredPlanetIds
      ? [...registeredPlanetIds]
      : NPC_PLANET_FIXTURES.map((planet) => planet.id),
  });
}

export const UNIVERSE_NPC_OWNER_ID = NPC_OWNER_ID;
