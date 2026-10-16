import type { SaveState } from './contracts.ts';
import type { RuntimeMode } from '../domain/runtime/mode.ts';
import {
  acceptExplorationOperation, cancelExplorationOperation, createExplorationState,
  getOrMaterializeExplorationContact, resolveExplorationRecon,
} from '../domain/exploration/ledger.ts';
import { explorationResourceScore } from './exploration-flight.ts';
import { getExplorationTarget } from './exploration.ts';
import type { FlightRecord } from '../domain/flights/types.ts';

/** Accepting an operation persists its precise cycle; it never creates a demo operation. */
export function acceptLiveExploration(state: SaveState, id: string, nowMs: number, mode: RuntimeMode): SaveState | null {
  const node = getExplorationTarget(state, id, nowMs, mode);
  if (!node) return null;
  const ledger = state.exploration ?? createExplorationState();
  const materialized = getOrMaterializeExplorationContact(ledger, node, explorationResourceScore(state));
  return { ...state, exploration: acceptExplorationOperation(materialized.state, id) };
}
export function cancelLiveExploration(state: SaveState, id: string): SaveState {
  if (!state.exploration?.acceptedContactIds?.includes(id)) return state;
  return { ...state, exploration: cancelExplorationOperation(state.exploration, id) };
}

/** Recon reports come only from completed one-probe flights, never from a UI click. */
export function resolveExplorationProbeArrival(state: SaveState, flight: FlightRecord, arrivedAt: number, mode: RuntimeMode): {
  state: SaveState; notice: string;
} {
  const id = flight.operationId;
  const ledger = state.exploration ?? createExplorationState();
  if (!id || !ledger.contacts[id] || !getExplorationTarget(state, id, arrivedAt, mode)) {
    return { state, notice: 'Зонд прибыл после исчезновения объекта. Данные не получены.' };
  }
  if (ledger.reconReports?.some(r => r.flightId === flight.id)) {
    return { state, notice: 'Результат исследования этого полёта уже сохранён.' };
  }
  const report = resolveExplorationRecon(ledger.contacts[id]!, state.profile.playerId, flight.id,
    arrivedAt, ledger.reconReports ?? []);
  return {
    state: { ...state, exploration: {
      ...ledger, reconReports: [...(ledger.reconReports ?? []), report].slice(-256),
    } },
    notice: report.success
      ? 'Зонд завершил исследование: сведения о ресурсах и риске доступны в «Операциях».'
      : 'Зонд исследовал объект, но не получил достоверных данных. Повторная попытка возможна через 120 секунд.',
  };
}
