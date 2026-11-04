import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../../domain/combat/faction-catalog.ts';
import { COMMANDER_COMBAT_CATALOG } from '../../domain/combat/catalog.ts';
import type { CombatFactionId } from '../../domain/combat/factions.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import type { BuildingRole, BuildingZone } from '../../domain/buildings/balance-v1.ts';
import { getBuildingDefinition, getBuildingsForZone } from '../../domain/buildings/resource-zone.ts';
import type { FleetProductionOrder } from '../../domain/fleet/production.ts';
import type { TestTimeScale, RuntimeMode } from '../../domain/runtime/mode.ts';
import { SCIENCE_CATALOG } from '../../domain/science/catalog.ts';
import { formatUniverseCoordinate } from '../../domain/universe/runtime.ts';
import type { SaveState } from '../../application/contracts.ts';
import { adviseEmptyGather, buildEmpireOverview, cargoHullsOnPlanet, EMPIRE_RESOURCES, holdOf, planGatherLoads, type EmpireFlight, type EmpireOverview, type EmpirePlanetRow, type EmpireProductionKind, type EmpireResource } from '../../application/empire.ts';
import { getPlayerFlightSlotUsage, type DispatchFlightCommand } from '../../application/flights.ts';
import type { QuickLegOutcome, QuickTarget } from '../../application/quick-actions.ts';
import { QuickSendPanel, quickRuntimeNow } from '../quick-send/QuickSendPanel.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import { compactAmount, countdown, formatNumber, plural, signedAmount, taskProgress } from './empire-format.ts';
import { BUILD_ZONES, BuildPicker, ProductionPicker, type BuildPickerState, type ProductionPickerState } from './EmpirePickers.tsx';
import './empire.css';

const RESOURCE_LABELS: Record<EmpireResource, string> = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ' };
const MISSION_LABELS: Partial<Record<string, string>> = {
  transport: 'Транспорт', deployment: 'Перебазирование', gas: 'Сбор газа', recycle: 'Обломки', attack: 'Атака',
  espionage: 'Шпионаж', colonize: 'Колонизация', expedition: 'Экспедиция', 'exploration-recon': 'Разведка', 'pirate-recon': 'Разведка', 'pirate-elimination': 'Пиратский рейд',
};
const SHOWN_SHIPS = 6;
const SHOWN_FLIGHTS = 3;

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
  onCancelBuilding: (planetId: string, queueId: string) => boolean;
  /** Order ships or defence on that planet's shipyard; false when refused (App shows why). */
  onProduce: (planetId: string, kind: EmpireProductionKind, itemId: string, quantity: number) => boolean;
  onCancelProduction: (planetId: string, orderId: string) => void;
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
};

type Drawer = { targetId: string; mode: 'transport' | 'deployment'; origins?: string[] };
type Unit = { name: string; art: string };

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

function Bar({ value }: { value: number }) {
  return <span className="empire-bar" aria-hidden="true"><i style={{ '--fill': value } as CSSProperties} /></span>;
}

/**
 * «Империя»: all own planets as rows. A collapsed row answers «what is going
 * on here»; a click opens the planet's panel, where everything on that planet
 * can be done without leaving the console. Every action goes through the same
 * command as its own screen.
 */
export function EmpireView({ state, now, mode, testTimeScale, planetArt, onOpenPlanet, onBuild, onCancelBuilding, onProduce, onCancelProduction, onSend }: EmpireViewProps) {
  const overview = useMemo(() => buildEmpireOverview(state, { now, mode, testTimeScale }), [state, now, mode, testTimeScale]);
  const factionId = state.profile.factionId as CombatFactionId;
  const units = useMemo(() => new Map<string, Unit>([...getFactionShipCatalog(factionId), ...getFactionDefenseCatalog(factionId), ...COMMANDER_COMBAT_CATALOG].map((entity) => [entity.id, { name: entity.name, art: entity.art }])), [factionId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [picker, setPicker] = useState<BuildPickerState | null>(null);
  const [yard, setYard] = useState<ProductionPickerState | null>(null);
  const yardName = getBuildingDefinition('shipyard', factionId).name;
  const current = overview.rows.find((row) => row.isCurrent) ?? overview.rows[0];
  const anyHome = overview.rows[0];

  const openPicker = (planetId: string, anchor: HTMLElement, zone?: BuildingZone) => {
    const rect = anchor.getBoundingClientRect();
    setDrawer(null);
    setYard(null);
    setPicker((was) => (was?.planetId === planetId && (!zone || was.zone === zone) ? null : { planetId, left: rect.right + 10, top: rect.top + rect.height / 2, zone: zone ?? was?.zone ?? 'resource' }));
  };
  const openYard = (planetId: string, kind: EmpireProductionKind, anchor: HTMLElement, focus?: string) => {
    const rect = anchor.getBoundingClientRect();
    setDrawer(null);
    setPicker(null);
    setYard((was) => (was?.planetId === planetId && was.kind === kind && !focus ? null : { planetId, kind, left: rect.right + 10, top: rect.top + rect.height / 2, focus }));
  };
  const openDrawer = (next: Drawer) => { setPicker(null); setYard(null); setDrawer(next); };

  return (
    <section className="empire" data-qa-empire aria-label="Империя: все планеты">
      <EmpireSummary overview={overview} state={state} now={now} yardName={yardName} />

      <ol className="empire__lanes">
        {/* Inside the scrolling list, so the captions keep the rows' exact columns and stay on top. */}
        <li className="empire__cols" aria-hidden="true" data-toast-guard>
          <span>Планета</span>{EMPIRE_RESOURCES.map((key) => <span key={key}>{RESOURCE_LABELS[key]}</span>)}<span>Энергия</span><span>Стройка</span><span>{yardName}</span><span>Флот</span><span />
        </li>
        {overview.rows.map((row, index) => (
          <Lane key={row.id} row={row} index={index} now={now} art={planetArt[row.id]} factionId={factionId} units={units} state={state}
            open={openId === row.id} single={overview.rows.length < 2} targeted={drawer?.targetId === row.id}
            onToggle={() => setOpenId((was) => (was === row.id ? null : row.id))}
            onOpenPlanet={() => onOpenPlanet(row.id)}
            onPick={(anchor, zone) => openPicker(row.id, anchor, zone)}
            onYard={(kind, anchor) => openYard(row.id, kind, anchor)}
            onCancelBuilding={(queueId) => onCancelBuilding(row.id, queueId)}
            onCancelProduction={(orderId) => onCancelProduction(row.id, orderId)}
            onGather={(gather) => openDrawer({ targetId: row.id, mode: gather })}
            onSendFrom={() => openDrawer({ targetId: row.id === anyHome?.id ? overview.rows[1]?.id ?? row.id : anyHome!.id, mode: 'transport', origins: [row.id] })} />
        ))}
      </ol>

      {current && overview.rows.length > 1 ? (
        <footer className="empire__foot">
          <button type="button" className="empire__btn empire__btn--pri" onClick={() => openDrawer({ targetId: current.id, mode: 'transport' })} data-qa-empire-gather="transport">
            Свезти ресурсы на планету
          </button>
          <button type="button" className="empire__btn" onClick={() => openDrawer({ targetId: current.id, mode: 'deployment' })} data-qa-empire-gather="deployment">
            Собрать флот на планету
          </button>
          <span className="empire__hint">Планету назначения выберете в панели. Каждая отправка занимает один рейс.</span>
        </footer>
      ) : null}

      {picker ? (
        <BuildPicker state={state} picker={picker} now={now} mode={mode} testTimeScale={testTimeScale}
          onZone={(zone) => setPicker({ ...picker, zone })} onClose={() => setPicker(null)} onBuild={(role) => onBuild(picker.planetId, role)} />
      ) : null}

      {yard ? (
        <ProductionPicker state={state} picker={yard} now={now} mode={mode} testTimeScale={testTimeScale}
          onKind={(kind) => setYard({ ...yard, kind, focus: undefined })} onClose={() => setYard(null)} onProduce={(kind, itemId, quantity) => onProduce(yard.planetId, kind, itemId, quantity)} />
      ) : null}

      {drawer ? createPortal(
        <EmpireDrawer key={`${drawer.targetId}:${drawer.mode}`} state={state} drawer={drawer} planetArt={planetArt} rows={overview.rows} now={now} runtimeMode={mode} testTimeScale={testTimeScale}
          onTarget={(targetId) => setDrawer({ ...drawer, targetId, origins: drawer.origins?.filter((id) => id !== targetId) })}
          onMode={(next) => setDrawer({ ...drawer, mode: next })}
          onBuildShips={(planetId, shipId, anchor) => openYard(planetId, 'ships', anchor, shipId)}
          onClose={() => setDrawer(null)} onSend={onSend} />,
        document.body,
      ) : null}
    </section>
  );
}

function SummaryCell({ label, value, note, tone, children }: { label: string; value: string; note: string; tone?: 'ok' | 'warn' | 'bad'; children?: ReactNode }) {
  return (
    <div className="empire__sum-cell">
      {children}
      <span>
        <small>{label}</small>
        <b>{value}</b>
        <small className={tone ? `is-${tone}` : ''}>{note}</small>
      </span>
    </div>
  );
}

function EmpireSummary({ overview, state, now, yardName }: { overview: EmpireOverview; state: SaveState; now: number; yardName: string }) {
  const count = overview.rows.length;
  const research = [...state.science.queue].sort((a, b) => a.finishAt - b.finishAt)[0];
  const science = research ? SCIENCE_CATALOG.find((item) => item.id === research.scienceId) : null;
  const moreResearch = overview.researchCount - 1;
  return (
    <div className="empire__sum" data-qa-empire-summary data-toast-guard>
      <div className="empire__sum-title"><b>Вся империя</b><small>{count} {plural(count, 'планета', 'планеты', 'планет')}</small></div>
      {EMPIRE_RESOURCES.map((key) => (
        <SummaryCell key={key} label={RESOURCE_LABELS[key]} value={compactAmount(overview.totals[key].amount)} note={`+${compactAmount(overview.totals[key].perHour)} в час`} tone="ok">
          <ResourceIcon kind={key} />
        </SummaryCell>
      ))}
      <SummaryCell label="Энергия свободно" value={signedAmount(overview.energy.available)} note={`из ${compactAmount(overview.energy.produced)}`} tone={overview.energy.available < 0 ? 'bad' : undefined}>
        <ResourceIcon kind="energy" />
      </SummaryCell>
      <div data-qa-empire-idle={overview.idleCount}>
        <SummaryCell label="Стройка" value={`занято ${overview.queueUsed} из ${overview.queueCapacity}`}
          note={overview.idleCount ? `не строит: ${overview.idleCount} ${plural(overview.idleCount, 'планета', 'планеты', 'планет')}` : 'строят все планеты'} tone={overview.idleCount ? 'warn' : undefined} />
      </div>
      <SummaryCell label={yardName} value={`занято ${overview.shipyardsBusy} из ${count}`} note={overview.shipyardsBusy ? `свободно: ${count - overview.shipyardsBusy}` : 'заказов нет'} />
      <SummaryCell label="Наука" value={science ? `${science.name} ${research!.toLevel}` : 'не идёт'} note={science ? `${countdown(research!.finishAt - now)}${moreResearch > 0 ? ` · ещё ${moreResearch}` : ''}` : 'ничего не изучается'} />
      <SummaryCell label="Рейсы" value={`${overview.flightSlots.used} из ${overview.flightSlots.limit}`} note={`свободно: ${overview.flightSlots.free}`} />
    </div>
  );
}

type LaneProps = {
  row: EmpirePlanetRow;
  state: SaveState;
  index: number;
  now: number;
  art?: string;
  factionId: CombatFactionId;
  units: Map<string, Unit>;
  open: boolean;
  single: boolean;
  targeted: boolean;
  onToggle: () => void;
  onOpenPlanet: () => void;
  onPick: (anchor: HTMLElement, zone?: BuildingZone) => void;
  onYard: (kind: EmpireProductionKind, anchor: HTMLElement) => void;
  onCancelBuilding: (queueId: string) => boolean;
  onCancelProduction: (orderId: string) => void;
  onGather: (mode: 'transport' | 'deployment') => void;
  onSendFrom: () => void;
};

/** One line of work in a collapsed row: what is running, its progress, the time left, what follows. */
function WorkCell({ qa, count, art, title, level, timer, progress, more, empty, action }: {
  qa: Record<string, number>; count: number; art?: string; title?: string; level?: string; timer?: string; progress?: number; more?: string; empty: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={`empire-work ${count ? '' : 'is-empty'}`} {...Object.fromEntries(Object.entries(qa).map(([key, value]) => [`data-qa-${key}`, value]))}>
      {count ? (
        <>
          {art ? <img src={art} alt="" draggable={false} /> : null}
          <span className="empire-work__body">
            <span className="empire-work__title"><b>{title}</b>{level ? <em>{level}</em> : null}</span>
            <Bar value={progress ?? 0} />
            <small><time>{timer}</time>{more ? ` · ${more}` : ''}</small>
          </span>
        </>
      ) : <span className="empire-work__idle">{empty}</span>}
      {action}
    </div>
  );
}

function orderTitle(order: FleetProductionOrder, units: Map<string, Unit>) {
  return `${units.get(order.itemId)?.name ?? order.itemId} ×${formatNumber(Math.max(0, order.quantity - order.completedQuantity))}`;
}

function Lane({ row, state, index, now, art, factionId, units, open, single, targeted, onToggle, onOpenPlanet, onPick, onYard, onCancelBuilding, onCancelProduction, onGather, onSendFrom }: LaneProps) {
  const rootRef = useRef<HTMLLIElement>(null);
  // The panel stays mounted while it folds away, and the opened row scrolls fully into view.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const timer = window.setTimeout(() => rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 340);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setMounted(false), 340);
    return () => window.clearTimeout(timer);
  }, [open]);

  const active = row.queue[0];
  const activeDef = active ? getBuildingDefinition(active.assetRole, factionId) : null;
  const orders = [...row.shipyard, ...row.defense, ...row.commanders];
  const order = orders[0];
  const orderArt = order ? units.get(order.itemId)?.art : undefined;
  const fleet = (Object.entries(row.ships) as [ShipId, number][]).sort((a, b) => b[1] - a[1]);
  const out = row.flights.filter((flight) => flight.direction === 'out');
  const incoming = row.flights.filter((flight) => flight.direction === 'in');
  const free = row.queueCapacity - row.queue.length;
  const hasYard = row.shipyardLevel > 0;
  const yardName = getBuildingDefinition('shipyard', factionId).name;
  const toggleFromRow = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).closest('button')) onToggle();
  };
  return (
    <li ref={rootRef} className={`empire-lane ${row.isCurrent ? 'is-current' : ''} ${row.idle ? 'is-idle' : ''} ${targeted ? 'is-target' : ''} ${open ? 'is-open' : ''}`}
      style={{ '--lane-i': index } as CSSProperties} data-qa-empire-row={row.id}>
      <div className="empire-lane__row" onClick={toggleFromRow} data-qa-empire-toggle-row>
        <div className="empire-lane__planet">
          {art ? <img src={art} alt="" draggable={false} /> : <i />}
          <span>
            <b>{row.name}</b>
            <small>{formatUniverseCoordinate(row.coordinate)}{row.isCurrent ? ' · вы здесь' : ''}</small>
          </span>
        </div>

        {EMPIRE_RESOURCES.map((key) => {
          const cell = row.resources[key];
          const tone = cell.full ? 'full' : cell.fill >= 0.9 ? 'near' : 'ok';
          return (
            <div key={key} className={`empire-res empire-res--${key} is-${tone}`} data-qa-empire-res={key} data-qa-empire-fill={tone}>
              <b>{compactAmount(cell.amount)}</b>
              <span className="empire-bar" role="meter" aria-valuemin={0} aria-valuemax={cell.capacity} aria-valuenow={cell.amount}
                aria-label={`${RESOURCE_LABELS[key]}: ${formatNumber(cell.amount)} из ${formatNumber(cell.capacity)}`}><i style={{ '--fill': cell.fill } as CSSProperties} /></span>
              <small>{cell.full ? 'склад полон' : cell.perHour > 0 ? <em>+{compactAmount(cell.perHour)}/ч</em> : 'нет добычи'}</small>
            </div>
          );
        })}

        <div className={`empire-energy ${row.energy.available < 0 ? 'is-bad' : ''}`} data-qa-empire-energy={row.energy.available}>
          <b>{signedAmount(row.energy.available)}</b>
          <small>из {compactAmount(row.energy.produced)}</small>
        </div>

        <WorkCell qa={{ 'empire-queue': row.queue.length }} count={row.queue.length}
          art={activeDef?.art} title={activeDef?.name} level={active ? `ур. ${active.targetLevel}` : undefined}
          timer={active ? countdown(active.finishAt - now) : undefined} progress={active ? taskProgress(now, active.startedAt, active.finishAt) : 0}
          more={row.queue.length > 1 ? `ещё ${row.queue.length - 1} в очереди` : undefined}
          empty={row.blocked ? <span className="is-warn">Планета перенаселена</span> : <span className="is-warn">Стройка стоит</span>}
          action={!row.blocked && free > 0 ? (
            <button type="button" className={`empire-add ${row.idle ? 'is-wide is-warn' : ''}`} aria-label={`Добавить стройку: ${row.name}`} onClick={(event) => onPick(event.currentTarget)} data-qa-empire-add={row.id} data-empire-pick-trigger>
              +{row.idle ? <span>Построить</span> : null}
            </button>
          ) : null} />

        <WorkCell qa={{ 'empire-yard-orders': orders.length }} count={orders.length}
          art={orderArt} title={order ? orderTitle(order, units) : undefined}
          timer={order ? countdown(order.finishAt - now) : undefined} progress={order ? taskProgress(now, order.startedAt, order.finishAt) : 0}
          more={orders.length > 1 ? `ещё ${orders.length - 1}` : undefined}
          empty={hasYard ? `${yardName}: заказов нет` : `${yardName}: не построено`}
          action={hasYard && !row.blocked ? (
            <button type="button" className={`empire-add ${orders.length ? '' : 'is-wide'}`} aria-label={`Заказать корабли: ${row.name}`} onClick={(event) => onYard('ships', event.currentTarget)} data-qa-empire-order={row.id} data-empire-pick-trigger>
              +{orders.length ? null : <span>Заказать</span>}
            </button>
          ) : null} />

        <div className="empire-fleet">
          {fleet.length ? (
            <span className="empire-fleet__ships">
              {units.get(fleet[0]![0])?.art ? <img src={units.get(fleet[0]![0])!.art} alt="" draggable={false} /> : null}
              <b>{compactAmount(row.shipCount)}</b> <span>{plural(row.shipCount, 'корабль', 'корабля', 'кораблей')}</span>
            </span>
          ) : <span className="empire-fleet__none">На орбите пусто</span>}
          <small>
            {out.length ? `в рейсе: ${out.length}` : ''}
            {out.length && incoming.length ? ' · ' : ''}
            {incoming.length ? `летят сюда: ${incoming.length}` : ''}
            {!out.length && !incoming.length ? 'рейсов нет' : ''}
          </small>
        </div>

        <button type="button" className="empire-lane__more" aria-expanded={open} aria-controls={`empire-detail-${row.id}`} onClick={onToggle} data-qa-empire-more={row.id}>
          <span>{open ? 'Свернуть' : 'Подробнее'}</span>
          <i aria-hidden="true" />
        </button>
      </div>

      <div className="empire-lane__fold" id={`empire-detail-${row.id}`} {...(open ? {} : { inert: true })}>
        <div className="empire-lane__fold-inner">
          {mounted ? (
            <PlanetDetail row={row} state={state} now={now} factionId={factionId} units={units} single={single}
              onOpenPlanet={onOpenPlanet} onPick={onPick} onYard={onYard} onCancelBuilding={onCancelBuilding} onCancelProduction={onCancelProduction} onGather={onGather} onSendFrom={onSendFrom} />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TaskLine({ art, title, level, now, startedAt, finishAt, waiting, cancelLabel, onCancel, qa }: {
  art?: string; title: string; level?: string; now: number; startedAt: number; finishAt: number; waiting: boolean; cancelLabel: string; onCancel: () => void; qa?: string;
}) {
  return (
    <li className={`empire-task ${waiting ? 'is-waiting' : ''}`} data-qa-empire-task={qa}>
      {art ? <img src={art} alt="" draggable={false} /> : <i />}
      <span className="empire-task__body">
        <span className="empire-work__title"><b>{title}</b>{level ? <em>{level}</em> : null}</span>
        {waiting ? null : <Bar value={taskProgress(now, startedAt, finishAt)} />}
        <small>{waiting ? 'ждёт очереди · готово через ' : 'осталось '}<time>{countdown(finishAt - now)}</time></small>
      </span>
      <button type="button" className="empire-task__x" aria-label={cancelLabel} onClick={onCancel}>✕</button>
    </li>
  );
}

function flightLine(flight: EmpireFlight, now: number) {
  const mission = MISSION_LABELS[flight.missionId] ?? 'Рейс';
  const time = (flight.phase === 'outbound' ? flight.arrivalAt : flight.returnAt) ?? flight.arrivalAt;
  if (flight.direction === 'in') return { arrow: '↘', text: `${mission}: прибудет через`, time };
  if (flight.phase === 'returning') return { arrow: '↩', text: `${mission}: вернётся через`, time };
  if (flight.phase === 'arrived') return { arrow: '●', text: `${mission}: на месте, вернётся через`, time: time ?? now };
  return { arrow: '↗', text: `${mission}: прибудет через`, time };
}

function PlanetDetail({ row, state, now, factionId, units, single, onOpenPlanet, onPick, onYard, onCancelBuilding, onCancelProduction, onGather, onSendFrom }: {
  row: EmpirePlanetRow; state: SaveState; now: number; factionId: CombatFactionId; units: Map<string, Unit>; single: boolean;
} & Pick<LaneProps, 'onOpenPlanet' | 'onPick' | 'onYard' | 'onCancelBuilding' | 'onCancelProduction' | 'onGather' | 'onSendFrom'>) {
  const levels = state.planets[row.id]?.buildings;
  const built = BUILD_ZONES.flatMap((zone) => getBuildingsForZone(zone.id, factionId)
    .filter((def) => (levels?.[def.assetRole] ?? 0) > 0)
    .map((def) => ({ def, zone: zone.id, level: levels![def.assetRole] })));
  const fleet = (Object.entries(row.ships) as [ShipId, number][]).sort((a, b) => b[1] - a[1]);
  const orderGroups: [string, FleetProductionOrder[]][] = [['Корабли', row.shipyard], ['Оборона', row.defense], ['Командиры', row.commanders]];
  const orders = orderGroups.flatMap(([, list]) => list.map((order, position) => ({ order, waiting: position > 0 })));
  const hasYard = row.shipyardLevel > 0;
  const yardName = getBuildingDefinition('shipyard', factionId).name;
  return (
    <div className="empire-detail" data-qa-empire-detail={row.id}>
      <section className="empire-detail__col">
        <h4>Стройка <span>{row.queue.length} из {row.queueCapacity}</span></h4>
        {row.queue.length ? (
          <ul className="empire-tasks" data-toast-guard>
            {row.queue.map((item, position) => {
              const def = getBuildingDefinition(item.assetRole, factionId);
              return <TaskLine key={item.id} art={def.art} title={def.name} level={`ур. ${item.targetLevel}`} now={now} startedAt={item.startedAt} finishAt={item.finishAt} waiting={position > 0}
                cancelLabel={`Отменить: ${def.name}`} onCancel={() => onCancelBuilding(item.id)} qa="building" />;
            })}
          </ul>
        ) : <p className={row.blocked ? 'is-warn' : ''}>{row.blocked ? 'Планета перенаселена: строить нельзя, пока не улетит часть флота.' : 'Сейчас ничего не строится.'}</p>}
        {row.blocked || row.queue.length >= row.queueCapacity ? null : (
          <button type="button" className="empire__btn empire__btn--pri" onClick={(event) => onPick(event.currentTarget)} data-empire-pick-trigger data-qa-empire-add-detail={row.id}>+ Добавить здание</button>
        )}
      </section>

      <section className="empire-detail__col">
        <h4>{yardName} и оборона <span>{hasYard ? `ур. ${row.shipyardLevel}` : 'не построено'}</span></h4>
        {orders.length ? (
          <ul className="empire-tasks" data-toast-guard>
            {orders.map(({ order, waiting }) => (
              <TaskLine key={order.id} art={units.get(order.itemId)?.art} title={orderTitle(order, units)} now={now} startedAt={order.startedAt} finishAt={order.finishAt} waiting={waiting}
                cancelLabel={`Отменить заказ: ${units.get(order.itemId)?.name ?? order.itemId}`} onCancel={() => onCancelProduction(order.id)} qa="order" />
            ))}
          </ul>
        ) : <p>{hasYard ? 'Заказов нет.' : `Чтобы заказывать корабли и оборону, постройте в военной зоне: ${yardName}.`}</p>}
        {hasYard && !row.blocked ? (
          <div className="empire-detail__btns">
            <button type="button" className="empire__btn empire__btn--pri" onClick={(event) => onYard('ships', event.currentTarget)} data-empire-pick-trigger data-qa-empire-yard-open="ships">+ Корабли</button>
            <button type="button" className="empire__btn" onClick={(event) => onYard('defense', event.currentTarget)} data-empire-pick-trigger data-qa-empire-yard-open="defense">+ Оборона</button>
          </div>
        ) : null}
      </section>

      <section className="empire-detail__col">
        <h4>Флот на орбите <span>{formatNumber(row.population.used)} из {formatNumber(row.population.capacity)} населения</span></h4>
        {fleet.length ? (
          <ul className="empire-orbit">
            {fleet.slice(0, SHOWN_SHIPS).map(([id, count]) => (
              <li key={id}>
                {units.get(id)?.art ? <img src={units.get(id)!.art} alt="" draggable={false} /> : <i />}
                <span><b>{compactAmount(count)}</b><small>{units.get(id)?.name ?? id}</small></span>
              </li>
            ))}
          </ul>
        ) : <p>На орбите нет свободных кораблей.</p>}
        <p className="empire-detail__line">
          {fleet.length > SHOWN_SHIPS ? `и ещё ${fleet.length - SHOWN_SHIPS} ${plural(fleet.length - SHOWN_SHIPS, 'вид', 'вида', 'видов')} · ` : ''}
          спутники {formatNumber(row.solarSatellites)} · оборона {formatNumber(row.defenseCount)}
        </p>
        <h4 className="is-sub">Рейсы <span>{row.flights.length}</span></h4>
        {row.flights.length ? (
          <ul className="empire-flights" data-qa-empire-flights={row.flights.length}>
            {row.flights.slice(0, SHOWN_FLIGHTS).map((flight) => {
              const line = flightLine(flight, now);
              return <li key={`${flight.id}:${flight.direction}`}><i aria-hidden="true">{line.arrow}</i><span>{line.text} <time>{countdown(line.time - now)}</time></span></li>;
            })}
            {row.flights.length > SHOWN_FLIGHTS ? <li className="is-more">и ещё {row.flights.length - SHOWN_FLIGHTS}</li> : null}
          </ul>
        ) : <p>Рейсов нет.</p>}
      </section>

      <section className="empire-detail__col">
        <h4>Склады и энергия</h4>
        <ul className="empire-stock" data-toast-guard>
          {EMPIRE_RESOURCES.map((key) => {
            const cell = row.resources[key];
            const tone = cell.full ? 'full' : cell.fill >= 0.9 ? 'near' : 'ok';
            return (
              <li key={key} className={`empire-res--${key} is-${tone}`} data-qa-empire-stock={key}>
                <ResourceIcon kind={key} />
                <span>
                  <span className="empire-stock__line"><b>{compactAmount(cell.amount)}</b><small>из {compactAmount(cell.capacity)}</small><em>{cell.full ? 'склад полон' : cell.perHour > 0 ? `+${compactAmount(cell.perHour)}/ч` : ''}</em></span>
                  <Bar value={cell.fill} />
                </span>
              </li>
            );
          })}
          <li className={row.energy.available < 0 ? 'is-full' : ''} data-qa-empire-stock="energy">
            <ResourceIcon kind="energy" />
            <span>
              <span className="empire-stock__line"><b>{signedAmount(row.energy.available)}</b><small>свободно из {compactAmount(row.energy.produced)}</small><em /></span>
            </span>
          </li>
        </ul>
        <LabLine row={row} now={now} />
      </section>

      <section className="empire-detail__built" aria-label="Здания на планете">
        <h4>Здания</h4>
        {built.length ? (
          <ul>
            {built.map(({ def, zone, level }) => (
              <li key={def.assetRole}>
                <button type="button" className="empire-built" data-tip={def.name} aria-label={`${def.name}, уровень ${level}`} onClick={(event) => onPick(event.currentTarget, zone)} data-empire-pick-trigger data-qa-empire-built={def.assetRole}>
                  <img src={def.art} alt="" draggable={false} /><em>{level}</em>
                </button>
              </li>
            ))}
          </ul>
        ) : <p>На планете пока нет зданий.</p>}
      </section>

      <footer className="empire-detail__acts">
        <b>{row.name}</b>
        {single ? null : (
          <>
            <button type="button" className="empire__btn" onClick={() => onGather('transport')} data-qa-empire-here={row.id}>Привезти ресурсы сюда</button>
            <button type="button" className="empire__btn" onClick={() => onGather('deployment')} data-qa-empire-gather-here={row.id}>Собрать флот сюда</button>
            <button type="button" className="empire__btn" onClick={onSendFrom} data-qa-empire-from={row.id}>Отправить отсюда</button>
          </>
        )}
        <button type="button" className="empire__btn" onClick={onOpenPlanet} data-qa-empire-open={row.id}>Открыть планету</button>
      </footer>
    </div>
  );
}

function LabLine({ row, now }: { row: EmpirePlanetRow; now: number }) {
  const research = row.research[0];
  const science = research ? SCIENCE_CATALOG.find((item) => item.id === research.scienceId) : null;
  return (
    <p className="empire-detail__line">
      {science ? <>Исследование: {science.name} {research!.toLevel}, осталось <time>{countdown(research!.finishAt - now)}</time></> : 'На этой планете ничего не изучается.'}
    </p>
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

function EmpireDrawer({ state, drawer, planetArt, rows, now, runtimeMode, testTimeScale, onTarget, onMode, onBuildShips, onClose, onSend }: {
  state: SaveState; drawer: Drawer; planetArt: Record<string, string>; rows: EmpirePlanetRow[]; now: number; runtimeMode: RuntimeMode; testTimeScale: TestTimeScale;
  onTarget: (planetId: string) => void; onMode: (mode: Drawer['mode']) => void; onBuildShips: (planetId: string, shipId: string, anchor: HTMLElement) => void; onClose: () => void;
  onSend: (commands: DispatchFlightCommand[]) => QuickLegOutcome[];
}) {
  const target = useMemo(() => ownTarget(state, drawer.targetId, planetArt[drawer.targetId] ?? ''), [state, drawer.targetId, planetArt]);
  const [origins] = useState(() => drawer.origins ?? defaultOrigins(state, rows, drawer));
  const targetRow = rows.find((row) => row.id === drawer.targetId);
  const full = targetRow ? EMPIRE_RESOURCES.filter((key) => targetRow.resources[key].full) : [];
  const notice = drawer.mode !== 'transport' || full.length === 0 ? null
    : full.length === EMPIRE_RESOURCES.length ? `Склады ${targetRow!.name} полны: везти некуда. Выберите другую планету.`
      : `Склад полон: ${full.map((key) => RESOURCE_LABELS[key].toLowerCase()).join(', ')}. Это не повезём.`;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const advice = () => {
    const { message, build } = adviseEmptyGather(state, rows, drawer.targetId, drawer.mode, { now, mode: runtimeMode, testTimeScale });
    return (
      <div className="empire-drawer__advice" role="status" data-qa-quick-error data-qa-empire-advice>
        <p>{message}</p>
        {build ? (
          <button type="button" className="empire__btn empire__btn--pri" data-empire-pick-trigger data-qa-empire-advice-build={build.planetId}
            onClick={(event) => onBuildShips(build.planetId, build.shipId, event.currentTarget)}>{build.shipName}: заказать на планете {build.planetName}</button>
        ) : null}
      </div>
    );
  };
  return (
    <aside className="empire-drawer" aria-label="Перевозка между планетами" data-qa-empire-drawer={drawer.mode}>
      <header className="empire-drawer__head">
        <b>{drawer.mode === 'transport' ? 'Свезти ресурсы' : 'Собрать флот'}</b>
        <button type="button" className="empire-drawer__close" onClick={onClose} aria-label="Закрыть" data-qa-empire-drawer-close>✕</button>
      </header>
      <div className="empire-drawer__top">
        <small>На какую планету</small>
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
      <QuickSendPanel state={state} actionId={drawer.mode} target={target} bare emptyAdvice={advice}
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
