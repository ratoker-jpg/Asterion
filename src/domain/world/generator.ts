import { calculateDefensePopulation, createEmptyDefenseState } from '../fleet/production.ts';
import { calculateFleetPopulation, createCanonicalStartingFleet, createEmptyFleetState } from '../fleet/runtime.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { ShipId } from '../combat/ids.ts';
import type { PlayerFactionId } from '../profile/types.ts';
import type { SpyTargetState } from '../espionage/types.ts';
import type { UniverseCoordinate } from '../universe/types.ts';
import { WORLD_DENSITY_RULES, WORLD_LIMITS, getWorldNpcCapacity, type NewGameConfig } from './config.ts';
import { createSeededRandom, pickRandom, randomInteger } from './random.ts';
import { createCanonicalStartingBuildingLevels } from '../buildings/resource-zone.ts';
import { CANONICAL_STARTING_WALLET } from './start.ts';

/** Owner ids of generated stubs. They never collide with Bot 01 (`npc-bot-01`). */
export const GENERATED_NPC_OWNER_PREFIX = 'npc-gen-';

export function isGeneratedNpcOwnerId(ownerId: string): boolean {
  return ownerId.startsWith(GENERATED_NPC_OWNER_PREFIX);
}

const NPC_NAMES = [
  'Варг Тессел', 'Мира Кальдер', 'Остин Рейв', 'Кайра Вольт', 'Деймос Хард', 'Лиара Сенн', 'Торвальд Икс', 'Нея Арвен',
  'Сайрус Марр', 'Ильва Корт', 'Брам Делейн', 'Эсса Новак', 'Корвин Блэйз', 'Талия Ферн', 'Рикс Орион', 'Хельга Вейл',
  'Юстас Крейн', 'Ада Стрейн', 'Мэйсон Кор', 'Сола Тирн', 'Гаррет Фолк', 'Ивора Ракс', 'Зейн Окуро', 'Вера Лумен',
  'Кассий Дрейк', 'Номи Шарп', 'Арлен Пайк', 'Селин Морау', 'Тэо Бракс', 'Фрея Кинн', 'Лукан Сорр', 'Ора Вистер',
  'Дамир Хольт', 'Эйла Трэс', 'Марек Зонн', 'Рина Галло', 'Вольф Энгер', 'Кира Остел', 'Сет Варро', 'Лана Мирск',
] as const;

const PLANET_NAMES = [
  'Ортана', 'Келлис', 'Зефирия', 'Арго', 'Тирон', 'Мелора', 'Скайфол', 'Нерида', 'Валтар', 'Ксенон-4',
  'Эридан', 'Халцея', 'Кастор', 'Лумина', 'Обелис', 'Дракар', 'Сильва', 'Террина', 'Велес', 'Авалон',
  'Рубикон', 'Аэтра', 'Морана', 'Корсак', 'Иллирия', 'Феникс', 'Гелида', 'Тартар', 'Синора', 'Пирра',
  'Ульма', 'Квазар', 'Нимба', 'Борея', 'Карнак', 'Эфира', 'Сардис', 'Вирена', 'Онтар', 'Калипсо',
] as const;

const FACTIONS: readonly PlayerFactionId[] = ['aegis', 'synod', 'veyra'];

export type GeneratedWorld = {
  playerStart: UniverseCoordinate;
  npcPlanets: SpyTargetState[];
};

function coordinateKey(coordinate: UniverseCoordinate): string {
  return `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;
}

/** A small, believable garrison: the stub can be spied on and attacked, it never acts. */
function createStubGarrison(raceId: PlayerFactionId, random: () => number) {
  const fleet = createEmptyFleetState();
  const defense = createEmptyDefenseState();
  const ships = getFactionShipCatalog(raceId)
    .filter((entity) => entity.kind === 'ship' && entity.id !== 'solar-satellite' && entity.id !== 'spy-probe' && entity.id !== 'colonizer' && entity.population > 0);
  const defenses = getFactionDefenseCatalog(raceId)
    .filter((entity) => entity.population > 0 && entity.id !== 'tower-shield' && entity.id !== 'planetary-shield');
  const fleetTarget = randomInteger(random, 400, 3_600);
  const defenseTarget = randomInteger(random, 200, 1_800);
  const cheapShips = [...ships].sort((left, right) => left.population - right.population).slice(0, 4);
  let remaining = fleetTarget;
  for (const entity of cheapShips) {
    if (remaining < entity.population) continue;
    const count = Math.floor((remaining * (0.25 + random() * 0.4)) / entity.population);
    if (count <= 0) continue;
    fleet.ships[entity.id as ShipId] = count;
    remaining -= count * entity.population;
  }
  let defenseRemaining = defenseTarget;
  for (const entity of [...defenses].sort((left, right) => left.population - right.population).slice(0, 3)) {
    if (defenseRemaining < entity.population) continue;
    const count = Math.floor((defenseRemaining * (0.3 + random() * 0.4)) / entity.population);
    if (count <= 0) continue;
    defense.defenses[entity.id as keyof typeof defense.defenses] = count;
    defenseRemaining -= count * entity.population;
  }
  return { fleet, defense };
}

/**
 * Builds the world of a new campaign from its seed. Pure: the same config
 * always yields the same player start and the same NPC stubs. NPC stubs are
 * owners with exactly one planet and no behaviour (no flights, no growth).
 */
export function generateWorld(config: NewGameConfig, now: number): GeneratedWorld {
  const random = createSeededRandom(`world:${config.seed}`);
  const { galaxyCount, maxNpcPerSystem, density, randomPlayerStart } = config.world;
  const playerStart: UniverseCoordinate = randomPlayerStart
    ? {
      galaxy: randomInteger(random, 1, galaxyCount),
      system: randomInteger(random, 1, WORLD_LIMITS.systemsPerGalaxy),
      position: randomInteger(random, 1, WORLD_LIMITS.positionsPerSystem),
    }
    : { galaxy: 1, system: 1, position: 1 };

  const npcCount = Math.min(config.world.npcCount, getWorldNpcCapacity(config.world));
  const occupied = new Set<string>([coordinateKey(playerStart)]);
  const perSystem = new Map<string, number>();
  const systems: Array<{ galaxy: number; system: number }> = [];
  for (let galaxy = 1; galaxy <= galaxyCount; galaxy += 1) {
    for (let system = 1; system <= WORLD_LIMITS.systemsPerGalaxy; system += 1) systems.push({ galaxy, system });
  }
  const weightOf = WORLD_DENSITY_RULES[density].weight;
  // A fixed mix gives exact counts (largest remainder) in a seeded order; `random` rolls each stub.
  const mix = config.npcFactions === 'random' ? null : config.npcFactions;
  const raceQueue: PlayerFactionId[] = [];
  if (mix) {
    const exact = FACTIONS.map((id) => (npcCount * mix[id]) / 100);
    const counts = exact.map(Math.floor);
    let left = npcCount - counts.reduce((sum, item) => sum + item, 0);
    exact.map((item, index) => ({ index, remainder: item - Math.floor(item) }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .forEach((entry) => { if (left > 0) { counts[entry.index]! += 1; left -= 1; } });
    FACTIONS.forEach((id, index) => { for (let n = 0; n < counts[index]!; n += 1) raceQueue.push(id); });
    const raceRandom = createSeededRandom(`world-races:${config.seed}`);
    for (let index = raceQueue.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(raceRandom() * (index + 1));
      [raceQueue[index], raceQueue[swap]] = [raceQueue[swap]!, raceQueue[index]!];
    }
  }
  const npcPlanets: SpyTargetState[] = [];
  for (let index = 0; index < npcCount; index += 1) {
    const candidates = systems.filter((entry) => (perSystem.get(`${entry.galaxy}:${entry.system}`) ?? 0) < maxNpcPerSystem);
    if (!candidates.length) break;
    const weights = candidates.map((entry) => weightOf(perSystem.get(`${entry.galaxy}:${entry.system}`) ?? 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = random() * total;
    let chosen = candidates[candidates.length - 1]!;
    for (let candidate = 0; candidate < candidates.length; candidate += 1) {
      roll -= weights[candidate]!;
      if (roll < 0) { chosen = candidates[candidate]!; break; }
    }
    const freePositions = Array.from({ length: WORLD_LIMITS.positionsPerSystem }, (_, slot) => slot + 1)
      .filter((position) => !occupied.has(`${chosen.galaxy}:${chosen.system}:${position}`));
    if (!freePositions.length) continue;
    const coordinate = { galaxy: chosen.galaxy, system: chosen.system, position: pickRandom(random, freePositions) };
    occupied.add(coordinateKey(coordinate));
    const systemKey = `${chosen.galaxy}:${chosen.system}`;
    perSystem.set(systemKey, (perSystem.get(systemKey) ?? 0) + 1);

    const number = String(index + 1).padStart(2, '0');
    const rolledRace = pickRandom(random, FACTIONS);
    const raceId = mix ? raceQueue[index] ?? rolledRace : rolledRace;
    const cycle = Math.floor(index / NPC_NAMES.length);
    const ownerName = `${NPC_NAMES[index % NPC_NAMES.length]}${cycle ? ` ${cycle + 1}` : ''}`;
    const planetName = `${PLANET_NAMES[(index * 7) % PLANET_NAMES.length]}${cycle ? `-${cycle + 1}` : ''}`;
    // Keep the legacy random draws in place so changing NPC starting fleets
    // and economy does not shift seeded world placement or other map details.
    createStubGarrison(raceId, random);
    // Preserve the previous seeded draw while starting at the player's level.
    randomInteger(random, 0, 4);
    randomInteger(random, 4_000, 24_000);
    randomInteger(random, 3_000, 18_000);
    randomInteger(random, 1_000, 9_000);
    randomInteger(random, 80, 260);
    randomInteger(random, 3, 9);
    randomInteger(random, 3, 8);
    randomInteger(random, 2, 6);
    randomInteger(random, 1, 5);
    randomInteger(random, 1, 5);
    randomInteger(random, 2, 6);
    const fleet = createCanonicalStartingFleet(raceId);
    const defense = createEmptyDefenseState();
    const fleetPopulation = calculateFleetPopulation(fleet, raceId);
    const defensePopulation = calculateDefensePopulation(defense, raceId);
    npcPlanets.push({
      id: `${GENERATED_NPC_OWNER_PREFIX}${number}-planet`,
      name: planetName,
      coordinate,
      ownerId: `${GENERATED_NPC_OWNER_PREFIX}${number}`,
      ownerName,
      raceId,
      alliance: null,
      kind: 'npc',
      espionageLevel: 0,
      resources: {
        metal: CANONICAL_STARTING_WALLET.metal,
        minerals: CANONICAL_STARTING_WALLET.minerals,
        gas: CANONICAL_STARTING_WALLET.gas,
        developmentEnergy: CANONICAL_STARTING_WALLET.energy,
        debris: 0,
      },
      buildings: createCanonicalStartingBuildingLevels(),
      fleet,
      defense,
      commanders: {},
      population: { total: fleetPopulation + defensePopulation, fleet: fleetPopulation, defense: defensePopulation },
      hunterLevel: 0,
      resourceClock: { lastReconciledAt: Math.max(0, now), remainder: { metal: 0, minerals: 0, gas: 0 } },
    });
  }
  return { playerStart, npcPlanets };
}

export type WorldSummary = {
  systems: number;
  planetSlots: number;
  npcCount: number;
  npcCapacity: number;
  occupancyPercent: number;
  suns: number;
};

export function summarizeWorld(config: NewGameConfig): WorldSummary {
  const systems = config.world.galaxyCount * WORLD_LIMITS.systemsPerGalaxy;
  const npcCapacity = getWorldNpcCapacity(config.world);
  const npcCount = Math.min(config.world.npcCount, npcCapacity);
  return {
    systems,
    planetSlots: systems * WORLD_LIMITS.positionsPerSystem,
    npcCount,
    npcCapacity,
    occupancyPercent: npcCapacity ? Math.round((npcCount / npcCapacity) * 100) : 0,
    suns: systems,
  };
}
