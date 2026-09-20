import { calculateDefensePopulation, createEmptyDefenseState } from '../fleet/production.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../fleet/runtime.ts';
import { BOT_01_PLANET_FIXTURES, UNIVERSE_NPC_OWNER_ID } from '../universe/runtime.ts';
import type { Bot01PlanetState, EspionageState } from './types.ts';

const BOT_OWNER_NAME = 'Бот 01';
const BOT_FACTION = 'veyra' as const;

function createBotPlanet(index: number): Bot01PlanetState {
  const fixture = BOT_01_PLANET_FIXTURES[index];
  const fleet = createEmptyFleetState();
  fleet.ships.scout = index === 0 ? 900 : 80 + index * 35;
  fleet.ships.cruiser = index === 0 ? 900 : 4 + index * 3;
  fleet.ships.defender = index === 0 ? 690 : index % 2 === 0 ? 8 + index : 2 + index;
  if (index === 0) fleet.ships.destroyer = 0;
  fleet.ships['spy-probe'] = 0;

  const defense = createEmptyDefenseState();
  defense.defenses['ballistic-turret'] = index === 0 ? 1_000 : 40 + index * 9;
  defense.defenses['laser-turret'] = index === 0 ? 30 : 5 + index * 4;
  defense.defenses['ion-turret'] = index === 0 ? 500 : index % 3 === 0 ? 12 + index : index;
  defense.defenses['plasma-turret'] = index === 0 ? 100 : 0;
  defense.defenses['laser-ion-battery'] = index === 0 ? 90 : 0;
  if (index === 0) defense.defenses['tower-shield'] = 20;

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
      civilian: 900 + index * 240,
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
