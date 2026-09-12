import {
  COMMANDER_COMBAT_CATALOG,
  type CatalogEntity,
} from '../combat/catalog.ts';
import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceId } from '../science/types.ts';
import type { BuildingLevels, BuildingRole, ScienceLevels } from './resource-zone.ts';
import { scaleRuntimeDuration, type RuntimeMode } from '../runtime/mode.ts';
import { SPACEPORT_UPGRADE_BALANCE_V1 } from './spaceport-upgrade-balance-v1.ts';

export const SPACEPORT_UPGRADE_QUEUE_CAPACITY = 3;
export const PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS = 15 * 60 * 1000;
export const SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK = Object.freeze({
  ships: 10,
  commanders: 40,
} as const);
export const PROTOTYPE_SPACEPORT_UPGRADE_COST = Object.freeze({
  metal: 500,
  minerals: 250,
  gas: 0,
});

export const SPACEPORT_UPGRADE_PROTOTYPE_NOTE =
  'BALANCE V1: стоимость и время обычных кораблей взяты из Factory upgrades для всех трёх рас. Космодром ускоряет новое улучшение на 5% за уровень; командирские корабли пока используют прототипные значения.';

export type SpaceportUpgradeTrack = 'ships' | 'commanders';
export type SpaceportUpgradeStatus =
  | 'available'
  | 'requirements-unmet'
  | 'queue-full'
  | 'insufficient-resource'
  | 'max-level';

export type SpaceportUpgradeWallet = {
  metal: number;
  minerals: number;
  gas: number;
};

export function calculateSpaceportUpgradeCost(fromLevel: number): SpaceportUpgradeWallet {
  const safeFromLevel = Number.isFinite(fromLevel) ? Math.max(0, Math.floor(fromLevel)) : 0;
  const multiplier = 2 ** safeFromLevel;
  return {
    metal: PROTOTYPE_SPACEPORT_UPGRADE_COST.metal * multiplier,
    minerals: PROTOTYPE_SPACEPORT_UPGRADE_COST.minerals * multiplier,
    gas: PROTOTYPE_SPACEPORT_UPGRADE_COST.gas * multiplier,
  };
}

export type SpaceportUpgradeTask = {
  id: string;
  track: SpaceportUpgradeTrack;
  shipId: string;
  fromLevel: number;
  toLevel: number;
  startedAt: number;
  finishAt: number;
  spaceportLevelAtStart: number;
  effectiveDurationMs: number;
};

export type SpaceportUpgradeState = {
  shipLevels: Record<string, number>;
  shipQueue: SpaceportUpgradeTask[];
  commanderQueue: SpaceportUpgradeTask[];
};

export type SpaceportRequirementState = {
  kind: 'building-level' | 'science-level' | 'unresolved-catalog-requirement';
  label: string;
  requiredLevel: number;
  currentLevel: number | null;
  met: boolean;
  valueKind: 'level' | 'quantity' | 'unknown';
  buildingRole?: BuildingRole;
  scienceId?: ScienceId;
};

export type SpaceportUpgradePreview = {
  status: SpaceportUpgradeStatus;
  canStart: boolean;
  reason: string | null;
  track: SpaceportUpgradeTrack;
  shipId: string;
  currentLevel: number;
  projectedLevel: number;
  nextLevel: number | null;
  queuedCount: number;
  requirements: readonly SpaceportRequirementState[];
  cost: SpaceportUpgradeWallet;
  baseDurationMs: number;
  effectiveDurationMs: number;
};

export type SpaceportUpgradeContext = {
  state: SpaceportUpgradeState;
  wallet: SpaceportUpgradeWallet;
  buildings: BuildingLevels;
  scienceLevels: ScienceLevels;
  spaceportLevel: number;
  factionId?: CombatFactionId;
  mode?: RuntimeMode;
  testTimeScale?: number;
};

export type SpaceportUpgradeTransition = {
  ok: boolean;
  state: SpaceportUpgradeState;
  wallet: SpaceportUpgradeWallet;
  task: SpaceportUpgradeTask | null;
  reason: string | null;
};

export type SpaceportReconciliation = {
  changed: boolean;
  state: SpaceportUpgradeState;
  completed: SpaceportUpgradeTask[];
};

const EXCLUDED_SHIP_UPGRADE_IDS = new Set<string>([
  'solar-satellite',
  'spy-probe',
  'colonizer',
  'recycler',
]);

const commanderIds = new Set<string>(COMMANDER_COMBAT_CATALOG.map((entity) => entity.id));

const normalizeRequirementName = (value: string) => value
  .toLocaleLowerCase('ru-RU')
  .replaceAll('ё', 'е')
  .replace(/[^а-яa-z0-9]+/giu, ' ')
  .trim();

const scienceByNormalizedName = new Map<string, (typeof SCIENCE_CATALOG)[number]>();
for (const science of SCIENCE_CATALOG) {
  scienceByNormalizedName.set(normalizeRequirementName(science.name), science);
  scienceByNormalizedName.set(normalizeRequirementName(science.sourceName), science);
}

export function getSpaceportUpgradeMaxLevel(track: SpaceportUpgradeTrack): number {
  return SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK[track];
}

function safeTrackLevel(value: unknown, track: SpaceportUpgradeTrack): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(getSpaceportUpgradeMaxLevel(track), Math.max(0, Math.floor(value)));
}

function safeSpaceportLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(10, Math.max(0, Math.floor(value)));
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function trackForEntityId(id: string): SpaceportUpgradeTrack {
  return commanderIds.has(id) ? 'commanders' : 'ships';
}

function queueForTrack(state: SpaceportUpgradeState, track: SpaceportUpgradeTrack) {
  return track === 'ships' ? state.shipQueue : state.commanderQueue;
}

function withQueue(
  state: SpaceportUpgradeState,
  track: SpaceportUpgradeTrack,
  queue: SpaceportUpgradeTask[],
): SpaceportUpgradeState {
  return track === 'ships'
    ? { ...state, shipQueue: queue }
    : { ...state, commanderQueue: queue };
}

function getSpaceportUpgradeBalance(track: SpaceportUpgradeTrack, shipId: string, fromLevel: number) {
  if (track !== 'ships') return null;
  const rows = SPACEPORT_UPGRADE_BALANCE_V1[shipId as keyof typeof SPACEPORT_UPGRADE_BALANCE_V1];
  return rows?.[fromLevel] ?? null;
}

function getCatalog(track: SpaceportUpgradeTrack, factionId: CombatFactionId): readonly CatalogEntity[] {
  if (track === 'commanders') return COMMANDER_COMBAT_CATALOG;
  return getFactionShipCatalog(factionId).filter((entity) => !EXCLUDED_SHIP_UPGRADE_IDS.has(entity.id));
}

export function getSpaceportUpgradeCatalog(
  track: SpaceportUpgradeTrack,
  factionId: CombatFactionId = 'aegis',
): readonly CatalogEntity[] {
  return getCatalog(track, factionId);
}

export function getSpaceportUpgradeEntity(
  track: SpaceportUpgradeTrack,
  shipId: string,
  factionId: CombatFactionId = 'aegis',
): CatalogEntity | null {
  return getCatalog(track, factionId).find((entity) => entity.id === shipId) ?? null;
}

export function createDefaultSpaceportUpgradeState(): SpaceportUpgradeState {
  const ids = [...getFactionShipCatalog('aegis'), ...COMMANDER_COMBAT_CATALOG].map((entity) => entity.id);
  return {
    shipLevels: Object.fromEntries(ids.map((id) => [id, 0])),
    shipQueue: [],
    commanderQueue: [],
  };
}

export function calculateSpaceportEffectiveDuration(
  baseDurationMs: number,
  spaceportLevel: number,
): number {
  const safeBase = Math.max(1, Math.round(baseDurationMs));
  const safeLevel = safeSpaceportLevel(spaceportLevel);
  return Math.max(1, Math.round(safeBase * (1 - 0.05 * safeLevel)));
}

export function hasFreeSpaceportQueueSlot(state: SpaceportUpgradeState, track: SpaceportUpgradeTrack): boolean {
  return queueForTrack(state, track).length < SPACEPORT_UPGRADE_QUEUE_CAPACITY;
}

function parseCatalogRequirement(
  raw: string,
  buildings: BuildingLevels,
  scienceLevels: ScienceLevels,
): SpaceportRequirementState | null {
  const match = raw.match(/^(.+?)\s*[·•]\s*(уровень|количество)\s*(\d+)\s*$/iu);
  if (!match) {
    return {
      kind: 'unresolved-catalog-requirement',
      label: raw.trim(),
      requiredLevel: 1,
      currentLevel: null,
      met: false,
      valueKind: 'unknown',
    };
  }

  const label = match[1].trim();
  const valueKind = match[2].toLocaleLowerCase('ru-RU') === 'количество' ? 'quantity' : 'level';
  const requiredLevel = Math.max(0, Number(match[3]));
  if (valueKind === 'quantity') {
    return {
      kind: 'unresolved-catalog-requirement',
      label,
      requiredLevel,
      currentLevel: null,
      met: false,
      valueKind,
    };
  }

  if (normalizeRequirementName(label) === normalizeRequirementName('Верфь')) {
    const currentLevel = buildings.shipyard ?? 0;
    return {
      kind: 'building-level',
      label: 'Верфь',
      requiredLevel,
      currentLevel,
      met: currentLevel >= requiredLevel,
      valueKind,
      buildingRole: 'shipyard',
    };
  }

  const science = scienceByNormalizedName.get(normalizeRequirementName(label));
  if (!science) {
    return {
      kind: 'unresolved-catalog-requirement',
      label,
      requiredLevel,
      currentLevel: null,
      met: false,
      valueKind,
    };
  }

  const currentLevel = scienceLevels[science.id] ?? 0;
  return {
    kind: 'science-level',
    label: science.name,
    requiredLevel,
    currentLevel,
    met: currentLevel >= requiredLevel,
    valueKind,
    scienceId: science.id,
  };
}

export function evaluateSpaceportUpgradeRequirements(
  track: SpaceportUpgradeTrack,
  shipId: string,
  buildings: BuildingLevels,
  scienceLevels: ScienceLevels,
  factionId: CombatFactionId = 'aegis',
): SpaceportRequirementState[] {
  const entity = getSpaceportUpgradeEntity(track, shipId, factionId);
  if (!entity) return [];

  const parsed = entity.construction.requirements
    .map((raw) => parseCatalogRequirement(raw, buildings, scienceLevels))
    .filter((item): item is SpaceportRequirementState => item != null);

  const hasShipyardRequirement = parsed.some((requirement) => requirement.kind === 'building-level');
  if (!hasShipyardRequirement) {
    const currentLevel = buildings.shipyard ?? 0;
    parsed.unshift({
      kind: 'building-level',
      label: 'Верфь',
      requiredLevel: entity.construction.requiredShipyardLevel,
      currentLevel,
      met: currentLevel >= entity.construction.requiredShipyardLevel,
      valueKind: 'level',
      buildingRole: 'shipyard',
    });
  }

  return parsed;
}

export function formatSpaceportRequirement(requirement: SpaceportRequirementState): string {
  const valueLabel = requirement.valueKind === 'quantity'
    ? 'количество'
    : requirement.valueKind === 'unknown'
      ? 'значение'
      : 'уровень';
  if (requirement.currentLevel == null) {
    const modelLabel = requirement.valueKind === 'quantity'
      ? 'общей модели состава флота'
      : requirement.valueKind === 'unknown'
        ? 'общей модели требований'
        : 'общей science-модели';
    return `${requirement.label} — ${valueLabel} ${requirement.requiredLevel}; текущее ${valueLabel} не подключено к ${modelLabel}`;
  }
  return `${requirement.label} — ${valueLabel} ${requirement.requiredLevel}; сейчас ${requirement.currentLevel}`;
}

export function previewSpaceportUpgrade(
  context: SpaceportUpgradeContext,
  track: SpaceportUpgradeTrack,
  shipId: string,
): SpaceportUpgradePreview {
  const entity = getSpaceportUpgradeEntity(track, shipId, context.factionId);
  if (!entity) throw new Error(`Unknown ${track} upgrade target: ${shipId}`);

  const maxLevel = getSpaceportUpgradeMaxLevel(track);
  const queue = queueForTrack(context.state, track);
  const currentLevel = safeTrackLevel(context.state.shipLevels[shipId], track);
  const queuedCount = queue.filter((task) => task.shipId === shipId).length;
  const projectedLevel = Math.min(maxLevel, currentLevel + queuedCount);
  const requirements = evaluateSpaceportUpgradeRequirements(
    track,
    shipId,
    context.buildings,
    context.scienceLevels,
    context.factionId,
  );
  const balance = getSpaceportUpgradeBalance(track, shipId, projectedLevel);
  const cost = balance ? { ...balance.cost } : calculateSpaceportUpgradeCost(projectedLevel);
  const baseDurationMs = balance?.durationMs ?? PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS;
  const effectiveDurationMs = scaleRuntimeDuration(calculateSpaceportEffectiveDuration(
    baseDurationMs,
    context.spaceportLevel,
  ), context.mode ?? 'production', context.testTimeScale);
  const base = {
    track,
    shipId,
    currentLevel,
    projectedLevel,
    nextLevel: projectedLevel < maxLevel ? projectedLevel + 1 : null,
    queuedCount,
    requirements,
    cost,
    baseDurationMs,
    effectiveDurationMs,
  };

  if (projectedLevel >= maxLevel) {
    return { ...base, status: 'max-level', canStart: false, reason: 'Достигнут максимальный уровень корабля.' };
  }

  const missingRequirements = requirements.filter((requirement) => !requirement.met);
  if (missingRequirements.length > 0) {
    return {
      ...base,
      status: 'requirements-unmet',
      canStart: false,
      reason: `Требуется: ${missingRequirements.map(formatSpaceportRequirement).join('; ')}.`,
    };
  }

  if (!hasFreeSpaceportQueueSlot(context.state, track)) {
    return { ...base, status: 'queue-full', canStart: false, reason: 'Очередь улучшений заполнена.' };
  }

  const missingResource = (Object.keys(cost) as (keyof SpaceportUpgradeWallet)[])
    .find((key) => context.wallet[key] < cost[key]);
  if (missingResource) {
    const labels: Record<keyof SpaceportUpgradeWallet, string> = {
      metal: 'металла',
      minerals: 'минералов',
      gas: 'газа',
    };
    return {
      ...base,
      status: 'insufficient-resource',
      canStart: false,
      reason: `Недостаточно ${labels[missingResource]}.`,
    };
  }

  return { ...base, status: 'available', canStart: true, reason: null };
}

export function enqueueSpaceportUpgrade(
  context: SpaceportUpgradeContext,
  track: SpaceportUpgradeTrack,
  shipId: string,
  now: number,
  taskId: string,
): SpaceportUpgradeTransition {
  if (!getSpaceportUpgradeEntity(track, shipId, context.factionId)) {
    return {
      ok: false,
      state: context.state,
      wallet: context.wallet,
      task: null,
      reason: 'Эта позиция недоступна для улучшения в Космодроме.',
    };
  }

  const preview = previewSpaceportUpgrade(context, track, shipId);
  if (!preview.canStart || preview.nextLevel == null) {
    return {
      ok: false,
      state: context.state,
      wallet: context.wallet,
      task: null,
      reason: preview.reason,
    };
  }

  const queue = queueForTrack(context.state, track);
  const previous = queue.at(-1) ?? null;
  const startedAt = previous ? previous.finishAt : now;
  const effectiveDurationMs = preview.effectiveDurationMs;
  const task: SpaceportUpgradeTask = {
    id: taskId,
    track,
    shipId,
    fromLevel: preview.projectedLevel,
    toLevel: preview.nextLevel,
    startedAt,
    finishAt: startedAt + effectiveDurationMs,
    spaceportLevelAtStart: safeSpaceportLevel(context.spaceportLevel),
    effectiveDurationMs,
  };
  const wallet: SpaceportUpgradeWallet = {
    metal: context.wallet.metal - preview.cost.metal,
    minerals: context.wallet.minerals - preview.cost.minerals,
    gas: context.wallet.gas - preview.cost.gas,
  };

  return {
    ok: true,
    state: withQueue(context.state, track, [...queue, task]),
    wallet,
    task,
    reason: null,
  };
}

function reconcileTrack(
  state: SpaceportUpgradeState,
  track: SpaceportUpgradeTrack,
  now: number,
): { state: SpaceportUpgradeState; completed: SpaceportUpgradeTask[]; removed: number } {
  let nextState = state;
  let queue = [...queueForTrack(nextState, track)];
  const completed: SpaceportUpgradeTask[] = [];
  let removed = 0;
  const maxLevel = getSpaceportUpgradeMaxLevel(track);

  while (queue[0] && now >= queue[0].finishAt) {
    const task = queue[0];
    const currentLevel = safeTrackLevel(nextState.shipLevels[task.shipId], track);
    const taskTarget = safeTrackLevel(task.toLevel, track);
    if (currentLevel < taskTarget) {
      const nextLevel = Math.min(maxLevel, taskTarget);
      nextState = {
        ...nextState,
        shipLevels: {
          ...nextState.shipLevels,
          [task.shipId]: nextLevel,
        },
      };
      completed.push(task);
    }
    queue = queue.slice(1);
    removed += 1;
  }

  return { state: withQueue(nextState, track, queue), completed, removed };
}

export function reconcileSpaceportUpgradeState(
  state: SpaceportUpgradeState,
  now: number,
): SpaceportReconciliation {
  const ships = reconcileTrack(state, 'ships', now);
  const commanders = reconcileTrack(ships.state, 'commanders', now);
  const completed = [...ships.completed, ...commanders.completed];
  return {
    changed: ships.removed + commanders.removed > 0,
    state: commanders.state,
    completed,
  };
}

function migrateQueue(
  value: unknown,
  track: SpaceportUpgradeTrack,
  levels: Record<string, number>,
): SpaceportUpgradeTask[] {
  const source = Array.isArray(value) ? value : [];
  const result: SpaceportUpgradeTask[] = [];
  const queuedPerTarget: Record<string, number> = {};
  let previousFinishAt: number | null = null;
  const maxLevel = getSpaceportUpgradeMaxLevel(track);

  for (const raw of source) {
    if (result.length >= SPACEPORT_UPGRADE_QUEUE_CAPACITY) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const shipId = typeof item.shipId === 'string' ? item.shipId : '';
    if (!getSpaceportUpgradeEntity(track, shipId)) continue;

    const queuedBefore = queuedPerTarget[shipId] ?? 0;
    const currentLevel = safeTrackLevel(levels[shipId], track);
    const expectedFromLevel = Math.min(
      maxLevel,
      currentLevel + queuedBefore,
    );
    const persistedFromLevel = typeof item.fromLevel === 'number' && Number.isFinite(item.fromLevel)
      ? Math.floor(item.fromLevel)
      : null;
    const persistedToLevel = typeof item.toLevel === 'number' && Number.isFinite(item.toLevel)
      ? Math.floor(item.toLevel)
      : null;

    // Current saves contain explicit level transitions. Drop a task whose
    // persisted target is already applied before rebuilding legacy fields;
    // otherwise readSave() would replay it as the next level.
    if (persistedToLevel != null && safeTrackLevel(persistedToLevel, track) <= currentLevel) continue;

    const persistedTransitionIsValid = persistedFromLevel != null
      && persistedToLevel != null
      && persistedToLevel === persistedFromLevel + 1
      && persistedFromLevel === expectedFromLevel
      && safeTrackLevel(persistedToLevel, track) === expectedFromLevel + 1;
    const fromLevel = persistedTransitionIsValid
      ? safeTrackLevel(persistedFromLevel, track)
      : expectedFromLevel;
    if (fromLevel >= maxLevel) continue;

    const rawStartedAt = safeTimestamp(item.startedAt) ?? previousFinishAt ?? 0;
    const effectiveDurationMs = typeof item.effectiveDurationMs === 'number'
      && Number.isFinite(item.effectiveDurationMs)
      && item.effectiveDurationMs > 0
      ? Math.round(item.effectiveDurationMs)
      : PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS;
    const startedAt: number = previousFinishAt == null ? rawStartedAt : previousFinishAt;
    const rawFinishAt = safeTimestamp(item.finishAt);
    const finishAt: number = rawFinishAt != null && rawFinishAt >= startedAt
      ? rawFinishAt
      : startedAt + effectiveDurationMs;
    const spaceportLevelAtStart = safeSpaceportLevel(item.spaceportLevelAtStart);
    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id
      : `migrated-${track}-${result.length}-${shipId}-${startedAt}`;

    result.push({
      id,
      track,
      shipId,
      fromLevel,
      toLevel: fromLevel + 1,
      startedAt,
      finishAt,
      spaceportLevelAtStart,
      effectiveDurationMs,
    });
    queuedPerTarget[shipId] = queuedBefore + 1;
    previousFinishAt = finishAt;
  }

  return result;
}

export function migrateSpaceportUpgradeState(value: unknown): SpaceportUpgradeState {
  const defaults = createDefaultSpaceportUpgradeState();
  if (!value || typeof value !== 'object') return defaults;
  const source = value as Record<string, unknown>;
  const rawLevels = source.shipLevels && typeof source.shipLevels === 'object'
    ? source.shipLevels as Record<string, unknown>
    : source.levels && typeof source.levels === 'object'
      ? source.levels as Record<string, unknown>
      : {};
  const shipLevels = { ...defaults.shipLevels };
  for (const id of Object.keys(shipLevels)) {
    shipLevels[id] = safeTrackLevel(rawLevels[id], trackForEntityId(id));
  }

  return {
    shipLevels,
    shipQueue: migrateQueue(source.shipQueue, 'ships', shipLevels),
    commanderQueue: migrateQueue(source.commanderQueue, 'commanders', shipLevels),
  };
}
