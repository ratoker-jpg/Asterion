import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { getFactionShipCatalog } from '../../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../../domain/combat/factions.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import { localizeBuildingNames, type BuildingRole, type BuildingZone } from '../../domain/buildings/balance-v1.ts';
import { getBuildingDefinition, getBuildingsForZone } from '../../domain/buildings/resource-zone.ts';
import type { TestTimeScale, RuntimeMode } from '../../domain/runtime/mode.ts';
import { SCIENCE_CATALOG } from '../../domain/science/catalog.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { SaveState } from '../../application/contracts.ts';
import { previewBuilding } from '../../application/buildings.ts';
import { buildEmpireOverview, cargoHullsOnPlanet, EMPIRE_RESOURCES, holdOf, planGatherLoads, type EmpirePlanetRow, type EmpireResource } from '../../application/empire.ts';
import { getPlayerFlightSlotUsage, type DispatchFlightCommand } from '../../application/flights.ts';
import type { QuickLegOutcome, QuickTarget } from '../../application/quick-actions.ts';
import { QuickSendPanel, quickRuntimeNow } from '../quick-send/QuickSendPanel.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import './empire.css';

const number = new Intl.NumberFormat('ru-RU');
const RESOURCE_LABELS: Record<EmpireResource, string> = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ' };
const ZONES: { id: BuildingZone; label: string }[] = [
  { id: 'resource', label: 'Ресурсная' },
  { id: 'industry', label: 'Промышленная' },
  { id: 'military', label: 'Военная' },
];
const MISSION_LABELS: Partial<Record<string, string>> = {
  transport: 'транспорт', deployment: 'перебазирование', gas: 'сбор газа', recycle: 'обломки', attack: 'атака',
  espionage: 'шпионаж', colonize: 'колонизация', expedition: 'экспедиция', 'exploration-recon': 'разведка', 'pirate-recon': 'разведка', 'pirate-elimination': 'рейд',
};

/** «12,4 млн» above a million, exact digits below it. */
export function compactAmount(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n < 1_000_000) return number.format(n);
  const millions = n / 1_000_000;
  if (millions < 1_000) return `${millions.toLocaleString('ru-RU', { maximumFractionDigits: millions < 100 ? 1 : 0 })} млн`;
  return `${(millions / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млрд`;
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export type EmpireViewProps = {
  state: SaveState;
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
  planetArt: Record<string, string>;
  /** Select the planet and show «Текущая планета». */
  onOpenPlanet: (planetId: string) => void;
  /** Queue one building on that planet; false when refused (App shows why). */
  onBuild: (planetId: string, role: BuildingRole) => boolean;
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
};

type Drawer = { targetId: string; mode: 'transport' | 'deployment'; origins?: string[] };
type Picker = { planetId: string; left: number; top: number; zone: BuildingZone };

function ownTarget(state: SaveState, planetId: string, art: string): QuickTarget {
  const planet = state.planets[planetId]!;
  return {
    node: {
      id: planetId, kind: 'player', name: planet.name, art, ownerId: state.profile.playerId, isHomeworld: planetId === 'helion-01',
      statusLabel: planetId === 'helion-01' ? 'Основная планета' : 'Колония', description: '',
      coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
    },
    relation: 'self',
  };
}

/**
 * «Империя»: all own planets as lanes. Each lane reads the planet's own
 * wallet, storage, queues and hangar; «+» queues a building on that planet
 * through the same command as the zone screen, and «Сюда» opens the
 * quick-send panel with this planet as the target and the others as sources.
 */
export function EmpireView({ state, now, mode, testTimeScale, planetArt, onOpenPlanet, onBuild, onSend }: EmpireViewProps) {
  const overview = useMemo(() => buildEmpireOverview(state, { now, mode, testTimeScale }), [state, now, mode, testTimeScale]);
  const factionId = state.profile.factionId as CombatFactionId;
  const ships = useMemo(() => new Map(getFactionShipCatalog(factionId).map((ship) => [ship.id as ShipId, ship])), [factionId]);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const home = overview.rows[0];

  const openPicker = (planetId: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setDrawer(null);
    setPicker((current) => (current?.planetId === planetId ? null : { planetId, left: rect.right + 10, top: rect.top + rect.height / 2, zone: current?.zone ?? 'resource' }));
  };
  const openDrawer = (next: Drawer) => { setPicker(null); setDrawer(next); };

  return (
    <section className="empire" data-qa-empire aria-label="Империя: все планеты">
      <div className="empire__sum" data-qa-empire-summary data-toast-guard>
        {EMPIRE_RESOURCES.map((key) => (
          <div key={key} className="empire__sum-res">
            <ResourceIcon kind={key} />
            <span><small>{RESOURCE_LABELS[key]}</small><b>{compactAmount(overview.totals[key].amount)}</b></span>
            <em>+{compactAmount(overview.totals[key].perHour)}/ч</em>
          </div>
        ))}
        <div className="empire__sum-stat"><small>Стройка</small><b>{overview.queueUsed} / {overview.queueCapacity}</b></div>
        <div className={`empire__sum-stat ${overview.idleCount ? 'is-warn' : ''}`} data-qa-empire-idle={overview.idleCount}><small>Стройка стоит</small><b>{overview.idleCount ? `${overview.idleCount} ${overview.idleCount === 1 ? 'планета' : overview.idleCount < 5 ? 'планеты' : 'планет'}` : 'нигде'}</b></div>
        <div className="empire__sum-stat"><small>Наука</small><b>{overview.researchCount ? `${overview.researchCount} в работе` : 'свободна'}</b></div>
        <div className="empire__sum-stat"><small>Рейсы</small><b>{overview.flightsInAir ? `${overview.flightsInAir} в полёте` : 'нет'}</b></div>
      </div>

      <div className="empire__cols" aria-hidden="true" data-toast-guard>
        <span>Планета</span>{EMPIRE_RESOURCES.map((key) => <span key={key}>{RESOURCE_LABELS[key]}</span>)}<span>Стройка</span><span>Наука и верфь</span><span>Флот</span><span />
      </div>

      <ol className="empire__lanes" style={{ '--empire-rows': overview.rows.length } as CSSProperties}>
        {overview.rows.map((row, index) => (
          <Lane key={row.id} row={row} index={index} now={now} art={planetArt[row.id]} factionId={factionId} ships={ships}
            picking={picker?.planetId === row.id} targeted={drawer?.targetId === row.id}
            onOpen={() => onOpenPlanet(row.id)}
            onPick={(anchor) => openPicker(row.id, anchor)}
            onGather={() => openDrawer({ targetId: row.id, mode: 'transport' })}
            onSendFrom={() => openDrawer({ targetId: row.id === home?.id ? overview.rows[1]?.id ?? row.id : home!.id, mode: 'transport', origins: [row.id] })} />
        ))}
      </ol>

      {home && overview.rows.length > 1 ? (
        <footer className="empire__foot">
          <button type="button" className="empire__btn empire__btn--pri" onClick={() => openDrawer({ targetId: home.id, mode: 'transport' })} data-qa-empire-gather="transport">
            Свезти ресурсы на {home.name}
          </button>
          <button type="button" className="empire__btn" onClick={() => openDrawer({ targetId: home.id, mode: 'deployment' })} data-qa-empire-gather="deployment">
            Собрать флот на {home.name}
          </button>
          <span className="empire__hint">Каждая отправка — обычный рейс: правила полётов те же, лимит рейсов общий.</span>
        </footer>
      ) : null}

      {picker ? (
        <BuildPicker state={state} picker={picker} now={now} mode={mode} testTimeScale={testTimeScale}
          onZone={(zone) => setPicker({ ...picker, zone })} onClose={() => setPicker(null)} onBuild={(role) => onBuild(picker.planetId, role)} />
      ) : null}

      {drawer ? createPortal(
        <EmpireDrawer key={`${drawer.targetId}:${drawer.mode}`} state={state} drawer={drawer} planetArt={planetArt} rows={overview.rows}
          onTarget={(targetId) => setDrawer({ ...drawer, targetId, origins: drawer.origins?.filter((id) => id !== targetId) })}
          onMode={(next) => setDrawer({ ...drawer, mode: next })}
          onClose={() => setDrawer(null)} onSend={onSend} />,
        document.body,
      ) : null}
    </section>
  );
}

type LaneProps = {
  row: EmpirePlanetRow;
  index: number;
  now: number;
  art?: string;
  factionId: CombatFactionId;
  ships: Map<ShipId, ReturnType<typeof getFactionShipCatalog>[number]>;
  picking: boolean;
  targeted: boolean;
  onOpen: () => void;
  onPick: (anchor: HTMLElement) => void;
  onGather: () => void;
  onSendFrom: () => void;
};

function Lane({ row, index, now, art, factionId, ships, picking, targeted, onOpen, onPick, onGather, onSendFrom }: LaneProps) {
  const active = row.queue[0];
  const activeDef = active ? getBuildingDefinition(active.assetRole, factionId) : null;
  const progress = active ? Math.min(1, Math.max(0, (now - active.startedAt) / Math.max(1, active.finishAt - active.startedAt))) : 0;
  const fleet = (Object.entries(row.ships) as [ShipId, number][]).sort((a, b) => b[1] - a[1]);
  const research = row.research[0];
  const science = research ? SCIENCE_CATALOG.find((item) => item.id === research.scienceId) : null;
  const order = row.shipyard[0];
  const out = row.flights.filter((flight) => flight.direction === 'out');
  const incoming = row.flights.filter((flight) => flight.direction === 'in');
  const free = row.queueCapacity - row.queue.length;
  return (
    <li className={`empire-lane ${row.isCurrent ? 'is-current' : ''} ${row.idle ? 'is-idle' : ''} ${targeted ? 'is-target' : ''}`}
      style={{ '--lane-i': index } as CSSProperties} data-qa-empire-row={row.id}>
      <button type="button" className="empire-lane__planet" onClick={onOpen} aria-label={`Открыть планету ${row.name}`} data-qa-empire-open={row.id}>
        {art ? <img src={art} alt="" draggable={false} /> : <i />}
        <span>
          <b title={row.name}>{row.name}</b>
          <small>{formatUniverseCoordinate(row.coordinate)}{row.isCurrent ? ' · вы здесь' : ''}</small>
        </span>
      </button>

      {EMPIRE_RESOURCES.map((key) => {
        const cell = row.resources[key];
        const tone = cell.full ? 'full' : cell.fill >= 0.9 ? 'near' : 'ok';
        return (
          <div key={key} className={`empire-res empire-res--${key} is-${tone}`} data-qa-empire-res={key} data-qa-empire-fill={tone}>
            <b>{compactAmount(cell.amount)}</b>
            <span className="empire-res__bar" role="meter" aria-valuemin={0} aria-valuemax={cell.capacity} aria-valuenow={cell.amount}
              aria-label={`${RESOURCE_LABELS[key]}: ${number.format(cell.amount)} из ${number.format(cell.capacity)}`}><i style={{ '--fill': cell.fill } as CSSProperties} /></span>
            <small><em>{cell.perHour > 0 ? `+${compactAmount(cell.perHour)}/ч` : 'нет добычи'}</em> · {cell.full ? 'склад полон' : `из ${compactAmount(cell.capacity)}`}</small>
          </div>
        );
      })}

      <div className="empire-queue" data-qa-empire-queue={row.queue.length}>
        <div className="empire-queue__slots">
          {Array.from({ length: row.queueCapacity }, (_, slot) => {
            const item = row.queue[slot];
            if (item) {
              const def = getBuildingDefinition(item.assetRole, factionId);
              return (
                <span key={item.id} className={`empire-slot ${slot === 0 ? 'is-active' : ''}`} style={slot === 0 ? { '--progress': progress } as CSSProperties : undefined}>
                  <img src={def.art} alt="" draggable={false} /><em>{item.targetLevel}</em>
                </span>
              );
            }
            const first = slot === row.queue.length;
            return first && !row.blocked ? (
              <button key={`free-${slot}`} type="button" className={`empire-slot empire-slot--add ${picking ? 'is-open' : ''}`} aria-label={`Добавить стройку: ${row.name}`} aria-expanded={picking}
                onClick={(event) => onPick(event.currentTarget)} data-qa-empire-add={row.id}>+</button>
            ) : <span key={`free-${slot}`} className="empire-slot empire-slot--free" />;
          })}
        </div>
        <small className={row.idle ? 'is-warn' : ''}>
          {row.blocked ? 'планета перенаселена' : activeDef ? `${activeDef.name} · ${countdown(active!.finishAt - now)}` : 'стройка стоит'}
          {!row.idle && free > 0 && !row.blocked ? ` · свободно ${free}` : ''}
        </small>
      </div>

      <div className="empire-work">
        <span className={research ? '' : 'is-off'}>{science ? <><b>{science.name} {research!.toLevel}</b> · {countdown(research!.finishAt - now)}</> : 'лаборатория свободна'}</span>
        <span className={order ? '' : 'is-off'}>{order ? <><b>{ships.get(order.itemId as ShipId)?.name ?? order.itemId} ×{number.format(order.quantity - order.completedQuantity)}</b> · {countdown(order.finishAt - now)}</> : 'верфь свободна'}</span>
      </div>

      <div className="empire-fleet">
        {fleet.length ? (
          <span className="empire-fleet__ships" aria-label={`Флот на орбите: ${number.format(row.shipCount)}`}>
            {fleet.slice(0, 2).map(([id, count]) => (
              <span key={id} title="">{ships.get(id)?.art ? <img src={ships.get(id)!.art} alt="" draggable={false} /> : null}<b>{compactAmount(count)}</b><i className="sr">{ships.get(id)?.name}</i></span>
            ))}
            {fleet.length > 2 ? <em>+{fleet.length - 2}</em> : null}
          </span>
        ) : <span className="empire-fleet__none">на орбите пусто</span>}
        <small>
          {out.length ? `↗ ${out.length} ${MISSION_LABELS[out[0]!.missionId] ?? 'рейс'}${out.length > 1 ? ' и др.' : ''}` : ''}
          {out.length && incoming.length ? ' · ' : ''}
          {incoming.length ? `↘ летят сюда: ${incoming.length}` : ''}
          {!out.length && !incoming.length ? 'рейсов нет' : ''}
        </small>
      </div>

      <div className="empire-lane__acts">
        <button type="button" className="empire__btn empire__btn--pri" onClick={onGather} data-qa-empire-here={row.id}>Сюда</button>
        <button type="button" className="empire__btn" onClick={onSendFrom} data-qa-empire-from={row.id}>Отсюда</button>
      </div>
    </li>
  );
}

function BuildPicker({ state, picker, now, mode, testTimeScale, onZone, onClose, onBuild }: {
  state: SaveState; picker: Picker; now: number; mode: RuntimeMode; testTimeScale: TestTimeScale;
  onZone: (zone: BuildingZone) => void; onClose: () => void; onBuild: (role: BuildingRole) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const factionId = state.profile.factionId;
  const planet = state.planets[picker.planetId];
  const queue = state.queues[picker.planetId] ?? [];
  const [justQueued, setJustQueued] = useState<BuildingRole | null>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!ref.current?.contains(target as Node) && !target?.closest('[data-qa-empire-add]')) onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-qa-empire-build]:not([aria-disabled="true"])')?.focus({ preventScroll: true }); }, [picker.zone]);
  useEffect(() => {
    if (!justQueued) return;
    const timer = window.setTimeout(() => setJustQueued(null), 700);
    return () => window.clearTimeout(timer);
  }, [justQueued]);
  if (!planet) return null;
  // Beside the slot, vertically centred on it and kept on screen.
  const height = Math.min(420, window.innerHeight - 24);
  const top = Math.min(Math.max(12, picker.top - height / 2), window.innerHeight - height - 12);
  const left = Math.min(picker.left, window.innerWidth - 392);
  const context = { planetId: picker.planetId, now, mode, testTimeScale };
  const all = getBuildingsForZone(picker.zone, factionId).map((def) => ({ def, availability: previewBuilding(state, context, def.assetRole).availability }));
  // Buildable first, then the ones waiting for resources; locked and maxed ones are only counted.
  const items = all.filter(({ availability }) => availability.canBuild || availability.status === 'insufficient-resource' || availability.status === 'queue-full')
    .sort((a, b) => Number(b.availability.canBuild) - Number(a.availability.canBuild));
  const locked = all.length - items.length;
  return createPortal(
    <div ref={ref} className="empire-pick" style={{ left, top, maxHeight: height }} role="dialog" aria-label={`Стройка на планете ${planet.name}`} data-qa-empire-picker={picker.planetId}>
      <header>
        <b>{planet.name}</b>
        <span>очередь {queue.length} / 3</span>
        <button type="button" onClick={onClose} aria-label="Закрыть">✕</button>
      </header>
      <nav role="tablist" aria-label="Зона">
        {ZONES.map((zone) => (
          <button key={zone.id} type="button" role="tab" aria-selected={picker.zone === zone.id} className={picker.zone === zone.id ? 'is-on' : ''} onClick={() => onZone(zone.id)}>{zone.label}</button>
        ))}
      </nav>
      <ul>
        {items.map(({ def, availability }) => {
          const reason = availability.reason ? localizeBuildingNames(availability.reason, factionId) : null;
          const level = availability.nextLevel;
          return (
            <li key={def.assetRole}>
              <button type="button" aria-disabled={!availability.canBuild} className={`${availability.canBuild ? '' : 'is-off'} ${justQueued === def.assetRole ? 'is-done' : ''}`}
                onClick={() => { if (availability.canBuild && onBuild(def.assetRole)) setJustQueued(def.assetRole); }} data-qa-empire-build={def.assetRole}>
                <img src={def.art} alt="" draggable={false} />
                <span>
                  <b>{def.name}</b>
                  <small>{level == null ? 'максимальный уровень' : availability.currentLevel > 0 || availability.projectedLevel > 0 ? `ур. ${level - 1} → ${level}` : 'построить'}</small>
                </span>
                <span className="empire-pick__cost">
                  {availability.canBuild || availability.status === 'insufficient-resource'
                    ? (['metal', 'minerals', 'gas'] as const).filter((key) => (availability.cost?.[key] ?? 0) > 0).map((key) => (
                      <em key={key} className={availability.missing[key] ? 'is-short' : ''}><ResourceIcon kind={key} />{compactAmount(availability.cost![key])}</em>
                    ))
                    : <em className="is-reason">{reason}</em>}
                </span>
              </button>
            </li>
          );
        })}
        {items.length === 0 ? <li className="empire-pick__empty">Здесь пока нечего строить.</li> : null}
        {locked > 0 ? <li className="empire-pick__locked">Ещё {locked} — откроются после других зданий и наук</li> : null}
      </ul>
    </div>,
    document.body,
  );
}

/**
 * Sources checked when the drawer opens: as many as there are free flights
 * (the «Компьютерные системы» limit), the ones that can carry the most first
 * (resources: what their transports hold; fleet: ships on orbit).
 */
function defaultOrigins(state: SaveState, rows: EmpirePlanetRow[], drawer: Drawer): string[] {
  const free = Math.max(1, getPlayerFlightSlotUsage(state).free);
  const weight = (row: EmpirePlanetRow) => drawer.mode === 'deployment'
    ? row.shipCount
    : Math.min(EMPIRE_RESOURCES.reduce((sum, key) => sum + row.resources[key].amount, 0), holdOf(cargoHullsOnPlanet(state, row.id), Object.fromEntries(cargoHullsOnPlanet(state, row.id).map((hull) => [hull.shipId, hull.free]))));
  return rows.filter((row) => row.id !== drawer.targetId && weight(row) > 0)
    .sort((a, b) => weight(b) - weight(a)).slice(0, free).map((row) => row.id);
}

function EmpireDrawer({ state, drawer, planetArt, rows, onTarget, onMode, onClose, onSend }: {
  state: SaveState; drawer: Drawer; planetArt: Record<string, string>; rows: EmpirePlanetRow[];
  onTarget: (planetId: string) => void; onMode: (mode: Drawer['mode']) => void; onClose: () => void;
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
}) {
  const target = useMemo(() => ownTarget(state, drawer.targetId, planetArt[drawer.targetId] ?? ''), [state, drawer.targetId, planetArt]);
  const [origins] = useState(() => drawer.origins ?? defaultOrigins(state, rows, drawer));
  const targetRow = rows.find((row) => row.id === drawer.targetId);
  const full = targetRow ? EMPIRE_RESOURCES.filter((key) => targetRow.resources[key].full) : [];
  const notice = drawer.mode !== 'transport' || full.length === 0 ? null
    : full.length === EMPIRE_RESOURCES.length ? `Склады ${targetRow!.name} полны — везти некуда. Выберите другую планету.`
      : `Склад полон: ${full.map((key) => RESOURCE_LABELS[key].toLowerCase()).join(', ')} — это не повезём.`;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside className="empire-drawer" aria-label="Логистика" data-qa-empire-drawer={drawer.mode}>
      <div className="empire-drawer__top">
        <small>Куда</small>
        <div className="empire-drawer__targets" role="radiogroup" aria-label="Планета назначения">
          {rows.map((row) => (
            <button key={row.id} type="button" role="radio" aria-checked={row.id === drawer.targetId} className={row.id === drawer.targetId ? 'is-on' : ''}
              onClick={() => onTarget(row.id)} data-qa-empire-target={row.id}>
              {planetArt[row.id] ? <img src={planetArt[row.id]} alt="" draggable={false} /> : null}<span>{row.name}</span>
            </button>
          ))}
        </div>
        <div className="empire-drawer__modes" role="tablist" aria-label="Что везти">
          <button type="button" role="tab" aria-selected={drawer.mode === 'transport'} className={drawer.mode === 'transport' ? 'is-on' : ''} onClick={() => onMode('transport')}>Ресурсы</button>
          <button type="button" role="tab" aria-selected={drawer.mode === 'deployment'} className={drawer.mode === 'deployment' ? 'is-on' : ''} onClick={() => onMode('deployment')}>Флот</button>
        </div>
      </div>
      <QuickSendPanel state={state} actionId={drawer.mode} target={target}
        initialOrigins={origins} onSend={onSend} onClose={onClose} notice={notice}
        gatherLoads={(ids, keep) => planGatherLoads(state, target, ids, keep, quickRuntimeNow())} />
    </aside>
  );
}

/** «Текущая планета / Империя» switch at the top of the «Планета» workspace. */
export function PlanetSections({ section, planetCount, idleCount, onChange }: {
  section: 'current' | 'empire'; planetCount: number; idleCount: number; onChange: (section: 'current' | 'empire') => void;
}) {
  return (
    <div className="planet-sections" role="tablist" aria-label="Раздел планеты" data-qa-planet-sections={section}>
      <button type="button" role="tab" aria-selected={section === 'current'} onClick={() => onChange('current')} data-qa-planet-section="current">Текущая планета</button>
      <button type="button" role="tab" aria-selected={section === 'empire'} onClick={() => onChange('empire')} data-qa-planet-section="empire">
        Империя · {planetCount}{idleCount > 0 && planetCount > 1 ? <em aria-label={`стройка стоит на ${idleCount}`}>●&nbsp;{idleCount}</em> : null}
      </button>
    </div>
  );
}
