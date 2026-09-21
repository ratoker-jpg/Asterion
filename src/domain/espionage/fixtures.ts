import { calculateDefensePopulation, createEmptyDefenseState } from '../fleet/production.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../fleet/runtime.ts';
import { COMMANDER_IDS, type CommanderId } from '../combat/commanders.ts';
import { getSpaceportUpgradeCatalog } from '../buildings/spaceport-upgrades.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceLevels } from '../buildings/resource-zone.ts';
import type { ShipId } from '../combat/ids.ts';
import { BOT_01_PLANET_FIXTURES, UNIVERSE_NPC_OWNER_ID } from '../universe/runtime.ts';
import type { Bot01PlanetState, Bot01Profile, EspionageState } from './types.ts';

const BOT_OWNER_NAME = 'Бот 01';
const BOT_FACTION = 'veyra' as const;
const MIN_BOT_PLANET_POPULATION = 5_000;
const MAX_BOT_PLANET_POPULATION = 25_112;

const BOT01_SHIP_LEVELS: Partial<Record<ShipId, number>> = {
  transporter: 4,
  'mega-transporter': 3,
  scout: 6,
  cruiser: 5,
  defender: 7,
  battleship: 4,
  destroyer: 3,
  bomber: 2,
  'death-star': 1,
};

/**
 * Upgrade levels are intentionally deterministic fixture data. They are
 * created once for the owner and reused by every Bot 01 planet, matching the
 * owner-wide spaceport/science rules instead of inventing planet-local levels.
 */
export function createDefaultBot01Profile(): Bot01Profile {
  const shipLevels = Object.fromEntries(
    getSpaceportUpgradeCatalog('ships', BOT_FACTION).map((entity) => [entity.id, BOT01_SHIP_LEVELS[entity.id as ShipId] ?? 1]),
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

function createBotPlanet(index: number, profile: Bot01Profile): Bot01PlanetState {
  const fixture = BOT_01_PLANET_FIXTURES[index];
  const fleet = createEmptyFleetState();
  if (index === 0) {
    fleet.ships.scout = 900;
    fleet.ships.cruiser = 900;
    fleet.ships.defender = 690;
  } else if (index === 1) {
    fleet.ships.scout = 1_500;
    fleet.ships.cruiser = 650;
    fleet.ships.defender = 450;
    fleet.ships.destroyer = 20;
  } else if (index === 2) {
    fleet.ships.scout = 200;
    fleet.ships.cruiser = 100;
    fleet.ships.defender = 60;
  } else if (index === 3) {
    fleet.ships.scout = 900;
    fleet.ships.cruiser = 400;
    fleet.ships.defender = 300;
    fleet.ships.destroyer = 30;
    fleet.ships.bomber = 20;
  } else if (index === 4) {
    fleet.ships.scout = 250;
    fleet.ships.cruiser = 150;
    fleet.ships.defender = 120;
  } else if (index === 5) {
    fleet.ships.scout = 1_200;
    fleet.ships.cruiser = 500;
    fleet.ships.defender = 400;
    fleet.ships.bomber = 30;
  } else {
    fleet.ships.scout = 150;
    fleet.ships.cruiser = 80;
    fleet.ships.defender = 100;
  }
  fleet.ships['spy-probe'] = 0;

  const defense = createEmptyDefenseState();
  if (index === 0) {
    defense.defenses['ballistic-turret'] = 1_000;
    defense.defenses['laser-turret'] = 30;
    defense.defenses['ion-turret'] = 500;
    defense.defenses['plasma-turret'] = 100;
    defense.defenses['laser-ion-battery'] = 90;
    defense.defenses['tower-shield'] = 20;
  } else if (index === 2) {
    defense.defenses['ballistic-turret'] = 800;
    defense.defenses['ion-turret'] = 500;
    defense.defenses['plasma-turret'] = 300;
  } else if (index === 4) {
    defense.defenses['ballistic-turret'] = 1_200;
    defense.defenses['laser-turret'] = 200;
    defense.defenses['ion-turret'] = 250;
    defense.defenses['plasma-turret'] = 200;
  } else if (index === 6) {
    defense.defenses['ballistic-turret'] = 900;
    defense.defenses['ion-turret'] = 600;
    defense.defenses['laser-ion-battery'] = 120;
  } else {
    defense.defenses['ballistic-turret'] = 60 + index * 20;
    defense.defenses['laser-turret'] = 20 + index * 8;
    defense.defenses['ion-turret'] = 12 + index * 6;
  }

  const commanders: Bot01PlanetState['commanders'] = index === 0
    ? {
      hunter: { level: profile.commanderLevels.hunter ?? 20, count: 1 },
      judge: { level: profile.commanderLevels.judge ?? 1, count: 1 },
    }
    : {};
  fleet.commanders.hunter = commanders.hunter?.count ?? 0;
  fleet.commanders.judge = commanders.judge?.count ?? 0;

  let fleetPopulation = calculateFleetPopulation(fleet, BOT_FACTION);
  let defensePopulation = calculateDefensePopulation(defense, BOT_FACTION);
  if (fleetPopulation + defensePopulation < MIN_BOT_PLANET_POPULATION) {
    // Fill the remaining test population with the cheapest defense unit. This
    // keeps every fixture within the hangar test range without changing the
    // varied fleet/defense distribution above.
    defense.defenses['ballistic-turret'] += MIN_BOT_PLANET_POPULATION - fleetPopulation - defensePopulation;
    defensePopulation = calculateDefensePopulation(defense, BOT_FACTION);
  }
  const totalPopulation = fleetPopulation + defensePopulation;
  if (totalPopulation > MAX_BOT_PLANET_POPULATION) {
    throw new Error(`Bot 01 fixture exceeds the hangar population cap: ${totalPopulation}.`);
  }
  return {
    id: fixture.id,
    name: fixture.name,
    coordinate: { galaxy: 1, system: fixture.system, position: fixture.position },
    ownerId: UNIVERSE_NPC_OWNER_ID,
    ownerName: BOT_OWNER_NAME,
    raceId: BOT_FACTION,
    alliance: null,
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
      total: totalPopulation,
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
  return {
    missions: [],
    reports: [],
    hunterNotices: [],
    bot01Profile: createDefaultBot01Profile(),
    bot01Planets: createBot01Planets(),
  };
}
