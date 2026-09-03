import { COMMANDER_IDS, type CommanderId } from './commanders.ts';

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

export const ALL_COMBAT_ENTITY_IDS: readonly CombatEntityId[] = [
  ...SHIP_IDS,
  ...DEFENSE_IDS,
  ...COMMANDER_IDS,
];
