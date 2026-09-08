import type {
  UniverseAction,
  UniverseActionState,
  UniverseAssetCatalog,
  UniverseAsteroidState,
  UniverseCoordinate,
  UniverseMap,
  UniverseOwnerAlliance,
  UniverseOwnerProfile,
  UniversePlanetNode,
  UniversePoint,
  UniversePirateState,
  UniverseSystem,
  UniverseTimedObjectState,
} from './types.ts';

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

const BOT_PLANET_PRESETS = [
  { name: 'Аурелия', artIndex: 12 },
  { name: 'Кальдера', artIndex: 13 },
  { name: 'Вейлора', artIndex: 14 },
  { name: 'Мицелия', artIndex: 15 },
  { name: 'Механика', artIndex: 16 },
  { name: 'Элизиум', artIndex: 17 },
  { name: 'Ноктис', artIndex: 18 },
] as const;

const SYSTEM_ONE_FIXTURES: Readonly<Record<number, { kind: UniversePlanetNode['kind']; name?: string; ownerId?: string; id?: string; artIndex?: number; known?: boolean }>> = {
  1: { kind: 'player', id: 'player-planet-helion-01', ownerId: 'player-current', known: true },
  21: { kind: 'uninhabited', name: 'Необитаемый мир', artIndex: 8, known: true },
};

// Seeded once for a stable atlas: every bot system and position is sampled.
const npcRandom = mulberry32(10_701);
const NPC_PLANET_FIXTURES = shuffle(Array.from({ length: SYSTEM_COUNT }, (_, index) => index + 1), npcRandom)
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

function getAsteroidOrbitOffset(slot: number): UniversePoint {
  const safeSlot = Number.isFinite(slot) ? Math.min(POSITION_COUNT, Math.max(1, Math.floor(slot))) : 1;
  const ring = Math.floor((safeSlot - 1) / 6);
  const index = (safeSlot - 1) % 6;
  const ringOffset = [-30, 0, -15, 15][ring];
  const angle = ((index * 60 + ringOffset) + 90) * Math.PI / 180;
  return { x: Math.cos(angle) * 4.2, y: Math.sin(angle) * 5.4 };
}

/** Asteroids keep their numbered coordinate but render as a nearby companion, like a local orbital object. */
function getUniverseAsteroidAnchorPoint(slot: number): UniversePoint {
  const point = getUniverseSlotPoint(slot);
  const offset = getAsteroidOrbitOffset(slot);
  return { x: point.x + offset.x, y: point.y + offset.y };
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

/** The asteroid glides briefly between two numbered coordinates at a dwell boundary. */
export function getUniverseAsteroidPoint(node: UniversePlanetNode, nowMs: number): UniversePoint {
  const current = getUniverseAsteroidAnchorPoint(node.coordinate.position);
  const state = node.asteroid;
  if (!state?.nextCoordinate || !Number.isFinite(nowMs)) return current;
  const transitStart = state.nextMoveAt - ASTEROID_TRANSIT_MS;
  const progress = Math.min(1, Math.max(0, (nowMs - transitStart) / ASTEROID_TRANSIT_MS));
  if (progress <= 0) return current;
  const next = getUniverseAsteroidAnchorPoint(state.nextCoordinate.position);
  return {
    x: current.x + (next.x - current.x) * progress,
    y: current.y + (next.y - current.y) * progress,
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
): UniverseOwnerRelation {
  if (node.isHomeworld || node.ownerId === currentOwnerId) return 'self';

  const targetAlliance = targetOwner?.alliance;
  if (!currentAlliance || !targetAlliance) return 'neutral';
  return currentAlliance.id === targetAlliance.id || currentAlliance.tag === targetAlliance.tag ? 'ally' : 'enemy';
}

export function getUniverseNodeCaption(node: UniversePlanetNode, currentPlayerName: string, ownerDisplayName = 'Бот 01') {
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
  galaxy?: number;
  system: number;
  currentOwnerId?: string;
  currentPlanetName?: string;
  currentPlanetArt?: string;
  assets?: Partial<UniverseAssetCatalog>;
  nowMs?: number;
  galaxyCount?: number;
};

function fixtureFor(system: number, slot: number) {
  const npc = NPC_PLANET_FIXTURES.find((planet) => planet.system === system && planet.position === slot);
  if (npc) return { ...npc, kind: 'npc' as const, ownerId: NPC_OWNER_ID, known: true };
  if (system === 1) return SYSTEM_ONE_FIXTURES[slot];
  return undefined;
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
  const fixture = fixtureFor(system, slot);
  const coordinate = { galaxy, system, position: slot };
  const kind = fixture?.kind ?? generatedKind();
  const ownerId = fixture?.ownerId;
  const isHomeworld = kind === 'player' && system === 1 && slot === 1;
  const name = isHomeworld
    ? options.currentPlanetName?.trim() || 'Helion 01'
    : fixture?.name ?? `Планета ${String(system).padStart(2, '0')}-${String(slot).padStart(2, '0')}`;
  const art = isHomeworld
    ? options.currentPlanetArt?.trim() || pickAsset(assets.planetArts, slot, 'planet-home')
    : pickAsset(assets.planetArts, fixture?.artIndex ?? system * 5 + slot, 'planet-default');

  return {
    id: fixture?.id ?? `universe-${galaxy}-${system}-${slot}`,
    coordinate,
    kind,
    name,
    art: kind === 'empty' ? '' : art,
    ownerId: isHomeworld ? options.currentOwnerId ?? 'player-current' : ownerId,
    isHomeworld,
    statusLabel: KIND_LABELS[kind],
    description: KIND_DESCRIPTIONS[kind],
    known: fixture?.known ?? true,
  };
}

function createUniverseSystemBase(options: CreateUniverseSystemOptions, assets: UniverseAssetCatalog): UniverseSystem {
  const galaxy = Math.max(1, Math.floor(options.galaxy ?? GALAXY));
  const system = Math.min(SYSTEM_COUNT, Math.max(1, Math.floor(options.system)));
  const random = mulberry32(10_000 + galaxy * 977 + system * 1_003);
  const fixtureSlots = Array.from({ length: POSITION_COUNT }, (_, index) => index + 1)
    .filter((slot) => fixtureFor(system, slot));
  const planetCount = 8 + ((galaxy + system) % 7);
  const remainingSlots = shuffle(
    Array.from({ length: POSITION_COUNT }, (_, index) => index + 1).filter((slot) => !fixtureSlots.includes(slot)),
    random,
  );
  const occupiedSlots = new Set([...fixtureSlots, ...remainingSlots.slice(0, Math.max(0, planetCount - fixtureSlots.length))]);
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
    });

  return {
    galaxy,
    system,
    starArt: pickAsset(assets.starArts, system - 1, 'star-default'),
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

export function getUniverseAsteroidState(spawnIndex: number, nowMs: number, galaxyCount = 1): UniverseAsteroidState & { coordinate: UniverseCoordinate } | null {
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
  return {
    spawnIndex,
    spawnedAt,
    previousMoveAt,
    nextMoveAt,
    nextCoordinate,
    gasYield,
    coordinate,
  };
}

function createAsteroidNode(state: UniverseAsteroidState & { coordinate: UniverseCoordinate }, assets: UniverseAssetCatalog): UniversePlanetNode {
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

function createActiveAsteroidsBySystem(galaxy: number, nowMs: number, galaxyCount: number, assets: UniverseAssetCatalog) {
  const grouped = Array.from({ length: SYSTEM_COUNT }, () => [] as UniversePlanetNode[]);
  const currentSpawnIndex = asteroidSpawnIndexAt(nowMs);
  if (currentSpawnIndex < 0) return grouped;
  const maxRouteMs = galaxyCount * SYSTEM_COUNT * POSITION_COUNT * ASTEROID_MAX_DWELL_MS;
  const firstSpawnIndex = Math.max(0, currentSpawnIndex - Math.ceil(maxRouteMs / ASTEROID_SPAWN_INTERVAL_MS) - 1);
  for (let spawnIndex = firstSpawnIndex; spawnIndex <= currentSpawnIndex; spawnIndex += 1) {
    const state = getUniverseAsteroidState(spawnIndex, nowMs, galaxyCount);
    if (state?.coordinate.galaxy === galaxy) grouped[state.coordinate.system - 1].push(createAsteroidNode(state, assets));
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
  const asteroidNodes = createActiveAsteroidsBySystem(Math.max(1, Math.floor(options.galaxy ?? GALAXY)), nowMs, galaxyCount, assets);
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
  const asteroidNodes = createActiveAsteroidsBySystem(galaxy, nowMs, galaxyCount, assets);
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
): UniverseActionState {
  const label = action === 'spy' ? 'Отправить шпионский зонд' : 'Отправить флот';
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
    return {
      action,
      enabled: false,
      status: 'disabled',
      label,
      reason: 'Это ваша планета.',
    };
  }
  return {
    action,
    enabled: true,
    status: 'prototype',
    label,
    reason: 'Прототип — отправка не подключена.',
  };
}

export function createUniverseNpcOwnerProfile(): UniverseOwnerProfile {
  return normalizeUniverseOwnerProfile({
    id: NPC_OWNER_ID,
    displayName: 'Бот 01',
    planetIds: NPC_PLANET_FIXTURES.map((planet) => planet.id),
  });
}

export const UNIVERSE_NPC_OWNER_ID = NPC_OWNER_ID;
