import { COMBAT_ENTITY_BY_ID, getCombatEntity, type CatalogEntity } from './catalog.ts';
import { getFactionCombatEntity } from './faction-catalog.ts';
import type { CombatFactionId } from './factions.ts';
import type { CombatEntityId, CombatStackEntityId } from './ids.ts';
import { PIRATE_CATALOG_BY_ID, type PirateAbility, type PirateShipId } from '../pirates/catalog.ts';
import type { PirateProfile } from '../pirates/profile.ts';
import type { CombatEntityDefinition } from './types.ts';

export type CombatSideProfile = Readonly<{
  kind: 'pirate';
  snapshot: PirateProfile;
}>;

export type ResolvedCombatEntity = Pick<CombatEntityDefinition,
  'id' | 'kind' | 'name' | 'role' | 'art' | 'population' | 'cost' | 'combat' | 'category' | 'ordinaryClass' | 'specialBonus' | 'combatEligible'
> & {
  maxOwned?: number;
  pirateAbility?: PirateAbility;
};

function pirateSpecialBonus(ability: PirateAbility): CombatEntityDefinition['specialBonus'] {
  switch (ability.kind) {
    case 'bonus-life':
      return { kind: 'life', rate: ability.perShipRate, cap: ability.cap, capStatus: 'known', scope: 'fleet', status: 'confirmed' };
    case 'armor-boost':
      return { kind: 'armor', rate: ability.perShipRate, cap: ability.cap, capStatus: 'known', scope: 'fleet', status: 'confirmed' };
    case 'destroyer-aura':
      return { kind: 'attack', rate: ability.attackBonus, cap: ability.attackBonus, capStatus: 'known', scope: 'fleet', status: 'inferred' };
    default:
      return undefined;
  }
}

export function isPirateShipId(value: unknown): value is PirateShipId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PIRATE_CATALOG_BY_ID, value);
}

function asPirateCombatEntity(entityId: PirateShipId): ResolvedCombatEntity {
  const entity = PIRATE_CATALOG_BY_ID[entityId];
  return {
    id: entity.id,
    kind: 'ship',
    name: entity.name,
    role: entity.role,
    art: entity.art,
    population: entity.population,
    cost: entity.cost,
    combat: entity.combat,
    category: 'Боевой корабль',
    ordinaryClass: entity.ordinaryClass === 'planet-breaker' ? undefined : entity.ordinaryClass,
    combatEligible: true,
    specialBonus: pirateSpecialBonus(entity.ability),
    pirateAbility: entity.ability,
  };
}

/** Entity lookup for report presentation and generic combat diagnostics. */
export function getCombatEntityForStack(entityId: CombatStackEntityId): ResolvedCombatEntity {
  return isPirateShipId(entityId)
    ? asPirateCombatEntity(entityId)
    : getCombatEntity(entityId as CombatEntityId);
}

/** Resolves entity stats through an explicit side adapter; a pirate race string is never faction-normalized. */
export function getCombatEntityForSide(
  entityId: CombatStackEntityId,
  factionId: CombatFactionId | undefined,
  profile?: CombatSideProfile,
): ResolvedCombatEntity | null {
  if (profile?.kind === 'pirate') return isPirateShipId(entityId) ? asPirateCombatEntity(entityId) : null;
  if (isPirateShipId(entityId)) return null;
  if (!COMBAT_ENTITY_BY_ID.has(entityId as CombatEntityId)) return null;
  if (factionId) return getFactionCombatEntity(factionId, entityId as CombatEntityId) as CatalogEntity & ResolvedCombatEntity;
  return getCombatEntity(entityId as CombatEntityId);
}

export function isPiratePlanetBreaker(entityId: CombatStackEntityId): boolean {
  return entityId === 'pirate-planet-breaker';
}
