import {
  createCanonicalStartingFleet,
  getFleetSummary,
  resolveSavedFleetState,
  type OwnedFleetState,
} from '../domain/fleet/runtime.ts';
import type { PlanetId, SaveState } from './contracts.ts';
import { createPersistenceFacade, type PersistenceOptions } from './persistence.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';

export type FleetSnapshot = {
  factionId: CombatFactionId;
  fleet: OwnedFleetState;
  hangarLevel: number;
  shipyardLevel: number;
  advancedFactoryLevel: number;
};

export type FleetSummary = ReturnType<typeof getFleetSummary>;

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
  summary: FleetSummary;
};

function safeLevel(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getFleetSnapshot(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetSnapshot {
  const planet = state.planets[planetId];
  return {
    factionId: state.profile.factionId,
    fleet: resolveSavedFleetState(planet?.fleet),
    hangarLevel: safeLevel(planet?.buildings.hangar, 1),
    shipyardLevel: safeLevel(planet?.buildings.shipyard, 0),
    advancedFactoryLevel: safeLevel(planet?.buildings['advanced-factory'], 0),
  };
}

export function getFleetSummaryForState(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetSummary {
  const snapshot = getFleetSnapshot(state, planetId);
  return getFleetSummary(snapshot.fleet, snapshot.hangarLevel, snapshot.factionId);
}

export function getFleetSummaryForSnapshot(snapshot: FleetSnapshot): FleetSummary {
  return getFleetSummary(snapshot.fleet, snapshot.hangarLevel, snapshot.factionId);
}

export function readFleetSnapshot(options: PersistenceOptions = {}): FleetSnapshot {
  const state = createPersistenceFacade(options).read();
  return getFleetSnapshot(state);
}

export function getFleetBuildBudget(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetBuildBudget {
  const snapshot = getFleetSnapshot(state, planetId);
  const summary = getFleetSummary(snapshot.fleet, snapshot.hangarLevel, snapshot.factionId);
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
    summary,
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
    hangarLevel: 1,
    shipyardLevel: 0,
    advancedFactoryLevel: 0,
  };
}
