import {
  createCanonicalStartingFleet,
  createEmptyFleetState,
  normalizeFleetStateForCapacity,
  removeSolarSatellitesFromFleet,
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
import { getPlanetResources } from './contracts.ts';
import { getAvailableFleetForPlanet, getReservedShipsForPlanet } from './flights.ts';
import { createPersistenceFacade, type PersistenceOptions } from './persistence.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
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
  solarSatellites: number;
  /** Ships reserved by active flights are hidden from selection but remain in population. */
  reservedFleet?: OwnedFleetState;
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
  solarSatellites: number;
};

function safeLevel(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fleetWithReservations(fleet: OwnedFleetState, reserved: OwnedFleetState): OwnedFleetState {
  return {
    ships: Object.fromEntries(Object.keys(fleet.ships).map((id) => [
      id,
      (fleet.ships[id as ShipId] ?? 0) + (reserved.ships[id as ShipId] ?? 0),
    ])) as OwnedFleetState['ships'],
    commanders: { ...fleet.commanders },
  };
}

export function getFleetSnapshot(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetSnapshot {
  const planet = state.planets[planetId];
  const hangarLevel = safeLevel(planet?.buildings.hangar, 1);
  const migratedFleet = removeSolarSatellitesFromFleet(
    resolveSavedFleetState(planet?.fleet, state.profile.factionId),
  );
  const normalizedFleet = normalizeFleetStateForCapacity(
    migratedFleet.fleet,
    hangarLevel,
    state.profile.factionId,
  );
  const fleet = normalizeFleetStateForCapacity(
    getAvailableFleetForPlanet(state, planetId),
    hangarLevel,
    state.profile.factionId,
  );
  const reservedShips = getReservedShipsForPlanet(state, planetId);
  const reservedFleet: OwnedFleetState = {
    ships: Object.fromEntries(Object.keys(normalizedFleet.ships).map((id) => [id, reservedShips[id as ShipId] ?? 0])) as OwnedFleetState['ships'],
    commanders: { ...normalizedFleet.commanders },
  };
  return {
    factionId: state.profile.factionId,
    fleet,
    defense: planet?.defense ?? createEmptyDefenseState(),
    fleetProduction: planet?.fleetProduction ?? createDefaultFleetProductionState(),
    spaceportUpgrades: planet?.spaceportUpgrades ?? createDefaultSpaceportUpgradeState(),
    hangarLevel,
    shipyardLevel: safeLevel(planet?.buildings.shipyard, 0),
    advancedFactoryLevel: safeLevel(planet?.buildings['advanced-factory'], 0),
    solarSatellites: Math.max(0, Math.floor(planet?.solarSatellites ?? migratedFleet.count)),
    reservedFleet,
  };
}

export function getFleetSummaryForState(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetSummary {
  const snapshot = getFleetSnapshot(state, planetId);
  return getFleetProductionPopulationSummary(
    fleetWithReservations(snapshot.fleet, snapshot.reservedFleet ?? createEmptyFleetState()),
    snapshot.fleetProduction,
    snapshot.hangarLevel,
    snapshot.factionId,
    snapshot.solarSatellites,
  );
}

export function getFleetSummaryForSnapshot(snapshot: FleetSnapshot): FleetSummary {
  return getFleetProductionPopulationSummary(
    fleetWithReservations(snapshot.fleet, snapshot.reservedFleet ?? createEmptyFleetState()),
    snapshot.fleetProduction,
    snapshot.hangarLevel,
    snapshot.factionId,
    snapshot.solarSatellites,
  );
}

export function getOutgoingFleetSummaryForSnapshot(snapshot: FleetSnapshot): FleetSummary {
  return getFleetProductionPopulationSummary(
    fleetWithReservations(snapshot.fleet, snapshot.reservedFleet ?? createEmptyFleetState()),
    snapshot.fleetProduction,
    snapshot.hangarLevel,
    snapshot.factionId,
    0,
    false,
  );
}

/** Planet population includes orbital satellites, which occupy hangar capacity. */
export function getPlanetPopulationForSnapshot(snapshot: FleetSnapshot): number {
  return getFleetSummaryForSnapshot(snapshot).population;
}

export function getPlanetPopulationForState(state: SaveState, planetId: PlanetId = state.currentPlanetId): number {
  return getPlanetPopulationForSnapshot(getFleetSnapshot(state, planetId));
}

export function getOutgoingFleetSummaryForState(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetSummary {
  return getOutgoingFleetSummaryForSnapshot(getFleetSnapshot(state, planetId));
}

export function readFleetSnapshot(options: PersistenceOptions = {}): FleetSnapshot {
  const state = createPersistenceFacade(options).read();
  return getFleetSnapshot(state);
}

export function getFleetBuildBudget(state: SaveState, planetId: PlanetId = state.currentPlanetId): FleetBuildBudget {
  const snapshot = getFleetSnapshot(state, planetId);
  const resources = getPlanetResources(state, planetId);
  const summary = getFleetSummaryForSnapshot(snapshot);
  const defenseSummary = getDefensePopulationSummary(
    snapshot.defense,
    snapshot.fleetProduction,
    snapshot.hangarLevel,
    snapshot.factionId,
  );
  return {
    factionId: snapshot.factionId,
    metal: resources.metal,
    minerals: resources.minerals,
    gas: resources.gas,
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
    solarSatellites: snapshot.solarSatellites,
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
    solarSatellites: 0,
    reservedFleet: createEmptyFleetState(),
  };
}
