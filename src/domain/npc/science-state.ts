import { SCIENCE_CATALOG } from '../science/catalog.ts';
import { createDefaultScienceState, migrateScienceLevels, type ScienceState } from '../science/runtime.ts';
import type { SpyTargetState } from '../espionage/types.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../universe/runtime.ts';

export type NpcScienceLedger = {
  version: 1;
  /** Earliest game time at which newly scheduled owner research can begin. */
  activatedAt: number;
  owners: Record<string, ScienceState>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isScienceState(value: unknown): value is ScienceState {
  if (!isRecord(value) || !isRecord(value.levels) || !Array.isArray(value.queue)) return false;
  if (value.queue.length > 3) return false;
  const scienceById = new Map<number, (typeof SCIENCE_CATALOG)[number]>(SCIENCE_CATALOG.map((science) => [science.id, science]));
  const projectedLevels: Record<number, number> = {};
  for (const [id, level] of Object.entries(value.levels)) {
    const science = scienceById.get(Number(id));
    if (!science || !Number.isSafeInteger(level) || Number(level) < 0 || Number(level) > science.maxLevel) return false;
    projectedLevels[science.id] = Number(level);
  }
  const additionalDirections = new Set([18, 19, 20]);
  let selectedAdditionalDirection: number | undefined;
  for (const id of additionalDirections) {
    if ((projectedLevels[id] ?? 0) <= 0) continue;
    if (selectedAdditionalDirection !== undefined && selectedAdditionalDirection !== id) return false;
    selectedAdditionalDirection = id;
  }
  const seenTaskIds = new Set<string>();
  let previousFinishAt = 0;
  for (const task of value.queue) {
    const cost = isRecord(task) ? task.cost : undefined;
    const science = isRecord(task) && typeof task.scienceId === 'number'
      ? scienceById.get(task.scienceId)
      : undefined;
    if (!isRecord(task)
      || typeof task.id !== 'string' || task.id.length === 0
      || seenTaskIds.has(task.id)
      || !science
      || typeof task.planetId !== 'string' || task.planetId.trim().length === 0
      || !isTimestamp(task.startedAt) || !isTimestamp(task.finishAt) || task.finishAt < task.startedAt
      || task.finishAt - task.startedAt !== task.durationMs
      || task.startedAt < previousFinishAt
      || !Number.isSafeInteger(task.durationMs) || Number(task.durationMs) < 1
      || !Number.isSafeInteger(task.fromLevel) || Number(task.fromLevel) !== (projectedLevels[science.id] ?? 0)
      || !Number.isSafeInteger(task.toLevel) || Number(task.toLevel) !== Number(task.fromLevel) + 1
      || Number(task.toLevel) > science.maxLevel
      || !isRecord(cost)
      || !['metal', 'minerals', 'gas', 'energy'].every((resource) => (
        typeof cost[resource] === 'number'
        && Number.isFinite(cost[resource])
        && Number(cost[resource]) >= 0
      ))) return false;
    if (additionalDirections.has(science.id)) {
      if (selectedAdditionalDirection !== undefined && selectedAdditionalDirection !== science.id) return false;
      selectedAdditionalDirection = science.id;
    }
    seenTaskIds.add(task.id);
    projectedLevels[science.id] = Number(task.toLevel);
    previousFinishAt = Number(task.finishAt);
  }
  return true;
}

/** Strict guard for the versioned owner science ledger stored in saves. */
export function validateNpcScienceLedger(value: unknown): value is NpcScienceLedger {
  if (!isRecord(value) || value.version !== 1 || !isTimestamp(value.activatedAt) || !isRecord(value.owners)) return false;
  return Object.entries(value.owners).every(([ownerId, science]) => ownerId.length > 0 && isScienceState(science));
}

function targetOwners(targets: Record<string, SpyTargetState> | undefined): string[] {
  return [...new Set(Object.values(targets ?? {})
    .filter((target) => target.kind === 'npc'
      && target.ownerId !== UNIVERSE_NPC_OWNER_ID
      && typeof target.ownerId === 'string'
      && target.ownerId.trim().length > 0)
    .map((target) => target.ownerId))].sort();
}

function legacyOwnerScience(targets: Record<string, SpyTargetState> | undefined): Record<string, ScienceState> {
  const owners: Record<string, ScienceState> = Object.create(null) as Record<string, ScienceState>;
  for (const ownerId of targetOwners(targets)) owners[ownerId] = createDefaultScienceState();
  for (const target of Object.values(targets ?? {})) {
    if (target.kind !== 'npc' || target.ownerId === UNIVERSE_NPC_OWNER_ID || !owners[target.ownerId]) continue;
    const previous = owners[target.ownerId]!;
    const migrated = migrateScienceLevels(target.ownerProfile?.scienceLevels);
    const levels = Object.fromEntries(SCIENCE_CATALOG.map(({ id }) => [
      id,
      Math.max(previous.levels[id] ?? 0, migrated[id] ?? 0),
    ])) as ScienceState['levels'];
    owners[target.ownerId] = { ...previous, levels };
  }
  return owners;
}

/**
 * Upgrade legacy per-target science to one owner ledger. Existing valid owner
 * state wins; missing represented owners are seeded from their legacy target
 * profiles. Orphan owner records remain available for stable persistence.
 */
export function migrateNpcScienceState(
  value: unknown,
  targets: Record<string, SpyTargetState> | undefined,
  activatedAt: number,
): NpcScienceLedger {
  const activation = isTimestamp(activatedAt) ? activatedAt : 0;
  const legacyOwners = legacyOwnerScience(targets);
  if (value === undefined) {
    return { version: 1, activatedAt: activation, owners: legacyOwners };
  }
  if (!validateNpcScienceLedger(value)) throw new TypeError('Malformed NPC science ledger version 1');

  const owners: Record<string, ScienceState> = Object.assign(Object.create(null), value.owners) as Record<string, ScienceState>;
  for (const [ownerId, science] of Object.entries(legacyOwners)) {
    if (!owners[ownerId]) owners[ownerId] = science;
  }
  return { version: 1, activatedAt: value.activatedAt, owners };
}
