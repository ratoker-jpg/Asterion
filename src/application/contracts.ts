import type { BattleHistoryState } from '../domain/combat/battle-repository.ts';
import type { CombatPriorityState } from '../domain/combat/priority.ts';
import type { SimulatorState } from '../domain/combat/simulator-repository.ts';
import type { CommandState } from '../domain/command/types.ts';
import type { OwnedFleetState } from '../domain/fleet/runtime.ts';
import type {
  FleetProductionState,
  OwnedDefenseState,
} from '../domain/fleet/production.ts';
import type { OperationsState } from '../domain/operations/types.ts';
import type { PlayerProfileState } from '../domain/profile/types.ts';
import type { RatingPrototypeState } from '../domain/rating/fixtures.ts';
import type { ReportsState } from '../domain/reports/types.ts';
import type { ScienceState } from '../domain/science/runtime.ts';
import type {
  BuildingLevels,
  BuildingQueueItem,
} from '../domain/buildings/resource-zone.ts';
import type { BotAssignment } from '../domain/buildings/production-bots.ts';
import type { RecyclingState } from '../domain/buildings/recycling.ts';
import type { SpaceportUpgradeState } from '../domain/buildings/spaceport-upgrades.ts';
import type { TradeState } from '../domain/buildings/trade.ts';
import type { RepairWorkshopState } from '../domain/repair/workshop.ts';
import type { EnergyLedger, EnergySourceSnapshot } from '../domain/energy/runtime.ts';
import type { FlightState } from '../domain/flights/types.ts';
import type { EspionageState } from '../domain/espionage/types.ts';
import type { UniverseAsteroidSimulationState } from '../domain/universe/types.ts';
import type { UniverseOwnerAlliance } from '../domain/universe/types.ts';
import type { OverpopulationState } from '../domain/fleet/overpopulation.ts';

/** Planet ids are stable save keys; the legacy homeworld remains `helion-01`. */
export type PlanetId = string;

export type PlanetResources = {
  metal: number;
  minerals: number;
  gas: number;
};

export type PlanetRuntime = {
  name: string;
  skin: string;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  fleetProduction: FleetProductionState;
  repair: RepairWorkshopState;
  /** Legacy alias for the available energy balance. */
  energy: number;
  /** One-time energy ledger. Optional for source compatibility with old test fixtures. */
  energyLedger?: EnergyLedger;
  producedEnergy?: number;
  consumedEnergy?: number;
  availableEnergy?: number;
  energySources?: EnergySourceSnapshot[];
  energyExpenseAttribution?: Partial<Record<string, number>>;
  /** Orbital presence is separate from the outgoing fleet roster. */
  solarSatellites?: number;
  /** Persisted linear overpopulation episode; absent means the planet is not blocked. */
  overpopulation?: OverpopulationState;
  universeGalaxy?: number;
  universeSystem?: number;
  universePosition?: number;
  buildings: BuildingLevels;
  productionBots: BotAssignment;
  recycling: RecyclingState;
  trade: TradeState;
  spaceportUpgrades: SpaceportUpgradeState;
  stability: number;
  /** Per-planet wallet. Legacy saves may omit it and are migrated from root resources. */
  resources?: PlanetResources;
};

/**
 * A serialized non-player planet that the application has explicitly
 * authorized as an allied transport target. It intentionally reuses the
 * normal planet runtime so delivery/recycling cannot become a UI-only path.
 */
export type AlliedPlanetState = PlanetRuntime & {
  id: PlanetId;
  ownerId: string;
  displayName: string;
  raceId: string;
  alliance: UniverseOwnerAlliance | null;
  fixtureId?: string;
};

export type ResourceClockEntry = {
  lastReconciledAt: number;
  remainder: {
    metal: number;
    minerals: number;
    gas: number;
    energy: number;
  };
};

export type ResourceClock = ResourceClockEntry & {
  /**
   * Resource income is settled independently for every owned planet. The
   * top-level fields remain as a compatibility alias for legacy consumers and
   * old fixtures that only know about the homeworld clock.
   */
  byPlanet?: Record<PlanetId, ResourceClockEntry>;
};

export type PlanetStateRecord = Record<PlanetId, PlanetRuntime>;

export type PlanetQueueRecord = Record<PlanetId, BuildingQueueItem[]>;

export type SaveState = {
  schemaVersion: number;
  metal: number;
  minerals: number;
  gas: number;
  currentPlanetId: PlanetId;
  planets: PlanetStateRecord;
  queues: PlanetQueueRecord;
  /** Completed owner-wide ship/commander upgrades. Absent only in legacy fixtures. */
  shipUpgradeLevels?: Record<string, number>;
  rating: RatingPrototypeState;
  profile: PlayerProfileState;
  combatPriority: CombatPriorityState;
  combat: BattleHistoryState;
  combatSimulator: SimulatorState;
  operations: OperationsState;
  command: CommandState;
  reports: ReportsState;
  science: ScienceState;
  resourceClock: ResourceClock;
  flights: FlightState;
  /** Authoritative asteroid timeline. Missing only while hydrating legacy saves/fixtures. */
  asteroidSimulation?: UniverseAsteroidSimulationState;
  /** Hidden asteroid cargo by stable spawn index; never part of free orbital debris. */
  asteroidDebrisBySpawnIndex?: Record<string, number>;
  /** Fresh saves materialize this state; optional keeps legacy test fixtures source-compatible. */
  espionage?: EspionageState;
  /** Optional for backwards compatibility; fresh states always materialize it. */
  alliedPlanets?: Record<PlanetId, AlliedPlanetState>;
};

export function getPlanetState(state: SaveState, planetId: PlanetId): PlanetRuntime {
  return state.planets[planetId];
}

export function replacePlanetState(
  state: SaveState,
  planetId: PlanetId,
  planet: PlanetRuntime,
): SaveState {
  return {
    ...state,
    planets: {
      ...state.planets,
      [planetId]: planet,
    },
  };
}

export function getPlanetResources(state: SaveState, planetId: PlanetId = state.currentPlanetId): PlanetResources {
  const planet = state.planets[planetId];
  // Root resource fields are a compatibility alias for the currently selected
  // world. Explicit reads of other worlds use their own persisted wallet.
  if (planetId === state.currentPlanetId) {
    return { metal: state.metal, minerals: state.minerals, gas: state.gas };
  }
  if (planet?.resources) return { ...planet.resources };
  // Legacy root wallets were only persisted for Helion 01.
  if (planetId === 'helion-01') return { metal: state.metal, minerals: state.minerals, gas: state.gas };
  return { metal: state.metal, minerals: state.minerals, gas: state.gas };
}

export function getOwnerShipUpgradeLevels(state: SaveState): Record<string, number> {
  if (state.shipUpgradeLevels !== undefined) return { ...state.shipUpgradeLevels };
  const levels: Record<string, number> = {};
  for (const planet of Object.values(state.planets)) {
    for (const [id, value] of Object.entries(planet.spaceportUpgrades.shipLevels)) {
      levels[id] = Math.max(levels[id] ?? 0, Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
    }
  }
  return levels;
}

export function getOwnerShipUpgradeLevel(state: SaveState, shipId: string): number {
  const levels = getOwnerShipUpgradeLevels(state);
  return Math.max(0, Math.floor(levels[shipId] ?? 0));
}

export function replacePlanetResources(
  state: SaveState,
  planetId: PlanetId,
  resources: PlanetResources,
): SaveState {
  const planet = state.planets[planetId];
  if (!planet) return state;
  const nextPlanet = { ...planet, resources: { ...resources } };
  const next: SaveState = {
    ...state,
    planets: { ...state.planets, [planetId]: nextPlanet },
  };
  // Keep the root wallet as a compatibility alias for whichever planet is current.
  if (planetId !== next.currentPlanetId) return next;
  return { ...next, metal: resources.metal, minerals: resources.minerals, gas: resources.gas };
}

export function replaceAlliedPlanetState(
  state: SaveState,
  planetId: PlanetId,
  planet: AlliedPlanetState,
): SaveState {
  return {
    ...state,
    alliedPlanets: {
      ...(state.alliedPlanets ?? {}),
      [planetId]: planet,
    },
  };
}
