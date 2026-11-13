import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { FlightRecord } from '../../domain/flights/types.ts';
import { ResourceIcon } from '../resources/ResourceIcon';
import { compactAmount } from '../empire/empire-format.ts';
import { EMPTY_ART } from '../ui-art.ts';

/**
 * «Рейсы и миссии» (concepts v2, approved 12.11): every flight is one card.
 * Attacks on the player's planets come first and red, own missions follow in
 * departure order, then any other fleet the player can see. A click on a card
 * opens its full composition in the big mission card at the bottom.
 * Everything here is presentation: the Fleet screen prepares the items and
 * owns every action.
 */

export type FlightBoardShip = { id: string; name: string; art?: string; count: number };
export type FlightBoardCargo = { kind: 'metal' | 'minerals' | 'gas' | 'debris'; amount: number };
export type FlightBoardSection = 'attack' | 'own' | 'other';
export type FlightBoardTone = 'out' | 'work' | 'back' | 'hot' | 'warn' | 'foreign';

export type FlightBoardItem = {
  flight: FlightRecord;
  section: FlightBoardSection;
  /** Same meaning as the old table: a foreign fleet that came for the player. */
  hostile: boolean;
  pirateRaid: boolean;
  missionLabel: string;
  missionArt?: string;
  bannerArt?: string;
  sinceLabel: string;
  origin: { node: ReactNode; art?: string };
  target: { node: ReactNode; art?: string };
  stateLabel: string;
  tone: FlightBoardTone;
  progress: number;
  /** What the timer counts to; undefined shows a dash. */
  timerAt?: number;
  whenLabel: string;
  /** null: the composition is hidden (Espionage below 10). */
  ships: FlightBoardShip[] | null;
  hiddenNote?: string;
  /** Full composition as one line; kept for screen readers and QA. */
  compositionText?: string;
  tags?: ReactNode;
  cargo: FlightBoardCargo[];
  canRepeat: boolean;
  /** 'none' renders the dash of a fleet the player cannot recall. */
  recall: 'enabled' | 'disabled' | 'none';
  canEvade: boolean;
  details?: () => void;
  cardKicker: string;
  cardTitle: ReactNode;
  cardLine: string;
};

const SHOWN_TYPES = 5;

export function boardTimer(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function typesLabel(count: number) {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return `${count} типов`;
  const last = count % 10;
  return last === 1 ? `${count} тип` : last >= 2 && last <= 4 ? `${count} типа` : `${count} типов`;
}

const exact = new Intl.NumberFormat('ru-RU');

function TimerCell({ item, now }: { item: FlightBoardItem; now: number }) {
  const { flight } = item;
  return <div className="fl-row__time">
    <strong data-qa-flight-arrival data-qa-flight-arrival-at={flight.arrivalAt} hidden={flight.phase !== 'outbound'}>{flight.phase === 'outbound' ? boardTimer(flight.arrivalAt - now) : '—'}</strong>
    <strong data-qa-flight-return hidden={flight.phase !== 'returning'}>{flight.phase === 'returning' && flight.returnAt !== undefined ? boardTimer(flight.returnAt - now) : '—'}</strong>
    {flight.phase !== 'outbound' && flight.phase !== 'returning' ? <strong>{item.timerAt !== undefined && item.timerAt > now ? boardTimer(item.timerAt - now) : '—'}</strong> : null}
    <small>{item.whenLabel}</small>
  </div>;
}

function ShipsButton({ item, selected, onOpen }: { item: FlightBoardItem; selected: boolean; onOpen: () => void }) {
  const total = item.ships?.reduce((sum, ship) => sum + ship.count, 0) ?? 0;
  return <button
    type="button"
    className={`fl-row__ships${selected ? ' is-on' : ''}${item.ships ? '' : ' is-hidden'}`}
    aria-pressed={selected}
    aria-label={item.ships ? `Состав флота: ${item.compositionText ?? ''}` : 'Состав флота скрыт'}
    onClick={(event) => { event.stopPropagation(); onOpen(); }}
    data-qa-flight-ships-open={item.flight.id}
  >
    {item.ships
      ? <><b>{compactAmount(total)}</b><small>· {typesLabel(item.ships.length)}</small></>
      : <small data-qa-incoming-composition-hidden>{item.hiddenNote ?? 'Состав скрыт'}</small>}
    <i aria-hidden="true">›</i>
    {item.ships && item.compositionText && item.hostile
      ? <span className="fl-sr" data-qa-incoming-composition data-qa-pirate-raid-force={item.pirateRaid || undefined}>{item.compositionText}</span>
      : null}
  </button>;
}

function resourcesLabel(count: number) {
  return count === 1 ? '1 ресурс' : count < 5 ? `${count} ресурса` : `${count} ресурсов`;
}

/** Two resources fit the cell; more show their count and the full list waits in the bottom card. */
function Cargo({ cargo }: { cargo: FlightBoardCargo[] }) {
  if (!cargo.length) return <div className="fl-row__cargo"><span className="is-none">без груза</span></div>;
  if (cargo.length > 2) return <div className="fl-row__cargo" data-qa-flight-cargo={cargo.length}><span className="is-many">{resourcesLabel(cargo.length)}<i aria-hidden="true">›</i></span></div>;
  return <div className="fl-row__cargo" data-qa-flight-cargo>{cargo.map((entry) => <span key={entry.kind}><ResourceIcon kind={entry.kind} /><b>{compactAmount(entry.amount)}</b></span>)}</div>;
}

function Row({ item, now, selected, onSelect, onRecall, onRepeat, onEvade }: {
  item: FlightBoardItem; now: number; selected: boolean;
  onSelect: () => void; onRecall: () => void; onRepeat: () => void; onEvade: () => void;
}) {
  const { flight } = item;
  const hot = item.section === 'attack';
  return <div
    className={`fl-row${hot ? ' is-hot' : ''}${item.section === 'other' ? ' is-foreign' : ''}${selected ? ' is-on' : ''}${item.hostile ? ' fleet-flight-row-v1--incoming-attack' : ''}`}
    style={{ '--fl-p': `${Math.round(Math.max(0, Math.min(1, item.progress)) * 100)}%` } as CSSProperties}
    onClick={onSelect}
    data-qa-flight-row={flight.id}
    data-qa-flight-phase={flight.phase}
    data-qa-flight-owner-side={flight.ownerSide ?? 'player'}
    data-qa-flight-incoming-attack={item.hostile || undefined}
    data-qa-flight-pirate-raid={item.pirateRaid || undefined}
    data-qa-flight-selected={selected || undefined}
  >
    <div className="fl-row__mission">
      <img className="fleet-flight-mission-icon" src={item.bannerArt ?? item.missionArt} alt="" draggable={false} />
      <div><b>{item.missionLabel}</b><small>{item.sinceLabel}</small>{item.tags}</div>
    </div>
    <div className="fl-row__place" data-qa-flight-origin>{item.origin.art ? <img src={item.origin.art} alt="" draggable={false} /> : <span className="fl-row__dot" />}<div>{item.origin.node}</div></div>
    <b className="fl-row__arrow" aria-hidden="true">{flight.phase === 'returning' ? '←' : '→'}</b>
    <div className="fl-row__place" data-qa-flight-target>{item.target.art ? <img src={item.target.art} alt="" draggable={false} /> : <span className="fl-row__dot" />}<div>{item.target.node}</div></div>
    <div className={`fl-row__state is-${item.tone}`}><span data-qa-flight-status>{item.stateLabel}</span><i aria-hidden="true" /></div>
    <TimerCell item={item} now={now} />
    <ShipsButton item={item} selected={selected} onOpen={onSelect} />
    <Cargo cargo={item.cargo} />
    <div className="fl-row__actions" onClick={(event) => event.stopPropagation()}>
      {item.canEvade ? <button type="button" className="is-red" data-qa-flight-evade={flight.id} onClick={onEvade}>Увести флот</button> : null}
      {item.recall === 'none'
        ? <span className="fl-row__norecall" aria-label="Чужой флот нельзя отозвать" data-qa-flight-no-recall>{item.canEvade ? '' : '—'}</span>
        : item.recall === 'enabled' ? <button type="button" data-qa-flight-recall={flight.id} onClick={onRecall}>Отозвать</button> : null}
      {item.canRepeat ? <button type="button" data-qa-flight-repeat={flight.id} onClick={onRepeat}>Повторить</button> : null}
    </div>
  </div>;
}

function FocusCard({ item, now, onRecall, onRepeat, onEvade }: {
  item: FlightBoardItem; now: number; onRecall: () => void; onRepeat: () => void; onEvade: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [item.flight.id]);
  const ships = item.ships ?? [];
  const shown = expanded ? ships : ships.slice(0, SHOWN_TYPES);
  const hot = item.section === 'attack';
  const remaining = item.timerAt !== undefined && item.timerAt > now ? boardTimer(item.timerAt - now) : null;
  return <section className={`fl-focus${hot ? ' is-hot' : ''}`} aria-label="Выбранный рейс" data-qa-flight-card={item.flight.id}>
    {item.bannerArt ? <img className="fl-focus__art" src={item.bannerArt} alt="" draggable={false} /> : null}
    <div className="fl-focus__text">
      <small className="fl-focus__kicker">{item.cardKicker}</small>
      <h2>{item.cardTitle}{remaining ? <> · <em data-qa-flight-card-timer>{remaining}</em></> : null}</h2>
      <p>{item.cardLine}</p>
      {item.cargo.length ? <div className="fl-focus__cargo" data-qa-flight-card-cargo>{item.cargo.map((entry) => <span key={entry.kind}><ResourceIcon kind={entry.kind} /><b>{compactAmount(entry.amount)}</b></span>)}</div> : null}
    </div>
    <div className={`fl-focus__ships${expanded ? ' is-open' : ''}`} data-qa-flight-card-ships>
      {item.ships
        ? shown.map((ship) => <div className="fl-focus__ship" key={ship.id} data-qa-flight-card-ship={ship.id}>
          {ship.art ? <img src={ship.art} alt="" draggable={false} /> : null}
          <small>{ship.name}</small><b>{exact.format(ship.count)}</b>
        </div>)
        : <div className="fl-focus__hidden"><b>Состав скрыт</b><small>{item.hiddenNote}</small></div>}
      {!expanded && ships.length > SHOWN_TYPES ? <button type="button" className="fl-focus__more" onClick={() => setExpanded(true)} aria-label={`Показать ещё ${ships.length - SHOWN_TYPES} типов`} data-qa-flight-card-more>+{ships.length - SHOWN_TYPES}</button> : null}
    </div>
    <div className="fl-focus__actions">
      {item.details ? <button type="button" onClick={item.details} data-qa-flight-card-details>Подробнее</button> : null}
      {item.recall === 'enabled' ? <button type="button" onClick={onRecall} data-qa-flight-card-recall>Отозвать</button> : null}
      {item.canRepeat ? <button type="button" onClick={onRepeat} data-qa-flight-card-repeat>Повторить</button> : null}
      {item.canEvade ? <button type="button" className="is-red" onClick={onEvade} data-qa-flight-card-evade>Увести флот</button> : null}
    </div>
  </section>;
}

export function FlightsBoard({ items, now, onRecall, onRepeat, onEvade, onSend, focus, footer }: {
  items: FlightBoardItem[];
  now: number;
  onRecall: (flight: FlightRecord) => void;
  onRepeat: (flight: FlightRecord) => void;
  onEvade: (flight: FlightRecord) => void;
  onSend: () => void;
  /** A flight to open, e.g. from the incoming-attack alert; the nonce reopens the same one. */
  focus?: { id: string; nonce: number } | null;
  footer?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    setSelectedId(focus.id);
    // A flight opened from outside the list (the attack alert, the chip) comes into view.
    requestAnimationFrame(() => document.querySelector(`[data-qa-flight-row="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [focus]);
  const groups = useMemo(() => ({
    attack: items.filter((item) => item.section === 'attack'),
    own: items.filter((item) => item.section === 'own'),
    other: items.filter((item) => item.section === 'other'),
  }), [items]);
  const selected = items.find((item) => item.flight.id === selectedId) ?? groups.attack[0] ?? groups.own[0] ?? groups.other[0] ?? null;
  const row = (item: FlightBoardItem) => <Row
    key={item.flight.id}
    item={item}
    now={now}
    selected={item === selected}
    onSelect={() => setSelectedId(item.flight.id)}
    onRecall={() => onRecall(item.flight)}
    onRepeat={() => onRepeat(item.flight)}
    onEvade={() => onEvade(item.flight)}
  />;

  return <div className={`fl-board${items.length ? '' : ' is-empty'}`} data-qa-flights-board>
    <div className="fl-list" data-qa-flights-list>
      {items.length === 0 ? <div className="fl-empty" data-qa-flight-empty>
        <img className="ui-empty-art" src={EMPTY_ART.flights} alt="" draggable={false} />
        <strong>Сейчас ни один флот не летит</strong>
        <span>Атаки на ваши планеты тоже появятся здесь, сверху и красным.</span>
        <button type="button" className="is-primary" onClick={onSend} data-qa-flights-empty-send>Отправить флот</button>
      </div> : null}
      {groups.attack.length ? <h3 className="fl-sec is-hot">Атаки на ваши планеты</h3> : null}
      {groups.attack.map(row)}
      {groups.own.length ? <h3 className="fl-sec">Ваши миссии · по времени отправки</h3> : null}
      {groups.own.map(row)}
      {groups.other.length ? <h3 className="fl-sec">Другие флоты</h3> : null}
      {groups.other.map(row)}
      {footer}
    </div>
    {selected ? <FocusCard
      item={selected}
      now={now}
      onRecall={() => onRecall(selected.flight)}
      onRepeat={() => onRepeat(selected.flight)}
      onEvade={() => onEvade(selected.flight)}
    /> : null}
  </div>;
}
