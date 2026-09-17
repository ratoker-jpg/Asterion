export type CombatEntityKind = 'ship' | 'defense' | 'commander';

export type CombatOrdinaryClass =
  | 'scout'
  | 'cruiser'
  | 'defender'
  | 'battleship'
  | 'destroyer'
  | 'bomber';

export type CombatSpecialBonus = {
  kind: 'attack' | 'life' | 'armor';
  rate: number;
  cap?: number;
  /** The source did not establish a cap for some inferred bonuses. */
  capStatus?: 'known' | 'unknown';
  /** Marks the documented fleet rule and the explicit Asterion recipient scope. */
  scope?: 'fleet' | 'asterion';
  status: 'confirmed' | 'inferred' | 'unknown' | 'not-calibrated';
  source?: string;
  note?: string;
};

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
  /** Catalog/UI preparation for a future production limit; runtime production is not implemented yet. */
  maxOwned?: number;
  cost: ResourceCost;
  combat: CombatStats;
  category: string;
  /** Stable combat archetype used by the Asterion matchup and level rules. */
  ordinaryClass?: CombatOrdinaryClass;
  /** Start-of-round bonus donated to other allied combat stacks. */
  specialBonus?: CombatSpecialBonus;
  combatEligible?: boolean;
  ship?: ShipCombatTraits;
  tactical?: TacticalCombatTraits;
  commanderAbility?: CommanderAbilityTraits;
  /** Source requirement snapshot kept separate from Asterion's currently enforced gates. */
  sourceRequirements?: readonly string[];
  construction: ConstructionDefinition;
};
