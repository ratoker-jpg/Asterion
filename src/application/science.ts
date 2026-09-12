import {
  SCIENCE_CANCEL_REQUEST_EVENT,
  SCIENCE_RUNTIME_CHANGED_EVENT,
  SCIENCE_START_REQUEST_EVENT,
  cancelScienceResearch,
  createDefaultScienceState,
  createScienceRuntimeSnapshot,
  reconcileScienceState,
  startScienceResearch,
  type ScienceCancellationTransition,
  type ScienceRuntimeSnapshot,
  type ScienceStartRequest,
} from '../domain/science/runtime.ts';
import type { ScienceId } from '../domain/science/types.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import {
  ACTIVE_RUNTIME_MODE,
  resolveTestTimeScale,
  type RuntimeMode,
  type TestTimeScale,
} from '../domain/runtime/mode.ts';
import {
  createPersistenceFacade,
  SAVE_SCHEMA_VERSION,
  type PersistenceOptions,
} from './persistence.ts';
import {
  getPlanetState,
  replacePlanetState,
  type PlanetId,
  type SaveState,
} from './contracts.ts';

export type ScienceApplicationContext = {
  planetId: PlanetId;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
  now: number;
  rng?: () => number;
  createTaskId?: (scienceId: ScienceId, now: number) => string;
};

export type ScienceActionResult = {
  state: SaveState;
  transition: ScienceCancellationTransition | ReturnType<typeof startScienceResearch>;
};

function walletFor(state: SaveState, planetId: PlanetId) {
  const planet = getPlanetState(state, planetId);
  return {
    metal: state.metal,
    minerals: state.minerals,
    gas: state.gas,
    energy: planet.energy,
  };
}

function stateFromScienceTransition(
  state: SaveState,
  planetId: PlanetId,
  nextScience: SaveState['science'],
  wallet: ReturnType<typeof walletFor>,
): SaveState {
  const planet = getPlanetState(state, planetId);
  return replacePlanetState({
    ...state,
    schemaVersion: SAVE_SCHEMA_VERSION,
    metal: wallet.metal,
    minerals: wallet.minerals,
    gas: wallet.gas,
    science: nextScience,
  }, planetId, { ...planet, energy: wallet.energy });
}

function defaultScienceTaskId(scienceId: ScienceId, now: number): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `science-${scienceId}-${now}-${Math.random().toString(36).slice(2, 9)}`;
}

export function startScience(
  state: SaveState,
  context: ScienceApplicationContext,
  scienceId: ScienceId,
  taskId = (context.createTaskId ?? defaultScienceTaskId)(scienceId, context.now),
): ScienceActionResult {
  const planet = getPlanetState(state, context.planetId);
  const transition = startScienceResearch({
    state: state.science,
    wallet: walletFor(state, context.planetId),
    capacities: getStorageCapacities(planet.buildings),
    laboratoryLevel: planet.buildings.research,
    now: context.now,
    mode: context.mode,
    testTimeScale: context.testTimeScale,
  }, scienceId, taskId);
  return {
    transition,
    state: transition.ok
      ? stateFromScienceTransition(state, context.planetId, transition.state, transition.wallet)
      : state,
  };
}

export function cancelScience(
  state: SaveState,
  context: ScienceApplicationContext,
  taskId: string,
): ScienceActionResult {
  const planet = getPlanetState(state, context.planetId);
  const transition = cancelScienceResearch({
    state: state.science,
    wallet: walletFor(state, context.planetId),
    capacities: getStorageCapacities(planet.buildings),
    laboratoryLevel: planet.buildings.research,
    now: context.now,
    mode: context.mode,
    testTimeScale: context.testTimeScale,
    rng: context.rng,
  }, taskId);
  return {
    transition,
    state: stateFromScienceTransition(state, context.planetId, transition.state, transition.wallet),
  };
}

export type ScienceReconcileResult = {
  changed: boolean;
  state: SaveState;
  completedScienceIds: ScienceId[];
};

export function reconcileScience(
  state: SaveState,
  context: Pick<ScienceApplicationContext, 'planetId' | 'now'>,
): ScienceReconcileResult {
  const transition = reconcileScienceState(state.science, context.now);
  return {
    changed: transition.changed,
    state: transition.changed
      ? { ...state, schemaVersion: SAVE_SCHEMA_VERSION, science: transition.state }
      : state,
    completedScienceIds: transition.completed.map((task) => task.scienceId),
  };
}

export function createScienceSnapshot(
  state: SaveState,
  context: ScienceApplicationContext,
): ScienceRuntimeSnapshot {
  const planet = getPlanetState(state, context.planetId);
  return createScienceRuntimeSnapshot(
    state.science,
    walletFor(state, context.planetId),
    planet.buildings.research,
    context.now,
    context.mode,
    context.testTimeScale,
  );
}

export function readScienceSnapshot(options: PersistenceOptions = {}): ScienceRuntimeSnapshot {
  const mode = options.mode ?? ACTIVE_RUNTIME_MODE;
  const testTimeScale = options.testTimeScale ?? resolveTestTimeScale();
  const now = options.now?.() ?? Date.now();
  const persistence = createPersistenceFacade(options);
  const storage = options.storage !== undefined
    ? options.storage
    : typeof window === 'undefined' ? null : window.localStorage;
  const raw = storage?.getItem(persistence.saveKey);
  if (!raw) {
    return createScienceRuntimeSnapshot(
      createDefaultScienceState(),
      { metal: 0, minerals: 0, gas: 0, energy: 0 },
      0,
      now,
      mode,
      testTimeScale,
    );
  }
  try {
    JSON.parse(raw);
  } catch {
    return createScienceRuntimeSnapshot(
      createDefaultScienceState(),
      { metal: 0, minerals: 0, gas: 0, energy: 0 },
      0,
      now,
      mode,
      testTimeScale,
    );
  }
  const state = persistence.read();
  return createScienceSnapshot(state, {
    planetId: 'helion-01',
    mode,
    testTimeScale,
    now,
  });
}

export type ScienceEventBridgeOptions = {
  target: EventTarget;
  getState: () => SaveState;
  getContext: (now: number) => ScienceApplicationContext;
  commit: (state: SaveState) => void;
  onNotice: (notice: string) => void;
};

export function bindScienceEventBridge(options: ScienceEventBridgeOptions): () => void {
  const onScienceStartRequest = (event: Event) => {
    const request = (event as CustomEvent<ScienceStartRequest>).detail;
    if (!request || !Number.isInteger(request.scienceId)) return;
    const now = Number.isFinite(request.now) ? request.now : Date.now();
    const result = startScience(options.getState(), {
      ...options.getContext(now),
      now,
    }, request.scienceId);
    if (!result.transition.ok) {
      options.onNotice(result.transition.reason ?? 'Исследование сейчас недоступно.');
      return;
    }
    options.commit(result.state);
    options.onNotice('Исследование добавлено в очередь.');
  };

  const onScienceCancelRequest = (event: Event) => {
    const request = (event as CustomEvent<{ taskId?: string; now?: number }>).detail;
    if (!request?.taskId) return;
    const now = typeof request.now === 'number' && Number.isFinite(request.now) ? request.now : Date.now();
    const result = cancelScience(options.getState(), {
      ...options.getContext(now),
      now,
    }, request.taskId);
    const transition = result.transition as ScienceCancellationTransition;
    options.commit(result.state);
    const cascadedCount = Math.max(0, transition.canceledTasks.length - 1);
    const unreimbursedCount = transition.ok
      ? Math.max(0, transition.canceledTasks.length - transition.refundPercents.length)
      : 0;
    options.onNotice(transition.ok
      ? `Исследование отменено.${cascadedCount > 0 ? ` Каскадно отменено ещё ${cascadedCount} зависимых исследований.` : ''} ${cascadedCount > 0
        ? `Для ${transition.refundPercents.length} отменённых заданий рассчитан отдельный возврат 60–80%.${unreimbursedCount > 0 ? ` ${unreimbursedCount} старых заданий без подтверждённой стоимости возвращены без компенсации.` : ''}`
        : `Возвращено ${transition.refundPercent}% сохранённой стоимости.`}`
      : transition.reason ?? 'Исследование недоступно для отмены.');
  };

  options.target.addEventListener(SCIENCE_START_REQUEST_EVENT, onScienceStartRequest);
  options.target.addEventListener(SCIENCE_CANCEL_REQUEST_EVENT, onScienceCancelRequest);
  return () => {
    options.target.removeEventListener(SCIENCE_START_REQUEST_EVENT, onScienceStartRequest);
    options.target.removeEventListener(SCIENCE_CANCEL_REQUEST_EVENT, onScienceCancelRequest);
  };
}

export const SCIENCE_RUNTIME_EVENT = SCIENCE_RUNTIME_CHANGED_EVENT;
