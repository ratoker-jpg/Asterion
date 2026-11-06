import { COMMANDER_IDS, type CommanderId } from './commanders.ts';
import type { PirateShipId } from '../pirates/catalog.ts';

export const SHIP_IDS = [
  'solar-satellite',
  'spy-probe',
  'transporter',
  'mega-transporter',
  'colonizer',
  'recycler',
  'scout',
  'cruiser',
  'defender',
  'battleship',
  'destroyer',
  'bomber',
  'death-star',
] as const;

export const SOLAR_SATELLITE_ID = 'solar-satellite' as const;

export const DEFENSE_IDS = [
  'ballistic-turret',
  'laser-turret',
  'ion-turret',
  'plasma-turret',
  'laser-ion-battery',
  'plasma-laser-battery',
  'ion-plasma-battery',
  'tower-shield',
  'planetary-shield',
] as const;

export type ShipId = (typeof SHIP_IDS)[number];
export type DefenseId = (typeof DEFENSE_IDS)[number];
export type CombatEntityId = ShipId | DefenseId | CommanderId;
/** Combat/report-only unit ids; pirate NPCs are deliberately not playable ShipIds. */
export type CombatStackEntityId = CombatEntityId | PirateShipId;

/**
 * A side may field several owners' fleets (joint raids). Every extra owner group
 * keeps its own race and technologies, so its stacks get a tag: `cruiser#g2`.
 * The first group keeps the plain id, which keeps single-owner battles unchanged.
 */
export const COMBAT_GROUP_SEPARATOR = '#';
export function combatGroupStackId(entityId: string, tag: string): CombatStackEntityId {
  return `${entityId}${COMBAT_GROUP_SEPARATOR}${tag}` as CombatStackEntityId;
}
/** The catalog id of a stack id, with any owner-group tag removed. */
export function combatBaseEntityId(entityId: string): CombatStackEntityId {
  const index = entityId.indexOf(COMBAT_GROUP_SEPARATOR);
  return (index < 0 ? entityId : entityId.slice(0, index)) as CombatStackEntityId;
}
/** The owner-group tag of a stack id, or null for the side's first group. */
export function combatGroupTag(entityId: string): string | null {
  const index = entityId.indexOf(COMBAT_GROUP_SEPARATOR);
  return index < 0 ? null : entityId.slice(index + 1);
}

export const ALL_COMBAT_ENTITY_IDS: readonly CombatEntityId[] = [
  ...SHIP_IDS,
  ...DEFENSE_IDS,
  ...COMMANDER_IDS,
];
