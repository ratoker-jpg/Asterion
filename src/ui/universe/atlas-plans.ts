/**
 * Flight times for the «Звёздный атлас» planet list.
 *
 * Each cell is the same plan the right-click menu makes (`planQuickSend`):
 * nearest planet with suitable ships, the runtime's own verdict. Nothing here
 * adds a rule; it only spreads the work over a few frames so the window opens
 * at once and the times arrive row by row.
 */
import { useEffect, useState } from 'react';
import { getLiveSaveState } from '../../application/runtime.ts';
import { planQuickSend, type QuickActionId, type QuickTarget } from '../../application/quick-actions.ts';
import { quickRuntimeNow } from '../quick-send/QuickSendPanel.tsx';

export type AtlasCell =
  | { kind: 'pending' }
  | { kind: 'ready'; durationMs: number }
  /** The runtime refused the default launch (no ships, gas…): the reason in its words. */
  | { kind: 'refused'; reason: string };

export type AtlasRowRequest = { rowId: string; target: QuickTarget; actions: readonly QuickActionId[] };

export type AtlasPlans = Readonly<Record<string, Partial<Record<QuickActionId, AtlasCell>>>>;

/** «00:03:00»: the clock format of flight times everywhere in the atlas and the right-click menu. */
export function flightClock(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((value) => String(value).padStart(2, '0')).join(':');
}

export function useAtlasPlans(requests: readonly AtlasRowRequest[], key: string): AtlasPlans {
  const [plans, setPlans] = useState<AtlasPlans>({});
  useEffect(() => {
    setPlans({});
    const state = getLiveSaveState();
    if (!state) return undefined;
    let cancelled = false;
    let index = 0;
    let timer = 0;
    const runtime = quickRuntimeNow();
    const step = () => {
      if (cancelled) return;
      const request = requests[index];
      if (!request) return;
      index += 1;
      const row: Partial<Record<QuickActionId, AtlasCell>> = {};
      for (const actionId of request.actions) {
        try {
          const plan = planQuickSend(state, actionId, request.target, runtime);
          row[actionId] = plan.preview?.ok
            ? { kind: 'ready', durationMs: plan.preview.flight.oneWayDurationMs }
            : { kind: 'refused', reason: plan.error ?? 'Сейчас отправить нельзя.' };
        } catch {
          row[actionId] = { kind: 'refused', reason: 'Сейчас отправить нельзя.' };
        }
      }
      setPlans((current) => ({ ...current, [request.rowId]: row }));
      timer = window.setTimeout(step, 16);
    };
    // One frame for the window's entrance, then a row per frame.
    timer = window.setTimeout(step, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `key` names the request set; the array itself is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return plans;
}
