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
  cost: ResourceCost;
  combat: CombatStats;
  category: string;
  ship?: ShipCombatTraits;
  tactical?: TacticalCombatTraits;
  construction: ConstructionDefinition;
};
