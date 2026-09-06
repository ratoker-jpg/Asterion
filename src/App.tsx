import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import './planet-skins.css';
import './universe.css';
import { UniverseView } from './UniverseView';
import { OperationsView } from './OperationsView';
import { CommandView } from './CommandView';
import { ReportsView } from './ReportsView';
import { ZoneView } from './ZoneView';
import { BuildingInteriorHost } from './BuildingInteriorHost';
import { FLEET_ROOT_REQUEST_EVENT } from './FleetRootNavigationController';
import {
  FLEET_CONSTRUCTION_REQUEST_EVENT,
  canEnterBuildingInterior,
  createBuildingInteriorContext,
  getBuildingInteriorTarget,
  type BuildingInteriorContext as BuildingInteriorNavigationContext,
} from './building-interior-navigation.ts';
import {
  BATTLE_HISTORY_CHANGED_EVENT,
  createDefaultBattleHistory,
  migrateBattleHistory,
  persistBattleHistory,
  setBattleReportSaved,
  type BattleHistoryState,
} from './domain/combat/battle-repository.ts';
import {
  COMBAT_PRIORITY_CHANGED_EVENT,
  COMBAT_SAVE_SCHEMA_VERSION,
  createDefaultCombatPriority,
  migrateCombatPriority,
  type CombatPriorityState,
} from './domain/combat/priority.ts';
import {
  SIMULATOR_STATE_CHANGED_EVENT,
  createDefaultSimulatorState,
  migrateSimulatorState,
  type SimulatorState,
} from './domain/combat/simulator-repository.ts';
import {
  acceptOperation,
  cancelOperation,
  createDefaultOperationsState,
  migrateOperationsState,
  revealOperation,
} from './domain/operations/repository.ts';
import type { OperationId, OperationsState } from './domain/operations/types.ts';
import {
  createDefaultCommandState,
  joinJointOperation,
  markResourceRequestReviewing,
  migrateCommandState,
  updateAllianceSettings,
} from './domain/command/repository.ts';
import type { AllianceSettingsInput, CommandState } from './domain/command/types.ts';
import { createDefaultReportsState, migrateReportsState } from './domain/reports/repository.ts';
import type { ReportsState } from './domain/reports/types.ts';
import { SCIENCE_CATALOG } from './domain/science/catalog.ts';
import {
  createDefaultRatingPrototypeState,
  migrateRatingPrototypeState,
  type RatingPrototypeState,
} from './domain/rating/fixtures.ts';
import {
  BUILDING_QUEUE_CAPACITY,
  RESOURCE_BASE_INCOME_PER_HOUR,
  RESOURCE_BUILDING_ROLES,
  completeBuildingProject,
  createDefaultBuildingLevels,
  evaluateBuildingBuild,
  getBuildingDefinition,
  migrateBuildingLevels,
  migrateBuildingQueue,
  startBuildingProject,
  type BuildingLevels,
  type BuildingQueueItem,
  type BuildingRole,
  type BuildingZone,
  type ResourceWallet,
  type ScienceLevels,
} from './domain/buildings/resource-zone.ts';
import {
  createEmptyBotAssignment,
  getProductionBotIncomePerHour,
  migrateProductionBotAssignment,
  type BotAssignment,
} from './domain/buildings/production-bots.ts';
import {
  advanceRecyclingState,
  collectRecyclingJob,
  createDefaultRecyclingState,
  migrateRecyclingState,
  startRecyclingJob,
  type RecyclingState,
  type ResourceAllocationPercent,
} from './domain/buildings/recycling.ts';
import {
  createDefaultTradeState,
  executeTrade,
  migrateTradeState,
  reconcileTradeState,
  type TradeExecution,
  type TradeRequest,
  type TradeState,
  type TradeWallet,
} from './domain/buildings/trade.ts';

import systemBackground from '../assets/source/starter/backgrounds/system_background.png';
import planetColonized from '../assets/source/starter/planets/planet_colonized.png';
import planetTerran from '../assets/source/starter/planets/planet_terran.png';
import planetOceanic from '../assets/source/starter/planets/planet_oceanic.png';
import planetDesert from '../assets/source/starter/planets/planet_desert.png';
import planetIce from '../assets/source/starter/planets/planet_ice.png';
import planetVolcanic from '../assets/source/starter/planets/planet_volcanic.png';
import planetToxic from '../assets/source/starter/planets/planet_toxic.png';
import planetBarren from '../assets/source/starter/planets/planet_barren_rocky.png';
import planetGas from '../assets/source/starter/planets/planet_gas_giant.png';

import generated002 from '../assets/source/planets/skins/planet-002.png';
import generated003 from '../assets/source/planets/skins/planet-003.png';
import generated005 from '../assets/source/planets/skins/planet-005.png';
import generated011 from '../assets/source/planets/skins/planet-011.png';
import generated012 from '../assets/source/planets/skins/planet-012.png';
import generated015 from '../assets/source/planets/skins/planet-015.png';
import generated016 from '../assets/source/planets/skins/planet-016.png';
import generated026 from '../assets/source/planets/skins/planet-026.png';
import generated027 from '../assets/source/planets/skins/planet-027.png';
import generated028 from '../assets/source/planets/skins/planet-028.png';
import generated030 from '../assets/source/planets/skins/planet-030.png';
import generated032 from '../assets/source/planets/skins/planet-032.png';

const planetSkins = [
  { id: 'colonized', label: 'Колония', art: planetColonized },
  { id: 'terran', label: 'Терран', art: planetTerran },
  { id: 'oceanic', label: 'Океан', art: planetOceanic },
  { id: 'desert', label: 'Пустыня', art: planetDesert },
  { id: 'ice', label: 'Ледяная', art: planetIce },
  { id: 'volcanic', label: 'Вулкан', art: planetVolcanic },
  { id: 'toxic', label: 'Токсичная', art: planetToxic },
  { id: 'barren', label: 'Каменная', art: planetBarren },
  { id: 'gas', label: 'Газовый гигант', art: planetGas },
  { id: 'skin-002', label: 'Облик 002', art: generated002 },
  { id: 'skin-003', label: 'Облик 003', art: generated003 },
  { id: 'skin-005', label: 'Облик 005', art: generated005 },
  { id: 'skin-011', label: 'Облик 011', art: generated011 },
  { id: 'skin-012', label: 'Облик 012', art: generated012 },
  { id: 'skin-015', label: 'Облик 015', art: generated015 },
  { id: 'skin-016', label: 'Облик 016', art: generated016 },
  { id: 'skin-026', label: 'Облик 026', art: generated026 },
  { id: 'skin-027', label: 'Облик 027', art: generated027 },
  { id: 'skin-028', label: 'Облик 028', art: generated028 },
  { id: 'skin-030', label: 'Облик 030', art: generated030 },
  { id: 'skin-032', label: 'Облик 032', art: generated032 },
] as const;

type PlanetSkin = (typeof planetSkins)[number]['id'];
type PlanetId = 'helion-01';
type Zone = BuildingZone;
type PlanetViewMode = 'overview' | Zone;
type IconKind = 'metal' | 'mineral' | 'gas' | 'energy' | 'population' | Zone;
type NavigationIconKind = 'planet' | 'universe' | 'fleets' | 'operations' | 'command' | 'reports' | 'settings' | 'rating' | 'science';
type BuildingInteriorContext = BuildingInteriorNavigationContext<PlanetId>;

type PlanetRuntime = {
  name: string;
  skin: PlanetSkin;
  population: number;
  populationMax: number;
  energy: number;
  buildings: BuildingLevels;
  productionBots: BotAssignment;
  recycling: RecyclingState;
  trade: TradeState;
  stability: number;
};

type SaveState = {
  schemaVersion: number;
  metal: number;
  minerals: number;
  gas: number;
  currentPlanetId: PlanetId;
  planets: Record<PlanetId, PlanetRuntime>;
  queues: Record<PlanetId, BuildingQueueItem[]>;
  rating: RatingPrototypeState;
  combatPriority: CombatPriorityState;
  combat: BattleHistoryState;
  combatSimulator: SimulatorState;
  operations: OperationsState;
  command: CommandState;
  reports: ReportsState;
};

type StoredPlanetRuntime = {
  name?: unknown;
  skin?: unknown;
  population?: unknown;
  populationMax?: unknown;
  energy?: unknown;
  buildings?: unknown;
  productionBots?: unknown;
  recycling?: unknown;
  trade?: unknown;
  solarStations?: unknown;
  stability?: unknown;
};

type StoredSave = {
  schemaVersion?: unknown;
  metal?: unknown;
  minerals?: unknown;
  gas?: unknown;
  planetSkin?: unknown;
  population?: unknown;
  energy?: unknown;
  solarStations?: unknown;
  planets?: Record<string, StoredPlanetRuntime>;
  queues?: Record<string, unknown>;
  queue?: unknown;
  rating?: unknown;
  combatPriority?: unknown;
  combat?: unknown;
  combatSimulator?: unknown;
  operations?: unknown;
  command?: unknown;
  reports?: unknown;
};

type PlanetDefinition = {
  id: PlanetId;
  coords: string;
  status: 'Основная планета';
  faction: 'Астеры';
};

const ownedPlanets: PlanetDefinition[] = [
  { id: 'helion-01', coords: '[1:1:1]', status: 'Основная планета', faction: 'Астеры' },
];

const SAVE_KEY = 'asterion.vertical-slice.v1';
const SAVE_SCHEMA_VERSION = Math.max(COMBAT_SAVE_SCHEMA_VERSION, 7);
const DEFAULT_PLANET_NAME = 'Helion 01';
const CURRENT_SCIENCE_LEVELS = Object.fromEntries(
  SCIENCE_CATALOG.map((science) => [science.id, science.capturedLevel]),
) as ScienceLevels;

const createInitialState = (): SaveState => ({
  schemaVersion: SAVE_SCHEMA_VERSION,
  metal: 15_880,
  minerals: 12_712,
  gas: 6_421,
  currentPlanetId: 'helion-01',
  planets: {
    'helion-01': {
      name: DEFAULT_PLANET_NAME,
      skin: 'colonized',
      population: 4,
      populationMax: 70,
      energy: 140,
      buildings: createDefaultBuildingLevels(),
      productionBots: createEmptyBotAssignment(),
      recycling: createDefaultRecyclingState(),
      trade: createDefaultTradeState(),
      stability: 100,
    },
  },
  queues: {
    'helion-01': [],
  },
  rating: createDefaultRatingPrototypeState(),
  combatPriority: createDefaultCombatPriority(),
  combat: createDefaultBattleHistory(),
  combatSimulator: createDefaultSimulatorState(),
  operations: createDefaultOperationsState(),
  command: createDefaultCommandState(),
  reports: createDefaultReportsState(),
});

const initialState = createInitialState();

const primaryTabs: ReadonlyArray<{ label: string; icon: NavigationIconKind }> = [
  { label: 'Планета', icon: 'planet' },
  { label: 'Вселенная', icon: 'universe' },
  { label: 'Флоты', icon: 'fleets' },
  { label: 'Операции', icon: 'operations' },
  { label: 'Командование', icon: 'command' },
  { label: 'Отчёты', icon: 'reports' },
];
const utilityTabs: ReadonlyArray<{ label: string; icon: NavigationIconKind }> = [
  { label: 'Настройки', icon: 'settings' },
  { label: 'Рейтинг', icon: 'rating' },
  { label: 'Наука', icon: 'science' },
];
const zoneMeta: Record<Zone, { title: string; subtitle: string; accent: string }> = {
  resource: { title: 'РЕСУРСНАЯ ЗОНА', subtitle: 'Добыча и энергия', accent: '#38c8ff' },
  industry: { title: 'ПРОМЫШЛЕННАЯ ЗОНА', subtitle: 'Производство', accent: '#f0ad38' },
  military: { title: 'ВОЕННАЯ ЗОНА', subtitle: 'Оборона и флот', accent: '#ee665d' },
};

const isPlanetSkin = (value: unknown): value is PlanetSkin => planetSkins.some((skin) => skin.id === value);
const numberOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function readSave(): SaveState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createInitialState();

    const parsed = JSON.parse(raw) as StoredSave;
    const savedHomeworld = parsed.planets?.['helion-01'];
    const legacySolarStations = numberOr(savedHomeworld?.solarStations, numberOr(parsed.solarStations, 0));
    const buildings = migrateBuildingLevels(savedHomeworld?.buildings, legacySolarStations);
    const now = Date.now();
    const homeworld: PlanetRuntime = {
      name: typeof savedHomeworld?.name === 'string' && savedHomeworld.name.trim()
        ? savedHomeworld.name.trim().slice(0, 28)
        : DEFAULT_PLANET_NAME,
      skin: isPlanetSkin(savedHomeworld?.skin)
        ? savedHomeworld.skin
        : isPlanetSkin(parsed.planetSkin)
          ? parsed.planetSkin
          : initialState.planets['helion-01'].skin,
      population: numberOr(savedHomeworld?.population, numberOr(parsed.population, initialState.planets['helion-01'].population)),
      populationMax: numberOr(savedHomeworld?.populationMax, initialState.planets['helion-01'].populationMax),
      energy: numberOr(savedHomeworld?.energy, numberOr(parsed.energy, initialState.planets['helion-01'].energy)),
      buildings,
      productionBots: migrateProductionBotAssignment(savedHomeworld?.productionBots, buildings),
      recycling: migrateRecyclingState(savedHomeworld?.recycling, buildings.recycling, now),
      trade: migrateTradeState(savedHomeworld?.trade, buildings['trade-center'], now),
      stability: numberOr(savedHomeworld?.stability, initialState.planets['helion-01'].stability),
    };

    const savedQueue = parsed.queues?.['helion-01'] ?? parsed.queue ?? null;
    const queue = migrateBuildingQueue(savedQueue, 'helion-01', homeworld.buildings);

    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      metal: numberOr(parsed.metal, initialState.metal),
      minerals: numberOr(parsed.minerals, initialState.minerals),
      gas: numberOr(parsed.gas, initialState.gas),
      currentPlanetId: 'helion-01',
      planets: { 'helion-01': homeworld },
      queues: { 'helion-01': queue },
      rating: migrateRatingPrototypeState(parsed.rating),
      combatPriority: migrateCombatPriority(parsed.combatPriority),
      combat: migrateBattleHistory(parsed.combat),
      combatSimulator: migrateSimulatorState(parsed.combatSimulator),
      operations: migrateOperationsState(parsed.operations),
      command: migrateCommandState(parsed.command),
      reports: migrateReportsState(parsed.reports),
    };
  } catch {
    return createInitialState();
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatStorageEta(current: number, capacity: number, hourlyGain: number) {
  if (current >= capacity) return 'склад заполнен';
  if (hourlyGain <= 0) return 'нет добычи';

  const minutes = Math.max(1, Math.ceil(((capacity - current) / hourlyGain) * 60));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const remainingMinutes = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} д`);
  if (hours) parts.push(`${hours} ч`);
  if (!days && !hours) parts.push(`${remainingMinutes} мин`);
  return parts.join(' ');
}

function useStageScale() {
  const calc = () => Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const [scale, setScale] = useState(calc);
  useEffect(() => {
    const onResize = () => setScale(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

function GameIcon({ kind }: { kind: IconKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (kind === 'metal') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 7 12 3l8 4-8 4-8-4Z"/><path {...common} d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>;
  if (kind === 'mineral') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 7 7-7 13L5 9l7-7Z"/><path {...common} d="M5 9h14M12 2v20"/></svg>;
  if (kind === 'gas') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3c4 4.7 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2-6.3 6-11Z"/><circle {...common} cx="10" cy="13" r="1.8"/><circle {...common} cx="14.5" cy="15.5" r="1.2"/></svg>;
  if (kind === 'energy') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z"/></svg>;
  if (kind === 'population') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="9" cy="8" r="3"/><circle {...common} cx="16.5" cy="9.5" r="2.3"/><path {...common} d="M3.5 20c.5-4.2 2.5-6.3 5.5-6.3s5 2.1 5.5 6.3M14 14.6c3.5-.5 5.6 1.3 6.5 5.4"/></svg>;
  if (kind === 'resource') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 4 6-4 6-4-6 4-6Zm-6 9 3 4-3 5-3-5 3-4Zm12 0 3 4-3 5-3-5 3-4Z"/></svg>;
  if (kind === 'industry') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M3 21V10l6 3v-3l6 3V6h4v15H3Z"/><path {...common} d="M6 17h2m3 0h2m3 0h2M16 6V3h3v3"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 19h16M7 19v-4l4-2V8l2-2 2 2v5l3 2v4M11 10h4M9 19v-3m6 3v-4"/><path {...common} d="m12 6 1-4 1 4"/></svg>;
}

function NavigationIcon({ kind }: { kind: NavigationIconKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (kind === 'planet') return <svg viewBox="0 0 32 32" aria-hidden="true"><ellipse {...common} cx="16" cy="16" rx="11" ry="6.5" /><circle {...common} cx="16" cy="16" r="4.7" /><path {...common} d="M4 13c5-5 19-7 25-2M5 20c5 4 17 5 23 1" /></svg>;
  if (kind === 'universe') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="2.4" /><ellipse {...common} cx="16" cy="16" rx="12.5" ry="5.2" transform="rotate(25 16 16)" /><ellipse {...common} cx="16" cy="16" rx="12.5" ry="5.2" transform="rotate(-35 16 16)" /></svg>;
  if (kind === 'fleets') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 3 8 23-8-5-8 5 8-23Z" /><path {...common} d="M11 19H4l5-6M21 19h7l-5-6M16 8v13" /></svg>;
  if (kind === 'operations') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="10" /><circle {...common} cx="16" cy="16" r="4" /><path {...common} d="M16 2v6M16 24v6M2 16h6M24 16h6" /></svg>;
  if (kind === 'command') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 8 4 5-4 5-4-5 4-5Z" /><path {...common} d="M12 13 3 9l6 9 7 7M20 13l9-4-6 9-7 7" /></svg>;
  if (kind === 'reports') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M9 3h11l4 4v22H9V3Z" /><path {...common} d="M20 3v5h5M13 13h8M13 18h8M13 23h6" /></svg>;
  if (kind === 'settings') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4.2" /><path {...common} d="m16 3 1.5 3.4a10.3 10.3 0 0 1 3 1.2l3.4-1.4 2.1 2.1-1.4 3.4a10.3 10.3 0 0 1 1.2 3L29 16l-1.2 1.5a10.3 10.3 0 0 1-1.2 3l1.4 3.4-2.1 2.1-3.4-1.4a10.3 10.3 0 0 1-3 1.2L16 29l-1.5-1.2a10.3 10.3 0 0 1-3-1.2l-3.4 1.4L6 25.9l1.4-3.4a10.3 10.3 0 0 1-1.2-3L3 16l3.2-1.3a10.3 10.3 0 0 1 1.2-3L6 8.3l2.1-2.1 3.4 1.4a10.3 10.3 0 0 1 3-1.2L16 3Z" /></svg>;
  if (kind === 'rating') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 4 3.5 7.1 7.8 1.1-5.7 5.5 1.3 7.8-6.9-3.7-6.9 3.7 1.3-7.8-5.7-5.5 7.8-1.1L16 4Z" /></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M13 4h6M14 4v8L7 25c-1.1 2.2.2 4 3 4h12c2.8 0 4.1-1.8 3-4l-7-13V4" /><path {...common} d="M10 21h12" /></svg>;
}

type ResourceProps = {
  kind: Exclude<IconKind, Zone>;
  label: string;
  value: number;
  capacity?: number;
  hourlyGain?: number;
  description?: string;
};

function Resource({ kind, label, value, capacity, hourlyGain, description }: ResourceProps) {
  const fill = capacity ? Math.min(100, Math.max(0, (value / capacity) * 100)) : 0;
  const fillTone = fill >= 85 ? 'critical' : fill >= 75 ? 'warning' : fill >= 65 ? 'watch' : 'normal';

  return (
    <div className={`resource-chip resource-chip--${kind}`} tabIndex={0}>
      <span className="resource-chip__icon"><GameIcon kind={kind} /></span>
      <span className="resource-chip__text">
        <small>{label}</small>
        <strong>{formatNumber(value)}</strong>
        {capacity ? <span className={`resource-fill resource-fill--${fillTone}`}><i style={{ '--fill': `${fill}%` } as CSSProperties} /></span> : null}
      </span>
      <span className="resource-tooltip" role="tooltip">
        <strong>{label}</strong>
        {capacity ? <span>{formatNumber(value)} / {formatNumber(capacity)}</span> : <span>{formatNumber(value)}</span>}
        {hourlyGain != null ? <span>Добыча: +{formatNumber(hourlyGain)}/ч</span> : null}
        {capacity && hourlyGain != null ? <span>Склад заполнится через: {formatStorageEta(value, capacity, hourlyGain)}</span> : null}
        {kind === 'population' && capacity ? <span>Заполнено: {fill.toFixed(1).replace('.', ',')}%</span> : null}
        {description ? <span>{description}</span> : null}
      </span>
    </div>
  );
}

function AegisButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className="aegis-button" disabled={disabled} onClick={onClick}><span>{children}</span></button>;
}

export function App() {
  const scale = useStageScale();
  const [planetViewMode, setPlanetViewMode] = useState<PlanetViewMode>('overview');
  const [activeTab, setActiveTab] = useState('Планета');
  const [state, setState] = useState<SaveState>(readSave);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('Система готова. Локальное сохранение активно.');
  const [planetMenuOpen, setPlanetMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [editingPlanetId, setEditingPlanetId] = useState<PlanetId | null>(null);
  const [editingName, setEditingName] = useState(DEFAULT_PLANET_NAME);
  const [selectedBuildingRole, setSelectedBuildingRole] = useState<BuildingRole | null>(null);
  const [buildingInterior, setBuildingInterior] = useState<BuildingInteriorContext | null>(null);

  useEffect(() => localStorage.setItem(SAVE_KEY, JSON.stringify(state)), [state]);
  useEffect(() => {
    const onCombatPriorityChanged = (event: Event) => {
      const priority = (event as CustomEvent<CombatPriorityState>).detail;
      setState((current) => ({
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        combatPriority: migrateCombatPriority(priority),
      }));
    };

    window.addEventListener(COMBAT_PRIORITY_CHANGED_EVENT, onCombatPriorityChanged);
    return () => window.removeEventListener(COMBAT_PRIORITY_CHANGED_EVENT, onCombatPriorityChanged);
  }, []);
  useEffect(() => {
    const onBattleHistoryChanged = (event: Event) => {
      const history = (event as CustomEvent<BattleHistoryState>).detail;
      setState((current) => ({
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        combat: migrateBattleHistory(history),
      }));
    };

    window.addEventListener(BATTLE_HISTORY_CHANGED_EVENT, onBattleHistoryChanged);
    return () => window.removeEventListener(BATTLE_HISTORY_CHANGED_EVENT, onBattleHistoryChanged);
  }, []);
  useEffect(() => {
    const onSimulatorStateChanged = (event: Event) => {
      const simulator = (event as CustomEvent<SimulatorState>).detail;
      setState((current) => ({
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        combatSimulator: migrateSimulatorState(simulator),
      }));
    };

    window.addEventListener(SIMULATOR_STATE_CHANGED_EVENT, onSimulatorStateChanged);
    return () => window.removeEventListener(SIMULATOR_STATE_CHANGED_EVENT, onSimulatorStateChanged);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const activeQueueItem = state.queues['helion-01'][0];
    if (!activeQueueItem || now < activeQueueItem.finishAt) return;
    const completedDefinition = getBuildingDefinition(activeQueueItem.assetRole);

    setState((current) => {
      const currentActiveItem = current.queues['helion-01'][0];
      if (!currentActiveItem || Date.now() < currentActiveItem.finishAt) return current;
      const currentPlanet = current.planets['helion-01'];
      const completed = completeBuildingProject({
        resources: {
          metal: current.metal,
          minerals: current.minerals,
          gas: current.gas,
          energy: currentPlanet.energy,
        },
        buildings: currentPlanet.buildings,
        queue: current.queues['helion-01'],
        scienceLevels: CURRENT_SCIENCE_LEVELS,
      }, Date.now());
      if (!completed.completedRole) return current;

      return {
        ...current,
        metal: completed.state.resources.metal,
        minerals: completed.state.resources.minerals,
        gas: completed.state.resources.gas,
        planets: {
          'helion-01': {
            ...currentPlanet,
            energy: completed.state.resources.energy,
            buildings: completed.state.buildings,
          },
        },
        queues: { 'helion-01': completed.state.queue },
      };
    });
    setNotice(`${state.planets['helion-01'].name}: ${completedDefinition.name} завершено.`);
  }, [now, state.queues, state.planets]);

  useEffect(() => {
    const snapshot = advanceRecyclingState(state.planets['helion-01'].recycling, now);
    if (!snapshot.changed) return;

    setState((current) => {
      const currentPlanet = current.planets['helion-01'];
      const advanced = advanceRecyclingState(currentPlanet.recycling, now);
      if (!advanced.changed) return current;
      return {
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        metal: current.metal + advanced.autoCollectedOutput.metal,
        minerals: current.minerals + advanced.autoCollectedOutput.minerals,
        gas: current.gas + advanced.autoCollectedOutput.gas,
        planets: {
          ...current.planets,
          'helion-01': {
            ...currentPlanet,
            recycling: advanced.state,
          },
        },
      };
    });

    if (snapshot.autoCollectedJobIds.length > 0) setNotice('Результат переработки автоматически зачислен');
  }, [now, state.planets]);

  useEffect(() => {
    const snapshot = reconcileTradeState(state.planets['helion-01'].trade, state.planets['helion-01'].buildings['trade-center'], now);
    if (!snapshot.changed) return;
    setState((current) => {
      const currentPlanet = current.planets['helion-01'];
      const reconciled = reconcileTradeState(currentPlanet.trade, currentPlanet.buildings['trade-center'], now);
      if (!reconciled.changed) return current;
      return {
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        planets: {
          ...current.planets,
          'helion-01': { ...currentPlanet, trade: reconciled.state },
        },
      };
    });
  }, [now, state.planets]);

  const currentPlanet = ownedPlanets[0];
  const currentPlanetState = state.planets['helion-01'];
  const currentPlanetName = currentPlanetState.name;
  const currentSkin = useMemo(
    () => planetSkins.find((skin) => skin.id === currentPlanetState.skin) ?? planetSkins[0],
    [currentPlanetState.skin],
  );
  const currentQueue = state.queues['helion-01'];
  const currentActiveQueueItem = currentQueue[0] ?? null;
  const currentQueueDefinition = currentActiveQueueItem ? getBuildingDefinition(currentActiveQueueItem.assetRole) : null;
  const resourceWallet: ResourceWallet = {
    metal: state.metal,
    minerals: state.minerals,
    gas: state.gas,
    energy: currentPlanetState.energy,
  };
  const tradeWallet: TradeWallet = {
    metal: state.metal,
    minerals: state.minerals,
    gas: state.gas,
    debris: currentPlanetState.recycling.availableDebris,
  };
  const resourceIncomePerHour = useMemo(
    () => getProductionBotIncomePerHour(RESOURCE_BASE_INCOME_PER_HOUR, currentPlanetState.productionBots),
    [currentPlanetState.productionBots],
  );
  const buildingInteriorTarget = buildingInterior
    ? getBuildingInteriorTarget(buildingInterior.buildingRole)
    : null;
  const buildingInteriorDefinition = buildingInterior
    ? getBuildingDefinition(buildingInterior.buildingRole)
    : null;

  const editingPlanet = editingPlanetId ? currentPlanet : null;
  const editingPlanetState = editingPlanet ? state.planets['helion-01'] : null;

  const progress = useMemo(() => {
    if (!currentActiveQueueItem) return 0;
    return Math.min(100, Math.max(0, ((now - currentActiveQueueItem.startedAt) / Math.max(1, currentActiveQueueItem.finishAt - currentActiveQueueItem.startedAt)) * 100));
  }, [now, currentActiveQueueItem]);

  const resourceBuildingCount = useMemo(
    () => RESOURCE_BUILDING_ROLES.filter((role) => currentPlanetState.buildings[role] > 0).length,
    [currentPlanetState.buildings],
  );

  const clearBuildingInterior = () => {
    setBuildingInterior(null);
    setSelectedBuildingRole(null);
  };

  const selectPlanet = (_planetId: PlanetId) => {
    clearBuildingInterior();
    setState((current) => ({ ...current, currentPlanetId: 'helion-01' }));
    setPlanetMenuOpen(false);
    setPlanetViewMode('overview');
    setNotice(`${currentPlanetName} ${currentPlanet.coords} выбрана как текущая планета.`);
  };

  const openPlanetEditor = (planetId: PlanetId) => {
    clearBuildingInterior();
    setState((current) => ({ ...current, currentPlanetId: 'helion-01' }));
    setActiveTab('Планета');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setEditingName(state.planets[planetId].name);
    setEditingPlanetId(planetId);
  };

  const savePlanetName = () => {
    if (!editingPlanetId) return;
    const trimmed = editingName.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 2) {
      setNotice('Название планеты должно содержать минимум 2 символа.');
      return;
    }
    const safeName = trimmed.slice(0, 28);
    setState((current) => ({
      ...current,
      planets: {
        'helion-01': { ...current.planets['helion-01'], name: safeName },
      },
    }));
    setEditingName(safeName);
    setNotice(`Планета переименована: ${safeName}.`);
  };

  const chooseSkin = (skin: (typeof planetSkins)[number]) => {
    if (!editingPlanetId) return;
    setState((current) => ({
      ...current,
      planets: {
        'helion-01': { ...current.planets['helion-01'], skin: skin.id },
      },
    }));
    setNotice(`Облик ${state.planets['helion-01'].name} изменён: ${skin.label}.`);
  };

  const applyProductionBots = (assignment: BotAssignment) => {
    setState((current) => {
      const currentPlanet = current.planets['helion-01'];
      const productionBots = migrateProductionBotAssignment(assignment, currentPlanet.buildings);
      return {
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        planets: {
          ...current.planets,
          'helion-01': {
            ...currentPlanet,
            productionBots,
          },
        },
      };
    });
    setNotice('Роботы перераспределены');
  };

  const startRecycling = (debrisAmount: number, allocation: ResourceAllocationPercent) => {
    const startedAt = Date.now();
    const jobId = globalThis.crypto?.randomUUID?.() ?? `recycling-${startedAt}-${Math.random().toString(36).slice(2, 9)}`;
    const preview = startRecyclingJob(
      currentPlanetState.recycling,
      currentPlanetState.buildings.recycling,
      debrisAmount,
      allocation,
      startedAt,
      jobId,
    );
    if (!preview.canStart) {
      setNotice(preview.reason ?? 'Переработка сейчас недоступна');
      return false;
    }

    setState((current) => {
      const currentPlanetStateForUpdate = current.planets['helion-01'];
      const transition = startRecyclingJob(
        currentPlanetStateForUpdate.recycling,
        currentPlanetStateForUpdate.buildings.recycling,
        debrisAmount,
        allocation,
        startedAt,
        jobId,
      );
      if (!transition.canStart) return current;
      return {
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        planets: {
          ...current.planets,
          'helion-01': {
            ...currentPlanetStateForUpdate,
            recycling: transition.state,
          },
        },
      };
    });
    setNotice('Переработка запущена');
    return true;
  };

  const collectRecycling = (jobId: string) => {
    const collectedAt = Date.now();
    const preview = collectRecyclingJob(currentPlanetState.recycling, jobId, collectedAt);
    if (!preview.ok || !preview.output) {
      setNotice(preview.reason ?? 'Ресурс пока недоступен');
      if (preview.state !== currentPlanetState.recycling) {
        setState((current) => ({
          ...current,
          planets: {
            ...current.planets,
            'helion-01': { ...current.planets['helion-01'], recycling: preview.state },
          },
        }));
      }
      return false;
    }

    setState((current) => {
      const currentPlanetStateForUpdate = current.planets['helion-01'];
      const transition = collectRecyclingJob(currentPlanetStateForUpdate.recycling, jobId, collectedAt);
      if (!transition.ok || !transition.output) return current;
      return {
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        metal: current.metal + transition.output.metal,
        minerals: current.minerals + transition.output.minerals,
        gas: current.gas + transition.output.gas,
        planets: {
          ...current.planets,
          'helion-01': {
            ...currentPlanetStateForUpdate,
            recycling: transition.state,
          },
        },
      };
    });
    setNotice('Ресурсы получены');
    return true;
  };

  const tradeResources = (request: TradeRequest): TradeExecution => {
    const tradedAt = Date.now();
    const preview = executeTrade(
      { wallet: tradeWallet, trade: currentPlanetState.trade },
      currentPlanetState.buildings['trade-center'],
      state.rating.resourcePoints,
      request,
      tradedAt,
    );
    if (!preview.ok) {
      setNotice(preview.reason ?? 'Обмен сейчас недоступен');
      return preview;
    }

    setState((current) => {
      const planet = current.planets['helion-01'];
      const transition = executeTrade(
        {
          wallet: {
            metal: current.metal,
            minerals: current.minerals,
            gas: current.gas,
            debris: planet.recycling.availableDebris,
          },
          trade: planet.trade,
        },
        planet.buildings['trade-center'],
        current.rating.resourcePoints,
        request,
        tradedAt,
      );
      if (!transition.ok) return current;
      return {
        ...current,
        schemaVersion: SAVE_SCHEMA_VERSION,
        metal: transition.state.wallet.metal,
        minerals: transition.state.wallet.minerals,
        gas: transition.state.wallet.gas,
        planets: {
          ...current.planets,
          'helion-01': {
            ...planet,
            trade: transition.state.trade,
            recycling: {
              ...planet.recycling,
              availableDebris: transition.state.wallet.debris,
            },
          },
        },
      };
    });
    setNotice('Обмен выполнен');
    return preview;
  };

  const buildBuilding = (assetRole: BuildingRole) => {
    const snapshot = {
      resources: resourceWallet,
      buildings: currentPlanetState.buildings,
      queue: currentQueue,
      scienceLevels: CURRENT_SCIENCE_LEVELS,
    };
    const availability = evaluateBuildingBuild(snapshot, assetRole);
    if (!availability.canBuild) {
      setNotice(availability.reason ?? 'Строительство сейчас недоступно.');
      return false;
    }

    const enqueuedAt = Date.now();
    const definition = getBuildingDefinition(assetRole);
    setState((current) => {
      const currentPlanetStateForBuild = current.planets['helion-01'];
      const transition = startBuildingProject({
        resources: {
          metal: current.metal,
          minerals: current.minerals,
          gas: current.gas,
          energy: currentPlanetStateForBuild.energy,
        },
        buildings: currentPlanetStateForBuild.buildings,
        queue: current.queues['helion-01'],
        scienceLevels: CURRENT_SCIENCE_LEVELS,
      }, assetRole, 'helion-01', enqueuedAt);
      if (!transition.ok) return current;

      return {
        ...current,
        metal: transition.state.resources.metal,
        minerals: transition.state.resources.minerals,
        gas: transition.state.resources.gas,
        planets: {
          'helion-01': {
            ...currentPlanetStateForBuild,
            energy: transition.state.resources.energy,
            buildings: transition.state.buildings,
          },
        },
        queues: { 'helion-01': transition.state.queue },
      };
    });
    setNotice(`${currentPlanetName}: ${definition.name} добавлено в общую очередь.`);
    return true;
  };

  const closePlanetEditor = () => {
    setEditingPlanetId(null);
    setEditingName(state.planets['helion-01'].name);
  };

  const reset = () => {
    localStorage.removeItem(SAVE_KEY);
    setState(createInitialState());
    setPlanetMenuOpen(false);
    setEditingPlanetId(null);
    setEditingName(DEFAULT_PLANET_NAME);
    setDetailsOpen(true);
    setPlanetViewMode('overview');
    setSelectedBuildingRole(null);
    setBuildingInterior(null);
    setNotice('Сохранение прототипа сброшено.');
  };

  const acceptOperationsOperation = (operationId: OperationId) => {
    setState((current) => ({ ...current, operations: acceptOperation(current.operations, operationId) }));
    setNotice('Операция принята. Подготовьте флот для выполнения.');
  };

  const cancelOperationsOperation = (operationId: OperationId) => {
    setState((current) => ({ ...current, operations: cancelOperation(current.operations, operationId) }));
    setNotice('Операция отменена и возвращена в доступные без штрафа.');
  };

  const revealOperationsOperation = (operationId: OperationId) => {
    setState((current) => ({ ...current, operations: revealOperation(current.operations, operationId) }));
    setNotice('Сигнал просканирован. Классификация операции обновлена.');
  };

  const openFleetRootFromOperations = () => {
    clearBuildingInterior();
    setActiveTab('Флоты');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Флоты: подготовьте состав для принятой операции.');
    window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
  };

  const joinCommandOperation = (operationId: string) => {
    setState((current) => ({ ...current, command: joinJointOperation(current.command, operationId) }));
    setNotice('Совместная операция добавлена в ваш союзный контур. Подготовка флота выполняется через раздел «Флоты».');
  };

  const reviewCommandRequest = (requestId: string) => {
    setState((current) => ({ ...current, command: markResourceRequestReviewing(current.command, requestId) }));
    setNotice('Запрос ресурсов принят к рассмотрению. Реальная транспортировка выполняется через раздел «Флоты».');
  };

  const saveCommandSettings = (input: AllianceSettingsInput) => {
    setState((current) => ({ ...current, command: updateAllianceSettings(current.command, input) }));
    setNotice('Настройки союза сохранены в локальном прототипе.');
  };

  const openFleetRootFromCommand = () => {
    clearBuildingInterior();
    setActiveTab('Флоты');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Флоты: подготовьте состав для союзной задачи. Отправка не запускается автоматически.');
    window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
  };

  const openFleetRootFromReports = () => {
    clearBuildingInterior();
    setActiveTab('Флоты');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Флоты: выберите состав для союзной операции из отчётов.');
    window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
  };

  const toggleBattleSavedFromReports = (reportId: string, saved: boolean) => {
    const result = persistBattleHistory(setBattleReportSaved(state.combat, reportId, saved));
    setState((current) => ({
      ...current,
      schemaVersion: SAVE_SCHEMA_VERSION,
      combat: migrateBattleHistory(result.value),
    }));
    setNotice(result.ok
      ? (saved ? 'Боевой доклад сохранён.' : 'Боевой доклад удалён из сохранённых.')
      : `Не удалось обновить сохранённые бои: ${result.error}`);
  };

  const returnToBuilding = () => {
    if (!buildingInterior) return;
    const context = buildingInterior;
    const definition = getBuildingDefinition(context.buildingRole);
    setBuildingInterior(null);
    setState((current) => current.currentPlanetId === context.planetId
      ? current
      : { ...current, currentPlanetId: context.planetId });
    setActiveTab('Планета');
    setPlanetViewMode(context.zone);
    setSelectedBuildingRole(context.buildingRole);
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice(`${definition.name}: возвращение в ${zoneMeta[context.zone].title.toLowerCase()}.`);
  };

  const enterBuilding = (assetRole: BuildingRole) => {
    if (!canEnterBuildingInterior(assetRole, currentPlanetState.buildings[assetRole])) return;
    const context = createBuildingInteriorContext(state.currentPlanetId, assetRole);
    const target = getBuildingInteriorTarget(assetRole);
    if (!context || !target) return;

    setBuildingInterior(context);
    setSelectedBuildingRole(assetRole);
    setPlanetMenuOpen(false);
    closePlanetEditor();

    if (target.kind === 'host') {
      setActiveTab('Планета');
      setPlanetViewMode(context.zone);
      setNotice(`${getBuildingDefinition(assetRole).name}: внутренний модуль открыт.`);
      return;
    }
    if (target.kind === 'fleet-construction') {
      setActiveTab('Флоты');
      setNotice('Верфь: открыт существующий раздел строительства флота.');
      window.setTimeout(() => window.dispatchEvent(new Event(FLEET_CONSTRUCTION_REQUEST_EVENT)), 0);
      return;
    }
    if (target.kind === 'science') {
      setActiveTab('Наука');
      setNotice('Лаборатория: открыт существующий раздел «Наука».');
      return;
    }

    setActiveTab('Командование');
    setNotice('Палата управления: открыт существующий раздел «Командование».');
  };

  const chooseTab = (tab: string) => {
    clearBuildingInterior();
    setActiveTab(tab);
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    if (tab === 'Вселенная') setNotice('Галактика 1 загружена. Доступно 40 солнечных систем.');
    else if (tab === 'Операции') setNotice('Операции: доступные PvE-сценарии загружены.');
    else if (tab === 'Командование') setNotice('Командование: союзный контур загружен.');
    else if (tab === 'Отчёты') setNotice('Отчёты: центр сообщений и боевых журналов загружен.');
    else if (tab === 'Планета') setNotice(`${currentPlanetName}: обзор планеты.`);
    else setNotice(`Экран «${tab}» пока в разработке.`);
  };

  const chooseZone = (nextZone: Zone) => {
    clearBuildingInterior();
    setActiveTab('Планета');
    setPlanetViewMode(nextZone);
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice(`${zoneMeta[nextZone].title}: сцена открыта для ${currentPlanetName}.`);
  };

  useEffect(() => {
    if (!buildingInterior) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      returnToBuilding();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [buildingInterior]);

  const remaining = currentActiveQueueItem ? currentActiveQueueItem.finishAt - now : 0;
  const workspaceKind = buildingInteriorTarget?.kind === 'host'
    ? 'building-interior'
    : activeTab === 'Вселенная'
      ? 'universe'
      : activeTab === 'Планета' && planetViewMode !== 'overview'
        ? 'resource-zone'
        : activeTab === 'Планета'
          ? 'planet'
          : activeTab === 'Операции'
            ? 'operations'
            : activeTab === 'Командование'
              ? 'command'
              : activeTab === 'Отчёты'
                ? 'reports'
                : 'module';

  return (
    <div className="viewport">
      <div className="stage stage-shell-v3 stage-shell-v4" style={{ transform: `scale(${scale})`, '--space-bg': `url(${systemBackground})` } as CSSProperties}>
        <header className="asterion-header">
          <section className="header-planet-module">
            <div className="header-planet-orbit">
              <button className="header-planet-world" type="button" onClick={() => chooseTab('Планета')} aria-label={`Открыть ${currentPlanetName}`}>
                <img src={currentSkin.art} alt={currentPlanetName} draggable={false} />
              </button>
              {(['resource', 'industry', 'military'] as Zone[]).map((item) => {
                const isActive = activeTab === 'Планета' && planetViewMode === item;
                return (
                  <button
                    key={item}
                    type="button"
                    className={`header-zone header-zone--${item} ${isActive ? 'active' : ''}`}
                    title={zoneMeta[item].title}
                    onClick={() => chooseZone(item)}
                  >
                    <GameIcon kind={item} />
                  </button>
                );
              })}
            </div>

            <div className="current-planet-control">
              <button className="current-planet-select" type="button" onClick={() => setPlanetMenuOpen((open) => !open)}>
                <img src={currentSkin.art} alt={currentPlanetName} draggable={false} />
                <span>
                  <small>ТЕКУЩАЯ ПЛАНЕТА</small>
                  <strong>{currentPlanetName} <em>{currentPlanet.coords}</em></strong>
                </span>
                <i>{planetMenuOpen ? '⌃' : '⌄'}</i>
              </button>
            </div>

            {planetMenuOpen ? (
              <div className="planet-list-popover">
                <button type="button" className="active" onClick={() => selectPlanet('helion-01')}>
                  <img src={currentSkin.art} alt="" />
                  <span><strong>{currentPlanetName}</strong><small>{currentPlanet.coords} · {currentPlanet.status}</small></span>
                  <b>✓</b>
                </button>
                <div>Новые планеты появятся здесь только после реальной колонизации.</div>
              </div>
            ) : null}
          </section>

          <section className="header-main">
            <div className="resources header-resource-rail" aria-label="Ресурсы планеты">
              <Resource kind="metal" label="МЕТАЛЛ" value={state.metal} capacity={60_000} hourlyGain={resourceIncomePerHour.metal} />
              <Resource kind="mineral" label="МИНЕРАЛЫ" value={state.minerals} capacity={60_000} hourlyGain={resourceIncomePerHour.minerals} />
              <Resource kind="gas" label="ГАЗ" value={state.gas} capacity={60_000} hourlyGain={resourceIncomePerHour.gas} />
              <Resource kind="energy" label="ЭНЕРГИЯ" value={currentPlanetState.energy} description="Энергия планеты. Солнечная электростанция увеличивает запас после завершения строительства." />
              <Resource kind="population" label="НАСЕЛЕНИЕ" value={currentPlanetState.population} capacity={currentPlanetState.populationMax} />
            </div>
            <nav className="primary-navigation" aria-label="Основная навигация">
              {primaryTabs.map(({ label, icon }) => (
                <button key={label} type="button" className={activeTab === label && !(label === 'Планета' && planetViewMode !== 'overview') ? 'active' : ''} onClick={() => chooseTab(label)}>
                  <NavigationIcon kind={icon} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </section>

          <section className="campaign-block campaign-module">
            <span className="campaign-icon">✦</span>
            <div className="campaign-status"><strong>КАМПАНИЯ АКТИВНА</strong></div>
            <time>{new Date(now).toLocaleTimeString('ru-RU', { hour12: false })}</time>
            <nav className="utility-navigation" aria-label="Служебная навигация">
              {utilityTabs.map(({ label, icon }) => (
                <button key={label} type="button" aria-label={label} className={activeTab === label ? 'active' : ''} onClick={() => chooseTab(label)}>
                  <NavigationIcon kind={icon} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </section>
        </header>

        <section className={`workspace workspace-v4 workspace--${workspaceKind}`}>
          {buildingInterior && buildingInteriorTarget && buildingInteriorTarget.kind !== 'host' && buildingInteriorDefinition ? (
            <button
              className="building-interior-return-overlay"
              type="button"
              data-qa-building-interior-back
              onClick={returnToBuilding}
            >
              <span aria-hidden="true">←</span>
              Назад в {buildingInteriorDefinition.name}
            </button>
          ) : null}

          {buildingInterior && buildingInteriorTarget?.kind === 'host' ? (
            <BuildingInteriorHost
              context={buildingInterior}
              planetName={currentPlanetName}
              moduleTitle={buildingInteriorTarget.moduleTitle}
              buildings={currentPlanetState.buildings}
              productionBots={currentPlanetState.productionBots}
              recycling={currentPlanetState.recycling}
              trade={currentPlanetState.trade}
              tradeWallet={tradeWallet}
              resourceRatingPoints={state.rating.resourcePoints}
              now={now}
              onProductionBotsApply={applyProductionBots}
              onRecyclingStart={startRecycling}
              onRecyclingCollect={collectRecycling}
              onTrade={tradeResources}
              onBack={returnToBuilding}
            />
          ) : activeTab === 'Вселенная' ? (
            <UniverseView onNotice={setNotice} ownedPlanetArt={currentSkin.art} ownedPlanetName={currentPlanetName} />
          ) : activeTab === 'Операции' ? (
            <OperationsView
              state={state.operations}
              onAccept={acceptOperationsOperation}
              onCancel={cancelOperationsOperation}
              onReveal={revealOperationsOperation}
              onOpenFleets={openFleetRootFromOperations}
            />
          ) : activeTab === 'Командование' ? (
            <CommandView
              state={state.command}
              onJoinOperation={joinCommandOperation}
              onReviewRequest={reviewCommandRequest}
              onSaveSettings={saveCommandSettings}
              onOpenFleets={openFleetRootFromCommand}
            />
          ) : activeTab === 'Отчёты' ? (
            <ReportsView
              battleReports={state.combat.reports}
              savedBattleReportIds={state.combat.savedReportIds}
              operations={state.operations}
              command={state.command}
              state={state.reports}
              onStateChange={(reports) => setState((current) => ({ ...current, reports }))}
              onToggleBattleSaved={toggleBattleSavedFromReports}
              onOpenFleets={openFleetRootFromReports}
            />
          ) : activeTab === 'Планета' && planetViewMode !== 'overview' ? (
            <ZoneView
              zone={planetViewMode}
              planetName={currentPlanetName}
              planetCoords={currentPlanet.coords}
              resources={resourceWallet}
              resourceIncomePerHour={resourceIncomePerHour}
              buildings={currentPlanetState.buildings}
              queue={currentQueue}
              scienceLevels={CURRENT_SCIENCE_LEVELS}
              now={now}
              selectedRole={selectedBuildingRole}
              onSelectedRoleChange={setSelectedBuildingRole}
              onBuild={buildBuilding}
              onEnterBuilding={enterBuilding}
            />
          ) : activeTab === 'Планета' ? (
            <div className="planet-page-v3 planet-page-v4">
              <aside className="planet-summary-v3 planet-list-panel-v4">
                <div className="page-panel-title"><strong>ПЛАНЕТЫ</strong><small>1 ПЛАНЕТА</small></div>

                <div className="owned-planets-v4">
                  <div className="owned-planet-row-v4 active">
                    <button className="owned-planet-main-v4" type="button" onClick={() => selectPlanet('helion-01')}>
                      <img src={currentSkin.art} alt="" />
                      <span><strong>{currentPlanetName}</strong><small>{currentPlanet.coords} · {currentPlanet.status}</small></span>
                    </button>
                    <button className="owned-planet-edit-v4" type="button" title={`Редактировать ${currentPlanetName}`} onClick={() => openPlanetEditor('helion-01')}>✎</button>
                  </div>
                </div>

                <button className={`planet-details-toggle-v4 ${detailsOpen ? 'open' : ''}`} type="button" onClick={() => setDetailsOpen((open) => !open)}>
                  <span>ПОДРОБНЕЕ О {currentPlanetName.toUpperCase()}</span><b>{detailsOpen ? '⌃' : '⌄'}</b>
                </button>

                {detailsOpen ? (
                  <div className="planet-details-v4">
                    <dl>
                      <div><dt>Статус</dt><dd>★ {currentPlanet.status}</dd></div>
                      <div><dt>Фракция</dt><dd>{currentPlanet.faction}</dd></div>
                      <div><dt>Координаты</dt><dd>{currentPlanet.coords}</dd></div>
                      <div><dt>Население</dt><dd>{currentPlanetState.population} / {currentPlanetState.populationMax}</dd></div>
                      <div><dt>Энергия</dt><dd>{currentPlanetState.energy}</dd></div>
                      <div><dt>Ресурсные здания</dt><dd>{resourceBuildingCount} / 10</dd></div>
                      <div><dt>Стабильность</dt><dd className="summary-stable">{currentPlanetState.stability}%</dd></div>
                    </dl>
                  </div>
                ) : null}
              </aside>

              <main className="planet-canvas-v3">
                <div className="scene-title scene-title-v3">
                  <small>ОБЗОР ПЛАНЕТЫ</small>
                  <h1>{currentPlanetName.toUpperCase()}</h1>
                  <p>{currentPlanet.coords} • РОДНОЙ МИР АСТЕРОВ</p>
                </div>
                <div className="planet-stage-v3">
                  <div className="planet-atmosphere" />
                  <img className="planet-image-v3" src={currentSkin.art} alt={currentPlanetName} draggable={false} />
                  {(['resource', 'industry', 'military'] as Zone[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`zone-hotspot zone-hotspot--${item}`}
                      style={{ '--zone-accent': zoneMeta[item].accent } as CSSProperties}
                      onClick={() => chooseZone(item)}
                    >
                      <span className="zone-hotspot__icon"><GameIcon kind={item} /></span>
                      <span className="zone-hotspot__label"><strong>{zoneMeta[item].title.replace(' ЗОНА', '')}</strong><small>ЗОНА</small></span>
                    </button>
                  ))}
                </div>
                <div className="planet-status planet-status-v2"><span>●</span> СТАБИЛЬНО <i /> ONLINE</div>
              </main>

              <aside className="queue-panel-v3">
                <div className="page-panel-title"><strong>ОЧЕРЕДЬ СТРОИТЕЛЬСТВА</strong><small>{currentQueue.length} / {BUILDING_QUEUE_CAPACITY}</small></div>
                <div className={`queue-card-v2 ${currentActiveQueueItem ? 'busy' : ''}`}>
                  {currentQueueDefinition ? <img src={currentQueueDefinition.art} alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} /> : <span className="queue-card-v2__icon"><GameIcon kind="resource" /></span>}
                  <span><strong>{currentQueueDefinition?.name ?? 'Свободный слот'}</strong><small>{currentActiveQueueItem ? `Осталось ${formatCountdown(remaining)}` : 'Готов к строительству'}</small></span>
                  <b>{currentActiveQueueItem ? 'I' : '+'}</b>
                  {currentActiveQueueItem ? <div className="queue-progress-v2"><i style={{ width: `${progress}%` }} /></div> : null}
                </div>
                <div className="build-preview-v2">
                  <span className="build-preview-v2__icon"><GameIcon kind="resource" /></span>
                  <div><strong>Ресурсная зона</strong><small>Добыча и энергетика планеты</small></div>
                </div>
                <AegisButton onClick={() => chooseZone('resource')}>ОТКРЫТЬ РЕСУРСНУЮ ЗОНУ</AegisButton>
              </aside>
            </div>
          ) : (
            <main className="module-placeholder-v3">
              <span>ASTERION COMMAND MODULE</span>
              <h1>{activeTab.toUpperCase()}</h1>
              <p>Верхняя командная панель остаётся неизменной. Этот рабочий экран будет реализован отдельным модулем.</p>
            </main>
          )}
        </section>

        <div className="shell-notice shell-notice-v4"><span>{notice}</span><button type="button" onClick={reset}>СБРОСИТЬ ПРОТОТИП</button></div>

        {editingPlanet && editingPlanetState ? (
          <div className="skin-picker-backdrop" onMouseDown={closePlanetEditor}>
            <section className="skin-picker-modal planet-editor-modal-v5" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <div><small>РЕДАКТИРОВАТЬ ПЛАНЕТУ</small><h2>{editingPlanetState.name}</h2><p>{editingPlanet.coords} · {editingPlanet.status}</p></div>
                <button type="button" onClick={closePlanetEditor}>×</button>
              </header>

              <form className="planet-editor-name-v5" onSubmit={(event) => { event.preventDefault(); savePlanetName(); }}>
                <label htmlFor="planet-name-input">НАЗВАНИЕ ПЛАНЕТЫ</label>
                <div>
                  <input
                    id="planet-name-input"
                    value={editingName}
                    maxLength={28}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setEditingName(event.target.value)}
                  />
                  <button type="submit">СОХРАНИТЬ</button>
                </div>
                <small>2–28 символов. Название отображается в шапке, на планете и во Вселенной.</small>
              </form>

              <div className="planet-editor-skins-title-v5"><strong>ОБЛИК ПЛАНЕТЫ</strong><small>Можно менять независимо от названия</small></div>
              <div className="skin-picker-grid">
                {planetSkins.map((skin) => (
                  <button key={skin.id} type="button" className={editingPlanetState.skin === skin.id ? 'active' : ''} onClick={() => chooseSkin(skin)}>
                    <img src={skin.art} alt="" /><span>{skin.label}</span><small>{editingPlanetState.skin === skin.id ? 'АКТИВИРОВАНА' : 'ИСПОЛЬЗОВАТЬ'}</small>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        <footer className="footer-status"><span>ASTERION // COMMAND SHELL V5</span><span>1920×1080 BASE CANVAS</span><span>ESC — WINDOWED</span></footer>
      </div>
    </div>
  );
}
