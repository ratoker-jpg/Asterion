import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { playSound } from '../../audio/engine.ts';
import { localizeBuildingNames } from '../../domain/buildings/balance-v1.ts';
import { getBuildingDefinition } from '../../domain/buildings/resource-zone.ts';
import type { CombatFactionId } from '../../domain/combat/factions.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import {
  emptyFleetPlan,
  isFleetPlanEmpty,
  removeFleetPlanLine,
  setFleetPlanTarget,
  toggleFleetPlanFill,
  type FleetPlan,
} from '../../domain/fleet/fleet-plan.ts';
import type { RuntimeMode, TestTimeScale } from '../../domain/runtime/mode.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { SaveState } from '../../application/contracts.ts';
import {
  buildFleetPlanView,
  FLEET_PLAN_RESOURCES,
  type FleetPlanLine,
  type FleetPlanStartResult,
  type FleetPlanView,
} from '../../application/fleet-plan.ts';
import { compactAmount, formatNumber, plural } from '../empire/empire-format.ts';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { fleetPlanLimitText, fleetPlanReport, planAmount } from './fleet-plan-text.ts';
import './fleet-planner.css';

const MAX_TARGET_DIGITS = 12;
/** «2:14:30», «3 д 04:10» past a day. Long orders only ever read in days and hours. */
function buildTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days > 0) return `${formatNumber(days)} д ${pad(hours)}:${pad(minutes)}`;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export type FleetPlannerDialogProps = {
  state: SaveState;
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
  planetId: string;
  planetArt: Record<string, string>;
  onPlanet: (planetId: string) => void;
  onClose: () => void;
  onSavePlan: (planetId: string, plan: FleetPlan) => boolean;
  onStart: (planetId: string, shipIds?: readonly ShipId[]) => FleetPlanStartResult | null;
};

type Report = { planetId: string; text: string; warn: string | null; key: number };

/**
 * «Эталонный флот»: what a planet should hold, what it holds, and one click for
 * the difference. It never builds by itself and keeps no rule of its own: the
 * numbers come from `buildFleetPlanView`, the orders from the shipyard command.
 */
export function FleetPlannerDialog({ state, now, mode, testTimeScale, planetId, planetArt, onPlanet, onClose, onSavePlan, onStart }: FleetPlannerDialogProps) {
  const factionId = state.profile.factionId as CombatFactionId;
  const runtime = useMemo(() => ({ now, mode, testTimeScale }), [now, mode, testTimeScale]);
  const view = useMemo(() => buildFleetPlanView(state, planetId, runtime), [state, planetId, runtime]);
  const planets = useMemo(() => Object.keys(state.planets).sort((a, b) => Number(b === 'helion-01') - Number(a === 'helion-01')).map((id) => {
    const other = buildFleetPlanView(state, id, runtime);
    return { id, name: state.planets[id]!.name, empty: other.empty, missing: other.missing, overBy: other.hangar.overBy, lines: other.lines.length };
  }), [state, runtime]);
  const [focusId, setFocusId] = useState<ShipId | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [launched, setLaunched] = useState<{ ids: Set<ShipId>; key: number } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [undo, setUndo] = useState<{ planetId: string; plan: FleetPlan; label: string } | null>(null);
  const planet = state.planets[planetId]!;
  const shipyardName = getBuildingDefinition('shipyard', factionId).name;
  const hangarName = getBuildingDefinition('hangar', factionId).name;
  const noYard = (planet.buildings.shipyard ?? 0) <= 0;
  const planned = new Set(view.lines.map((line) => line.id));
  const shelf = view.items.filter((item) => !planned.has(item.id as ShipId));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (copyOpen) setCopyOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copyOpen, onClose]);

  useEffect(() => {
    setReport(null);
    setCopyOpen(false);
    setFocusId(null);
  }, [planetId]);

  useEffect(() => {
    if (!launched) return;
    const timer = window.setTimeout(() => setLaunched(null), 1_400);
    return () => window.clearTimeout(timer);
  }, [launched]);

  const save = (plan: FleetPlan) => onSavePlan(planetId, plan);

  const start = (shipIds?: readonly ShipId[]) => {
    const result = onStart(planetId, shipIds);
    if (!result) return;
    const ids = new Set(result.outcomes.filter((outcome) => outcome.started > 0).map((outcome) => outcome.shipId));
    if (ids.size) {
      setLaunched({ ids, key: Date.now() });
      playSound('success');
    }
    setReport({ planetId, ...fleetPlanReport(result), key: Date.now() });
  };

  const addLine = (shipId: ShipId) => {
    const item = view.items.find((candidate) => candidate.id === shipId)!;
    if (save(setFleetPlanTarget(view.plan, shipId, Math.max(1, item.owned + item.pending)))) setFocusId(shipId);
  };

  const fromCurrent = () => {
    let plan = emptyFleetPlan();
    for (const item of view.items) {
      if (item.owned + item.pending > 0) plan = setFleetPlanTarget(plan, item.id as ShipId, item.owned + item.pending);
    }
    save(plan);
  };

  const copyFrom = (sourceId: string) => {
    const source = state.fleetUi?.plans?.[sourceId];
    if (!source) return;
    if (!isFleetPlanEmpty(view.plan)) setUndo({ planetId, plan: view.plan, label: state.planets[sourceId]!.name });
    else setUndo(null);
    save({ targets: { ...source.targets }, ...(source.fillShipId ? { fillShipId: source.fillShipId } : {}) });
    setCopyOpen(false);
  };

  const copySources = planets.filter((other) => other.id !== planetId && !other.empty);

  return createPortal(
    <div className="fplan-veil" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="fplan" role="dialog" aria-modal="true" aria-label={`Эталонный флот: ${planet.name}`} data-qa-fleet-planner={planetId}>
        <header className="fplan__head" data-toast-guard>
          <div className="fplan__title">
            <h2>Эталонный флот</h2>
            <small>{planet.name} · {formatUniverseCoordinate({ galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 })}</small>
          </div>
          <nav className="fplan__planets" aria-label="Планеты">
            {planets.map((other) => (
              <button key={other.id} type="button" className={other.id === planetId ? 'is-on' : ''} aria-pressed={other.id === planetId} onClick={() => onPlanet(other.id)} data-qa-fleet-plan-planet={other.id} data-qa-fleet-plan-missing={other.missing}>
                {planetArt[other.id] ? <img src={planetArt[other.id]} alt="" draggable={false} /> : null}
                <span>{other.name}</span>
                {other.empty ? <small className="is-none">нет плана</small>
                  : other.overBy > 0 ? <small className="is-bad">больше ангара</small>
                    : other.missing > 0 ? <small className="is-warn">−{compactAmount(other.missing)}</small>
                      : <small className="is-ok">всё есть</small>}
              </button>
            ))}
          </nav>
          <button type="button" className="fplan__close" onClick={onClose} aria-label="Закрыть" data-qa-fleet-planner-close>✕</button>
        </header>

        <HangarBand view={view} name={hangarName} />

        {noYard ? <p className="fplan__note" data-qa-fleet-plan-no-yard>{shipyardName} здесь ещё не построена. План можно составить заранее, запустить его можно будет после постройки.</p> : null}

        {view.empty ? (
          <EmptyPlan view={view} copyCount={copySources.length} onFromCurrent={fromCurrent} onCopy={() => setCopyOpen((was) => !was)} onAdd={addLine} />
        ) : (
          <>
            <ol className="fplan__lanes" data-qa-fleet-plan-lanes>
              {view.lines.map((line, index) => (
                <Lane key={line.id} line={line} index={index} autoFocus={focusId === line.id} launchKey={launched?.ids.has(line.id) ? launched.key : null} faction={factionId}
                  onTarget={(target) => save(setFleetPlanTarget(view.plan, line.id, target))}
                  onFill={() => save(toggleFleetPlanFill(view.plan, line.id, Math.max(1, view.lines.find((other) => other.isFill)?.target ?? 0)))}
                  onRemove={() => save(removeFleetPlanLine(view.plan, line.id))}
                  onStart={() => start([line.id])} />
              ))}
            </ol>
            {shelf.length ? (
              <div className="fplan__shelf" data-qa-fleet-plan-shelf>
                <span>Добавить в план</span>
                <div>
                  {shelf.map((item) => (
                    <button key={item.id} type="button" onClick={() => addLine(item.id as ShipId)} data-qa-fleet-plan-add={item.id}>
                      <img src={item.art} alt="" draggable={false} />
                      <b>{item.name}</b>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        <footer className="fplan__dock" data-toast-guard>
          <div className="fplan__summary" aria-live="polite">
            {report?.planetId === planetId ? (
              <div className="fplan__report" key={report.key} data-qa-fleet-plan-report>
                <b>{report.text}</b>
                {report.warn ? <small data-qa-fleet-plan-report-warn>{report.warn}</small> : null}
              </div>
            ) : undo?.planetId === planetId ? (
              <div className="fplan__report">
                <b>План взят с планеты {undo.label}.</b>
                <button type="button" className="fplan__undo" onClick={() => { save(undo.plan); setUndo(null); }} data-qa-fleet-plan-undo>Вернуть как было</button>
              </div>
            ) : view.missing > 0 ? (
              <div className="fplan__costs" data-qa-fleet-plan-costs>
                <small>Вся нехватка стоит</small>
                {FLEET_PLAN_RESOURCES.map((key) => (
                  <span key={key} className={view.short[key] ? 'is-short' : ''} data-qa-fleet-plan-cost={key}>
                    <ResourceIcon kind={key} />
                    <b>{compactAmount(view.cost[key])}</b>
                    {view.short[key] ? <small>нет {compactAmount(view.short[key]!)}</small> : null}
                  </span>
                ))}
              </div>
            ) : !view.empty ? (
              <div className="fplan__report is-calm"><b>На этой планете всё по плану.</b></div>
            ) : null}
          </div>
          <div className="fplan__actions">
            {!view.empty ? (
              <button type="button" className="fplan__btn" onClick={() => setCopyOpen((was) => !was)} disabled={!copySources.length} aria-expanded={copyOpen} data-qa-fleet-plan-copy>
                Взять план с планеты
              </button>
            ) : null}
            <button type="button" className="fplan__btn fplan__btn--pri" disabled={view.startable <= 0} onClick={() => start()} data-qa-fleet-plan-start-all data-sfx="none">
              {view.startable > 0 ? `Запустить всё · ${planAmount(view.startable)}` : 'Запустить всё'}
            </button>
          </div>
          {copyOpen ? (
            <div className="fplan__copy" role="dialog" aria-label="Взять план с планеты" data-qa-fleet-plan-copy-list>
              <header><b>Взять план с планеты</b>{!view.empty ? <small>Текущий план {planet.name} заменится</small> : null}</header>
              <ul>
                {copySources.map((other) => {
                  return (
                    <li key={other.id}>
                      <button type="button" onClick={() => copyFrom(other.id)} data-qa-fleet-plan-copy-from={other.id}>
                        {planetArt[other.id] ? <img src={planetArt[other.id]} alt="" draggable={false} /> : null}
                        <span><b>{other.name}</b><small>{other.lines} {plural(other.lines, 'вид', 'вида', 'видов')} кораблей</small></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function HangarBand({ view, name }: { view: FleetPlanView; name: string }) {
  const { used, capacity, withPlan, overBy } = view.hangar;
  const scale = Math.max(capacity, withPlan, used, 1);
  const usedShare = used / scale;
  const planShare = Math.max(0, withPlan - used) / scale;
  const capShare = capacity / scale;
  const free = Math.max(0, capacity - withPlan);
  return (
    <div className={`fplan-hangar ${overBy > 0 ? 'is-over' : ''}`} data-qa-fleet-plan-hangar data-qa-fleet-plan-over={overBy}>
      <p>
        <span>{name}</span>
        <b data-qa-fleet-plan-used={used}>{planAmount(used)}</b>
        <span>из {planAmount(capacity)} занято</span>
        {!view.empty ? <span className="fplan-hangar__plan">по плану будет <b>{planAmount(withPlan)}</b></span> : null}
        {overBy > 0
          ? <strong className="fplan-hangar__over" data-qa-fleet-plan-over-text>План не помещается: больше ангара на {planAmount(overBy)} населения</strong>
          : !view.empty ? <em className="fplan-hangar__free">{free > 0 ? `останется ${planAmount(free)} места` : 'ангар будет заполнен'}</em> : null}
      </p>
      <div className="fplan-hangar__band" role="meter" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used} aria-label={`${name}: занято ${formatNumber(used)} из ${formatNumber(capacity)}`}>
        <i className="fplan-hangar__plan-part" style={{ '--from': usedShare, '--share': planShare } as CSSProperties} />
        <i className="fplan-hangar__used" style={{ '--share': usedShare } as CSSProperties} />
        {overBy > 0 ? <i className="fplan-hangar__cap" style={{ '--at': capShare } as CSSProperties} /> : null}
      </div>
    </div>
  );
}

function EmptyPlan({ view, copyCount, onFromCurrent, onCopy, onAdd }: { view: FleetPlanView; copyCount: number; onFromCurrent: () => void; onCopy: () => void; onAdd: (shipId: ShipId) => void }) {
  const hasFleet = view.items.some((item) => item.owned + item.pending > 0);
  return (
    <div className="fplan-empty" data-qa-fleet-plan-empty>
      <div className="fplan-empty__lead">
        <h3>Какой флот должен стоять на этой планете?</h3>
        <p>Выберите корабли и задайте число. Планировщик покажет, сколько не хватает, и запустит ровно столько одной кнопкой. Сам он ничего не строит.</p>
        <div>
          <button type="button" className="fplan__btn" onClick={onFromCurrent} disabled={!hasFleet} data-qa-fleet-plan-from-current>Взять то, что уже есть</button>
          <button type="button" className="fplan__btn" onClick={onCopy} disabled={!copyCount} data-qa-fleet-plan-copy>Взять план с планеты</button>
        </div>
      </div>
      <div className="fplan-empty__grid">
        {view.items.map((item, index) => (
          <button key={item.id} type="button" style={{ '--i': index } as CSSProperties} onClick={() => onAdd(item.id as ShipId)} data-qa-fleet-plan-add={item.id}>
            <img src={item.art} alt="" draggable={false} />
            <b>{item.name}</b>
            <small>{item.owned + item.pending > 0 ? `есть ${planAmount(item.owned + item.pending)}` : 'нет'}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function Lane({ line, index, autoFocus, launchKey, faction, onTarget, onFill, onRemove, onStart }: {
  line: FleetPlanLine; index: number; autoFocus: boolean; launchKey: number | null; faction: CombatFactionId;
  onTarget: (target: number) => void; onFill: () => void; onRemove: () => void; onStart: () => void;
}) {
  const { item } = line;
  const scale = Math.max(line.target, line.current, 1);
  const hold = fleetPlanLimitText(line.limitedBy, line.short);
  const locked = !item.unlocked;
  const reason = locked ? localizeBuildingNames(item.reason ?? 'Требования не выполнены.', faction) : null;
  const state = locked ? 'locked' : line.missing <= 0 ? 'done' : line.startable <= 0 ? 'stuck' : line.startable < line.missing ? 'part' : 'ready';
  return (
    <li className={`fplan-lane is-${state} ${line.isFill ? 'is-fill' : ''} ${launchKey ? 'is-launched' : ''}`} style={{ '--i': index } as CSSProperties}
      data-qa-fleet-plan-line={line.id} data-qa-fleet-plan-line-state={state} data-qa-fleet-plan-line-missing={line.missing} data-qa-fleet-plan-line-target={line.target} data-qa-fleet-plan-line-current={line.current}>
      <div className="fplan-lane__art">
        <img key={launchKey ?? 'still'} src={item.art} alt="" draggable={false} />
      </div>
      <div className="fplan-lane__name">
        <b>{item.name}</b>
        <small>{line.isFill ? 'заполнит остаток ангара' : item.role}</small>
      </div>
      <div className="fplan-lane__track">
        <div className="fplan-lane__bar" aria-hidden="true">
          <i className="is-away" style={{ '--from': (line.onPlanet + line.queued) / scale, '--share': line.away / scale } as CSSProperties} />
          <i className="is-queued" style={{ '--from': line.onPlanet / scale, '--share': line.queued / scale } as CSSProperties} />
          <i className="is-here" style={{ '--from': 0, '--share': line.onPlanet / scale } as CSSProperties} />
        </div>
        <small className="fplan-lane__parts">
          <span>на планете <b>{planAmount(line.onPlanet)}</b></span>
          {line.queued ? <span className="is-queued" data-qa-fleet-plan-line-queued={line.queued}>строится <b>{planAmount(line.queued)}</b></span> : null}
          {line.away ? <span data-qa-fleet-plan-line-away={line.away}>в рейсе <b>{planAmount(line.away)}</b></span> : null}
          {line.surplus ? <span className="is-surplus">сверх плана <b>{planAmount(line.surplus)}</b></span> : null}
        </small>
      </div>
      <div className="fplan-lane__target">
        {line.isFill ? (
          <div className="fplan-lane__fill-value" data-qa-fleet-plan-fill-target={line.target}>{planAmount(line.target)}</div>
        ) : (
          <TargetInput value={line.target} name={item.name} autoFocus={autoFocus} onCommit={onTarget} qa={line.id} />
        )}
        <button type="button" className={`fplan-lane__fill ${line.isFill ? 'is-on' : ''}`} aria-pressed={line.isFill} onClick={onFill} data-qa-fleet-plan-fill={line.id}>на остаток</button>
      </div>
      <div className="fplan-lane__action">
        {locked ? (
          <p className="fplan-lane__why" data-qa-fleet-plan-line-reason>{reason}</p>
        ) : line.missing <= 0 ? (
          <p className="fplan-lane__done">Как в плане</p>
        ) : line.startable <= 0 ? (
          <p className="fplan-lane__stuck" data-qa-fleet-plan-line-stuck><b>Не хватает {planAmount(line.missing)}</b><small>{hold}</small></p>
        ) : (
          <>
            <button type="button" className={`fplan-lane__go ${state === 'part' ? 'is-part' : ''}`} onClick={onStart} data-qa-fleet-plan-start={line.id} data-sfx="none">
              <span>Запустить</span> <b>{planAmount(line.startable)}</b>
              {state === 'part' ? <small>из {planAmount(line.missing)}</small> : null}
            </button>
            <small className={`fplan-lane__hint ${state === 'part' ? 'is-warn' : ''}`}>{state === 'part' ? hold : buildTime(line.buildMs)}</small>
          </>
        )}
      </div>
      <button type="button" className="fplan-lane__remove" onClick={onRemove} aria-label={`Убрать из плана: ${item.name}`} data-qa-fleet-plan-remove={line.id}>✕</button>
    </li>
  );
}

/** Typed digits stay as typed until the field is left; an emptied field goes back to its number. */
function TargetInput({ value, name, autoFocus, onCommit, qa }: { value: number; name: string; autoFocus: boolean; onCommit: (target: number) => void; qa: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus({ preventScroll: false });
    ref.current?.select();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      className="fplan-lane__input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={`Сколько нужно: ${name}`}
      data-qa-fleet-plan-target={qa}
      value={draft ?? formatNumber(value)}
      onFocus={(event) => { setDraft(String(value)); requestAnimationFrame(() => event.target.select()); }}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(0, MAX_TARGET_DIGITS);
        setDraft(digits);
        const parsed = Number(digits);
        if (parsed > 0) onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  );
}
