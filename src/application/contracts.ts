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

/** Phase 4 deliberately preserves the current single-homeworld data contract. */
export type PlanetId = 'helion-01';

export type PlanetRuntime = {
  name: string;
  skin: string;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  fleetProduction: FleetProductionState;
  energy: number;
  buildings: BuildingLevels;
  productionBots: BotAssignment;
  recycling: RecyclingState;
  trade: TradeState;
  spaceportUpgrades: SpaceportUpgradeState;
  stability: number;
};

export type ResourceClock = {
  lastReconciledAt: number;
  remainder: {
    metal: number;
    minerals: number;
    gas: number;
    energy: number;
  };
};

export type SaveState = {
  schemaVersion: number;
  metal: number;
  minerals: number;
  gas: number;
  currentPlanetId: PlanetId;
  planets: Record<PlanetId, PlanetRuntime>;
  queues: Record<PlanetId, BuildingQueueItem[]>;
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
