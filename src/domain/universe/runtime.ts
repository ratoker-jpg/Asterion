import type {
  UniverseAction,
  UniverseActionState,
  UniverseAssetCatalog,
  UniverseCoordinate,
  UniverseMap,
  UniverseOwnerProfile,
  UniversePlanetNode,
  UniversePoint,
  UniverseSystem,
} from './types.ts';

export const GALAXY = 1;
export const SYSTEM_COUNT = 40;
export const POSITION_COUNT = 24;
export const MAX_PLANETS_PER_OWNER = 7;

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
  8: { kind: 'pirate', name: 'Пиратский объект «Клык»', artIndex: 0, known: true },
  13: { kind: 'anomaly', name: 'Аномалия «Люмен»', artIndex: 0, known: true },
  17: { kind: 'unique', name: 'Осколки Эдема', artIndex: 0, known: true },
  21: { kind: 'uninhabited', name: 'Необитаемый мир', artIndex: 8, known: true },
};

// Seeded once for a stable atlas: every bot system and position is sampled.
// Reserve authored landmarks without replacing them with an NPC world.
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
  npc: 'Планета Бота 01',
  uninhabited: 'Необитаемая планета',
  unique: 'Уникальный объект',
  pirate: 'Пиратский объект',
  anomaly: 'Аномалия',
  asteroid: 'Астероидный пояс',
};

const KIND_DESCRIPTIONS: Record<UniversePlanetNode['kind'], string> = {
  empty: 'Свободная орбитальная позиция.',
  player: 'Ваша домашняя планета.',
  npc: 'Один из семи миров, принадлежащих Боту 01.',
  uninhabited: 'Необитаемый мир. Сведений о поселениях нет.',
  unique: 'Необычный мир, заслуживающий отдельного изучения.',
  pirate: 'Объект, занятый пиратами.',
  anomaly: 'Необычный сигнал неизвестного происхождения.',
  asteroid: 'Скопление каменных тел на орбите звезды.',
};

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
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

export function formatUniverseCoordinate(coordinate: UniverseCoordinate) {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
}

export function universeCoordinateKey(coordinate: UniverseCoordinate) {
  return `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;
}

/** Stable screen position for a slot. It deliberately has no time input. */
export function getUniverseSlotPoint(slot: number): UniversePoint {
  return getOrbitPoint(slot, 0);
}

/** One minute per numbered slot, wrapping within the same six-slot ring. */
export function getUniverseAsteroidPoint(slot: number, elapsedMs: number): UniversePoint {
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs % 360_000 : 0;
  return getOrbitPoint(slot, elapsed / 60_000);
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

export function getUniverseObjectKindLabel(kind: UniversePlanetNode['kind']) {
  return KIND_LABELS[kind];
}

export function getUniverseNodeCaption(node: UniversePlanetNode, currentPlayerName: string) {
  return node.isHomeworld ? `★ ${currentPlayerName}` : node.name;
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
};

function fixtureFor(system: number, slot: number) {
  const npc = NPC_PLANET_FIXTURES.find((planet) => planet.system === system && planet.position === slot);
  if (npc) return { ...npc, kind: 'npc' as const, ownerId: NPC_OWNER_ID, known: true };
  if (system === 1) return SYSTEM_ONE_FIXTURES[slot];
  return undefined;
}

function generatedKind(system: number, slot: number): UniversePlanetNode['kind'] {
  if ((system * 11 + slot * 7) % 29 === 0) return 'pirate';
  if ((system * 13 + slot * 5) % 31 === 0) return 'anomaly';
  if ((system * 17 + slot * 3) % 47 === 0) return 'unique';
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
  const kind = fixture?.kind ?? generatedKind(system, slot);
  const ownerId = fixture?.ownerId;
  const isHomeworld = kind === 'player' && system === 1 && slot === 1;
  const name = isHomeworld
    ? options.currentPlanetName?.trim() || 'Helion 01'
    : fixture?.name
      ?? (kind === 'pirate' ? `Пиратский объект ${String(slot).padStart(2, '0')}`
        : kind === 'anomaly' ? `Аномалия ${String(slot).padStart(2, '0')}`
          : kind === 'unique' ? ['Осколки Эдема', 'Сердце Бездны', 'Кристаллический разлом'][(system + slot) % 3]
            : `Планета ${String(system).padStart(2, '0')}-${String(slot).padStart(2, '0')}`);
  const art = isHomeworld
    ? options.currentPlanetArt?.trim() || pickAsset(assets.planetArts, slot, 'planet-home')
    : kind === 'pirate'
      ? pickAsset(assets.pirateArts, fixture?.artIndex ?? system + slot, 'pirate-default')
      : kind === 'anomaly'
        ? pickAsset(assets.anomalyArts, fixture?.artIndex ?? system + slot, 'anomaly-default')
        : kind === 'unique'
          ? pickAsset(assets.uniqueArts, fixture?.artIndex ?? system + slot, 'unique-default')
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
    known: fixture?.known ?? (kind !== 'anomaly' || system % 2 === 0),
  };
}

export function createUniverseSystem(options: CreateUniverseSystemOptions): UniverseSystem {
  const galaxy = Math.max(1, Math.floor(options.galaxy ?? GALAXY));
  const system = Math.min(SYSTEM_COUNT, Math.max(1, Math.floor(options.system)));
  const assets = mergeAssets(options.assets);
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

  const emptySlots = positions.filter((node) => node.kind === 'empty').map((node) => node.coordinate.position);
  const asteroidCount = 3 + ((galaxy + system) % 3);
  const asteroidSlots = shuffle([...emptySlots], random).slice(0, asteroidCount);
  const asteroids = asteroidSlots.map((position, index): UniversePlanetNode => ({
    id: `asteroid-${galaxy}-${system}-${index + 1}`,
    coordinate: { galaxy, system, position },
    kind: 'asteroid',
    name: `Астероидный пояс ${String(index + 1).padStart(2, '0')}`,
    art: pickAsset(assets.asteroidArts, galaxy * 17 + system * 3 + index, 'asteroid-default'),
    statusLabel: KIND_LABELS.asteroid,
    description: KIND_DESCRIPTIONS.asteroid,
    known: true,
  }));

  return {
    galaxy,
    system,
    starArt: pickAsset(assets.starArts, system - 1, 'star-default'),
    positions,
    asteroids,
  };
}

export function createUniverseMap(options: Omit<CreateUniverseSystemOptions, 'system'> = {}): UniverseMap {
  const galaxy = Math.max(1, Math.floor(options.galaxy ?? GALAXY));
  return {
    galaxy,
    systems: Array.from({ length: SYSTEM_COUNT }, (_, index) => createUniverseSystem({ ...options, galaxy, system: index + 1 })),
  };
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
