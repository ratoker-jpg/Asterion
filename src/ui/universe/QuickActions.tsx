import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { RUNTIME_STATE_CHANGED_EVENT } from '../../domain/runtime/mode.ts';
import { formatUniverseCoordinate, getUniverseObjectKindLabel } from '../../domain/universe/runtime.ts';
import { flightClock } from './atlas-plans.ts';
import type { SaveState } from '../../application/contracts.ts';
import { getLiveSaveState } from '../../application/runtime.ts';
import { FLIGHT_COMMAND_RESULT_EVENT, type DispatchFlightCommand, type FlightCommandResult, type FlightLaunchContext } from '../../application/flights.ts';
import { evaluateQuickActions, type QuickActionId, type QuickActionView, type QuickLegOutcome, type QuickTarget } from '../../application/quick-actions.ts';
import { QuickSendPanel, quickRuntimeNow } from '../quick-send/QuickSendPanel.tsx';
import { QUICK_ACTION_ICONS as ACTION_ICONS } from '../quick-send/quick-action-icons.ts';
import './quick-actions.css';

const HOSTILE = new Set<QuickActionId>(['attack', 'exploration-attack', 'pirate-elimination']);

/** The authoritative game state as the fleet screen reads it. */
function useLiveSaveState(): SaveState | null {
  const [state, setState] = useState<SaveState | null>(() => getLiveSaveState());
  useEffect(() => {
    const onState = (event: Event) => {
      const next = (event as CustomEvent<SaveState>).detail;
      if (next?.planets) setState(next);
    };
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<FlightCommandResult>).detail;
      if (result?.ok) setState(result.state);
    };
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, onState);
    window.addEventListener(FLIGHT_COMMAND_RESULT_EVENT, onResult);
    return () => {
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, onState);
      window.removeEventListener(FLIGHT_COMMAND_RESULT_EVENT, onResult);
    };
  }, []);
  return state;
}

export type QuickActionsProps = {
  target: QuickTarget;
  /** The map object the menu belongs to; the menu follows it and returns focus to it. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Sends every leg through the same dispatch command as the fleet screen. */
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
  /** «Подробно»: the full fleet screen with this launch prefilled. */
  onDetails: (context: FlightLaunchContext, originPlanetId: string | null) => void;
  /** Opens the object's «Звёздный атлас» card (the left-click dialog). */
  onOpenCard: () => void;
  onPirateReport?: (reportId: string) => void;
  /** Opens directly on this action's send panel, with no way back to the menu («Найти обломки»). */
  initialAction?: QuickActionId;
};

type Placement = { left: number; top: number; side: 'right' | 'left' };

function place(anchor: DOMRect, width: number, height: number, centred = false): Placement {
  const gap = centred ? 28 : 14;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const right = anchor.right + gap;
  const side = right + width <= viewportWidth - 8 || anchor.left - gap - width < 8 ? 'right' : 'left';
  const left = side === 'right' ? Math.min(right, viewportWidth - width - 8) : anchor.left - gap - width;
  const wanted = centred ? anchor.top + anchor.height / 2 - height / 2 : anchor.top + anchor.height / 2 - Math.min(height, 120) / 2 - 22;
  // The column keeps clear of the map's filter bar at the bottom.
  const bottomGap = centred ? 92 : 8;
  const top = Math.min(Math.max(8, wanted), viewportHeight - height - bottomGap);
  return { left: Math.max(8, left), top: Math.max(8, top), side };
}

export function QuickActions({ target, anchor, onClose, onSend, onDetails, onOpenCard, onPirateReport, initialAction }: QuickActionsProps) {
  const state = useLiveSaveState();
  const rootRef = useRef<HTMLDivElement>(null);
  const [actionId, setActionId] = useState<QuickActionId | null>(initialAction ?? null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const actions = useMemo(() => (state ? evaluateQuickActions(state, target, quickRuntimeNow()) : []), [state, target]);

  // Follow the object (asteroids move) and keep the popover inside the window.
  const reposition = () => {
    const rect = anchor.getBoundingClientRect();
    const root = rootRef.current;
    if (!root) return;
    // The panel grows downwards as planets are checked: reserve its full height (see .quick-pop.is-panel).
    const next = place(rect, root.offsetWidth, actionId ? Math.min(640, window.innerHeight - 16) : root.offsetHeight, !actionId);
    setPlacement((current) => (current && current.left === next.left && current.top === next.top && current.side === next.side ? current : next));
  };
  useLayoutEffect(reposition);
  // The quick-send panel grows as planets are checked: keep it inside the window.
  const repositionRef = useRef(reposition);
  repositionRef.current = reposition;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => repositionRef.current());
    observer.observe(root);
    return () => observer.disconnect();
  }, [actionId]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  // Focus enters the menu and goes back to the object when it closes.
  useEffect(() => () => { if (anchor.isConnected) anchor.focus({ preventScroll: true }); }, [anchor]);

  const choose = (action: QuickActionView) => {
    if (!action.enabled) return;
    if (action.id === 'pirate-report') {
      if (target.pirate?.latestReportId) onPirateReport?.(target.pirate.latestReportId);
      onClose();
      return;
    }
    setActionId(action.id);
  };

  const style = (placement
    ? { left: placement.left, top: placement.top }
    : { left: -9999, top: 0 }) as CSSProperties;
  // The menu wears the object's tone; the send panel the action's (red only for an attack).
  const kindTone = { '--qa-k': actionId ? (HOSTILE.has(actionId) ? '#f0445e' : '#56d9f2') : target.node.kind === 'pirate' || target.relation === 'enemy' || target.relation === 'neutral' ? '#f0445e' : target.node.kind === 'unique' || target.node.kind === 'asteroid' ? '#e6ad50' : target.node.kind === 'anomaly' ? '#a98bff' : '#56d9f2' } as CSSProperties;

  return createPortal(
    <div ref={rootRef} className={`quick-pop quick-pop--${placement?.side ?? 'right'} ${actionId ? 'is-panel' : 'is-menu'} ${initialAction ? 'is-over-dialog' : ''}`} style={{ ...style, ...kindTone }}
      data-qa-quick-menu={actionId ? 'panel' : 'menu'} data-qa-quick-target={target.node.id}>
      {actionId && state
        ? <QuickSendPanel key={actionId} state={state} actionId={actionId} target={target} onBack={initialAction ? undefined : () => setActionId(null)} onClose={onClose} onSend={onSend} onDetails={onDetails}
            initialOrigins={actions.find((action) => action.id === actionId)?.plan?.originPlanetId ? [actions.find((action) => action.id === actionId)!.plan!.originPlanetId!] : undefined} />
        : <QuickMenu target={target} actions={actions} onChoose={choose} onOpenCard={() => { onClose(); onOpenCard(); }} />}
    </div>,
    document.body,
  );
}

const RELATION_WORD: Record<string, string> = { self: 'ваша планета', ally: 'союзник', enemy: 'враг', neutral: 'нейтральный' };

function targetCaption(target: QuickTarget): string {
  if (target.owner) return `${target.owner.displayName} · ${RELATION_WORD[target.relation ?? 'neutral'] ?? ''}`;
  return getUniverseObjectKindLabel(target.node.kind);
}

function QuickMenu({ target, actions, onChoose, onOpenCard }: { target: QuickTarget; actions: QuickActionView[]; onChoose: (action: QuickActionView) => void; onOpenCard: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    const first = Array.from(items ?? []).find((item) => item.getAttribute('aria-disabled') !== 'true') ?? items?.[0];
    first?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div ref={listRef} role="menu" aria-label={`Быстрые действия: ${target.node.name}`} onKeyDown={onKeyDown}>
      <header className="quick-pop__head">
        <b><span>{target.node.name}</span> <em>{formatUniverseCoordinate(target.node.coordinate)}</em></b>
        <small>{targetCaption(target)}</small>
      </header>
      {actions.length === 0 ? <p className="quick-pop__empty">Для этого объекта нет быстрых действий.</p> : null}
      {actions.map((action, index) => {
        const flight = action.plan?.preview?.ok ? action.plan.preview.flight : null;
        return (
          <button key={action.id} type="button" role="menuitem" aria-disabled={!action.enabled}
            className={`quick-pop__item ${action.enabled ? '' : 'is-off'} ${HOSTILE.has(action.id) ? 'is-hostile' : ''}`}
            style={{ '--qa-i': index } as CSSProperties}
            data-qa-quick-action={action.id} data-qa-quick-enabled={action.enabled ? 'true' : 'false'}
            onClick={() => onChoose(action)}>
            <img src={ACTION_ICONS[action.id]} alt="" draggable={false} />
            <span>
              <b>{action.label}</b>
              {action.enabled && action.adjust
                ? <small className="quick-pop__reason" data-qa-quick-adjust>{action.adjust} Состав можно изменить.</small>
                : action.enabled
                ? <small className="quick-pop__time">{flight ? flightClock(flight.oneWayDurationMs) : action.id === 'pirate-report' ? 'Последний отчёт по базе' : 'Готово к отправке'}</small>
                : <small className="quick-pop__reason" data-qa-quick-reason>{action.reason}</small>}
            </span>
          </button>
        );
      })}
      <button type="button" className="quick-pop__card" onClick={onOpenCard} data-qa-quick-open-card>Карточка объекта</button>
    </div>
  );
}
