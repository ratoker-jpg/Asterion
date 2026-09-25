import { createDefaultBuildingLevels } from '../domain/buildings/resource-zone.ts';
import { createEmptyBotAssignment } from '../domain/buildings/production-bots.ts';
import { createDefaultFleetProductionState, createEmptyDefenseState } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { createDefaultSpaceportUpgradeState } from '../domain/buildings/spaceport-upgrades.ts';
import { createDefaultTradeState } from '../domain/buildings/trade.ts';
import { createDefaultRepairWorkshopState } from '../domain/repair/workshop.ts';
import { addDebris } from '../domain/flights/cargo.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { creditResources } from '../domain/resources/credit.ts';
import { discardScienceTasksForPlanet } from '../domain/science/runtime.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import { initializePlanetEnergy } from './energy.ts';
import {
  getPlanetResources,
  type PlanetId,
  type PlanetResources,
  type PlanetRuntime,
  type SaveState,
} from './contracts.ts';

export type DestroyOwnedPlanetResult = {
  state: SaveState;
  destroyed: boolean;
  reason?: 'planet-not-found' | 'last-planet-protected';
};

export function createColonyPlanetRuntime(state: SaveState, coordinate: UniverseCoordinate): PlanetRuntime {
  const base: PlanetRuntime = {
    name: `Колония ${coordinate.system}-${coordinate.position}`,
    skin: 'colonized',
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    fleetProduction: createDefaultFleetProductionState(),
    repair: createDefaultRepairWorkshopState(),
    energy: 0,
    universeGalaxy: coordinate.galaxy,
    universeSystem: coordinate.system,
    universePosition: coordinate.position,
    buildings: createDefaultBuildingLevels(),
    productionBots: createEmptyBotAssignment(),
    recycling: { availableDebris: 0, jobs: [] },
    trade: createDefaultTradeState(),
    spaceportUpgrades: { ...createDefaultSpaceportUpgradeState(), shipLevels: {} },
    stability: 100,
    resources: { metal: 500, minerals: 500, gas: 500 },
  };
  return initializePlanetEnergy(base, state.science.levels);
}

export function selectOwnedPlanet(state: SaveState, planetId: PlanetId): SaveState {
  const planet = state.planets[planetId];
  if (!planet) return state;
  const wallet: PlanetResources = planet.resources ?? (planetId === 'helion-01'
    ? getPlanetResources(state, planetId)
    : { metal: 0, minerals: 0, gas: 0 });
  return {
    ...state,
    currentPlanetId: planetId,
    metal: wallet.metal,
    minerals: wallet.minerals,
    gas: wallet.gas,
  };
}

/** Adds battle debris to the orbit ledger before an owned world is removed. */
export function preserveOwnedPlanetOrbitalDebris(
  state: SaveState,
  planetId: PlanetId,
  debris: number,
  reportId: string,
  now: number,
): SaveState {
  const planet = state.planets[planetId];
  if (!planet || debris <= 0 || !state.espionage) return state;
  const coordinate = {
    galaxy: planet.universeGalaxy ?? 1,
    system: planet.universeSystem ?? 1,
    position: planet.universePosition ?? 1,
  };
  const previous = state.espionage.orbitalDebris?.[planetId];
  return {
    ...state,
    espionage: {
      ...state.espionage,
      orbitalDebris: {
        ...(state.espionage.orbitalDebris ?? {}),
        [planetId]: {
          id: previous?.id ?? `orbital-debris-${planetId}`,
          targetPlanetId: planetId,
          targetPlanetName: planet.name,
          targetOwnerId: state.profile.playerId,
          targetCoordinate: coordinate,
          debris: addDebris(previous?.debris, debris),
          createdAt: previous?.createdAt ?? Math.max(0, Math.floor(now)),
          reportId,
        },
      },
    },
  };
}

/** Atomically removes all local state and burns Space Flights launched from the destroyed planet. */
export function destroyOwnedPlanet(
  state: SaveState,
  planetId: PlanetId,
  now: number,
  rng: () => number = Math.random,
): DestroyOwnedPlanetResult {
  if (!state.planets[planetId]) return { state, destroyed: false, reason: 'planet-not-found' };
  const planetIds = Object.keys(state.planets);
  if (planetIds.length <= 1) return { state, destroyed: false, reason: 'last-planet-protected' };

  const planets = { ...state.planets };
  delete planets[planetId];
  const queues = { ...state.queues };
  delete queues[planetId];
  const byPlanetClock = { ...(state.resourceClock.byPlanet ?? {}) };
  delete byPlanetClock[planetId];
  const currentPlanetId = state.currentPlanetId === planetId
    ? Object.keys(planets).sort()[0]
    : state.currentPlanetId;
  const currentPlanet = planets[currentPlanetId];
  let currentWallet = currentPlanet.resources ?? { metal: 0, minerals: 0, gas: 0 };
  const scienceDestruction = discardScienceTasksForPlanet(state.science, planetId, now, rng);
  if (currentPlanet && scienceDestruction.refundPercents.length > 0) {
    const credit = creditResources(
      { ...currentWallet, energy: 0 },
      getStorageCapacities(currentPlanet.buildings),
      scienceDestruction.refund,
    );
    currentWallet = { metal: credit.wallet.metal, minerals: credit.wallet.minerals, gas: credit.wallet.gas };
    planets[currentPlanetId] = { ...currentPlanet, resources: currentWallet };
  }
  const currentClock = byPlanetClock[currentPlanetId] ?? {
    lastReconciledAt: Math.max(0, Math.floor(now)),
    remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
  };
  const flights = {
    ...state.flights,
    records: state.flights.records.map((flight) => (
      flight.ownerSide !== 'bot01'
      && flight.missionId === 'space-flight'
      && flight.originPlanetId === planetId
      && (flight.phase === 'outbound' || flight.phase === 'returning' || flight.phase === 'arrived')
        ? {
          ...flight,
          phase: 'failed' as const,
          completionReason: 'origin-destroyed' as const,
          completedAt: Math.max(0, Math.floor(now)),
          cargoState: flight.cargo ? 'voided' as const : flight.cargoState,
          ...(flight.cargo ? { cargoResolvedAt: Math.max(0, Math.floor(now)) } : {}),
        }
        : flight
    )),
  };
  return {
    state: {
      ...state,
      schemaVersion: Math.max(state.schemaVersion, 21),
      currentPlanetId,
      planets,
      queues,
      science: scienceDestruction.state,
      flights,
      resourceClock: { ...state.resourceClock, ...currentClock, byPlanet: byPlanetClock },
      metal: currentWallet.metal,
      minerals: currentWallet.minerals,
      gas: currentWallet.gas,
    },
    destroyed: true,
  };
}
