export const COMBAT_FACTION_IDS = ['aegis', 'synod', 'veyra'] as const;

export type CombatFactionId = (typeof COMBAT_FACTION_IDS)[number];

export type CombatFactionDefinition = {
  id: CombatFactionId;
  name: string;
};

export const DEFAULT_COMBAT_FACTION_ID: CombatFactionId = 'aegis';

export const COMBAT_FACTIONS: readonly CombatFactionDefinition[] = [
  { id: 'aegis', name: 'Астеры' },
  { id: 'synod', name: 'Илары' },
  { id: 'veyra', name: 'Рой' },
];

export const COMBAT_FACTION_BY_ID = new Map<CombatFactionId, CombatFactionDefinition>(
  COMBAT_FACTIONS.map((faction) => [faction.id, faction]),
);

export function isCombatFactionId(value: unknown): value is CombatFactionId {
  return typeof value === 'string' && (COMBAT_FACTION_IDS as readonly string[]).includes(value);
}

export function normalizeCombatFactionId(value: unknown): CombatFactionId {
  return isCombatFactionId(value) ? value : DEFAULT_COMBAT_FACTION_ID;
}

export function getCombatFactionName(id: unknown) {
  const normalized = normalizeCombatFactionId(id);
  return COMBAT_FACTION_BY_ID.get(normalized)?.name ?? COMBAT_FACTION_BY_ID.get(DEFAULT_COMBAT_FACTION_ID)!.name;
}
