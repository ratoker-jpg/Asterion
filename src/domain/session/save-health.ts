/**
 * Health of a raw save payload, checked before anything loads or overwrites it.
 *
 * `valid` also covers legacy partial saves (no `planets` yet): the migration
 * builds them out. `malformed` is valid JSON whose structure the migration
 * would silently replace with defaults (a planet entry that is not an object,
 * `planets` of the wrong type), so it must not be loaded as a campaign.
 */
import { validateNpcState } from '../npc/state.ts';

export type SavePayloadHealth =
  | { status: 'missing' }
  | { status: 'valid'; schemaVersion: number }
  | { status: 'corrupt'; reason: string }
  | { status: 'newer'; schemaVersion: number }
  | { status: 'malformed'; reason: string };

export type SaveProblem = Exclude<SavePayloadHealth, { status: 'missing' } | { status: 'valid' }>;

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Structural check of an already parsed save. */
export function inspectParsedSave(parsed: unknown, currentSchemaVersion: number): Exclude<SavePayloadHealth, { status: 'missing' } | { status: 'corrupt' }> {
  if (!plainObject(parsed)) return { status: 'malformed', reason: 'Сохранение не является объектом игры.' };
  const schema = parsed.schemaVersion;
  if (schema !== undefined && (typeof schema !== 'number' || !Number.isFinite(schema))) {
    return { status: 'malformed', reason: 'Неверная версия схемы.' };
  }
  const schemaVersion = typeof schema === 'number' ? schema : 0;
  if (schemaVersion > currentSchemaVersion) return { status: 'newer', schemaVersion };
  // Do not admit or autosave a private foundation we cannot losslessly read.
  // Rescue/backup export remains available for these original bytes.
  if (parsed.npc !== undefined && !validateNpcState(parsed.npc)) {
    return { status: 'malformed', reason: 'Неподдерживаемая версия или повреждённые данные NPC.' };
  }
  if (parsed.planets !== undefined) {
    if (!plainObject(parsed.planets)) return { status: 'malformed', reason: 'Повреждён список планет.' };
    for (const [planetId, planet] of Object.entries(parsed.planets)) {
      if (!plainObject(planet)) return { status: 'malformed', reason: `Повреждены данные планеты «${planetId.slice(0, 40)}».` };
    }
  }
  if (parsed.profile !== undefined && !plainObject(parsed.profile)) return { status: 'malformed', reason: 'Повреждён профиль игрока.' };
  if (parsed.currentPlanetId !== undefined && typeof parsed.currentPlanetId !== 'string') {
    return { status: 'malformed', reason: 'Повреждена текущая планета.' };
  }
  return { status: 'valid', schemaVersion };
}

export function inspectSavePayload(raw: string | null | undefined, currentSchemaVersion: number): SavePayloadHealth {
  if (raw === null || raw === undefined || raw === '') return { status: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', reason: 'Повреждённый JSON.' };
  }
  return inspectParsedSave(parsed, currentSchemaVersion);
}

export function isSaveProblem(health: SavePayloadHealth): health is SaveProblem {
  return health.status === 'corrupt' || health.status === 'newer' || health.status === 'malformed';
}

/** One player-facing line for a problem save. */
export function describeSaveProblem(health: SaveProblem, currentSchemaVersion: number): string {
  if (health.status === 'newer') {
    return `Сохранение создано более новой версией игры (схема ${health.schemaVersion}, у вас ${currentSchemaVersion}).`;
  }
  return `Сохранение повреждено: ${health.reason}`;
}
