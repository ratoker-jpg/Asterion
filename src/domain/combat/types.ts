export type CombatEntityKind = 'ship' | 'defense' | 'commander';

export type ResourceCost = {
  metal: number;
  minerals: number;
  gas: number;
};

export type CombatStats = {
  attack: number;
  life: number;
  weaponType: string;
  armorType: string;
  armorStrength: number;
};

export type ShipCombatTraits = {
  cargo: number;
  speed: number;
  fuel: number;
};

export type TacticalCombatTraits = {
  specialization: string;
  range: string;
  priority: string;
};

export type CommanderAbilityTraits = {
  ability: string;
  description: string;
  ratePerLevel: string;
};

export type ConstructionDefinition = {
  time: string;
  requiredShipyardLevel: number;
  requirements: readonly string[];
};

export type CombatEntityDefinition = {
  id: string;
  kind: CombatEntityKind;
  name: string;
  role: string;
  art: string;
  population: number;
  /** Shared-data production limit. Existing saves are intentionally not clamped by migration. */
  maxOwned?: number;
  cost: ResourceCost;
  combat: CombatStats;
  category: string;
  ship?: ShipCombatTraits;
  tactical?: TacticalCombatTraits;
  commanderAbility?: CommanderAbilityTraits;
  /** Source requirement snapshot kept separate from Asterion's currently enforced gates. */
  sourceRequirements?: readonly string[];
  construction: ConstructionDefinition;
};
