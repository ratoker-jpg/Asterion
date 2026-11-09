import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getFactionShipCatalog } from '../../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../../domain/combat/factions.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import { emptyTransportCargo, getCargoFieldMaximum, type TransportCargo, type TransportCargoKey } from '../../domain/flights/cargo.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale } from '../../domain/runtime/mode.ts';
import { isFlightLimitExempt } from '../../domain/flights/limit.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import { getPlanetResources, type PlanetResources, type SaveState } from '../../application/contracts.ts';
import { getAvailableFleetForPlanet, getPlayerFlightSlotUsage, type DispatchFlightCommand, type FlightLaunchContext } from '../../application/flights.ts';
import {
  QUICK_ACTION_LABELS,
  buildQuickCommand,
  defaultQuickFleet,
  defaultWaveOrder,
  isCombatQuickFleet,
  planWaveSpeeds,
  isMultiSourceAction,
  noShipsMessage,
  planFromOrigin,
  planQuickLegs,
  quickActionShipIds,
  quickLaunchContext,
  type QuickActionId,
  type QuickFleet,
  type QuickLegOutcome,
  type QuickTarget,
} from '../../application/quick-actions.ts';
import { AmountSlider } from '../AmountSlider.tsx';
import { FlightSpeedControl } from '../flight-speed/FlightSpeedControl.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { QUICK_ACTION_ICONS } from './quick-action-icons.ts';
import './quick-send.css';

const number = new Intl.NumberFormat('ru-RU');
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const HOSTILE = new Set<QuickActionId>(['attack', 'exploration-attack', 'pirate-elimination']);
const CARGO_KEYS = ['metal', 'minerals', 'gas'] as const;
const CARGO_LABELS = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ' } as const;
const TRANSPORT_KEYS = ['metal', 'minerals', 'gas', 'debris'] as const satisfies readonly TransportCargoKey[];
const TRANSPORT_LABELS = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ', debris: 'Обломки' } as const;
const NOTHING_KEPT: PlanetResources = { metal: 0, minerals: 0, gas: 0 };

export function flightDurationLabel(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
  return minutes ? `${minutes} мин ${String(rest).padStart(2, '0')} с` : `${rest} с`;
}

export function quickRuntimeNow() {
  return { now: Date.now(), mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() };
}

/**
 * Quick-send panel: one target, one mission, one or several source planets.
 *
 * Reusable outside the map menu (deployment planner, saved targets, repeat
 * mission). It owns only the draft: which planets are checked, each leg's
 * ships and cargo. Every figure on it (flight time, arrival, gas, refusal
 * reason) is a `previewFlight` of the command Send will dispatch, so it adds
 * no rule of its own.
 *
 * - `state`: the live save state (re-render with a fresh one; the draft stays).
 * - `actionId` + `target`: what to do and where (see `listQuickActions`).
 * - `onSend(commands)`: dispatch every checked leg, in order, and return one
 *   outcome per leg (App wraps `sendQuickLegs(…, dispatchFlight)`). All legs
 *   accepted → `onClose`; otherwise the sent legs drop out and the refusals
 *   stay on screen.
 * - `onDetails(context, originPlanetId)`: «Подробно», the full fleet screen
 *   prefilled with this launch from the first checked planet. Omitted or
 *   no fleet-screen form for the action → no link.
 * - `initialOrigins`: planets checked at open; default is the nearest planet
 *   whose suggested fleet the runtime accepts.
 * - `onBack`: shows a «‹» back button (e.g. to the action list).
 * - `gatherLoads(originPlanetIds, keep)`: transport only. Shows «Оставить на
 *   планете» and fills every checked leg with its ships and cargo from this
 *   planner (the «Империя» console passes `planGatherLoads`). The legs are
 *   refilled when a planet is checked or the kept amount changes; slider
 *   changes in between stay.
 * - `notice`: one line above the planets (e.g. «склады цели полны»).
 * - `bare`: no own header; the host already shows the title and the close button.
 * - `emptyAdvice`: replaces the «no free ships» line and hides the route and
 *   Send when no planet can launch (say what to do instead).
 *
 * Probe and colonizer actions are single-source (checking one planet
 * unchecks the others); the rest gather fleets from several planets. Every
 * leg has its own flight speed (100% by default). With two or more legs the
 * checked planets are waves: warships first by default, the player may move
 * a wave earlier or later, and each next wave is slowed just enough to land
 * at least one second after the previous one (`planWaveSpeeds`). All legs
 * leave now.
 */
export type QuickSendPanelProps = {
  state: SaveState;
  actionId: QuickActionId;
  target: QuickTarget;
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
  onClose: () => void;
  onDetails?: (context: FlightLaunchContext, originPlanetId: string | null) => void;
  onBack?: () => void;
  initialOrigins?: readonly string[];
  notice?: string | null;
  bare?: boolean;
  emptyAdvice?: () => ReactNode;
  gatherLoads?: (originPlanetIds: readonly string[], keep: PlanetResources) => Record<string, { ships: QuickFleet['ships']; cargo: TransportCargo }>;
};

type LegDraft = { checked: boolean; fleet: QuickFleet; cargo: TransportCargo; sent?: boolean; allShips?: boolean; speedPercent: number };

export function QuickSendPanel({ state, actionId, target, onSend, onClose, onDetails, onBack, initialOrigins, gatherLoads, notice, bare, emptyAdvice }: QuickSendPanelProps) {
  const factionId = state.profile.factionId as CombatFactionId;
  const catalog = useMemo(() => new Map(getFactionShipCatalog(factionId).map((ship) => [ship.id as ShipId, ship])), [factionId]);
  const multi = isMultiSourceAction(actionId);
  // Transport and «Дислокация» both carry resources in the hold.
  const carriesCargo = actionId === 'transport' || actionId === 'deployment';
  const planner = actionId === 'transport' ? gatherLoads : undefined;
  // Refills every checked leg from the planner; unchecked legs keep their draft.
  function fill(current: Record<string, LegDraft>, kept: PlanetResources): Record<string, LegDraft> {
    if (!planner) return current;
    const loads = planner(Object.keys(current).filter((id) => current[id]!.checked && !current[id]!.sent), kept);
    return Object.fromEntries(Object.entries(current).map(([id, draft]) => [id, loads[id] ? { ...draft, fleet: { ships: loads[id]!.ships }, cargo: loads[id]!.cargo } : draft]));
  }
  // Planets are listed once per opening; ships and verdicts follow the live state.
  const [origins] = useState(() => planQuickLegs(state, actionId, target, quickRuntimeNow()).map((leg) => leg.originPlanetId));
  const [drafts, setDrafts] = useState<Record<string, LegDraft>>(() => {
    const legs = planQuickLegs(state, actionId, target, quickRuntimeNow());
    const preferred = initialOrigins?.length ? new Set(initialOrigins) : new Set([(legs.find((leg) => leg.preview?.ok) ?? legs[0])?.originPlanetId]);
    const drafts = Object.fromEntries(legs.map((leg) => [leg.originPlanetId, { checked: preferred.has(leg.originPlanetId), fleet: leg.fleet, cargo: emptyTransportCargo(), speedPercent: 100 }]));
    return planner ? fill(drafts, NOTHING_KEPT) : drafts;
  });
  // Wave order of the checked legs (planet ids, first wave first); warships lead by default.
  const [waveOrder, setWaveOrder] = useState<string[]>(() => defaultWaveOrder(state, planQuickLegs(state, actionId, target, quickRuntimeNow())
    .map((leg) => ({ originPlanetId: leg.originPlanetId, ships: leg.fleet.ships, arrivalAt: leg.preview?.ok ? leg.preview.flight.arrivalAt : undefined }))));
  const [keep, setKeep] = useState<PlanetResources>(NOTHING_KEPT);
  const [sending, setSending] = useState(false);
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const sendRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { sendRef.current?.focus({ preventScroll: true }); }, []);

  const legs = origins.filter((planetId) => drafts[planetId] && !drafts[planetId]!.sent).map((planetId) => {
    const draft = drafts[planetId]!;
    const plan = planFromOrigin(state, actionId, target, planetId, quickRuntimeNow(), draft.fleet, carriesCargo ? draft.cargo : undefined, draft.speedPercent);
    return { planetId, draft, plan, flight: plan.preview?.ok ? plan.preview.flight : null };
  });
  const rank = (planetId: string) => { const at = waveOrder.indexOf(planetId); return at < 0 ? Number.MAX_SAFE_INTEGER : at; };
  const checked = legs.filter((leg) => leg.draft.checked).sort((a, b) => rank(a.planetId) - rank(b.planetId));
  // Two or more legs fly as waves: the game slows the later ones so each lands a second after the one before.
  // Legs the runtime refuses take no wave (they block Send with their own reason).
  const flying = checked.filter((leg) => leg.flight && leg.plan.command);
  const waves = multi && flying.length > 1
    ? planWaveSpeeds(state, flying.map((leg) => leg.plan.command!), quickRuntimeNow())
    : null;
  const waveOf = (planetId: string) => waves?.legs.find((leg) => leg.originPlanetId === planetId);
  // Each leg takes one flight slot (the «Компьютерные системы» limit).
  const slots = getPlayerFlightSlotUsage(state);
  const missionId = checked[0]?.plan.command?.missionId;
  const overLimit = checked.length > 1 && missionId !== undefined && !isFlightLimitExempt(missionId) && checked.length > slots.free;
  const waveError = waves && !waves.ok ? waves.message : null;
  const ready = checked.length > 0 && checked.every((leg) => leg.flight) && !overLimit && !waveError;
  const arrivals = checked.flatMap((leg) => (leg.flight ? [waveOf(leg.planetId)?.arrivalAt ?? leg.flight.arrivalAt] : []));
  const spread = arrivals.length > 1 ? Math.max(...arrivals) - Math.min(...arrivals) : 0;
  const gas = checked.reduce((total, leg) => total + (leg.flight?.gasCost ?? 0), 0);
  const context = onDetails ? quickLaunchContext(actionId, target) : null;

  const update = (planetId: string, change: (draft: LegDraft) => LegDraft) => {
    setSendErrors((current) => { const next = { ...current }; delete next[planetId]; return next; });
    setDrafts((current) => ({ ...current, [planetId]: change(current[planetId]!) }));
  };
  const toggle = (planetId: string) => {
    const draft = drafts[planetId];
    if (multi && draft && !draft.checked) {
      // A newly checked planet joins as the last warship wave, or as the last wave if it carries no warships.
      const combat = isCombatQuickFleet(state, draft.fleet.ships);
      setWaveOrder((order) => {
        const rest = order.filter((id) => id !== planetId);
        const on = rest.filter((id) => drafts[id]?.checked && !drafts[id]?.sent);
        const anchor = combat ? on.filter((id) => isCombatQuickFleet(state, drafts[id]!.fleet.ships)).at(-1) : on.at(-1);
        const at = anchor === undefined ? (combat ? 0 : rest.length) : rest.indexOf(anchor) + 1;
        return [...rest.slice(0, at), planetId, ...rest.slice(at)];
      });
    }
    setDrafts((current) => fill(Object.fromEntries(Object.entries(current).map(([id, item]) => [id,
      id === planetId ? { ...item, checked: multi ? !item.checked : true } : multi ? item : { ...item, checked: false }])), keep));
  };
  // Moves a checked leg one wave earlier (-1) or later (+1) among the checked legs.
  const moveWave = (planetId: string, step: -1 | 1) => setWaveOrder((order) => {
    const ids = (waves?.legs ?? []).map((leg) => leg.originPlanetId);
    const from = ids.indexOf(planetId);
    const to = from + step;
    if (from < 0 || to < 0 || to >= ids.length) return order;
    const swapped = [...ids];
    [swapped[from], swapped[to]] = [swapped[to]!, swapped[from]!];
    return [...swapped, ...order.filter((id) => !ids.includes(id))];
  });
  const changeKeep = (key: keyof PlanetResources, value: number) => {
    const next = { ...keep, [key]: Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)) };
    setKeep(next);
    setDrafts((current) => fill(current, next));
  };
  const reset = (planetId: string) => update(planetId, (draft) => ({ ...draft, fleet: defaultQuickFleet(state, actionId, planetId, target) }));

  const send = () => {
    if (!ready || sending) return;
    const runtime = quickRuntimeNow();
    const built = checked.flatMap((leg) => {
      const command = buildQuickCommand(state, actionId, target, leg.planetId, leg.draft.fleet, runtime, carriesCargo ? leg.draft.cargo : undefined);
      return command ? [{ ...command, ...(leg.draft.speedPercent < 100 ? { speedPercent: leg.draft.speedPercent } : {}) }] : [];
    });
    // Waves are planned again on the send moment, so the gaps hold exactly.
    const planned = multi && built.length > 1 ? planWaveSpeeds(state, built, runtime) : null;
    if (planned && !planned.ok) return;
    const commands = planned ? planned.legs.map((leg) => leg.command) : built;
    setSending(true);
    const outcomes = onSend(commands);
    setSending(false);
    if (outcomes.every((outcome) => outcome.result.ok)) { onClose(); return; }
    setDrafts((current) => {
      const next = { ...current };
      for (const outcome of outcomes) if (outcome.result.ok && next[outcome.originPlanetId]) next[outcome.originPlanetId] = { ...next[outcome.originPlanetId]!, sent: true };
      return next;
    });
    setSendErrors(Object.fromEntries(outcomes.flatMap((outcome) => (outcome.result.ok ? [] : [[outcome.originPlanetId, outcome.result.error.message]]))));
  };

  return (
    <section className={`quick-send ${HOSTILE.has(actionId) ? 'quick-send--hostile' : ''}`} aria-label={`${QUICK_ACTION_LABELS[actionId]}: ${target.node.name}`} data-qa-quick-send={actionId}>
      {bare ? null : <header className="quick-send__head">
        {onBack ? <button type="button" className="quick-send__back" onClick={onBack} aria-label="Назад к списку действий">‹</button> : <span />}
        <img src={QUICK_ACTION_ICONS[actionId]} alt="" draggable={false} />
        <div><b>{QUICK_ACTION_LABELS[actionId]}</b><span>{target.node.name} · {formatUniverseCoordinate(target.sun ? { ...target.sun, position: 0 } : target.node.coordinate)}</span></div>
        <button type="button" className="quick-send__close" onClick={onClose} aria-label="Закрыть">✕</button>
      </header>}

      {notice ? <p className="quick-send__notice" role="status" data-qa-quick-notice>{notice}</p> : null}
      {actionId === 'recycle' && !target.sun ? (
        <p className="quick-send__notice" role="status" data-qa-quick-recycle-note>
          {(target.orbitalDebris ?? 0) > 0
            ? 'Соберём то, что будет на орбите к моменту прибытия.'
            : 'Обломков здесь сейчас нет. Если к прибытию их не будет, флот вернётся пустым.'}
        </p>
      ) : null}

      {planner && legs.length > 0 ? (
        <div className="quick-send__keep" data-qa-quick-keep>
          <small>Оставить на каждой планете</small>
          {CARGO_KEYS.map((key) => (
            <label key={key}>
              <ResourceIcon kind={key} />
              <input type="number" min={0} step={1000} inputMode="numeric" value={keep[key]} aria-label={`${CARGO_LABELS[key]}: оставить на планете`}
                onChange={(event) => changeKeep(key, event.currentTarget.valueAsNumber)} data-qa-quick-keep-input={key} />
            </label>
          ))}
        </div>
      ) : null}

      {legs.length === 0 ? (emptyAdvice ? emptyAdvice() : <p className="quick-send__error" role="alert" data-qa-quick-error>{noShipsMessage(state, actionId, target)}</p>) : (
        <div className="quick-send__legs" role={multi ? 'group' : 'radiogroup'} aria-label={multi ? 'Планеты отправки' : 'Планета отправки'}>
          <small>{multi ? 'Откуда · можно несколько планет' : 'Откуда'}</small>
          {legs.map(({ planetId, draft, plan, flight }, index) => {
            const wave = waveOf(planetId);
            const waveIndex = waves ? waves.legs.findIndex((leg) => leg.originPlanetId === planetId) : -1;
            const waveCount = waves?.legs.length ?? 0;
            const shownDuration = wave?.oneWayDurationMs ?? flight?.oneWayDurationMs;
            const shownArrival = wave?.arrivalAt ?? flight?.arrivalAt;
            const free = getAvailableFleetForPlanet(state, planetId).ships;
            const eligible = quickActionShipIds(state, actionId).filter((id) => (free[id] ?? 0) > 0);
            // The suggested hulls first; the rest of the hangar only on request.
            const suggested = defaultQuickFleet(state, actionId, planetId, target).ships;
            const shipIds = draft.allShips || Object.keys(suggested).length === 0 ? eligible : eligible.filter((id) => (suggested[id] ?? 0) > 0 || (draft.fleet.ships[id] ?? 0) > 0);
            const hidden = eligible.length - shipIds.length;
            const fixed = !multi;
            const error = sendErrors[planetId] ?? (draft.checked && !flight ? plan.error : undefined);
            const capacity = Object.entries(draft.fleet.ships).reduce((total, [id, n]) => total + (catalog.get(id as ShipId)?.ship?.cargo ?? 0) * (n ?? 0), 0);
            const resources = getPlanetResources(state, planetId);
            const sourceDebris = state.planets[planetId]?.recycling.availableDebris ?? 0;
            return (
              <div key={planetId} className={`quick-send__leg ${draft.checked ? 'is-on' : ''}`} style={{ '--qa-i': index } as CSSProperties} data-qa-quick-leg={planetId} data-qa-quick-leg-checked={draft.checked ? 'true' : 'false'}>
                <button type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={draft.checked} className="quick-send__leg-toggle" onClick={() => toggle(planetId)} data-qa-quick-origin={planetId}>
                  <i aria-hidden="true" />
                  <b>{waves && waveIndex >= 0 ? <span className="quick-send__wave-no" key={waveIndex} data-qa-quick-wave-no={waveIndex + 1}>{waveIndex + 1}</span> : null}{state.planets[planetId]?.name ?? planetId}</b>
                  <span>{flight && shownDuration !== undefined && shownArrival !== undefined ? <>{flightDurationLabel(shownDuration)} · <em>{clock.format(shownArrival)}</em></> : 'не может отправить'}</span>
                </button>
                {!flight && !draft.checked ? <p className="quick-send__why" data-qa-quick-why>{plan.error ?? 'Сейчас отсюда отправить нельзя.'}</p> : null}
                {draft.checked ? (
                  <div className="quick-send__leg-body">
                    <ul className="quick-send__ships">
                      {shipIds.map((shipId) => {
                        const ship = catalog.get(shipId);
                        const count = draft.fleet.ships[shipId] ?? 0;
                        return (
                          <li key={shipId} data-qa-quick-ship={shipId} data-qa-quick-ship-count={count}>
                            {ship?.art ? <img src={ship.art} alt="" draggable={false} /> : <i />}
                            <span><b>{ship?.name ?? shipId}</b><em>{number.format(count)} из {number.format(free[shipId] ?? 0)}</em></span>
                            {fixed ? null : <AmountSlider compact value={count} max={free[shipId] ?? 0} label={`${ship?.name ?? shipId}, ${state.planets[planetId]?.name ?? ''}`}
                              onChange={(value) => update(planetId, (current) => ({ ...current, fleet: { ...current.fleet, ships: Object.fromEntries(Object.entries({ ...current.fleet.ships, [shipId]: value }).filter(([, n]) => (n ?? 0) > 0)) } }))} />}
                          </li>
                        );
                      })}
                      {carriesCargo ? TRANSPORT_KEYS.map((key) => {
                        // The fleet screen's own limit: stock of the source, then the shared hold.
                        const max = getCargoFieldMaximum(key, draft.cargo, resources, sourceDebris, capacity);
                        return (
                          <li key={key} className="quick-send__cargo" data-qa-quick-cargo={key}>
                            <ResourceIcon kind={key} />
                            <span><b>{TRANSPORT_LABELS[key]}</b><em>{number.format(draft.cargo[key])}</em></span>
                            <AmountSlider compact value={draft.cargo[key]} max={max} label={`${TRANSPORT_LABELS[key]}, ${state.planets[planetId]?.name ?? ''}`}
                              onChange={(value) => update(planetId, (current) => ({ ...current, cargo: { ...current.cargo, [key]: value } }))} />
                          </li>
                        );
                      }) : null}
                    </ul>
                    {waves && waveIndex >= 0 ? (
                      <div className="quick-send__wave" data-qa-quick-wave={waveIndex + 1}>
                        <small>Волна {waveIndex + 1} из {waveCount}</small>
                        <button type="button" className="quick-send__reset" onClick={() => moveWave(planetId, -1)} disabled={waveIndex === 0} data-qa-quick-wave-earlier>‹ Раньше</button>
                        <button type="button" className="quick-send__reset" onClick={() => moveWave(planetId, 1)} disabled={waveIndex === waveCount - 1} data-qa-quick-wave-later>Позже ›</button>
                      </div>
                    ) : null}
                    {flight ? (
                      <FlightSpeedControl value={draft.speedPercent} flown={wave?.speedPercent} qa={planetId}
                        duration={shownDuration !== undefined ? flightDurationLabel(shownDuration) : null}
                        onChange={(value) => update(planetId, (current) => ({ ...current, speedPercent: value }))} />
                    ) : null}
                    {fixed ? null : (
                      <div className="quick-send__leg-tools">
                        {hidden > 0 ? <button type="button" className="quick-send__reset" onClick={() => update(planetId, (current) => ({ ...current, allShips: true }))}>Другие корабли · {hidden}</button> : null}
                        <button type="button" className="quick-send__reset" onClick={() => reset(planetId)}>Сбросить состав</button>
                      </div>
                    )}
                    {error ? <p className="quick-send__error" role="alert" data-qa-quick-error>{error}</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {waveError ? <p className="quick-send__error quick-send__limit" role="alert" data-qa-quick-wave-error>{waveError}</p> : null}
      {overLimit ? <p className="quick-send__error quick-send__limit" role="alert" data-qa-quick-error>Свободных полётов: {slots.free} из {slots.limit}. Снимите лишние планеты.</p> : null}
      {legs.length === 0 && emptyAdvice ? null : <>
      <dl className="quick-send__route" data-qa-quick-route={ready ? 'ok' : 'off'}>
        <div><dt>{checked.length > 1 ? 'Прибытие' : 'В пути'}</dt><dd>{arrivals.length === 0 ? '—' : checked.length > 1 ? (spread > 0 ? `${clock.format(Math.min(...arrivals))}–${clock.format(Math.max(...arrivals))}` : clock.format(arrivals[0]!)) : checked[0]?.flight ? flightDurationLabel(checked[0].flight.oneWayDurationMs) : '—'}</dd></div>
        <div><dt>{checked.length > 1 ? 'Волны' : 'Прибытие'}</dt><dd>{arrivals.length === 0 ? '—' : checked.length > 1 ? (waves ? `${waves.legs.length} · за ${flightDurationLabel(spread)}` : spread > 0 ? flightDurationLabel(spread) : 'одновременно') : clock.format(arrivals[0]!)}</dd></div>
        <div><dt>Газ</dt><dd>{arrivals.length ? number.format(gas) : '—'}</dd></div>
      </dl>

      <footer className="quick-send__foot">
        {context ? <button type="button" className="quick-send__details" onClick={() => { onClose(); onDetails?.(context, checked[0]?.planetId ?? null); }} data-qa-quick-details>Подробно</button> : <span />}
        <button ref={sendRef} type="button" className="quick-send__go" disabled={!ready || sending} onClick={send} data-qa-quick-go>
          {checked.length > 1 ? `Отправить · ${checked.length}` : 'Отправить'}
        </button>
      </footer>
      </>}
    </section>
  );
}
