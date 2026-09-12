import {
  COMMANDER_COMBAT_CATALOG,
  type CatalogEntity,
} from '../combat/catalog.ts';
import { isCommanderId, type CommanderId } from '../combat/commanders.ts';
import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceId } from '../science/types.ts';
import type { BuildingLevels, BuildingRole, ScienceLevels } from './resource-zone.ts';
import { scaleRuntimeDuration, type RuntimeMode } from '../runtime/mode.ts';
import { getFactionSpaceportUpgradeBalance } from './spaceport-upgrade-balance-v1.ts';
import { getCommanderSpaceportUpgradeBalance } from './commander-upgrade-balance-v1.ts';
import { creditResources, type ResourceCapacitiesInput, type ResourceCreditResult } from '../resources/credit.ts';
import {
  calculateRefund,
  CANCEL_REFUND_MAX_PERCENT,
  CANCEL_REFUND_MIN_PERCENT,
  selectCancelRefundPercent,
} from '../resources/refund.ts';

export const SPACEPORT_UPGRADE_QUEUE_CAPACITY = 3;
export const PROTOTYPE_SPACEPORT_UPGRADE_BASE_DURATION_MS = 15 * 60 * 1000;
export const SPACEPORT_UPGRADE_MAX_LEVEL_BY_TRACK = Object.freeze({
  ships: 10,
  commanders: 40,
} as const);
export const SPACEPORT_UPGRADE_PROTOTYPE_NOTE =
  'BALANCE V1: обычные корабли используют Factory upgrades и Time Rebalanced, а командирские корабли — все 13 таблиц Ability upgrades из Time Rebalanced. Космодром ускоряет только новое улучшение на 5% за уровень; уже созданные задания сохраняют снимок времени.';

export const SPACEPORT_CANCEL_REFUND_MIN_PERCENT = CANCEL_REFUND_MIN_PERCENT;
export const SPACEPORT_CANCEL_REFUND_MAX_PERCENT = CANCEL_REFUND_MAX_PERCENT;
export const SPACEPORT_CANCEL_REFUND_SOURCE_URL = 'https://github.com/ratoker-jpg/Nemexia_auto_v2/blob/main/saved_pages/%D0%BD%D0%B0%D1%83%D0%BA%D0%B0/page_2026-09-05_22-49-40.html';

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

export type SpaceportUpgradeCostSource = 'faction-factory-upgrades' | 'commander-ability-upgrades' | 'legacy-unknown';

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
  /** Paid cost snapshot. Old tasks without this field are not refundable. */
  cost: SpaceportUpgradeWallet;
  costSource: SpaceportUpgradeCostSource;
  refundEligible?: boolean;
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
  costSource: Exclude<SpaceportUpgradeCostSource, 'legacy-unknown'>;
  gasSpecified: boolean;
  baseDurationMs: number;
  effectiveDurationMs: number;
};

export type SpaceportUpgradeContext = {
  state: SpaceportUpgradeState;
  wallet: SpaceportUpgradeWallet;
  capacities?: ResourceCapacitiesInput;
  buildings: BuildingLevels;
  scienceLevels: ScienceLevels;
  spaceportLevel: number;
  factionId?: CombatFactionId;
  mode?: RuntimeMode;
  testTimeScale?: number;
};

export type SpaceportCancellationTransition = {
  ok: boolean;
  state: SpaceportUpgradeState;
  wallet: SpaceportUpgradeWallet;
  canceled: SpaceportUpgradeTask | null;
  canceledTasks: SpaceportUpgradeTask[];
  refund: SpaceportUpgradeWallet | null;
  refundPercent: number | null;
  refundPercents: number[];
  reason: string | null;
  credit?: ResourceCreditResult;
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

function hasCompleteSpaceportCost(value: unknown): value is SpaceportUpgradeWallet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cost = value as Record<string, unknown>;
  return (['metal', 'minerals', 'gas'] as const).every((key) => (
    typeof cost[key] === 'number' && Number.isFinite(cost[key]) && cost[key] >= 0
  ));
}

function spaceportCostSource(value: unknown): SpaceportUpgradeCostSource {
  return value === 'faction-factory-upgrades'
    || value === 'commander-ability-upgrades'
    || value === 'legacy-unknown'
    ? value
    : 'legacy-unknown';
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

function getSpaceportUpgradeBalance(
  track: SpaceportUpgradeTrack,
  shipId: string,
  fromLevel: number,
  factionId: CombatFactionId,
): { cost: SpaceportUpgradeWallet; durationMs: number; costSource: Exclude<SpaceportUpgradeCostSource, 'legacy-unknown'>; gasSpecified: boolean } | null {
  if (track === 'ships') {
    const balance = getFactionSpaceportUpgradeBalance(factionId, shipId, fromLevel);
    return balance ? { ...balance, costSource: 'faction-factory-upgrades', gasSpecified: true } : null;
  }
  if (!isCommanderId(shipId)) return null;
  const balance = getCommanderSpaceportUpgradeBalance(shipId as CommanderId, fromLevel);
  return balance
    ? { cost: { ...balance.cost }, durationMs: balance.durationMs, costSource: 'commander-ability-upgrades', gasSpecified: false }
    : null;
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
    // TODO(phase6): connect Veyra sacrifice/quantity requirements to the
    // future fleet-production inventory. Until that model exists, keep the
    // requirement explicitly unresolved instead of inventing a current count.
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
  // A max-level preview still needs a stable display payload, but there is no
  // L -> L+1 row after the cap. Reuse the last real row for display only; it
  // never becomes enqueueable because the max-level branch below returns first.
  const balanceLevel = Math.min(projectedLevel, Math.max(0, maxLevel - 1));
  const balance = getSpaceportUpgradeBalance(track, shipId, balanceLevel, context.factionId ?? 'aegis');
  if (!balance) {
    throw new Error(`Missing ${track} upgrade balance for ${shipId} at level ${balanceLevel + 1}`);
  }
  const { cost, costSource, gasSpecified } = balance;
  const baseDurationMs = balance.durationMs;
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
    costSource,
    gasSpecified,
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
    cost: { ...preview.cost },
    costSource: preview.costSource,
    refundEligible: true,
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

export function selectSpaceportCancelRefundPercent(rng: () => number = Math.random): number {
  return selectCancelRefundPercent(rng);
}

function refundSpaceportCost(cost: SpaceportUpgradeWallet, refundPercent: number): SpaceportUpgradeWallet {
  return calculateRefund(cost, refundPercent);
}

function removeDependentSpaceportTasks(
  queue: readonly SpaceportUpgradeTask[],
  canceledIndex: number,
  state: SpaceportUpgradeState,
  track: SpaceportUpgradeTrack,
): { remaining: SpaceportUpgradeTask[]; cascaded: SpaceportUpgradeTask[] } {
  const canceledTask = queue[canceledIndex];
  if (!canceledTask) return { remaining: [...queue], cascaded: [] };

  const projectedLevels = { ...state.shipLevels };
  const remaining: SpaceportUpgradeTask[] = [];
  const cascaded: SpaceportUpgradeTask[] = [];

  queue.forEach((task, index) => {
    const projectedLevel = safeTrackLevel(projectedLevels[task.shipId], track);
    if (index < canceledIndex) {
      remaining.push(task);
      projectedLevels[task.shipId] = Math.max(projectedLevel, safeTrackLevel(task.toLevel, track));
      return;
    }
    if (index === canceledIndex) {
      cascaded.push(task);
      return;
    }

    if (task.shipId === canceledTask.shipId
      && (task.fromLevel !== projectedLevel || task.toLevel !== projectedLevel + 1)) {
      cascaded.push(task);
      return;
    }

    remaining.push(task);
    projectedLevels[task.shipId] = Math.max(projectedLevel, safeTrackLevel(task.toLevel, track));
  });

  return { remaining, cascaded };
}

function rescheduleSpaceportQueue(
  queue: readonly SpaceportUpgradeTask[],
  canceledWasActive: boolean,
  now: number,
): SpaceportUpgradeTask[] {
  if (queue.length === 0) return [];
  let cursor = canceledWasActive ? now : queue[0]?.finishAt ?? now;
  return queue.map((task, index) => {
    if (!canceledWasActive && index === 0) return task;
    const startedAt = cursor;
    const finishAt = startedAt + task.effectiveDurationMs;
    cursor = finishAt;
    return { ...task, startedAt, finishAt };
  });
}

export function cancelSpaceportUpgrade(
  context: SpaceportUpgradeContext,
  taskId: string,
  now: number,
  rng: () => number = Math.random,
): SpaceportCancellationTransition {
  const reconciledState = reconcileSpaceportUpgradeState(context.state, now).state;
  const tracks: readonly SpaceportUpgradeTrack[] = ['ships', 'commanders'];
  let track: SpaceportUpgradeTrack | null = null;
  let queueIndex = -1;
  for (const candidate of tracks) {
    const index = queueForTrack(reconciledState, candidate).findIndex((task) => task.id === taskId);
    if (index >= 0) {
      track = candidate;
      queueIndex = index;
      break;
    }
  }

  if (!track || queueIndex < 0) {
    return {
      ok: false,
      state: reconciledState,
      wallet: context.wallet,
      canceled: null,
      canceledTasks: [],
      refund: null,
      refundPercent: null,
      refundPercents: [],
      reason: 'Улучшение уже завершено или недоступно для отмены.',
    };
  }

  const queue = queueForTrack(reconciledState, track);
  const task = queue[queueIndex];
  if (!task || task.refundEligible === false || !hasCompleteSpaceportCost(task.cost)) {
    return {
      ok: false,
      state: reconciledState,
      wallet: context.wallet,
      canceled: null,
      canceledTasks: [],
      refund: null,
      refundPercent: null,
      refundPercents: [],
      reason: 'Невозможно подтвердить сохранённую стоимость старого задания.',
    };
  }

  const { remaining, cascaded } = removeDependentSpaceportTasks(queue, queueIndex, reconciledState, track);
  const canceledTasks = [task, ...cascaded.filter((candidate) => candidate.id !== task.id)];
  const refundPercents: number[] = [];
  const refund = canceledTasks.reduce((total, canceledTask) => {
    if (canceledTask.refundEligible === false || !hasCompleteSpaceportCost(canceledTask.cost)) return total;
    const refundPercent = selectSpaceportCancelRefundPercent(rng);
    refundPercents.push(refundPercent);
    const itemRefund = refundSpaceportCost(canceledTask.cost, refundPercent);
    return {
      metal: total.metal + itemRefund.metal,
      minerals: total.minerals + itemRefund.minerals,
      gas: total.gas + itemRefund.gas,
    };
  }, { metal: 0, minerals: 0, gas: 0 });
  const unlimitedCapacities = { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER };
  const credit = creditResources(
    { ...context.wallet, energy: 0 },
    context.capacities ?? unlimitedCapacities,
    refund,
  );
  const wallet = {
    metal: credit.wallet.metal,
    minerals: credit.wallet.minerals,
    gas: credit.wallet.gas,
  };

  return {
    ok: true,
    state: withQueue(reconciledState, track, rescheduleSpaceportQueue(remaining, queueIndex === 0, now)),
    wallet,
    canceled: task,
    canceledTasks,
    refund,
    refundPercent: refundPercents[0] ?? null,
    refundPercents,
    reason: null,
    credit,
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
    const savedCost = hasCompleteSpaceportCost(item.cost) ? item.cost : null;
    const cost = savedCost
      ? { metal: savedCost.metal, minerals: savedCost.minerals, gas: savedCost.gas }
      : { metal: 0, minerals: 0, gas: 0 };
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
      cost,
      costSource: savedCost ? spaceportCostSource(item.costSource) : 'legacy-unknown',
      refundEligible: savedCost != null,
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
