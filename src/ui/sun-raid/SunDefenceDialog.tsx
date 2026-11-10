import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { getFactionShipCatalog } from '../../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../../domain/combat/factions.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import { projectSun, readSun } from '../../domain/sun-raid/rules.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { SaveState } from '../../application/contracts.ts';
import { getPlayerFlightSlotUsage, type DispatchFlightCommand } from '../../application/flights.ts';
import type { QuickLegOutcome } from '../../application/quick-actions.ts';
import { currentSunRaidState, formatSun, sunFleetPopulation } from '../../application/sun-raid.ts';
import {
  buildSunSupportCommand,
  previewSunDefenceLeg,
  selectDefendableRaids,
  sunDefenceInTimeShips,
  sunDefenceRoom,
  sunDefenceSources,
  type SunDefenceShips,
} from '../../application/sun-gate-watch.ts';
import { AmountSlider } from '../AmountSlider.tsx';
import { flightDurationLabel, quickRuntimeNow } from '../quick-send/QuickSendPanel.tsx';
import { ACTION_ART } from '../actions/action-art.ts';
import { SUN_ART } from './sun-raid-assets.ts';
import './sun-defence.css';

const number = new Intl.NumberFormat('ru-RU');
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** «12:04» / «1:02:09»: the raid's landing countdown. */
function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function marginLabel(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 1) return ms >= 0 ? 'прибудет впритык' : 'опоздает на секунды';
  const span = minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`;
  return ms >= 0 ? `успеет за ${span} до удара` : `опоздает на ${span}`;
}

export type SunDefenceDialogProps = {
  state: SaveState;
  now: number;
  /** The Sun the player opened the window for; another Sun under attack can be picked inside. */
  galaxy: number;
  system: number;
  /** Planet id → its picture (the header planet art). */
  planetArt: Readonly<Record<string, string>>;
  onClose: () => void;
  /** Same dispatcher as the map quick panel (every leg through `dispatchFlight`). */
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
  /** «Полный план»: «Флоты → Поддержка солнца» for this Sun from the given planet. */
  onDetails: (galaxy: number, system: number, originPlanetId: string | null) => void;
};

/**
 * «Защита Солнца» from every planet at once: one row per planet with its free
 * warships, «Всё боевое» per planet and «Со всех планет», one «Отправить» for
 * every chosen fleet. Each row shows when its fleet lands against the raid;
 * a fleet that would come too late is marked and not sent. Every figure and
 * refusal is the runtime's own Sun preview of the command Send dispatches.
 */
export function SunDefenceDialog({ state, now, galaxy, system, planetArt, onClose, onSend, onDetails }: SunDefenceDialogProps) {
  const factionId = state.profile.factionId as CombatFactionId;
  const catalog = useMemo(() => new Map(getFactionShipCatalog(factionId).map((ship) => [ship.id as ShipId, ship])), [factionId]);
  const raids = selectDefendableRaids(state, now);
  const [sunKey, setSunKey] = useState(`${galaxy}:${system}`);
  const raid = raids.find((item) => `${item.galaxy}:${item.system}` === sunKey) ?? null;
  const [drafts, setDrafts] = useState<Record<string, SunDefenceShips>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  // Another Sun picked: the drafts belonged to the old raid.
  useEffect(() => { setDrafts({}); setErrors({}); }, [sunKey]);

  const runtime = { ...quickRuntimeNow(), now };
  const sources = raid ? sunDefenceSources(state, raid) : [];
  const rows = raid ? sources.map((source) => {
    const ships = Object.fromEntries(Object.entries(drafts[source.planetId] ?? {})
      .map(([id, count]) => [id, Math.min(Math.floor(count ?? 0), source.free[id as ShipId] ?? 0)])
      .filter(([, count]) => (count as number) > 0)) as SunDefenceShips;
    const picked = Object.keys(ships).length > 0;
    const leg = Object.keys(source.free).length ? previewSunDefenceLeg(state, raid, source.planetId, ships, runtime) : null;
    // «Всё боевое»: the whole fleet, or only the hulls that still make it when the slowest is late.
    const wholeLate = Boolean(leg && !picked && leg.late) || Boolean(picked && previewSunDefenceLeg(state, raid, source.planetId, {}, runtime).late);
    const candidate = wholeLate ? sunDefenceInTimeShips(state, raid, source.planetId, runtime) : source.free;
    return { source, ships, picked, leg, candidate, wholeLate };
  }) : [];
  const room = raid ? sunDefenceRoom(state, raid) : { cap: 0, committed: 0, remaining: 0 };
  const chosen = rows.filter((row) => row.picked && row.leg && !row.leg.late);
  const chosenPopulation = chosen.reduce((total, row) => total + sunFleetPopulation(row.ships, factionId), 0);
  const gas = chosen.reduce((total, row) => total + (row.leg?.gasCost ?? 0), 0);
  const overRoom = chosenPopulation > room.remaining;
  const slots = getPlayerFlightSlotUsage(state);
  const overSlots = chosen.length > slots.free;
  const blocked = chosen.some((row) => row.leg?.error);
  const ready = Boolean(raid) && chosen.length > 0 && !overRoom && !overSlots && !blocked;
  const inTime = rows.filter((row) => Object.keys(row.candidate).length > 0);

  const setShips = (planetId: string, ships: SunDefenceShips) => {
    setErrors((current) => { const next = { ...current }; delete next[planetId]; return next; });
    setDrafts((current) => ({ ...current, [planetId]: ships }));
  };
  const isAll = (row: (typeof rows)[number]) => row.picked && Object.entries(row.candidate).every(([id, count]) => row.ships[id as ShipId] === count)
    && Object.keys(row.ships).every((id) => id in row.candidate);
  const allOf = (row: (typeof rows)[number]) => (isAll(row) ? {} : { ...row.candidate });
  /** Nearest planets first, every warship, until the defence limit is full (the rest would be refused). */
  const takeEverything = () => {
    const next: Record<string, SunDefenceShips> = {};
    let left = room.remaining;
    for (const row of inTime) {
      if (left <= 0) break;
      const ships: SunDefenceShips = {};
      for (const [id, count] of Object.entries(row.candidate) as [ShipId, number][]) {
        const each = sunFleetPopulation({ [id]: 1 }, factionId);
        const take = each > 0 ? Math.min(count, Math.floor(left / each)) : count;
        if (take > 0) { ships[id] = take; left -= take * each; }
      }
      if (Object.keys(ships).length) next[row.source.planetId] = ships;
    }
    setDrafts(next);
    setErrors({});
  };

  const send = () => {
    if (!ready || !raid) return;
    const at = quickRuntimeNow();
    const outcomes = onSend(chosen.map((row) => buildSunSupportCommand(raid, row.source.planetId, row.ships, at)));
    if (outcomes.every((outcome) => outcome.result.ok)) { onClose(); return; }
    const sent = new Set(outcomes.filter((outcome) => outcome.result.ok).map((outcome) => outcome.originPlanetId));
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([planetId]) => !sent.has(planetId))));
    setErrors(Object.fromEntries(outcomes.flatMap((outcome) => (outcome.result.ok ? [] : [[outcome.originPlanetId, outcome.result.error.message]]))));
  };

  const sunState = raid ? projectSun(readSun(currentSunRaidState(state), raid.galaxy, raid.system), now) : null;
  const sunArt = sunState?.frozen ? SUN_ART.frozen : sunState && sunState.brightness < sunState.baseEfficiency ? SUN_ART.dimmed : SUN_ART.bright;
  const fill = room.cap > 0 ? Math.min(100, (room.committed / room.cap) * 100) : 0;
  const addFill = room.cap > 0 ? Math.min(100 - fill, (chosenPopulation / room.cap) * 100) : 0;

  return createPortal(
    <div className="sdef-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sdef" role="dialog" aria-modal="true" aria-label="Защита Солнца" data-qa-sun-defence={raid ? raid.id : 'none'}>
        <button ref={closeRef} type="button" className="sdef__close" data-asterion-close aria-label="Закрыть" onClick={onClose}>✕</button>

        <aside className="sdef__hero">
          <div className="sdef__sun" aria-hidden="true">
            <span className="sdef__sun-ring" />
            <img src={sunArt} alt="" draggable={false} />
          </div>
          <small className="sdef__eyebrow">Защита Солнца</small>
          <h2>Солнце {formatSun(raid?.galaxy ?? galaxy, raid?.system ?? system)}</h2>
          {raid ? (
            <>
              <div className="sdef__strike" data-qa-sun-defence-countdown>
                <small>Удар через</small>
                <b>{countdown(raid.arrivesAt - now)}</b>
                <span>в {clock.format(raid.arrivesAt)}</span>
              </div>
              <dl className="sdef__facts">
                <div><dt>Рейд</dt><dd>[{raid.allianceTag}] {raid.allianceName}</dd></div>
                <div><dt>Объявил</dt><dd>{raid.initiatorName}</dd></div>
              </dl>
              <div className="sdef__room" data-qa-sun-defence-room={room.remaining}>
                <small>Защитники · {number.format(room.committed + chosenPopulation)} из {number.format(room.cap)}</small>
                <i><i style={{ width: `${fill}%` }} /><i className="is-add" style={{ width: `${addFill}%` }} /></i>
                <span>{room.committed > 0 ? `уже летят ${number.format(room.committed)}` : 'пока никто не летит'}</span>
              </div>
            </>
          ) : <p className="sdef__none" data-qa-sun-defence-empty>Сейчас на это Солнце никто не нападает.</p>}
          {raids.length > 1 ? (
            <div className="sdef__suns" role="tablist" aria-label="Солнца под атакой">
              {raids.map((item) => {
                const key = `${item.galaxy}:${item.system}`;
                return (
                  <button key={item.id} type="button" role="tab" aria-selected={key === sunKey} className={key === sunKey ? 'is-on' : ''} onClick={() => setSunKey(key)} data-qa-sun-defence-sun={key}>
                    <b>{formatSun(item.galaxy, item.system)}</b><span>[{item.allianceTag}] · {countdown(item.arrivesAt - now)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </aside>

        <div className="sdef__main">
          <header className="sdef__head">
            <div>
              <h3>Флоты с ваших планет</h3>
              <span>Летят только боевые корабли. «Со всех» берёт ближние планеты до лимита защиты, опоздавший флот не отправится.</span>
            </div>
            <button type="button" className="sdef__all" disabled={!raid || inTime.every((row) => !Object.keys(row.source.free).length)} onClick={takeEverything} data-qa-sun-defence-all>
              <img src={ACTION_ART['sun-support']} alt="" draggable={false} />Всё боевое со всех
            </button>
          </header>

          <ul className="sdef__planets">
            {rows.map((row, index) => {
              const { source, leg } = row;
              const hasShips = Object.keys(source.free).length > 0;
              const open = row.picked || expanded[source.planetId];
              const error = errors[source.planetId] ?? (row.picked ? leg?.error ?? undefined : undefined);
              const tone = !hasShips ? 'is-empty' : leg?.late ? 'is-late' : row.picked ? 'is-on' : '';
              const canPick = Object.keys(row.candidate).length > 0;
              return (
                <li key={source.planetId} className={`sdef-row ${tone}`} style={{ '--i': index } as CSSProperties} data-qa-sun-defence-row={source.planetId} data-qa-sun-defence-late={leg?.late ? 'true' : 'false'}>
                  <div className="sdef-row__top">
                    {planetArt[source.planetId] ? <img className="sdef-row__planet" src={planetArt[source.planetId]} alt="" draggable={false} /> : <i className="sdef-row__planet" aria-hidden="true" />}
                    <div className="sdef-row__name">
                      <b>{source.name}</b>
                      <small>{formatUniverseCoordinate(source.coordinate)}</small>
                    </div>
                    <div className="sdef-row__time">
                      {!hasShips ? <span>нет свободных боевых кораблей</span>
                        : leg ? <>
                          <span>в пути {flightDurationLabel(leg.oneWayMs)} · {clock.format(leg.arrivesAt)}</span>
                          <em className={leg.late ? 'is-bad' : 'is-good'}>{marginLabel(leg.marginMs)}</em>
                        </> : null}
                    </div>
                    <div className="sdef-row__pick">
                      {hasShips ? <small>{row.picked ? `${number.format(sunFleetPopulation(row.ships, factionId))} насел.` : `${number.format(source.population)} насел.`}</small> : null}
                      {hasShips ? (
                        <>
                          {canPick || row.picked ? (
                            <button type="button" className={`sdef-row__all ${row.picked ? 'is-on' : ''}`} onClick={() => setShips(source.planetId, row.picked && !canPick ? {} : allOf(row))} data-qa-sun-defence-row-all={source.planetId}>
                              {isAll(row) || (row.picked && !canPick) ? 'Снять' : row.wholeLate ? 'Кто успеет' : 'Всё боевое'}
                            </button>
                          ) : null}
                          <button type="button" className="sdef-row__more" aria-expanded={Boolean(open)} aria-label={`Состав флота: ${source.name}`}
                            onClick={() => setExpanded((current) => ({ ...current, [source.planetId]: !open }))}>▾</button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {open && hasShips ? (
                    <ul className="sdef-row__ships">
                      {(Object.entries(source.free) as [ShipId, number][]).map(([shipId, max]) => {
                        const ship = catalog.get(shipId);
                        const count = row.ships[shipId] ?? 0;
                        return (
                          <li key={shipId} data-qa-sun-defence-ship={shipId}>
                            {ship?.art ? <img src={ship.art} alt="" draggable={false} /> : <i />}
                            <span><b>{ship?.name ?? shipId}</b><em>{number.format(count)} из {number.format(max)}</em></span>
                            <AmountSlider compact value={count} max={max} label={`${ship?.name ?? shipId}, ${source.name}`}
                              onChange={(value) => setShips(source.planetId, Object.fromEntries(Object.entries({ ...row.ships, [shipId]: value }).filter(([, n]) => (n ?? 0) > 0)))} />
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {error ? <p className="sdef-row__error" role="alert">{error}</p> : null}
                </li>
              );
            })}
          </ul>

          <footer className="sdef__foot">
            <dl>
              <div><dt>Флотов</dt><dd data-qa-sun-defence-count>{chosen.length}</dd></div>
              <div><dt>Население</dt><dd className={overRoom ? 'is-bad' : ''}>{number.format(chosenPopulation)} <small>из {number.format(room.remaining)}</small></dd></div>
              <div><dt>Газ</dt><dd>{number.format(gas)}</dd></div>
            </dl>
            {overRoom ? <p className="sdef__warn" role="alert">Сверх лимита защиты на {number.format(chosenPopulation - room.remaining)} населения: уменьшите флоты.</p>
              : overSlots ? <p className="sdef__warn" role="alert">Свободных полётов: {slots.free} из {slots.limit}. Снимите лишние планеты.</p>
              : null}
            <div className="sdef__actions">
              <button type="button" className="sdef__details" disabled={!raid} onClick={() => { onClose(); if (raid) onDetails(raid.galaxy, raid.system, chosen[0]?.source.planetId ?? null); }} data-qa-sun-defence-details>Полный план</button>
              <button type="button" className="sdef__go" disabled={!ready} onClick={send} data-qa-sun-defence-send>
                {chosen.length > 1 ? `Отправить · ${chosen.length}` : 'Отправить'}
              </button>
            </div>
          </footer>
        </div>
      </section>
    </div>,
    document.body,
  );
}
