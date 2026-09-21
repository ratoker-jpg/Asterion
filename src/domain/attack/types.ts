import type { CommanderId } from '../combat/commanders.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { ShipId } from '../combat/ids.ts';
import type { CombatTechnologyLevels } from '../combat/technologies.ts';
import type { SimulatorMaxRounds } from '../combat/simulator.ts';

/** Immutable data captured when an attack leaves the origin planet. */
export type AttackLaunchSnapshot = {
  version: 1;
  maxRounds: SimulatorMaxRounds;
  attackerFactionId: CombatFactionId;
  attackerTechnologies: CombatTechnologyLevels;
  attackerShipLevels: Partial<Record<ShipId, number>>;
  attackerCommanderLevels: Partial<Record<CommanderId, number>>;
  attackerPriority: CommanderId[];
};

export type AttackLoot = {
  metal: number;
  minerals: number;
  gas: number;
  debris: number;
};

/** Materialized attack outcome. Its presence is the arrival idempotency key. */
export type AttackResolution = {
  reportId: string;
  resolvedAt: number;
  debris: number;
  loot: AttackLoot;
  lootCreditedAt?: number;
};
