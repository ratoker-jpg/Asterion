import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getFactionShipCatalog } from '../../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../../domain/combat/factions.ts';
import { AID_RESOURCE_LABELS } from '../../domain/command/aid.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { SaveState } from '../../application/contracts.ts';
import type { DispatchFlightCommand } from '../../application/flights.ts';
import type { QuickLegOutcome } from '../../application/quick-actions.ts';
import {
  aidCapacity,
  aidQuickSources,
  aidRemainder,
  aidShipIds,
  buildAidQuickCommand,
  previewAidQuick,
  suggestAidLoad,
  type AidQuickSource,
  type AidShipId,
  type AidShips,
} from '../../application/aid-quick-send.ts';
import { FlightSpeedControl } from '../flight-speed/FlightSpeedControl.tsx';
import { AmountSlider } from '../AmountSlider.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { flightDurationLabel, quickRuntimeNow } from '../quick-send/QuickSendPanel.tsx';
import aidIcon from '../../assets/ui/mission-icons/aid.webp';
import '../universe/quick-actions.css';
import '../quick-send/quick-send.css';
import './aid-quick-send.css';

const number = new Intl.NumberFormat('ru-RU');
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export type AidQuickSendProps = {
  state: SaveState;
  requestId: string;
  /** The «Помочь» button: the window opens beside it and gives focus back to it. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Same dispatcher as the map quick panel (every leg through `dispatchFlight`). */
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
  /** «Полный план полёта»: the fleet screen prefilled with this request, from the chosen planet. */
  onDetails: (originPlanetId: string | null) => void;
};

type Draft = { planetId: string | null; ships: AidShips; amount: number };

function pickSource(sources: readonly AidQuickSource[]): AidQuickSource | null {
  return sources.find((source) => source.capacity > 0 && source.stock > 0) ?? sources.find((source) => source.capacity > 0) ?? sources[0] ?? null;
}

function place(anchor: DOMRect, width: number, height: number) {
  const gap = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const leftSide = anchor.left - gap - width;
  const left = leftSide >= 8 ? leftSide : Math.min(anchor.right + gap, vw - width - 8);
  const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - 60), vh - height - 8);
  return { left: Math.max(8, left), top: Math.max(8, top), side: leftSide >= 8 ? 'left' as const : 'right' as const };
}

/**
 * Quick answer to an ally's resource request: a compact window beside the
 * «Помочь» button, in the look of the map quick-send panel. The player picks
 * the source planet, the hulls and the amount; «Под запрос» fills just enough
 * hulls. Every figure and refusal is the runtime's own `previewFlight` of the
 * command Send dispatches.
 */
export function AidQuickSend({ state, requestId, anchor, onClose, onSend, onDetails }: AidQuickSendProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const request = state.command.requests.find((item) => item.id === requestId) ?? null;
  const catalog = useMemo(() => new Map(getFactionShipCatalog(state.profile.factionId as CombatFactionId).map((ship) => [ship.id, ship])), [state.profile.factionId]);
  const sources = request ? aidQuickSources(state, request) : [];
  const [draft, setDraft] = useState<Draft>(() => {
    const source = request ? pickSource(sources) : null;
    if (!request || !source) return { planetId: source?.planetId ?? null, ships: {}, amount: 0 };
    return { planetId: source.planetId, ...suggestAidLoad(state, request, source, quickRuntimeNow()) };
  });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [speedPercent, setSpeedPercent] = useState(100);
  const [placement, setPlacement] = useState<ReturnType<typeof place> | null>(null);

  const reposition = () => {
    const root = rootRef.current;
    if (!root || !anchor.isConnected) return;
    const next = place(anchor.getBoundingClientRect(), root.offsetWidth, root.offsetHeight);
    setPlacement((current) => (current && current.left === next.left && current.top === next.top ? current : next));
  };
  useLayoutEffect(reposition);
  const repositionRef = useRef(reposition);
  repositionRef.current = reposition;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => repositionRef.current());
    observer.observe(root);
    // The request list scrolls under the window: keep it beside its button.
    const onScroll = () => repositionRef.current();
    window.addEventListener('scroll', onScroll, true);
    return () => { observer.disconnect(); window.removeEventListener('scroll', onScroll, true); };
  }, []);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  useEffect(() => { sendRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => () => { if (anchor.isConnected) anchor.focus({ preventScroll: true }); }, [anchor]);

  const style = { ...(placement ? { left: placement.left, top: placement.top } : { left: -9999, top: 0 }), '--qa-k': '#56d9f2' } as CSSProperties;
  const shell = (body: ReactNode) => createPortal(
    <div ref={rootRef} className={`quick-pop quick-pop--${placement?.side ?? 'left'} is-panel aid-quick`} style={style} role="dialog" aria-label="Помощь союзнику" data-qa-aid-quick={requestId}>
      <section className="quick-send">{body}</section>
    </div>,
    document.body,
  );

  const head = (
    <header className="quick-send__head">
      <span />
      <img src={aidIcon} alt="" draggable={false} />
      <div>
        <b>Помощь союзнику</b>
        <span>{request ? `${request.authorName} · ${request.planetName} ${formatUniverseCoordinate(request.coordinate)}` : 'Запрос закрыт'}</span>
      </div>
      <button type="button" className="quick-send__close" onClick={onClose} aria-label="Закрыть" data-qa-aid-quick-close>✕</button>
    </header>
  );

  if (!request || request.status !== 'open') {
    return shell(<>{head}<p className="quick-send__error aid-quick__pad" role="alert" data-qa-aid-quick-error>Запрос закрыт или уже выполнен.</p></>);
  }

  const runtime = quickRuntimeNow();
  const remainder = aidRemainder(state, request);
  const source = sources.find((item) => item.planetId === draft.planetId) ?? null;
  const resourceLabel = AID_RESOURCE_LABELS[request.resource];
  // Ships and amount never exceed what is free right now (a flight may have left meanwhile).
  const ships: AidShips = source
    ? Object.fromEntries(Object.entries(draft.ships).map(([id, count]) => [id, Math.min(count ?? 0, source.free[id as AidShipId] ?? 0)]).filter(([, count]) => (count as number) > 0))
    : {};
  const capacity = aidCapacity(state, ships);
  const amountMax = source ? Math.max(0, Math.min(remainder, source.stock, capacity)) : 0;
  const amount = Math.min(draft.amount, amountMax);
  const hullCount = Object.values(ships).reduce((total, count) => total + (count ?? 0), 0);
  const withSpeed = (built: DispatchFlightCommand): DispatchFlightCommand => (speedPercent < 100 ? { ...built, speedPercent } : built);
  const command = source && hullCount > 0 && amount > 0 ? withSpeed(buildAidQuickCommand(request, source.planetId, ships, amount, runtime)) : null;
  const preview = command ? previewAidQuick(state, command, runtime) : null;
  const flight = preview?.ok ? preview.flight : null;
  const need = source ? Math.min(remainder, source.stock) : remainder;

  const blocker = remainder <= 0 ? 'Весь остаток запроса уже в пути или доставлен.'
    : sources.length === 0 ? 'Нет другой вашей планеты, откуда можно отправить помощь.'
      : !source ? 'Выберите планету отправки.'
        : source.capacity <= 0 ? `На планете ${source.name} нет свободных транспортёров. Выберите другую планету или постройте транспортёры на верфи.`
          : source.stock <= 0 ? `На планете ${source.name} нет ресурса «${resourceLabel}». Выберите другую планету.`
            : hullCount === 0 ? 'Выберите, сколько транспортёров отправить.'
              : amount <= 0 ? 'Укажите, сколько ресурса отправить.'
                : preview && !preview.ok ? preview.error.message : null;
  const notes: string[] = [];
  if (source && source.capacity > 0 && source.stock > 0 && remainder > 0) {
    if (source.stock < remainder) notes.push(`На складе планеты только ${number.format(source.stock)} из ${number.format(remainder)} — можно отправить, сколько есть.`);
    if (source.capacity < need) notes.push(`Всех транспортёров планеты хватит на ${number.format(source.capacity)} из ${number.format(need)}. Остальное — следующим рейсом.`);
    else if (hullCount > 0 && capacity < need) notes.push(`Выбранные транспортёры возьмут ${number.format(capacity)} из ${number.format(need)}. «Под запрос» добавит недостающие.`);
  }

  const choose = (next: AidQuickSource) => {
    setSendError(null);
    setDraft({ planetId: next.planetId, ...suggestAidLoad(state, request, next, quickRuntimeNow()) });
  };
  const fit = () => { if (source) choose(source); };
  const setShips = (id: AidShipId, value: number) => {
    setSendError(null);
    setDraft((current) => {
      const nextShips = { ...current.ships, [id]: value };
      // A bigger fleet takes as much as it now can; a smaller one keeps what fits.
      const grew = value > (current.ships[id] ?? 0);
      const nextMax = source ? Math.min(remainder, source.stock, aidCapacity(state, nextShips)) : 0;
      return { ...current, ships: nextShips, amount: grew ? nextMax : Math.min(current.amount, nextMax) };
    });
  };
  const setAmount = (value: number) => {
    setSendError(null);
    setDraft((current) => ({ ...current, amount: Math.max(0, Math.min(amountMax, Math.floor(Number.isFinite(value) ? value : 0))) }));
  };
  const send = () => {
    if (!command || blocker || sending) return;
    setSending(true);
    const fresh = withSpeed(buildAidQuickCommand(request, command.originPlanetId!, ships, amount, quickRuntimeNow()));
    const [outcome] = onSend([fresh]);
    setSending(false);
    if (outcome?.result.ok) { onClose(); return; }
    setSendError(outcome && !outcome.result.ok ? outcome.result.error.message : 'Отправить не удалось.');
  };

  const error = sendError ?? blocker;
  const ids = aidShipIds(state);
  return shell(<>
    {head}
    <div className="aid-quick__ask" data-qa-aid-quick-ask>
      <ResourceIcon kind={request.resource} />
      <span><b>{resourceLabel}</b><em>Осталось отправить</em></span>
      <strong data-qa-aid-quick-remainder>{number.format(remainder)}</strong>
    </div>

    {sources.length === 0 ? null : (
      <div className="quick-send__legs" role="radiogroup" aria-label="Планета отправки">
        <small>Откуда</small>
        {sources.map((item, index) => {
          const on = item.planetId === draft.planetId;
          const status = item.capacity <= 0 ? 'нет транспортёров' : item.stock <= 0 ? 'нет ресурса' : `на складе ${number.format(item.stock)}`;
          return (
            <div key={item.planetId} className={`quick-send__leg ${on ? 'is-on' : ''} ${item.capacity <= 0 || item.stock <= 0 ? 'aid-quick__leg--off' : ''}`} style={{ '--qa-i': index } as CSSProperties} data-qa-aid-quick-source={item.planetId}>
              <button type="button" role="radio" aria-checked={on} className="quick-send__leg-toggle" onClick={() => choose(item)}>
                <i aria-hidden="true" />
                <b>{item.name}</b>
                <span>{on && flight ? <>{flightDurationLabel(flight.oneWayDurationMs)} · <em>{clock.format(flight.arrivalAt)}</em></> : status}</span>
              </button>
              {on && item.capacity > 0 && item.stock > 0 ? (
                <div className="quick-send__leg-body">
                  <ul className="quick-send__ships">
                    {ids.map((id) => {
                      const ship = catalog.get(id);
                      const free = item.free[id] ?? 0;
                      const count = ships[id] ?? 0;
                      return (
                        <li key={id} className={free <= 0 ? 'aid-quick__ship--none' : ''} data-qa-aid-quick-ship={id} data-qa-aid-quick-ship-count={count}>
                          {ship?.art ? <img src={ship.art} alt="" draggable={false} /> : <i />}
                          <span><b>{ship?.name ?? id}</b><em>{free > 0 ? `${number.format(count)} из ${number.format(free)}` : 'нет на планете'}</em></span>
                          <AmountSlider compact value={count} max={free} label={`${ship?.name ?? id}, ${item.name}`} onChange={(value) => setShips(id, value)} />
                        </li>
                      );
                    })}
                    <li className="quick-send__cargo" data-qa-aid-quick-cargo={request.resource}>
                      <ResourceIcon kind={request.resource} />
                      <span>
                        <b>{resourceLabel}</b>
                        <input className="aid-quick__amount" type="text" inputMode="numeric" value={number.format(amount)}
                          aria-label={`${resourceLabel}: сколько отправить`} onChange={(event) => setAmount(Number(event.currentTarget.value.replace(/\D/g, '') || 0))} data-qa-aid-quick-amount />
                      </span>
                      <AmountSlider compact value={amount} max={amountMax} label={`${resourceLabel}: сколько отправить`} onChange={setAmount} />
                    </li>
                  </ul>
                  {flight ? <FlightSpeedControl value={speedPercent} onChange={(value) => { setSendError(null); setSpeedPercent(value); }} qa="aid" label="Скорость"
                    duration={flightDurationLabel(flight.oneWayDurationMs)} /> : null}
                  <div className="quick-send__leg-tools">
                    <button type="button" className="quick-send__reset aid-quick__fit" onClick={fit} data-qa-aid-quick-fit>Под запрос</button>
                    <span className="aid-quick__hold">Трюм {number.format(capacity)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    )}

    {notes.map((note) => <p key={note} className="quick-send__notice" role="status" data-qa-aid-quick-note>{note}</p>)}
    {error ? <p className="quick-send__error aid-quick__pad" role="alert" data-qa-aid-quick-error>{error}</p> : null}

    <dl className="quick-send__route" data-qa-aid-quick-route={flight && !blocker ? 'ok' : 'off'}>
      <div><dt>В пути</dt><dd>{flight ? flightDurationLabel(flight.oneWayDurationMs) : '—'}</dd></div>
      <div><dt>Прибытие</dt><dd>{flight ? clock.format(flight.arrivalAt) : '—'}</dd></div>
      <div><dt>Газ</dt><dd>{flight ? number.format(flight.gasCost) : '—'}</dd></div>
    </dl>

    <footer className="quick-send__foot">
      <button type="button" className="quick-send__details" onClick={() => { onClose(); onDetails(source?.planetId ?? null); }} data-qa-aid-quick-details>Полный план</button>
      <button ref={sendRef} type="button" className="quick-send__go" disabled={Boolean(blocker) || !flight || sending} onClick={send} data-qa-aid-quick-go>Отправить</button>
    </footer>
  </>);
}
