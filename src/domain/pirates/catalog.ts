import ashfangArt from '../../../assets/source/ships/pirates/ashfang.png';
import blackHarrowArt from '../../../assets/source/ships/pirates/black_harrow.png';
import chainjackArt from '../../../assets/source/ships/pirates/chainjack.png';
import crownEaterArt from '../../../assets/source/ships/pirates/crown_eater.png';
import gutterstarArt from '../../../assets/source/ships/pirates/gutterstar.png';
import redWraithArt from '../../../assets/source/ships/pirates/red_wraith.png';
import voidButcherArt from '../../../assets/source/ships/pirates/void_butcher.png';

import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { CombatOrdinaryClass, CombatStats, ResourceCost } from '../combat/types.ts';
import type { ShipId } from '../combat/ids.ts';

export const PIRATE_SHIP_IDS = [
  'pirate-hound',
  'pirate-raider',
  'pirate-corsair',
  'pirate-executioner',
  'pirate-butcher',
  'pirate-bruiser',
  'pirate-planet-breaker',
] as const;

export type PirateShipId = (typeof PIRATE_SHIP_IDS)[number];
export type PirateBaseShipId = Exclude<PirateShipId, 'pirate-planet-breaker'>;
export type PirateTier = 1 | 2 | 3 | 'special';

export type PirateAbility =
  | Readonly<{ kind: 'ignore-armor'; perShipChance: number; chanceCap: number }>
  | Readonly<{ kind: 'devastate'; attackMultiplier: 1.25; perShipChance: number; chanceCap: number; incompatibleWithCritical: true }>
  | Readonly<{ kind: 'bonus-life'; perShipRate: number; cap: number }>
  | Readonly<{ kind: 'armor-boost'; perShipRate: number; cap: number }>
  | Readonly<{ kind: 'destroyer-aura'; attackBonus: number; selfBoost: false; stacks: false; requiresLivingStack: true }>
  | Readonly<{ kind: 'artillery'; attackMultiplierVsDefense: 1.5; perShipChance: number; chanceCap: number }>
  | Readonly<{ kind: 'planet-breaker'; detonation: true; destructionChanceAtLevel10Bps: 1_500; incomingRaidOnly: true }>;

export type PirateShipDefinition = Readonly<{
  id: PirateShipId;
  sourceId: ShipId;
  name: string;
  imageFile: string;
  art: string;
  role: string;
  ordinaryClass: CombatOrdinaryClass | 'planet-breaker';
  tier: PirateTier;
  population: number;
  /** Neutral per-class route speed, using the source-class median. */
  flightSpeed: number;
  cost: Readonly<ResourceCost>;
  combat: Readonly<CombatStats>;
  ability: PirateAbility;
}>;

const SOURCE_FACTIONS: readonly CombatFactionId[] = ['aegis', 'synod', 'veyra'];

function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function mode(values: readonly string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]![0];
}

function sourceShips(sourceId: ShipId) {
  return SOURCE_FACTIONS.map((factionId) => {
    const entity = getFactionShipCatalog(factionId).find((candidate) => candidate.id === sourceId);
    if (!entity) throw new Error(`Missing ${sourceId} source ship for ${factionId}`);
    return entity;
  });
}

function neutralShip(input: {
  id: PirateShipId;
  sourceId: ShipId;
  name: string;
  imageFile: string;
  art: string;
  role: string;
  ordinaryClass: PirateShipDefinition['ordinaryClass'];
  tier: PirateTier;
  ability: PirateAbility;
}): PirateShipDefinition {
  const source = sourceShips(input.sourceId);
  return Object.freeze({
    ...input,
    population: median(source.map((entity) => entity.population)),
    flightSpeed: median(source.map((entity) => entity.ship?.speed ?? 0)),
    cost: Object.freeze({
      metal: median(source.map((entity) => entity.cost.metal)),
      minerals: median(source.map((entity) => entity.cost.minerals)),
      gas: median(source.map((entity) => entity.cost.gas)),
    }),
    combat: Object.freeze({
      attack: median(source.map((entity) => entity.combat.attack)),
      life: median(source.map((entity) => entity.combat.life)),
      weaponType: mode(source.map((entity) => entity.combat.weaponType)),
      armorType: mode(source.map((entity) => entity.combat.armorType)),
      armorStrength: median(source.map((entity) => entity.combat.armorStrength)),
    }),
  });
}

/**
 * Immutable NPC units. Base stats/cost/population are per-field medians of the
 * three faction catalogs; ability chance/rate coefficients are the medians of
 * source-fixtures/ship-abilities.json unless the prompt supplies a new effect.
 */
export const PIRATE_CATALOG: readonly PirateShipDefinition[] = Object.freeze([
  neutralShip({
    id: 'pirate-hound', sourceId: 'scout', name: 'Гончий', imageFile: 'red_wraith.png', art: redWraithArt,
    role: 'Scout', ordinaryClass: 'scout', tier: 1,
    // The source fixture reports .035% per ship and a 70% cap for each race.
    ability: Object.freeze({ kind: 'ignore-armor', perShipChance: 0.00035, chanceCap: 0.7 }),
  }),
  neutralShip({
    id: 'pirate-raider', sourceId: 'cruiser', name: 'Налётчик', imageFile: 'gutterstar.png', art: gutterstarArt,
    role: 'Cruiser', ordinaryClass: 'cruiser', tier: 1,
    // Median source chance: .036% per ship; the 50% cap is shared by all races.
    ability: Object.freeze({ kind: 'devastate', attackMultiplier: 1.25, perShipChance: 0.00036, chanceCap: 0.5, incompatibleWithCritical: true }),
  }),
  neutralShip({
    id: 'pirate-corsair', sourceId: 'defender', name: 'Капер', imageFile: 'chainjack.png', art: chainjackArt,
    role: 'Defender', ordinaryClass: 'defender', tier: 2,
    ability: Object.freeze({ kind: 'bonus-life', perShipRate: 0.0005, cap: 0.3 }),
  }),
  neutralShip({
    id: 'pirate-executioner', sourceId: 'battleship', name: 'Палач', imageFile: 'black_harrow.png', art: blackHarrowArt,
    role: 'Battleship', ordinaryClass: 'battleship', tier: 2,
    ability: Object.freeze({ kind: 'armor-boost', perShipRate: 0.00028, cap: 0.3 }),
  }),
  neutralShip({
    id: 'pirate-butcher', sourceId: 'destroyer', name: 'Потрошитель', imageFile: 'void_butcher.png', art: voidButcherArt,
    role: 'Destroyer', ordinaryClass: 'destroyer', tier: 3,
    ability: Object.freeze({ kind: 'destroyer-aura', attackBonus: 0.05, selfBoost: false, stacks: false, requiresLivingStack: true }),
  }),
  neutralShip({
    id: 'pirate-bruiser', sourceId: 'bomber', name: 'Громила', imageFile: 'ashfang.png', art: ashfangArt,
    role: 'Bomber', ordinaryClass: 'bomber', tier: 3,
    ability: Object.freeze({ kind: 'artillery', attackMultiplierVsDefense: 1.5, perShipChance: 0.0009, chanceCap: 0.7 }),
  }),
  neutralShip({
    id: 'pirate-planet-breaker', sourceId: 'death-star', name: 'Погибель', imageFile: 'crown_eater.png', art: crownEaterArt,
    role: 'Planet breaker', ordinaryClass: 'planet-breaker', tier: 'special',
    ability: Object.freeze({ kind: 'planet-breaker', detonation: true, destructionChanceAtLevel10Bps: 1_500, incomingRaidOnly: true }),
  }),
]);

export const PIRATE_CATALOG_BY_ID: Readonly<Record<PirateShipId, PirateShipDefinition>> = Object.freeze(
  Object.fromEntries(PIRATE_CATALOG.map((ship) => [ship.id, ship])) as Record<PirateShipId, PirateShipDefinition>,
);

export const PIRATE_BASE_SHIPS: readonly PirateShipDefinition[] = Object.freeze(
  PIRATE_CATALOG.filter((ship): ship is PirateShipDefinition & { id: PirateBaseShipId } => ship.tier !== 'special'),
);

export function getPirateShip(id: PirateShipId) {
  return PIRATE_CATALOG_BY_ID[id];
}
