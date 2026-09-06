import {
  COMMANDER_COMBAT_CATALOG,
  SHIP_COMBAT_CATALOG,
  type CatalogEntity,
} from '../combat/catalog.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceId } from '../science/types.ts';
import type { BuildingLevels, ScienceLevels } from './resource-zone.ts';

export const SPACEPORT_UPGRADE_QUEUE_CAPACITY = 3;
export const PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS = 15 * 60 * 1000;
export const PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL = 10;
export const PROTOTYPE_SPACEPORT_UPGRADE_COST = Object.freeze({
  metal: 500,
  minerals: 250,
  gas: 0,
});

export const SPACEPORT_UPGRADE_PROTOTYPE_NOTE =
  'PROTOTYPE: стоимость, индивидуальная длительность, максимальный уровень кораблей и правило повторной постановки ещё не являются каноническим балансом.';
export const SPACEPORT_DUPLICATE_POLICY_TBD =
  'TBD: общий каталог не задаёт запрет повторной постановки одной цели, поэтому очередь допускает последовательные N → N+1 задачи одного корабля.';

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

const CATALOG_BY_TRACK: Readonly<Record<SpaceportUpgradeTrack, readonly CatalogEntity[]>> = {
  ships: SHIP_COMBAT_CATALOG,
  commanders: COMMANDER_COMBAT_CATALOG,
};

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

function safeLevel(value: unknown, maxLevel = PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(value)));
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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

export function getSpaceportUpgradeCatalog(track: SpaceportUpgradeTrack): readonly CatalogEntity[] {
  return CATALOG_BY_TRACK[track];
}

export function getSpaceportUpgradeEntity(track: SpaceportUpgradeTrack, shipId: string): CatalogEntity | null {
  return CATALOG_BY_TRACK[track].find((entity) => entity.id === shipId) ?? null;
}

export function createDefaultSpaceportUpgradeState(): SpaceportUpgradeState {
  const ids = [...SHIP_COMBAT_CATALOG, ...COMMANDER_COMBAT_CATALOG].map((entity) => entity.id);
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
  const safeSpaceportLevel = Math.min(10, Math.max(0, Math.floor(spaceportLevel)));
  return Math.max(1, Math.round(safeBase * (1 - 0.05 * safeSpaceportLevel)));
}

export function hasFreeSpaceportQueueSlot(state: SpaceportUpgradeState, track: SpaceportUpgradeTrack): boolean {
  return queueForTrack(state, track).length < SPACEPORT_UPGRADE_QUEUE_CAPACITY;
}

function parseCatalogRequirement(
  raw: string,
  buildings: BuildingLevels,
  scienceLevels: ScienceLevels,
): SpaceportRequirementState | null {
  const match = raw.match(/^(.+?)\s*[·•]\s*уровень\s*(\d+)\s*$/iu);
  if (!match) {
    return {
      kind: 'unresolved-catalog-requirement',
      label: raw.trim(),
      requiredLevel: 1,
      currentLevel: null,
      met: false,
    };
  }

  const label = match[1].trim();
  const requiredLevel = Math.max(0, Number(match[2]));
  if (normalizeRequirementName(label) === normalizeRequirementName('Верфь')) {
    const currentLevel = buildings.shipyard ?? 0;
    return {
      kind: 'building-level',
      label: 'Верфь',
      requiredLevel,
      currentLevel,
      met: currentLevel >= requiredLevel,
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
    };
  }

  const currentLevel = scienceLevels[science.id] ?? 0;
  return {
    kind: 'science-level',
    label: science.name,
    requiredLevel,
    currentLevel,
    met: currentLevel >= requiredLevel,
    scienceId: science.id,
  };
}

export function evaluateSpaceportUpgradeRequirements(
  track: SpaceportUpgradeTrack,
  shipId: string,
  buildings: BuildingLevels,
  scienceLevels: ScienceLevels,
): SpaceportRequirementState[] {
  const entity = getSpaceportUpgradeEntity(track, shipId);
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
    });
  }

  return parsed;
}

export function formatSpaceportRequirement(requirement: SpaceportRequirementState): string {
  if (requirement.currentLevel == null) {
    return `${requirement.label} — уровень ${requirement.requiredLevel}; текущий уровень не подключён к общей science-модели`;
  }
  return `${requirement.label} — уровень ${requirement.requiredLevel}; сейчас ${requirement.currentLevel}`;
}

export function previewSpaceportUpgrade(
  context: SpaceportUpgradeContext,
  track: SpaceportUpgradeTrack,
  shipId: string,
): SpaceportUpgradePreview {
  const entity = getSpaceportUpgradeEntity(track, shipId);
  if (!entity) throw new Error(`Unknown ${track} upgrade target: ${shipId}`);

  const queue = queueForTrack(context.state, track);
  const currentLevel = safeLevel(context.state.shipLevels[shipId]);
  const queuedCount = queue.filter((task) => task.shipId === shipId).length;
  const projectedLevel = Math.min(PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL, currentLevel + queuedCount);
  const requirements = evaluateSpaceportUpgradeRequirements(track, shipId, context.buildings, context.scienceLevels);
  const effectiveDurationMs = calculateSpaceportEffectiveDuration(
    PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS,
    context.spaceportLevel,
  );
  const base = {
    track,
    shipId,
    currentLevel,
    projectedLevel,
    nextLevel: projectedLevel < PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL ? projectedLevel + 1 : null,
    queuedCount,
    requirements,
    cost: { ...PROTOTYPE_SPACEPORT_UPGRADE_COST },
    baseDurationMs: PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS,
    effectiveDurationMs,
  };

  if (projectedLevel >= PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL) {
    return { ...base, status: 'max-level', canStart: false, reason: 'Достигнут prototype-максимум уровня корабля.' };
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
    return { ...base, status: 'queue-full', canStart: false, reason: 'Очередь заполнена.' };
  }

  const missingResource = (Object.keys(PROTOTYPE_SPACEPORT_UPGRADE_COST) as (keyof SpaceportUpgradeWallet)[])
    .find((key) => context.wallet[key] < PROTOTYPE_SPACEPORT_UPGRADE_COST[key]);
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
    spaceportLevelAtStart: Math.min(10, Math.max(0, Math.floor(context.spaceportLevel))),
    effectiveDurationMs,
  };
  const wallet: SpaceportUpgradeWallet = {
    metal: context.wallet.metal - PROTOTYPE_SPACEPORT_UPGRADE_COST.metal,
    minerals: context.wallet.minerals - PROTOTYPE_SPACEPORT_UPGRADE_COST.minerals,
    gas: context.wallet.gas - PROTOTYPE_SPACEPORT_UPGRADE_COST.gas,
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
): { state: SpaceportUpgradeState; completed: SpaceportUpgradeTask[] } {
  let nextState = state;
  let queue = [...queueForTrack(nextState, track)];
  const completed: SpaceportUpgradeTask[] = [];

  while (queue[0] && now >= queue[0].finishAt) {
    const task = queue[0];
    const currentLevel = safeLevel(nextState.shipLevels[task.shipId]);
    const nextLevel = Math.min(PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL, currentLevel + 1);
    nextState = {
      ...nextState,
      shipLevels: {
        ...nextState.shipLevels,
        [task.shipId]: nextLevel,
      },
    };
    completed.push(task);
    queue = queue.slice(1);
  }

  return { state: withQueue(nextState, track, queue), completed };
}

export function reconcileSpaceportUpgradeState(
  state: SpaceportUpgradeState,
  now: number,
): SpaceportReconciliation {
  const ships = reconcileTrack(state, 'ships', now);
  const commanders = reconcileTrack(ships.state, 'commanders', now);
  const completed = [...ships.completed, ...commanders.completed];
  return {
    changed: completed.length > 0,
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

  for (const raw of source) {
    if (result.length >= SPACEPORT_UPGRADE_QUEUE_CAPACITY) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const shipId = typeof item.shipId === 'string' ? item.shipId : '';
    if (!getSpaceportUpgradeEntity(track, shipId)) continue;

    const queuedBefore = queuedPerTarget[shipId] ?? 0;
    const fromLevel = Math.min(
      PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL,
      safeLevel(levels[shipId]) + queuedBefore,
    );
    if (fromLevel >= PROTOTYPE_SPACEPORT_UPGRADE_MAX_LEVEL) continue;

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
    const spaceportLevelAtStart = safeLevel(item.spaceportLevelAtStart, 10);
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
  for (const id of Object.keys(shipLevels)) shipLevels[id] = safeLevel(rawLevels[id]);

  return {
    shipLevels,
    shipQueue: migrateQueue(source.shipQueue, 'ships', shipLevels),
    commanderQueue: migrateQueue(source.commanderQueue, 'commanders', shipLevels),
  };
}
