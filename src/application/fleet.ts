import {
  createCanonicalStartingFleet,
  normalizeFleetStateForCapacity,
  resolveSavedFleetState,
  type OwnedFleetState,
} from '../domain/fleet/runtime.ts';
import {
  createDefaultFleetProductionState,
  createEmptyDefenseState,
  getDefensePopulationSummary,
  getFleetProductionPopulationSummary,
  type FleetProductionState,
  type OwnedDefenseState,
} from '../domain/fleet/production.ts';
import type { PlanetId, SaveState } from './contracts.ts';
import { createPersistenceFacade, type PersistenceOptions } from './persistence.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { createDefaultSpaceportUpgradeState, type SpaceportUpgradeState } from '../domain/buildings/spaceport-upgrades.ts';

export type FleetSnapshot = {
  factionId: CombatFactionId;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  fleetProduction: FleetProductionState;
  spaceportUpgrades: SpaceportUpgradeState;
  hangarLevel: number;
  shipyardLevel: number;
  advancedFactoryLevel: number;
};

export type FleetSummary = ReturnType<typeof getFleetProductionPopulationSummary>;

export type FleetBuildBudget = {
  factionId: CombatFactionId;
  metal: number;
  minerals: number;
  gas: number;
  population: number;
  populationMax: number;
  shipyardLevel: number;
  advancedFactoryLevel: number;
  hangarLevel: number;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  fleetProduction: FleetProductionState;
  spaceportUpgrades: SpaceportUpgradeState;
  summary: FleetSummary;
  defenseSummary: ReturnType<typeof getDefensePopulationSummary>;
};

function safeLevel(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getFleetSnapshot(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetSnapshot {
  const planet = state.planets[planetId];
  const hangarLevel = safeLevel(planet?.buildings.hangar, 1);
  const fleet = normalizeFleetStateForCapacity(
    resolveSavedFleetState(planet?.fleet, state.profile.factionId),
    hangarLevel,
    state.profile.factionId,
  );
  return {
    factionId: state.profile.factionId,
    fleet,
    defense: planet?.defense ?? createEmptyDefenseState(),
    fleetProduction: planet?.fleetProduction ?? createDefaultFleetProductionState(),
    spaceportUpgrades: planet?.spaceportUpgrades ?? createDefaultSpaceportUpgradeState(),
    hangarLevel,
    shipyardLevel: safeLevel(planet?.buildings.shipyard, 0),
    advancedFactoryLevel: safeLevel(planet?.buildings['advanced-factory'], 0),
  };
}

export function getFleetSummaryForState(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetSummary {
  const snapshot = getFleetSnapshot(state, planetId);
  return getFleetProductionPopulationSummary(
    snapshot.fleet,
    snapshot.fleetProduction,
    snapshot.hangarLevel,
    snapshot.factionId,
  );
}

export function getFleetSummaryForSnapshot(snapshot: FleetSnapshot): FleetSummary {
  return getFleetProductionPopulationSummary(
    snapshot.fleet,
    snapshot.fleetProduction,
    snapshot.hangarLevel,
    snapshot.factionId,
  );
}

export function readFleetSnapshot(options: PersistenceOptions = {}): FleetSnapshot {
  const state = createPersistenceFacade(options).read();
  return getFleetSnapshot(state);
}

export function getFleetBuildBudget(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetBuildBudget {
  const snapshot = getFleetSnapshot(state, planetId);
  const summary = getFleetSummaryForSnapshot(snapshot);
  const defenseSummary = getDefensePopulationSummary(
    snapshot.defense,
    snapshot.fleetProduction,
    snapshot.hangarLevel,
    snapshot.factionId,
  );
  return {
    factionId: snapshot.factionId,
    metal: state.metal,
    minerals: state.minerals,
    gas: state.gas,
    population: summary.population,
    populationMax: summary.capacity,
    shipyardLevel: snapshot.shipyardLevel,
    advancedFactoryLevel: snapshot.advancedFactoryLevel,
    hangarLevel: snapshot.hangarLevel,
    fleet: snapshot.fleet,
    defense: snapshot.defense,
    fleetProduction: snapshot.fleetProduction,
    spaceportUpgrades: snapshot.spaceportUpgrades,
    summary,
    defenseSummary,
  };
}

export function readFleetBuildBudget(options: PersistenceOptions = {}): FleetBuildBudget {
  const state = createPersistenceFacade(options).read();
  return getFleetBuildBudget(state);
}

export function createDefaultFleetSnapshot(): FleetSnapshot {
  return {
    factionId: 'aegis',
    fleet: createCanonicalStartingFleet(),
    defense: createEmptyDefenseState(),
    fleetProduction: createDefaultFleetProductionState(),
    spaceportUpgrades: createDefaultSpaceportUpgradeState(),
    hangarLevel: 1,
    shipyardLevel: 0,
    advancedFactoryLevel: 0,
  };
}
