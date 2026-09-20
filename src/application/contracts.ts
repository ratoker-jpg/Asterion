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
import type { UniverseOwnerAlliance } from '../domain/universe/types.ts';

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

export type PlanetStateRecord = Record<PlanetId, PlanetRuntime> & {
  'helion-01': PlanetRuntime;
};

export type PlanetQueueRecord = Record<PlanetId, BuildingQueueItem[]> & {
  'helion-01': BuildingQueueItem[];
};

export type SaveState = {
  schemaVersion: number;
  metal: number;
  minerals: number;
  gas: number;
  currentPlanetId: PlanetId;
  planets: PlanetStateRecord;
  queues: PlanetQueueRecord;
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
  // The root wallet remains the authoritative compatibility alias for the
  // legacy homeworld while colonies use their own persisted wallet.
  if (planetId === 'helion-01') return { metal: state.metal, minerals: state.minerals, gas: state.gas };
  const planet = state.planets[planetId];
  if (planet?.resources) return { ...planet.resources };
  return { metal: state.metal, minerals: state.minerals, gas: state.gas };
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
  // Keep the old root wallet as a compatibility alias for the existing UI and
  // economy while the homeworld remains the active planet.
  if (planetId !== 'helion-01') return next;
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
