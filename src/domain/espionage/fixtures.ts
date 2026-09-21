import { calculateDefensePopulation, createEmptyDefenseState } from '../fleet/production.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../fleet/runtime.ts';
import { COMMANDER_IDS, type CommanderId } from '../combat/commanders.ts';
import { getSpaceportUpgradeCatalog } from '../buildings/spaceport-upgrades.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceLevels } from '../buildings/resource-zone.ts';
import { BOT_01_PLANET_FIXTURES, UNIVERSE_NPC_OWNER_ID } from '../universe/runtime.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { ShipId } from '../combat/ids.ts';
import { createSeededEspionageRng } from './runtime.ts';
import type { Bot01PlanetState, Bot01Profile, EspionageState, SpyTargetState } from './types.ts';

const BOT_OWNER_NAME = 'Бот 01';
const BOT_FACTION = 'veyra' as const;

/** Planet population stays stable between save resets but looks random. */
const POPULATION_MIN = 5_000;
const POPULATION_MAX = 25_112;

// These values are owner-wide. The names match the Veyra catalogue shown in
// the report and simulator: Носильщик 5, Тяжеловоз 6, Стрекоза 4, Скарабей 2.
// The remaining hulls use a seeded draw once for Bot 01, never once per planet.
const BOT01_SHIP_LEVEL_OVERRIDES: Partial<Record<ShipId, number>> = {
  transporter: 5,
  'mega-transporter': 6,
  cruiser: 4,
  battleship: 2,
};

export function createDefaultBot01Profile(): Bot01Profile {
  const rng = createSeededEspionageRng('bot01:owner-profile:v2');
  const shipLevels = Object.fromEntries(
    getSpaceportUpgradeCatalog('ships', BOT_FACTION).map((entity) => [
      entity.id,
      BOT01_SHIP_LEVEL_OVERRIDES[entity.id as ShipId] ?? Math.floor(rng() * 11),
    ]),
  ) as Partial<Record<ShipId, number>>;
  const scienceLevels = Object.fromEntries(
    SCIENCE_CATALOG.map((science) => [
      science.id,
      science.id === 5 ? 10 : Math.min(science.maxLevel, Math.max(1, science.capturedLevel)),
    ]),
  ) as ScienceLevels;
  const commanderLevels = Object.fromEntries(
    COMMANDER_IDS.map((id) => [id, id === 'hunter' ? 20 : id === 'judge' ? 1 : 0]),
  ) as Partial<Record<CommanderId, number>>;
  return { scienceLevels, shipLevels, commanderLevels };
}

type PopulationUnit = { id: string; population: number };

/**
 * Generates a composition whose computed hangar population approximates the
 * requested target. The result never exceeds the target by construction, and
 * the reported population is always recalculated from the actual composition,
 * so the numbers in the report always add up.
 */
function composePopulationUnits(units: readonly PopulationUnit[], target: number, rng: () => number): Record<string, number> {
  const composition: Record<string, number> = {};
  const usable = units.filter((unit) => unit.population > 0);
  if (!usable.length || target <= 0) return composition;

  // Deterministic random order keeps every planet composition distinct.
  const order = usable
    .map((unit) => ({ unit, key: rng() }))
    .sort((left, right) => left.key - right.key)
    .map(({ unit }) => unit);

  let remaining = target;
  order.forEach((unit, index) => {
    if (index === order.length - 1 || remaining < unit.population) return;
    const share = remaining * (0.15 + rng() * 0.45);
    const count = Math.floor(share / unit.population);
    if (count > 0) {
      composition[unit.id] = count;
      remaining -= count * unit.population;
    }
  });

  // Top the split up with the cheapest hull so the hangar feels lived in.
  const cheapest = [...usable].sort((left, right) => left.population - right.population)[0];
  const topUp = Math.floor(remaining / cheapest.population);
  if (topUp > 0) {
    composition[cheapest.id] = (composition[cheapest.id] ?? 0) + topUp;
  }
  return composition;
}

function createBotPlanet(index: number, profile: Bot01Profile): SpyTargetState {
  const fixture = BOT_01_PLANET_FIXTURES[index];
  const rng = createSeededEspionageRng(`bot01:planet:${index}:v1`);

  // Seeded planet population: looks random, replays identically.
  const totalPopulation = POPULATION_MIN + Math.floor(rng() * (POPULATION_MAX - POPULATION_MIN + 1));
  const fleetShare = 0.35 + rng() * 0.3;
  const fleetPopulationTarget = Math.round(totalPopulation * fleetShare);
  const defensePopulationTarget = totalPopulation - fleetPopulationTarget;

  const shipUnits = getFactionShipCatalog(BOT_FACTION)
    .filter((entity) => entity.id !== 'solar-satellite' && entity.id !== 'spy-probe')
    .map((entity) => ({ id: entity.id, population: Math.max(0, Math.floor(entity.population)) }));
  const defenseUnits = getFactionDefenseCatalog(BOT_FACTION)
    .map((entity) => ({ id: entity.id, population: Math.max(0, Math.floor(entity.population)) }));

  const fleet = createEmptyFleetState();
  const shipComposition = composePopulationUnits(shipUnits, fleetPopulationTarget, rng);
  for (const [id, count] of Object.entries(shipComposition)) {
    fleet.ships[id as ShipId] = count;
  }
  fleet.ships['spy-probe'] = 0;

  const defense = createEmptyDefenseState();
  const defenseComposition = composePopulationUnits(defenseUnits, defensePopulationTarget, rng);
  for (const [id, count] of Object.entries(defenseComposition)) {
    defense.defenses[id as keyof typeof defense.defenses] = count;
  }

  const commanders: Bot01PlanetState['commanders'] = index === 0
    ? {
      hunter: { level: profile.commanderLevels.hunter ?? 20, count: 1 },
      judge: { level: profile.commanderLevels.judge ?? 1, count: 1 },
    }
    : {};
  fleet.commanders.hunter = commanders.hunter?.count ?? 0;
  fleet.commanders.judge = commanders.judge?.count ?? 0;

  const fleetPopulation = calculateFleetPopulation(fleet, BOT_FACTION);
  const defensePopulation = calculateDefensePopulation(defense, BOT_FACTION);
  return {
    id: fixture.id,
    name: fixture.name,
    coordinate: { galaxy: 1, system: fixture.system, position: fixture.position },
    ownerId: UNIVERSE_NPC_OWNER_ID,
    ownerName: BOT_OWNER_NAME,
    raceId: BOT_FACTION,
    alliance: null,
    kind: 'npc',
    espionageLevel: 10,
    resources: {
      metal: 2_000 + index * 475,
      minerals: 1_250 + index * 360,
      gas: 850 + index * 220,
      developmentEnergy: 200 + index * 45,
      debris: index * 125,
    },
    buildings: {
      'metal-mine': 12 + index,
      'mineral-mine': 10 + index,
      'gas-extractor': 8 + index,
      research: index === 0 ? 10 : 4 + index,
      shipyard: 5 + (index % 4),
      espionage: 3 + (index % 5),
    },
    fleet,
    defense,
    commanders,
    population: {
      // Planet population counts everything attached to the hangars: ship
      // crews and defense garrisons, so the report numbers always converge.
      total: fleetPopulation + defensePopulation,
      fleet: fleetPopulation,
      defense: defensePopulation,
    },
    hunterLevel: index === 0 ? 20 : 0,
    debris: index * 125,
  };
}

export function createBot01Planets(): Record<string, Bot01PlanetState> {
  const profile = createDefaultBot01Profile();
  return Object.fromEntries(BOT_01_PLANET_FIXTURES.map((_, index) => {
    const planet = createBotPlanet(index, profile);
    return [planet.id, planet];
  }));
}

export function createDefaultTestEspionageState(): EspionageState {
  const targets = createBot01Planets();
  return {
    missions: [],
    reports: [],
    hunterNotices: [],
    bot01Profile: createDefaultBot01Profile(),
    targets,
    // Keep the alias in Test Mode while old saved fixtures and tests migrate.
    bot01Planets: targets,
  };
}
