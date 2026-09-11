import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  APP_ROUTE_LABELS,
  useNavigation,
  type AppRoute,
} from './ui/navigation.tsx';
import { AsterionHeader } from './ui/header/AsterionHeader';
import { ApprovedZoneIcon } from './ui/header/HeaderAssetIcons';
import { GameIcon } from './ui/header/HeaderIcons';
import {
  FLEET_CONSTRUCTION_REQUEST_EVENT,
  canEnterBuildingInterior,
  createBuildingInteriorContext,
  getBuildingInteriorTarget,
  type BuildingInteriorContext as BuildingInteriorNavigationContext,
} from './building-interior-navigation.ts';
import {
  BATTLE_HISTORY_CHANGED_EVENT,
  migrateBattleHistory,
  setBattleReportSaved,
  type BattleHistoryState,
} from './domain/combat/battle-repository.ts';
import {
  COMBAT_PRIORITY_CHANGED_EVENT,
  migrateCombatPriority,
  type CombatPriorityState,
} from './domain/combat/priority.ts';
import {
  SIMULATOR_STATE_CHANGED_EVENT,
  migrateSimulatorState,
  type SimulatorState,
} from './domain/combat/simulator-repository.ts';
import {
  acceptOperation,
  cancelOperation,
  revealOperation,
} from './domain/operations/repository.ts';
import type { OperationId } from './domain/operations/types.ts';
import {
  joinJointOperation,
  markResourceRequestReviewing,
  updateAllianceSettings,
} from './domain/command/repository.ts';
import type { AllianceSettingsInput } from './domain/command/types.ts';
import { CURRENT_PLAYER_FACTION_ID, syncPlayerProfileWithAlliance } from './domain/profile/repository.ts';
import { SCIENCE_CATALOG } from './domain/science/catalog.ts';
import {
  ACTIVE_RUNTIME_MODE,
  resolveTestTimeScale,
  TEST_TIME_SCALE_OPTIONS,
  type TestTimeScale,
  type RuntimeMode,
} from './domain/runtime/mode.ts';
import {
  BUILDING_QUEUE_CAPACITY,
  RESOURCE_BUILDING_ROLES,
  getBuildingDefinition,
  getBuildingEnergyIncomePerHour,
  getBuildingResourceIncomePerHour,
  getStorageCapacities,
  type BuildingRole,
  type BuildingZone,
  type ResourceWallet,
} from './domain/buildings/resource-zone.ts';
import { getProductionBotIncomePerHour, type BotAssignment } from './domain/buildings/production-bots.ts';
import type { ResourceAllocationPercent } from './domain/buildings/recycling.ts';
import {
  getSpaceportUpgradeEntity,
  type SpaceportUpgradeTrack,
  type SpaceportUpgradeWallet,
} from './domain/buildings/spaceport-upgrades.ts';
import {
  type TradeExecution,
  type TradeRequest,
  type TradeWallet,
} from './domain/buildings/trade.ts';
import {
  PLAYER_FACTION_LABELS,
} from './domain/profile/repository.ts';
import type { PlayerFactionId } from './domain/profile/types.ts';
import {
  createInitialSaveState,
  createPersistenceFacade,
  DEFAULT_PLANET_NAME,
  SAVE_SCHEMA_VERSION,
} from './application/persistence.ts';
import {
  applyProductionBots as applyProductionBotsAction,
  cancelBuilding as cancelBuildingAction,
  collectRecycling as collectRecyclingAction,
  destroyBuilding as destroyBuildingAction,
  executeTradeAction,
  previewBuilding,
  startBuilding as startBuildingAction,
  startRecycling as startRecyclingAction,
  startSpaceportUpgrade as startSpaceportUpgradeAction,
} from './application/buildings.ts';
import {
  bindScienceEventBridge,
} from './application/science.ts';
import { getFleetSummaryForState } from './application/fleet.ts';
import { publishApplicationRuntimeSnapshot } from './application/runtime.ts';
import { reconcileRuntime } from './application/reconcile.ts';
import { enqueueApplicationStateUpdate } from './application/state.ts';
import type { PlanetId, SaveState } from './application/contracts.ts';

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

type Zone = BuildingZone;
type PlanetViewMode = 'overview' | Zone;
type BuildingInteriorContext = BuildingInteriorNavigationContext<PlanetId>;

type PlanetDefinition = {
  id: PlanetId;
  coords: string;
  status: 'Основная планета';
  factionId: PlayerFactionId;
};

const ownedPlanets: PlanetDefinition[] = [
  { id: 'helion-01', coords: '[1:1:1]', status: 'Основная планета', factionId: CURRENT_PLAYER_FACTION_ID },
];

const RUNTIME_MODE: RuntimeMode = ACTIVE_RUNTIME_MODE;

const zoneMeta: Record<Zone, { title: string; subtitle: string; accent: string }> = {
  resource: { title: 'РЕСУРСНАЯ ЗОНА', subtitle: 'Добыча и энергия', accent: '#38c8ff' },
  industry: { title: 'ПРОМЫШЛЕННАЯ ЗОНА', subtitle: 'Производство', accent: '#f0ad38' },
  military: { title: 'ВОЕННАЯ ЗОНА', subtitle: 'Оборона и флот', accent: '#ee665d' },
};

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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

function AegisButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className="aegis-button" disabled={disabled} onClick={onClick}><span>{children}</span></button>;
}

export function App() {
  const scale = useStageScale();
  const { route: activeRoute, navigate } = useNavigation();
  const activeTab = APP_ROUTE_LABELS[activeRoute];
  const [planetViewMode, setPlanetViewMode] = useState<PlanetViewMode>('overview');
  const persistence = useMemo(() => createPersistenceFacade({ mode: RUNTIME_MODE }), []);
  const [state, setState] = useState<SaveState>(() => persistence.read());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [now, setNow] = useState(Date.now());
  const [testTimeScale, setTestTimeScale] = useState<TestTimeScale>(() => resolveTestTimeScale());
  const [notice, setNotice] = useState('Система готова. Локальное сохранение активно.');
  const [planetMenuOpen, setPlanetMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [editingPlanetId, setEditingPlanetId] = useState<PlanetId | null>(null);
  const [editingName, setEditingName] = useState(DEFAULT_PLANET_NAME);
  const [selectedBuildingRole, setSelectedBuildingRole] = useState<BuildingRole | null>(null);
  const [buildingInterior, setBuildingInterior] = useState<BuildingInteriorContext | null>(null);

  const navigateTo = (nextRoute: AppRoute) => {
    navigate(nextRoute);
    if (nextRoute === 'fleets') {
      window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
    }
  };

  useEffect(() => {
    if (RUNTIME_MODE !== 'test') return;
    persistence.writeTestTimeScale(testTimeScale);
  }, [persistence, testTimeScale]);

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
  useEffect(() => bindScienceEventBridge({
    target: window,
    getState: () => stateRef.current,
    getContext: (eventNow) => ({
      planetId: 'helion-01',
      mode: RUNTIME_MODE,
      testTimeScale,
      now: eventNow,
      rng: Math.random,
    }),
    commit: (nextState) => {
      stateRef.current = nextState;
      setState(nextState);
    },
    onNotice: setNotice,
  }), [testTimeScale]);
  useEffect(() => {
    persistence.write(state);
  }, [persistence, state]);
  useEffect(() => {
    publishApplicationRuntimeSnapshot(
      state,
      { planetId: 'helion-01', now, mode: RUNTIME_MODE, testTimeScale },
      window,
    );
  }, [now, state, testTimeScale]);
  useEffect(() => {
    const result = reconcileRuntime(stateRef.current, {
      planetId: 'helion-01',
      now,
      mode: RUNTIME_MODE,
      testTimeScale,
    });
    if (!result.changed) return;
    stateRef.current = result.state;
    setState(result.state);
    result.events.forEach((event) => {
      if (event.kind === 'science') {
        const names = event.scienceIds
          .map((scienceId) => SCIENCE_CATALOG.find((science) => science.id === scienceId)?.name ?? `Наука ${scienceId}`)
          .join(', ');
        setNotice(`Наука: исследование завершено — ${names}.`);
      } else if (event.kind === 'building') {
        setNotice(`${result.state.planets['helion-01'].name}: ${getBuildingDefinition(event.assetRole).name} завершено.`);
      } else if (event.kind === 'recycling') {
        setNotice('Результат переработки автоматически зачислен');
      } else if (event.kind === 'spaceport') {
        const names = event.tasks
          .map((task) => getSpaceportUpgradeEntity(task.track, task.shipId)?.name ?? task.shipId)
          .join(', ');
        setNotice(`Космодром: улучшение завершено — ${names}.`);
      }
    });
  }, [now, state, testTimeScale]);

  const currentPlanet = ownedPlanets[0];
  const currentPlanetState = state.planets['helion-01'];
  const currentPlanetName = currentPlanetState.name;
  const fleetSummary = useMemo(
    () => getFleetSummaryForState(state),
    [state],
  );
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
  const spaceportWallet: SpaceportUpgradeWallet = {
    metal: state.metal,
    minerals: state.minerals,
    gas: state.gas,
  };
  const resourceIncomePerHour = useMemo(
    () => getProductionBotIncomePerHour(
      getBuildingResourceIncomePerHour(currentPlanetState.buildings, state.science.levels),
      currentPlanetState.productionBots,
    ),
    [currentPlanetState.buildings, currentPlanetState.productionBots, state.science.levels],
  );
  const energyIncomePerHour = useMemo(
    () => getBuildingEnergyIncomePerHour(currentPlanetState.buildings, state.science.levels),
    [currentPlanetState.buildings, state.science.levels],
  );
  const storageCapacities = useMemo(
    () => getStorageCapacities(currentPlanetState.buildings),
    [currentPlanetState.buildings],
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
    navigateTo('planet');
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
    enqueueApplicationStateUpdate(stateRef, setState, (current) => ({
      state: applyProductionBotsAction(current, {
        planetId: 'helion-01',
        now,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, assignment),
      result: undefined,
    }));
    setNotice('Роботы перераспределены');
  };

  const startRecycling = (debrisAmount: number, allocation: ResourceAllocationPercent) => {
    const startedAt = Date.now();
    const jobId = globalThis.crypto?.randomUUID?.() ?? `recycling-${startedAt}-${Math.random().toString(36).slice(2, 9)}`;
    const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const transition = startRecyclingAction(current, {
        planetId: 'helion-01',
        now: startedAt,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, debrisAmount, allocation, jobId);
      return {
        state: transition.ok ? transition.state : current,
        result: transition,
      };
    });
    if (!result.ok) {
      setNotice(result.reason ?? 'Переработка сейчас недоступна');
      return false;
    }
    setNotice('Переработка запущена');
    return true;
  };

  const collectRecycling = (jobId: string) => {
    const collectedAt = Date.now();
    const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const transition = collectRecyclingAction(current, {
        planetId: 'helion-01',
        now: collectedAt,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, jobId);
      return { state: transition.state, result: transition };
    });
    if (!result.ok || !result.output) {
      setNotice(result.reason ?? 'Ресурс пока недоступен');
      return false;
    }
    setNotice('Ресурсы получены');
    return true;
  };

  const tradeResources = (request: TradeRequest): TradeExecution => {
    const tradedAt = Date.now();
    const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const transition = executeTradeAction(current, {
        planetId: 'helion-01',
        now: tradedAt,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, current.rating.resourcePoints, request);
      return { state: transition.state, result: transition.execution };
    });
    if (!result.ok) {
      setNotice(result.reason ?? 'Обмен сейчас недоступен');
      return result;
    }
    setNotice('Обмен выполнен');
    return result;
  };

  const startSpaceportUpgrade = (track: SpaceportUpgradeTrack, shipId: string) => {
    const enqueuedAt = Date.now();
    const taskId = globalThis.crypto?.randomUUID?.() ?? `spaceport-${track}-${shipId}-${enqueuedAt}-${Math.random().toString(36).slice(2, 9)}`;
    const result = startSpaceportUpgradeAction(stateRef.current, {
      planetId: 'helion-01',
      now: enqueuedAt,
      mode: RUNTIME_MODE,
      testTimeScale,
    }, track, shipId, taskId);
    if (!result.ok) {
      setNotice(result.reason ?? 'Улучшение сейчас недоступно.');
      return false;
    }
    stateRef.current = result.state;
    setState(result.state);
    setNotice(`Космодром: ${result.entityName} добавлен в очередь улучшений.`);
    return true;
  };

  const buildBuilding = (assetRole: BuildingRole) => {
    const enqueuedAt = Date.now();
    const context = { planetId: 'helion-01' as PlanetId, now: enqueuedAt, mode: RUNTIME_MODE, testTimeScale };
    const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const availability = previewBuilding(current, context, assetRole).availability;
      if (!availability.canBuild) {
        return {
          state: current,
          result: { ok: false, state: current, reason: availability.reason },
        };
      }
      const transition = startBuildingAction(current, context, assetRole);
      return {
        state: transition.ok ? transition.state : current,
        result: transition,
      };
    });
    if (!result.ok) {
      setNotice(result.reason ?? 'Строительство сейчас недоступно.');
      return false;
    }
    setNotice(`${currentPlanetName}: ${getBuildingDefinition(assetRole).name} добавлено в общую очередь.`);
    return true;
  };

  const cancelBuilding = (queueId: string) => {
    const canceledAt = Date.now();
    const current = stateRef.current;
    const result = cancelBuildingAction(current, {
      planetId: 'helion-01',
      now: canceledAt,
      mode: RUNTIME_MODE,
      testTimeScale,
    }, queueId);
    if (!result.ok) {
      setNotice(result.reason ?? 'Отмена строительства сейчас недоступна.');
      return false;
    }
    stateRef.current = result.state;
    setState(result.state);
    const canceledDefinition = result.canceledRole
      ? getBuildingDefinition(result.canceledRole)
      : null;
    const cascadedCount = result.cascadedCount;
    setNotice(`${canceledDefinition?.name ?? 'Проект'} отменён.${cascadedCount > 0 ? ` Каскадно отменено ещё ${cascadedCount} зависимых проектов.` : ''} Возвращено 90% сохранённых ресурсов.`);
    return true;
  };

  const destroyBuilding = (assetRole: BuildingRole) => {
    const current = stateRef.current;
    const result = destroyBuildingAction(current, {
      planetId: 'helion-01',
      now,
      mode: RUNTIME_MODE,
      testTimeScale,
    }, assetRole);
    if (!result.ok) {
      setNotice(result.reason ?? 'Разрушение уровня сейчас недоступно.');
      return false;
    }
    stateRef.current = result.state;
    setState(result.state);
    setNotice(`${getBuildingDefinition(assetRole).name}: уровень разрушен. Возвращено ${result.refundPercent}% ресурсов.`);
    return true;
  };

  const closePlanetEditor = () => {
    setEditingPlanetId(null);
    setEditingName(state.planets['helion-01'].name);
  };

  const reset = () => {
    persistence.clear();
    const nextState = createInitialSaveState(RUNTIME_MODE);
    stateRef.current = nextState;
    setState(nextState);
    setPlanetMenuOpen(false);
    setEditingPlanetId(null);
    setEditingName(DEFAULT_PLANET_NAME);
    setDetailsOpen(true);
    setPlanetViewMode('overview');
    setSelectedBuildingRole(null);
    setBuildingInterior(null);
    setNotice(RUNTIME_MODE === 'test' ? 'Тестовое сохранение сброшено.' : 'Сохранение прототипа сброшено.');
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
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Флоты: подготовьте состав для принятой операции.');
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
    setState((current) => {
      const command = updateAllianceSettings(current.command, input);
      return { ...current, command, profile: syncPlayerProfileWithAlliance(current.profile, command.alliance) };
    });
    setNotice('Настройки союза сохранены в локальном прототипе.');
  };

  const openFleetRootFromCommand = () => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Флоты: подготовьте состав для союзной задачи. Отправка не запускается автоматически.');
  };

  const openFleetRootFromReports = () => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Флоты: выберите состав для союзной операции из отчётов.');
  };

  const openCommandFromReports = () => {
    clearBuildingInterior();
    navigateTo('command');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Командование: профиль союза открыт из центра сообщений.');
  };

  const toggleBattleSavedFromReports = (reportId: string, saved: boolean) => {
    const current = stateRef.current;
    const nextState: SaveState = {
      ...current,
      schemaVersion: SAVE_SCHEMA_VERSION,
      combat: migrateBattleHistory(setBattleReportSaved(current.combat, reportId, saved)),
    };
    stateRef.current = nextState;
    setState(nextState);
    setNotice(saved ? 'Боевой доклад сохранён.' : 'Боевой доклад удалён из сохранённых.');
  };

  const returnToBuilding = () => {
    if (!buildingInterior) return;
    const context = buildingInterior;
    const definition = getBuildingDefinition(context.buildingRole);
    setBuildingInterior(null);
    setState((current) => current.currentPlanetId === context.planetId
      ? current
      : { ...current, currentPlanetId: context.planetId });
    navigateTo('planet');
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
      navigateTo('planet');
      setPlanetViewMode(context.zone);
      setNotice(`${getBuildingDefinition(assetRole).name}: внутренний модуль открыт.`);
      return;
    }
    if (target.kind === 'fleet-construction') {
      navigateTo('fleets');
      setNotice('Верфь: открыт существующий раздел строительства флота.');
      window.setTimeout(() => window.dispatchEvent(new Event(FLEET_CONSTRUCTION_REQUEST_EVENT)), 0);
      return;
    }
    if (target.kind === 'science') {
      navigateTo('science');
      setNotice('Лаборатория: открыт существующий раздел «Наука».');
      return;
    }

    navigateTo('command');
    setNotice('Палата управления: открыт существующий раздел «Командование».');
  };

  const chooseRoute = (nextRoute: AppRoute) => {
    clearBuildingInterior();
    navigateTo(nextRoute);
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    if (nextRoute === 'universe') setNotice('Галактика 1 загружена. Доступно 40 солнечных систем.');
    else if (nextRoute === 'operations') setNotice('Операции: доступные PvE-сценарии загружены.');
    else if (nextRoute === 'command') setNotice('Командование: союзный контур загружен.');
    else if (nextRoute === 'reports') setNotice('Отчёты: центр сообщений и боевых журналов загружен.');
    else if (nextRoute === 'planet') setNotice(`${currentPlanetName}: обзор планеты.`);
    else setNotice(`Экран «${APP_ROUTE_LABELS[nextRoute]}» пока в разработке.`);
  };

  const chooseZone = (nextZone: Zone) => {
    clearBuildingInterior();
    navigateTo('planet');
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
    : activeRoute === 'universe'
      ? 'universe'
      : activeRoute === 'planet' && planetViewMode !== 'overview'
        ? 'resource-zone'
        : activeRoute === 'planet'
          ? 'planet'
          : activeRoute === 'operations'
            ? 'operations'
            : activeRoute === 'command'
              ? 'command'
              : activeRoute === 'reports'
                ? 'reports'
                : 'module';

  return (
    <div className="viewport">
      <div className="stage stage-shell-v3 stage-shell-v4" style={{ transform: `scale(${scale})`, '--space-bg': `url(${systemBackground})` } as CSSProperties}>
        <AsterionHeader
          factionId={state.profile.factionId}
          currentPlanet={{
            id: currentPlanet.id,
            name: currentPlanetName,
            coords: currentPlanet.coords,
            status: currentPlanet.status,
            art: currentSkin.art,
          }}
          planets={ownedPlanets.map((planet) => ({
            id: planet.id,
            name: planet.id === currentPlanet.id ? currentPlanetName : planet.id,
            coords: planet.coords,
            status: planet.status,
            art: planet.id === currentPlanet.id ? currentSkin.art : currentSkin.art,
          }))}
          resources={[
             { kind: 'metal', label: 'МЕТАЛЛ', value: state.metal, capacity: storageCapacities.metal, hourlyGain: resourceIncomePerHour.metal },
             { kind: 'mineral', label: 'МИНЕРАЛЫ', value: state.minerals, capacity: storageCapacities.minerals, hourlyGain: resourceIncomePerHour.minerals },
             { kind: 'gas', label: 'ГАЗ', value: state.gas, capacity: storageCapacities.gas, hourlyGain: resourceIncomePerHour.gas },
             { kind: 'energy', label: 'ЭНЕРГИЯ', value: currentPlanetState.energy, hourlyGain: energyIncomePerHour, description: 'Энергия/ч — вычисляемый доход; строительство энерго-зданий отдельно меняет запас энергии.' },
            { kind: 'population', label: 'НАСЕЛЕНИЕ', value: fleetSummary.population, capacity: fleetSummary.capacity, showCapacity: false },
          ]}
          zoneMeta={zoneMeta}
          activeRoute={activeRoute}
          activeZone={activeRoute === 'planet' && planetViewMode !== 'overview' ? planetViewMode : null}
          planetMenuOpen={planetMenuOpen}
            campaign={{ now, mode: RUNTIME_MODE, timeScale: testTimeScale, saveKey: persistence.saveKey, timeScaleOptions: TEST_TIME_SCALE_OPTIONS, onTimeScaleChange: setTestTimeScale }}
          onRouteChange={chooseRoute}
          onZoneChange={chooseZone}
          onPlanetChange={(planetId) => {
            if (planetId === currentPlanet.id) selectPlanet(currentPlanet.id);
          }}
          onPlanetMenuToggle={() => setPlanetMenuOpen((open) => !open)}
         />

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
              scienceLevels={state.science.levels}
              productionBots={currentPlanetState.productionBots}
              recycling={currentPlanetState.recycling}
              trade={currentPlanetState.trade}
              tradeWallet={tradeWallet}
              spaceportUpgrades={currentPlanetState.spaceportUpgrades}
              spaceportWallet={spaceportWallet}
              resourceRatingPoints={state.rating.resourcePoints}
              now={now}
              onProductionBotsApply={applyProductionBots}
              onRecyclingStart={startRecycling}
              onRecyclingCollect={collectRecycling}
              onTrade={tradeResources}
              onSpaceportUpgrade={startSpaceportUpgrade}
              onBack={returnToBuilding}
            />
          ) : activeRoute === 'universe' ? (
            <UniverseView
              onNotice={setNotice}
              ownedPlanetArt={currentSkin.art}
              ownedPlanetName={currentPlanetName}
              profile={state.profile}
              rating={state.rating}
              command={state.command}
            />
          ) : activeRoute === 'operations' ? (
            <OperationsView
              state={state.operations}
              onAccept={acceptOperationsOperation}
              onCancel={cancelOperationsOperation}
              onReveal={revealOperationsOperation}
              onOpenFleets={openFleetRootFromOperations}
            />
          ) : activeRoute === 'command' ? (
            <CommandView
              state={state.command}
              onJoinOperation={joinCommandOperation}
              onReviewRequest={reviewCommandRequest}
              onSaveSettings={saveCommandSettings}
              onOpenFleets={openFleetRootFromCommand}
            />
          ) : activeRoute === 'reports' ? (
            <ReportsView
              battleReports={state.combat.reports}
              savedBattleReportIds={state.combat.savedReportIds}
              operations={state.operations}
              command={state.command}
              profile={state.profile}
              rating={state.rating}
              state={state.reports}
              onStateChange={(reports) => setState((current) => ({ ...current, reports }))}
              onToggleBattleSaved={toggleBattleSavedFromReports}
              onOpenFleets={openFleetRootFromReports}
              onOpenCommand={openCommandFromReports}
            />
          ) : activeRoute === 'planet' && planetViewMode !== 'overview' ? (
            <ZoneView
              zone={planetViewMode}
              planetName={currentPlanetName}
              planetCoords={currentPlanet.coords}
              resources={resourceWallet}
              resourceIncomePerHour={resourceIncomePerHour}
              productionBotAssignment={currentPlanetState.productionBots}
              buildings={currentPlanetState.buildings}
              queue={currentQueue}
              scienceLevels={state.science.levels}
              now={now}
              selectedRole={selectedBuildingRole}
              onSelectedRoleChange={setSelectedBuildingRole}
              onBuild={buildBuilding}
              onCancelBuilding={cancelBuilding}
              onDestroyBuilding={destroyBuilding}
              onEnterBuilding={enterBuilding}
            />
          ) : activeRoute === 'planet' ? (
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
                      <div><dt>Фракция</dt><dd>{PLAYER_FACTION_LABELS[state.profile.factionId]}</dd></div>
                      <div><dt>Координаты</dt><dd>{currentPlanet.coords}</dd></div>
                      <div><dt>Население</dt><dd>{fleetSummary.population} / {fleetSummary.capacity}</dd></div>
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
                      <span className="zone-hotspot__icon"><ApprovedZoneIcon kind={item} /></span>
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

        <div className="shell-notice shell-notice-v4" data-qa-runtime-mode={RUNTIME_MODE}>
          <span>{notice}</span>
          <button type="button" onClick={reset}>{RUNTIME_MODE === 'test' ? 'СБРОСИТЬ ТЕСТОВОЕ СОХРАНЕНИЕ' : 'СБРОСИТЬ ПРОТОТИП'}</button>
        </div>

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
