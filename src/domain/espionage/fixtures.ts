import { calculateDefensePopulation, createEmptyDefenseState } from '../fleet/production.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../fleet/runtime.ts';
import { BOT_01_PLANET_FIXTURES, UNIVERSE_NPC_OWNER_ID } from '../universe/runtime.ts';
import type { Bot01PlanetState, EspionageState } from './types.ts';

const BOT_OWNER_NAME = 'Бот 01';
const BOT_FACTION = 'veyra' as const;

function createBotPlanet(index: number): Bot01PlanetState {
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
    ? { hunter: { level: 20, count: 1 }, judge: { level: 1, count: 1 } }
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
      civilian: index === 0 ? 900 : 1_100 + index * 180,
      fleet: fleetPopulation,
      defense: defensePopulation,
    },
    hunterLevel: index === 0 ? 20 : 0,
    debris: index * 125,
  };
}

export function createBot01Planets(): Record<string, Bot01PlanetState> {
  return Object.fromEntries(BOT_01_PLANET_FIXTURES.map((_, index) => {
    const planet = createBotPlanet(index);
    return [planet.id, planet];
  }));
}

export function createDefaultTestEspionageState(): EspionageState {
  return {
    missions: [],
    reports: [],
    hunterNotices: [],
    bot01Planets: createBot01Planets(),
  };
}
