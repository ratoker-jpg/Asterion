import { dispatchBot01Exploration } from './application/exploration-bot01.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync, createPortal } from 'react-dom';
import './planet-skins.css';
import './universe.css';
import { UniverseView } from './UniverseView';
import { OperationsView } from './OperationsView';
import { createOperationsVariantAQaFixture, getOperationsVariantAQaStatus } from './operations-variant-a-qa-fixture.ts';
import { createUniverseNpcOwnerProfile, rerollTestUniverseLayout, TEST_MODE_ALLY_PLANET_FIXTURE, UNIVERSE_NPC_OWNER_ID } from './domain/universe/runtime.ts';
import { CommandView, type CommandActionResult, type CommandActions } from './CommandView';
import { ReportsView } from './ReportsView';
import { buildReportsFeed, getReportUnreadCounts } from './domain/reports/adapters.ts';
import { ZONE_VIEW_META, ZoneView } from './ZoneView';
import { PlanetOrbitView } from './ui/planet/PlanetOrbitView';
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
} from './domain/operations/repository.ts';
import type { OperationId } from './domain/operations/types.ts';
import {
  acceptApplication,
  applyToAlliance,
  createAlliance,
  kickMember,
  leaveAlliance,
  rejectApplication,
  refreshPresence,
  setDeputy,
  transferLeadership,
  updateAllianceSettings,
  withdrawApplication,
} from './domain/command/membership.ts';
import { selectCommandHallLevel, selectOwnerMembership } from './domain/command/selectors.ts';
import { declareWar, proposeTruce, respondTruce } from './domain/command/diplomacy.ts';
import { releaseTestBotFromOwnAlliance } from './domain/command/repository.ts';
import type { AllianceSettingsInput, CommandResult, CommandState } from './domain/command/types.ts';
import { syncPlayerProfileWithCommand } from './domain/profile/repository.ts';
import { withTestOwnerScoreFixtures } from './domain/rating/fixtures.ts';
import { SCIENCE_CATALOG } from './domain/science/catalog.ts';
import {
  ACTIVE_RUNTIME_MODE,
  scaleRuntimeDuration,
  dispatchRuntimeReset,
  getRuntimeElapsedScale,
  resolveTestTimeScale,
  TEST_TIME_SCALE_OPTIONS,
  type TestTimeScale,
  type RuntimeMode,
} from './domain/runtime/mode.ts';
import {
  BUILDING_QUEUE_CAPACITY,
  BUILDING_CANCEL_REFUND_PERCENT,
  RESOURCE_BUILDING_ROLES,
  getBuildingDefinition,
  getBuildingsForZone,
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
import { selectOwnerScores } from './domain/rating/scoring.ts';
import { advancePirateThreat, pirateRaidChance } from './domain/pirates/threat.ts';
import {defaultPirateOwnerAdaptation} from './domain/pirates/adaptive.ts';
import { buildPirateBattleAnalysisExport } from './application/pirate-battle-export.ts';
import {
  createInitialSaveState,
  createPersistenceFacade,
  DEFAULT_PLANET_NAME,
  SAVE_SCHEMA_VERSION,
  isCurrentBuildSave,
} from './application/persistence.ts';
import {
  applyProductionBots as applyProductionBotsAction,
  cancelBuilding as cancelBuildingAction,
  collectRecycling as collectRecyclingAction,
  cancelSpaceportUpgrade as cancelSpaceportUpgradeAction,
  destroyBuilding as destroyBuildingAction,
  describeBuildingRefund,
  executeTradeAction,
  previewBuilding,
  startBuilding as startBuildingAction,
  startRecycling as startRecyclingAction,
  startSpaceportUpgrade as startSpaceportUpgradeAction,
} from './application/buildings.ts';
import {
  bindScienceEventBridge,
} from './application/science.ts';
import {
  bindFleetProductionEventBridge,
} from './application/fleet-production.ts';
import {
  bindCombatResultEventBridge,
  bindRepairEventBridge,
} from './application/repair.ts';
import { bindCombatResolutionEventBridge } from './application/combat.ts';
import { getFleetProductionEntity } from './domain/fleet/production.ts';
import { getFleetBuildBudget, getFleetSummaryForState, getOutgoingFleetSummaryForState, getPlanetPopulationForState } from './application/fleet.ts';
import { getPendingInboundPopulation } from './application/flights.ts';
import {
  cancelAidRequest,
  createAidRequest,
  createIraAidRequest,
  prepareIraAidFixture,
  previewRequestOverflow,
  reconcileAidMembership,
  selectAidOverview,
  selectRequestProgress,
  syncAidState,
  type AidActionResult,
} from './application/alliance-aid.ts';
import { TEST_ALLY_OWNER_ID, TEST_BOT_ALLIANCE_ID } from './domain/command/catalog.ts';
import type { AidResource } from './domain/command/types.ts';
import { getPlanetOverpopulationSummary } from './application/overpopulation.ts';
import { energySummaryForPlanet, getPlanetEnergyCoordinates } from './application/energy.ts';
import { getEffectiveResourceIncomePerHour } from './application/resource-clock.ts';
import { publishApplicationRuntimeSnapshot } from './application/runtime.ts';
import { reconcileRuntime } from './application/reconcile.ts';
import {
  FLIGHT_COMMAND_RESULT_EVENT,
  FLIGHT_DISPATCH_REQUEST_EVENT,
  FLIGHT_EDIT_TARGET_REQUEST_EVENT,
  FLIGHT_LAUNCH_CONTEXT_EVENT,
  FLIGHT_RECALL_REQUEST_EVENT,
  BOT01_INCOMING_SCENARIO_REQUEST_EVENT,
  BOT01_EXPLORATION_SCENARIO_REQUEST_EVENT,
  SPY_REPORT_ALL_REQUEST_EVENT,
  SPY_REPORT_REQUEST_EVENT,
  UNIVERSE_COORDINATE_OPEN_EVENT,
  SPY_REPORT_RESULT_EVENT,
  dispatchFlight,
  dispatchNpcAidFlight,
  startBot01IncomingScenario,
  requestAllSpyReports,
  requestSpyReport,
  recallFlight,
  type DispatchFlightCommand,
  type FlightLaunchContext,
} from './application/flights.ts';
import { createSimulatorScenarioFromSpyReport, requestSimulatorHandoff } from './application/simulator-handoff.ts';
import type { SpyReportSnapshot } from './domain/espionage/types.ts';
import { getEspionageTargets, getEspionageState } from './domain/espionage/runtime.ts';
import { getOrbitalDebrisByCoordinate } from './domain/espionage/orbital-debris.ts';
import type { UniverseCoordinate, UniverseObjectKind, UniverseOwnerProfile } from './domain/universe/types.ts';
import {
  APPLICATION_COMMAND_REQUEST_EVENTS,
  enqueueApplicationStateUpdate,
  isApplicationCommandBlocked,
  isGameplayCommandRequestEvent,
  NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE,
} from './application/state.ts';
import { getOwnerShipUpgradeLevels, getPlanetResources, type PlanetId, type SaveState } from './application/contracts.ts';
import { selectOwnedPlanet } from './application/owned-planets.ts';
import type { TargetRelation } from './domain/flights/types.ts';
import { materializePirateProfiles, pirateContactOperation, pirateOperationId, selectOwnedPiratePresentations, selectOwnedPirateTargets, selectPirateContacts } from './application/pirate-presentation.ts';
import { selectExplorationTargets, getExplorationTarget, explorationTargetStatus, selectExplorationOperations } from './application/exploration.ts';
import { acceptLiveExploration, cancelLiveExploration } from './application/exploration-operations.ts';
import type { PirateContactPresentation, PirateSystemSelection } from './pirate-ui.ts';
import { startBot01GateAssault } from './application/flights.ts';
import {
  currentSunRaidState,
  formatSun,
  OPEN_SUN_OPERATIONS_EVENT,
  publishSunBrightness,
  selectGateContext,
  selectIncomingSunAlerts,
  startGateConstruction,
  type SunActionResult,
} from './application/sun-raid.ts';
import { refreshSlotMeta } from './application/slots.ts';
import { gateProgressPercent } from './domain/sun-raid/rules.ts';
import { getCampaignTimeScale, setCampaignTimeScale, CAMPAIGN_SPEED_SCALE } from './domain/runtime/mode.ts';
import { setActiveGalaxyCount } from './domain/universe/runtime.ts';
import { SunRaidPanel, type SunSelection } from './ui/sun-raid/SunRaidPanel.tsx';
import { GateDialog } from './ui/sun-raid/GateDialog.tsx';
import { CampaignResultOverlay, PauseMenu } from './ui/menu/InGameOverlays.tsx';
import { reloadToMenu, type ActiveSession } from './ui/menu/session.ts';

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
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';

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
  ...asterionAssetIntegrationAssets.regularPlanetSkins,
] as const;

type Zone = BuildingZone;
type PlanetViewMode = 'overview' | Zone;
type BuildingInteriorContext = BuildingInteriorNavigationContext<PlanetId>;
type UniverseFocusTarget = {
  coordinate: UniverseCoordinate;
  planetId?: string;
  ownerId?: string;
  /** 'inspect' opens the owner inspector; 'highlight' only pulses the planet. */
  mode?: 'inspect' | 'highlight';
};

/** Runtime toasts replace the legacy single status strip. */
type RuntimeToast = {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
};

const TOAST_AUTO_CLOSE_MS = 3_000;
const TOAST_STACK_LIMIT = 3;

/**
 * Navigation noise the plan explicitly silences: section/route openings, zone
 * scenes, planet selection and placeholder screens never become toasts.
 * Everything else (completions, spy reports, action errors) stays visible.
 */
const SILENT_NOTICE_PATTERNS: readonly RegExp[] = [
  /^Система готова/,
  /^Галактика \d+ загружена/,
  /^Операции: доступные PvE-сценарии загружены/,
  /^Командование: союзный контур загружен/,
  /^Отчёты: центр сообщений/,
  /пока в разработке\.$/,
  /^Вселенная: открыта координата/,
  /^Галактика \d+ · Солнечная система \d+/,
  /выбрана как текущая планета\.$/,
  /^Цель колонизации выбрана/,
  /^Лаборатория: открыт существующий раздел/,
  /^Палата управления: открыт существующий раздел/,
  /: сцена открыта для /,
  /^Флоты: подготовьте состав/,
  /^(?:Своя|Союзная) цель выбрана/,
  /: обзор планеты\.$/,
];

type PlanetDefinition = {
  id: PlanetId;
  coords: string;
  status: string;
  factionId: PlayerFactionId;
};

const RUNTIME_MODE: RuntimeMode = ACTIVE_RUNTIME_MODE;

/**
 * Test Mode only: `?faction=synod|veyra` (or the older `?headerFaction=`) previews
 * another race's interface theme. Presentation only, never saved.
 */
const HEADER_FACTION_PREVIEW = (() => {
  if (RUNTIME_MODE !== 'test' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get('faction') ?? params.get('headerFaction');
  return value === 'aegis' || value === 'synod' || value === 'veyra' ? value : null;
})();

const zoneMeta: Record<Zone, { title: string; subtitle: string; accent: string }> = {
  resource: { title: 'РЕСУРСНАЯ ЗОНА', subtitle: 'Добыча и энергия', accent: '#38c8ff' },
  industry: { title: 'ПРОМЫШЛЕННАЯ ЗОНА', subtitle: 'Производство', accent: '#f0ad38' },
  military: { title: 'ВОЕННАЯ ЗОНА', subtitle: 'Оборона и флот', accent: '#ee665d' },
};

/** Building that represents each zone on the planet overview hotspots. */
const PLANET_ZONE_EMBLEM_ROLE = { resource: 'metal-production-1', industry: 'construction', military: 'shipyard' } as const;

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function useStageScale() {
  const calc = () => Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const [scale, setScale] = useState(calc);
  useEffect(() => {
    // The long-page stage sits at the same letterbox offset as the centred fixed stage.
    document.documentElement.style.setProperty('--asterion-stage-top', `${Math.max(0, Math.round((window.innerHeight - 1080 * scale) / 2))}px`);
  }, [scale]);
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

/** Applies the loaded campaign's fixed parameters (speed, galaxies, dimmed Suns) to the runtime. */
function applyCampaignRuntime(state: SaveState, mode: RuntimeMode) {
  if (mode === 'production') setCampaignTimeScale(CAMPAIGN_SPEED_SCALE[state.worldConfig?.world.campaignSpeed ?? 'standard'] ?? 1);
  setActiveGalaxyCount(state.worldConfig?.world.galaxyCount ?? 1);
  publishSunBrightness(state, Date.now());
}

const SPEED_SUFFIX: Record<string, string> = { slow: ' ×0.5', standard: '', fast: ' ×2' };

export function App({ session = null }: { session?: ActiveSession | null } = {}) {
  const scale = useStageScale();
  const { route: activeRoute, fleetSection: activeFleetSection, navigate } = useNavigation();
  const activeTab = APP_ROUTE_LABELS[activeRoute];
  const [planetViewMode, setPlanetViewMode] = useState<PlanetViewMode>('overview');
  const persistence = useMemo(() => createPersistenceFacade({ mode: RUNTIME_MODE }), []);
  const [renderedState, setRenderedState] = useState<SaveState>(() => {
    const loaded = persistence.read();
    applyCampaignRuntime(loaded, RUNTIME_MODE);
    return loaded;
  });
  const state = renderedState;
  const stateRef = useRef(state);
  const runtimeReconcileRef = useRef<((at: number) => void) | null>(null);
  const npcReplayContinuation = useRef<number | null>(null);
  const scheduleNpcReplayRef = useRef<() => void>(() => {});
  const lastNpcReplayPublishAt = useRef(0);
  const [now, setNow] = useState(Date.now());
  const [testTimeScale, setTestTimeScale] = useState<TestTimeScale>(() => resolveTestTimeScale());
  const [toasts, setToasts] = useState<RuntimeToast[]>([]);
  const [lastNotice, setLastNotice] = useState('Система готова. Локальное сохранение активно.');
  const noticeSeq = useRef(0);
  const persistenceFailureNotified = useRef(false);

  /**
   * Keeps the QA notice layer in sync and emits a bottom-left toast. Silent
   * navigation noise still lands in the QA layer but never renders a toast.
   */
  const setNotice = useCallback((text: string, tone: RuntimeToast['tone'] = 'info') => {
    setLastNotice(text);
    if (SILENT_NOTICE_PATTERNS.some((pattern) => pattern.test(text))) return;
    noticeSeq.current += 1;
    const id = noticeSeq.current;
    setToasts((current) => current.some((toast) => toast.text === text)
      ? current
      : [...current, { id, text, tone }].slice(-TOAST_STACK_LIMIT));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_AUTO_CLOSE_MS);
  }, []);
  const cancelNpcReplayContinuation = useCallback(() => {
    if (npcReplayContinuation.current !== null) {
      window.clearTimeout(npcReplayContinuation.current);
      npcReplayContinuation.current = null;
    }
  }, []);
  const scheduleNpcReplayContinuation = useCallback(() => {
    if (!isApplicationCommandBlocked(stateRef.current)) {
      cancelNpcReplayContinuation();
      return;
    }
    if (npcReplayContinuation.current !== null) return;
    npcReplayContinuation.current = window.setTimeout(() => {
      npcReplayContinuation.current = null;
      runtimeReconcileRef.current?.(Date.now());
      if (isApplicationCommandBlocked(stateRef.current)) scheduleNpcReplayRef.current();
    }, 0);
  }, [cancelNpcReplayContinuation]);
  scheduleNpcReplayRef.current = scheduleNpcReplayContinuation;
  const setState = useCallback((update: SaveState | ((current: SaveState) => SaveState)) => {
    const current = stateRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    stateRef.current = next;
    if (isApplicationCommandBlocked(next)) scheduleNpcReplayRef.current();
    else cancelNpcReplayContinuation();
    setRenderedState(next);
  }, [cancelNpcReplayContinuation]);
  const persistSaveState = useCallback((save: SaveState) => {
    const result = persistence.write(save);
    if (!result.ok) {
      if (!persistenceFailureNotified.current) {
        persistenceFailureNotified.current = true;
        const reason = result.error.trim().slice(0, 160);
        setNotice(reason ? `Не удалось сохранить игру: ${reason}` : 'Не удалось сохранить игру в браузере.', 'error');
      }
      return false;
    }
    persistenceFailureNotified.current = false;
    return true;
  }, [persistence, setNotice]);
  const rejectNpcCatchupCommand = useCallback(() => {
    const current = stateRef.current;
    const hasRegisteredNpcReplay = Object.values(current.espionage?.targets ?? {}).some((target) =>
      target.kind === 'npc' && target.ownerId !== UNIVERSE_NPC_OWNER_ID && Boolean(current.npc?.profiles[target.ownerId]),
    );
    if (hasRegisteredNpcReplay) runtimeReconcileRef.current?.(Date.now());
    if (!isApplicationCommandBlocked(stateRef.current)) return false;
    setNotice(NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE, 'error');
    return true;
  }, [setNotice]);
  useEffect(() => {
    const handledByApp = new Set<string>([
      FLIGHT_DISPATCH_REQUEST_EVENT,
      FLIGHT_RECALL_REQUEST_EVENT,
      BOT01_INCOMING_SCENARIO_REQUEST_EVENT,
      BOT01_EXPLORATION_SCENARIO_REQUEST_EVENT,
      SPY_REPORT_REQUEST_EVENT,
      SPY_REPORT_ALL_REQUEST_EVENT,
    ]);
    const onCommandRequest = (event: Event) => {
      if (!isGameplayCommandRequestEvent(event.type) || handledByApp.has(event.type)
        || !rejectNpcCatchupCommand()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of APPLICATION_COMMAND_REQUEST_EVENTS) window.addEventListener(type, onCommandRequest, true);
    return () => APPLICATION_COMMAND_REQUEST_EVENTS.forEach((type) => window.removeEventListener(type, onCommandRequest, true));
  }, [rejectNpcCatchupCommand]);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const [planetMenuOpen, setPlanetMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [editingPlanetId, setEditingPlanetId] = useState<PlanetId | null>(null);
  const [editingName, setEditingName] = useState(DEFAULT_PLANET_NAME);
  const [selectedBuildingRole, setSelectedBuildingRole] = useState<BuildingRole | null>(null);
  const [buildingInterior, setBuildingInterior] = useState<BuildingInteriorContext | null>(null);
  const [universeFocusTarget, setUniverseFocusTarget] = useState<UniverseFocusTarget | null>(null);
  const [pirateSystem, setPirateSystem] = useState<PirateSystemSelection>(() => ({ galaxy: state.planets[state.currentPlanetId]?.universeGalaxy ?? 1, system: state.planets[state.currentPlanetId]?.universeSystem ?? 1 }));
  const [pirateFocusTarget, setPirateFocusTarget] = useState<Pick<PirateContactPresentation, 'coordinate' | 'contactCycleKey'> | null>(null);
  const [pirateReportId, setPirateReportId] = useState<string | undefined>();
  const exportPirateBattleAnalysis = useCallback(() => {
    if (RUNTIME_MODE !== 'test') return;
    try {
      const payload = buildPirateBattleAnalysisExport(stateRef.current);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `asterion-pirate-battles-${payload.currentState.exportedBattleCount}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(`Пиратские бои: выгружено ${payload.currentState.exportedBattleCount} отчётов в JSON.`, 'success');
    } catch {
      setNotice('Не удалось подготовить выгрузку пиратских боёв.', 'error');
    }
  }, [setNotice]);

  const pirateContacts = useMemo(() => {
    if (activeRoute !== 'operations' && activeRoute !== 'universe') return [];
    return activeRoute === 'operations'
      ? selectOwnedPiratePresentations(state, now)
      : selectPirateContacts(state, now, pirateSystem);
  }, [activeRoute, state, now, pirateSystem]);
  const operationsVariantAFixtureStatus = getOperationsVariantAQaStatus(RUNTIME_MODE);
  const fixturePirateContact = pirateContacts[0];
  const operationsVariantAFixture = useMemo(() => operationsVariantAFixtureStatus && fixturePirateContact
    ? createOperationsVariantAQaFixture(fixturePirateContact, state.profile.playerId, operationsVariantAFixtureStatus)
    : null,
  [operationsVariantAFixtureStatus, fixturePirateContact?.contactCycleKey, state.profile.playerId]);
  const completedPirateOperations = useMemo(() => {
    if (activeRoute !== 'operations') return [];
    const reports = new Map(state.combat.reports.map((report) => [report.id, report]));
    const successfulFlights = new Map(state.flights.records
      .filter((flight) => flight.missionId === 'pirate-elimination'
        && flight.pirateSnapshot && flight.attackResolution?.reportId
        && reports.has(flight.attackResolution.reportId))
      .map((flight) => [`${flight.pirateSnapshot!.contactCycleKey}:${flight.attackResolution!.resolvedAt}`, flight.attackResolution!.reportId]));
    return Object.values(state.pirate?.contact.defeatedCycles ?? {})
      .sort((left, right) => right.defeatedAt - left.defeatedAt)
      .flatMap((defeat) => {
        const reportId = successfulFlights.get(`${defeat.contactCycleKey}:${defeat.defeatedAt}`);
        const report = reportId ? reports.get(reportId) : undefined;
        return reportId && report ? [{
          cycleKey: defeat.contactCycleKey, coordinate: defeat.coordinate, reportId, defeatedAt: defeat.defeatedAt,
          rounds: report.roundCount, debris: report.debris ?? 0,
          ...(report.pirateReward ? {reward:report.pirateReward}:{}),
        }] : [];
      })
      .slice(0, 50);
  }, [activeRoute, state.pirate?.contact.defeatedCycles, state.flights.records, state.combat.reports]);

  // Expired accepted targets are no longer actionable. Drop their saved UI
  // selections instead of accumulating one entry for every abandoned cycle.
  useEffect(() => {
    if (activeRoute !== 'operations') return;
    const liveIds = new Set(pirateContacts.map((contact) => pirateOperationId(contact.contactCycleKey)));
    const current = stateRef.current;
    const nextItems = current.operations.items.filter((item) => !item.id.startsWith('pirate:pirate-cycle-v1:') || liveIds.has(item.id));
    if (nextItems.length !== current.operations.items.length) {
      const next = { ...current, operations: { items: nextItems } };
      stateRef.current = next;
      setState(next);
    }
  }, [activeRoute, pirateContacts, now]);

  const onPirateSystemChange = useCallback((selection: PirateSystemSelection) => {
    setPirateSystem((current) => current.galaxy === selection.galaxy && current.system === selection.system ? current : selection);
  }, []);
  const pirateProfileCycleSignature = pirateContacts.map((contact) => contact.contactCycleKey).join('|');
  useEffect(() => {
    const visible = activeRoute === 'operations' || activeRoute === 'universe' ? pirateContacts : [];
    const next = materializePirateProfiles(stateRef.current, visible);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
    // Profile snapshots are frozen on observing a new cycle, not on countdown ticks.
  }, [activeRoute, pirateProfileCycleSignature]);

  const activeRouteRef = useRef(activeRoute);
  const navigateTo = (nextRoute: AppRoute) => {
    // A screen switch closes the active toasts: stale cross-screen notices
    // must not linger over the newly opened section.
    if (activeRouteRef.current !== nextRoute) {
      activeRouteRef.current = nextRoute;
      setToasts([]);
    }
    navigate(nextRoute);
    if (nextRoute === 'fleets') {
      window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
    }
  };

  const openColonizationLaunch = (coordinate: { galaxy: number; system: number; position: number }) => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setNotice(`Цель колонизации выбрана: [${coordinate.galaxy}:${coordinate.system}:${coordinate.position}].`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, {
        detail: {
          missionId: 'colonize',
          targetKind: 'empty',
          destination: { kind: 'coordinate', coordinate },
        },
      }));
    }, 40);
  };

  const openAsteroidRecyclerLaunch = (target: { spawnIndex: number; coordinate: UniverseCoordinate }) => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setNotice(`Астероид выбран для переработки: сначала сбор газа, затем обломков — [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}].`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, {
        detail: {
          missionId: 'gas',
          targetKind: 'asteroid',
          destination: { kind: 'coordinate', coordinate: target.coordinate },
        },
      }));
    }, 40);
  };

  const openPirateAttack = (contact: PirateContactPresentation) => {
    const eligible = selectOwnedPirateTargets(stateRef.current, Date.now()).some((target) =>
      target.contactCycleKey === contact.contactCycleKey
      && target.coordinate.galaxy === contact.coordinate.galaxy
      && target.coordinate.system === contact.coordinate.system
      && target.coordinate.position === contact.coordinate.position);
    if (!eligible) {
      setNotice('Пиратский рейд доступен только в системах, где есть ваша колония и действующий контакт.', 'error');
      return;
    }
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, {
      detail: { missionId: 'pirate-elimination', contactCycleKey: contact.contactCycleKey,
        destination: { kind: 'coordinate', coordinate: { ...contact.coordinate } },
        targetKind: 'pirate', targetRelation: 'neutral', targetPlanetName: 'Пираты' },
    })), 40);
  };
  const launchPirateRecon = (contact: PirateContactPresentation) => {
    if (rejectNpcCatchupCommand()) return;
    const result = dispatchFlight(stateRef.current, { requestId: `pirate-recon-${crypto.randomUUID()}`,
      missionId: 'pirate-recon', contactCycleKey: contact.contactCycleKey,
      originPlanetId: stateRef.current.currentPlanetId,
      destination: { kind: 'coordinate', coordinate: { ...contact.coordinate } },
      selectedShips: { 'spy-probe': 1 }, targetKind: 'pirate', targetRelation: 'neutral',
    }, { now: Date.now(), mode: RUNTIME_MODE, testTimeScale });
    if (result.ok) { stateRef.current = result.state; setState(result.state); setNotice(result.notice); }
    else setNotice(result.error.message, 'error');
  };
  const openPirateReport = (reportId: string) => { setPirateReportId(reportId); navigateTo('reports'); };
  const focusPirateUniverse = (contact: PirateContactPresentation) => { setPirateFocusTarget(contact); navigateTo('universe'); };
  const openPirateReconCoordinate = (coordinate: UniverseCoordinate, contactCycleKey: string) => {
    setUniverseFocusTarget(null);
    setPirateFocusTarget({ coordinate, contactCycleKey });
    navigateTo('universe');
    setNotice(`Вселенная: открыта система ${coordinate.system} по архивной разведке.`);
  };

  useEffect(() => {
    if (RUNTIME_MODE !== 'test') return;
    persistence.writeTestTimeScale(testTimeScale);
  }, [persistence, testTimeScale]);

  useEffect(() => {
    const onDispatchRequest = (event: Event) => {
      const detail = (event as CustomEvent<DispatchFlightCommand & { now?: number }>).detail;
      if (rejectNpcCatchupCommand()) {
        const result = { ok: false as const, state: stateRef.current,
          error: { code: 'invalid-command' as const, message: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE } };
        window.dispatchEvent(new CustomEvent(FLIGHT_COMMAND_RESULT_EVENT, { detail: result }));
        return;
      }
      const result = dispatchFlight(stateRef.current, detail, {
        now: detail.now ?? Date.now(),
        mode: RUNTIME_MODE,
        testTimeScale,
      });
      if (result.ok) {
        stateRef.current = result.state;
        setState(result.state);
        setNotice(result.notice);
      } else {
        setNotice(result.error.message, 'error');
      }
      window.dispatchEvent(new CustomEvent(FLIGHT_COMMAND_RESULT_EVENT, { detail: result }));
    };
    const onRecallRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ flightId: string; now?: number }>).detail;
      if (rejectNpcCatchupCommand()) {
        const result = { ok: false as const, state: stateRef.current,
          error: { code: 'invalid-command' as const, message: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE } };
        window.dispatchEvent(new CustomEvent(FLIGHT_COMMAND_RESULT_EVENT, { detail: result }));
        return;
      }
      const result = recallFlight(stateRef.current, detail.flightId, {
        now: detail.now ?? Date.now(),
        mode: RUNTIME_MODE,
        testTimeScale,
      });
      if (result.ok) {
        stateRef.current = result.state;
        setState(result.state);
        setNotice(result.notice);
      } else {
        setNotice(result.error.message, 'error');
      }
      window.dispatchEvent(new CustomEvent(FLIGHT_COMMAND_RESULT_EVENT, { detail: result }));
    };
    const onBot01ScenarioRequest = (event: Event) => {
      if (rejectNpcCatchupCommand()) return;
      const detail = (event as CustomEvent<{ now?: number }>).detail;
      const result = startBot01IncomingScenario(stateRef.current, {
        now: detail.now ?? Date.now(),
        mode: RUNTIME_MODE,
        testTimeScale,
      });
      if (result.ok) {
        stateRef.current = result.state;
        setState(result.state);
        setNotice(result.notice);
      } else {
        setNotice(result.error.message, 'error');
      }
      window.dispatchEvent(new CustomEvent(FLIGHT_COMMAND_RESULT_EVENT, { detail: result }));
    };
    const onBot01ExplorationScenarioRequest = (event: Event) => {
      if (rejectNpcCatchupCommand()) return;
      if(RUNTIME_MODE !== 'test') return;
      const detail=(event as CustomEvent<{now?:number}>).detail;
      const now=detail?.now ?? Date.now();
      const candidates=selectExplorationTargets(stateRef.current,now,'test',25);
      const node=candidates.find(item=>explorationTargetStatus(stateRef.current,item)==='free'
        && (item.special?.expiresAt ?? 0)-now>180_000);
      if(!node){
        setNotice('Нет свободного исследовательского объекта с достаточным временем для перелёта Bot 01.','error');
        return;
      }
      const result=dispatchBot01Exploration(stateRef.current,node,now,testTimeScale);
      if(!result.ok){setNotice(result.notice,'error');return;}
      stateRef.current=result.state;
      setState(result.state);
      setNotice('Bot 01 вылетел к '+node.name+'. После прибытия открой «Операции», прими объект и нажми «Атаковать».');
      navigateTo('operations');
    };
        const onEditTargetRequest = () => {
      clearBuildingInterior();
      navigateTo('universe');
      setNotice('Выберите новую свободную координату для колонизации.');
    };
    const onSpyReportRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ missionId: string; now?: number }>).detail;
      if (rejectNpcCatchupCommand()) {
        const result = { ok: false as const, state: stateRef.current,
          error: { code: 'invalid-command' as const, message: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE } };
        window.dispatchEvent(new CustomEvent(SPY_REPORT_RESULT_EVENT, { detail: result }));
        return;
      }
      const result = requestSpyReport(stateRef.current, detail.missionId, { now: detail.now ?? Date.now() });
      if (result.ok) {
        stateRef.current = result.state;
        setState(result.state);
        setNotice(result.notice);
      } else {
        if (result.state !== stateRef.current) {
          stateRef.current = result.state;
          setState(result.state);
        }
        setNotice(result.error.message, 'error');
      }
      window.dispatchEvent(new CustomEvent(SPY_REPORT_RESULT_EVENT, { detail: result }));
    };
    const onSpyReportAllRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ missionIds?: string[]; now?: number }>).detail;
      if (rejectNpcCatchupCommand()) {
        const result = { ok: false as const, state: stateRef.current,
          error: { code: 'invalid-command' as const, message: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE } };
        window.dispatchEvent(new CustomEvent(SPY_REPORT_RESULT_EVENT, { detail: result }));
        return;
      }
      const result = requestAllSpyReports(stateRef.current, detail.missionIds ?? [], { now: detail.now ?? Date.now() });
      if (result.ok) {
        stateRef.current = result.state;
        setState(result.state);
        setNotice(result.notice);
      } else {
        if (result.state !== stateRef.current) {
          stateRef.current = result.state;
          setState(result.state);
        }
        setNotice(result.error.message, 'error');
      }
      window.dispatchEvent(new CustomEvent(SPY_REPORT_RESULT_EVENT, { detail: result }));
    };
    window.addEventListener(FLIGHT_DISPATCH_REQUEST_EVENT, onDispatchRequest);
    window.addEventListener(FLIGHT_RECALL_REQUEST_EVENT, onRecallRequest);
    window.addEventListener(BOT01_INCOMING_SCENARIO_REQUEST_EVENT, onBot01ScenarioRequest);
    window.addEventListener(BOT01_EXPLORATION_SCENARIO_REQUEST_EVENT,onBot01ExplorationScenarioRequest);
    window.addEventListener(FLIGHT_EDIT_TARGET_REQUEST_EVENT, onEditTargetRequest);
    window.addEventListener(SPY_REPORT_REQUEST_EVENT, onSpyReportRequest);
    window.addEventListener(SPY_REPORT_ALL_REQUEST_EVENT, onSpyReportAllRequest);
    return () => {
      window.removeEventListener(FLIGHT_DISPATCH_REQUEST_EVENT, onDispatchRequest);
      window.removeEventListener(FLIGHT_RECALL_REQUEST_EVENT, onRecallRequest);
      window.removeEventListener(BOT01_INCOMING_SCENARIO_REQUEST_EVENT, onBot01ScenarioRequest);
      window.removeEventListener(BOT01_EXPLORATION_SCENARIO_REQUEST_EVENT,onBot01ExplorationScenarioRequest);
      window.removeEventListener(FLIGHT_EDIT_TARGET_REQUEST_EVENT, onEditTargetRequest);
      window.removeEventListener(SPY_REPORT_REQUEST_EVENT, onSpyReportRequest);
      window.removeEventListener(SPY_REPORT_ALL_REQUEST_EVENT, onSpyReportAllRequest);
    };
  }, [rejectNpcCatchupCommand, testTimeScale]);

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
        combat: migrateBattleHistory(history, RUNTIME_MODE),
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
      planetId: stateRef.current.currentPlanetId,
      mode: RUNTIME_MODE,
      testTimeScale,
      now: eventNow,
      rng: Math.random,
    }),
    commit: (nextState) => {
      if (rejectNpcCatchupCommand()) return;
      stateRef.current = nextState;
      setState(nextState);
    },
    onNotice: setNotice,
  }), [rejectNpcCatchupCommand, testTimeScale]);
  useEffect(() => bindFleetProductionEventBridge({
    target: window,
    getState: () => stateRef.current,
    getContext: (eventNow) => ({
      planetId: stateRef.current.currentPlanetId,
      mode: RUNTIME_MODE,
      testTimeScale,
      now: eventNow,
      rng: Math.random,
    }),
    commit: (nextState) => {
      if (rejectNpcCatchupCommand()) return;
      stateRef.current = nextState;
      setState(nextState);
    },
    onNotice: setNotice,
  }), [rejectNpcCatchupCommand, testTimeScale]);
  useEffect(() => bindRepairEventBridge({
    target: window,
    getState: () => stateRef.current,
    commit: (nextState) => {
      if (rejectNpcCatchupCommand()) return;
      stateRef.current = nextState;
      setState(nextState);
    },
    onNotice: setNotice,
  }), [rejectNpcCatchupCommand]);
  useEffect(() => bindCombatResultEventBridge({
    target: window,
    getState: () => stateRef.current,
    commit: (nextState) => {
      if (rejectNpcCatchupCommand()) return;
      stateRef.current = nextState;
      setState(nextState);
    },
    onNotice: setNotice,
  }), [rejectNpcCatchupCommand]);
  useEffect(() => bindCombatResolutionEventBridge({
    target: window,
    getState: () => stateRef.current,
    commit: (nextState) => {
      if (rejectNpcCatchupCommand()) return;
      stateRef.current = nextState;
      setState(nextState);
    },
    onNotice: setNotice,
  }), [rejectNpcCatchupCommand]);
  const presenceMinute = Math.floor(now / 60_000);
  useEffect(() => {
    setState((current) => {
      const at = Date.now();
      const playerId = current.profile.playerId;
      const command = refreshPresence(current.command, playerId, at, current.profile.displayName);
      if (command === current.command) return current;
      return { ...current, command, profile: syncPlayerProfileWithCommand(current.profile, command) };
    });
  }, [presenceMinute]);
  // Another window of the game writes the same save on every tick. A save written by this build
  // carries a writer marker (see `isCurrentBuildSave`): such a write is adopted and not written
  // back. A write without it comes from an older build still open on the same origin (e.g. another
  // GitHub Pages preview); it never stops overwriting the save every second (a just-built «Палата
  // управления» kept reverting to 0), so this window restores its own state and asks the player to
  // close the other window.
  const adoptedFromOtherWindow = useRef<SaveState | null>(null);
  const [foreignWriterAt, setForeignWriterAt] = useState<number | null>(null);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== persistence.saveKey) return;
      if (event.newValue !== null && !isCurrentBuildSave(event.newValue)) {
        setForeignWriterAt(Date.now());
        persistence.write(stateRef.current);
        return;
      }
      const loaded = persistence.load();
      // An unreadable or newer-schema write is never adopted as a fresh campaign;
      // the write guard keeps it intact and this window stops overwriting it.
      if (loaded.status !== 'loaded') {
        setForeignWriterAt(Date.now());
        return;
      }
      adoptedFromOtherWindow.current = loaded.state;
      setState(loaded.state);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [persistence]);
  useEffect(() => {
    if (adoptedFromOtherWindow.current === state) {
      adoptedFromOtherWindow.current = null;
      return;
    }
    persistSaveState(stateRef.current);
  }, [persistSaveState, state]);
  useEffect(() => {
    publishApplicationRuntimeSnapshot(
      state,
      { planetId: state.currentPlanetId, now, mode: RUNTIME_MODE, testTimeScale },
      window,
    );
  }, [now, state, testTimeScale]);
  const runRuntimeReconcile = useCallback((at: number) => {
    const current = stateRef.current;
    const result = reconcileRuntime(current, {
      planetId: current.currentPlanetId,
      now: at,
      mode: RUNTIME_MODE,
      testTimeScale,
    });
    if (!result.changed) return;
    const wasPending = isApplicationCommandBlocked(current);
    const isPending = isApplicationCommandBlocked(result.state);
    stateRef.current = result.state;
    if (result.state.npcReplay
      && result.state.npcReplay.processedThroughAt !== current.npcReplay?.processedThroughAt) {
      persistSaveState(result.state);
    }
    const publishAt = performance.now();
    if (!isPending || !wasPending || publishAt - lastNpcReplayPublishAt.current >= 200) {
      lastNpcReplayPublishAt.current = publishAt;
      setRenderedState(result.state);
    }
    if (isPending) scheduleNpcReplayRef.current();
    else cancelNpcReplayContinuation();
    result.events.forEach((event) => {
      if (event.kind === 'science') {
        const names = event.scienceIds
          .map((scienceId) => SCIENCE_CATALOG.find((science) => science.id === scienceId)?.name ?? `Наука ${scienceId}`)
          .join(', ');
        setNotice(`Наука: исследование завершено — ${names}.`, 'success');
      } else if (event.kind === 'building') {
        const planet = result.state.planets[event.planetId] ?? result.state.planets[result.state.currentPlanetId];
        setNotice(`${planet.name}: ${getBuildingDefinition(event.assetRole, result.state.profile.factionId).name} завершено.`, 'success');
      } else if (event.kind === 'recycling') {
        const planet = result.state.planets[event.planetId] ?? result.state.planets[result.state.currentPlanetId];
        setNotice(`${planet.name}: результат переработки автоматически зачислен`, 'success');
      } else if (event.kind === 'spaceport') {
        const names = event.tasks
          .map((task) => getSpaceportUpgradeEntity(task.track, task.shipId, result.state.profile.factionId)?.name ?? task.shipId)
          .join(', ');
        const planet = result.state.planets[event.planetId] ?? result.state.planets[result.state.currentPlanetId];
        setNotice(`${planet.name}: космодром — улучшение завершено — ${names}.`, 'success');
      } else if (event.kind === 'fleet-production') {
        const names = event.completed
          .map((item) => getFleetProductionEntity(item.queueKind, item.itemId, result.state.profile.factionId)?.name ?? item.itemId)
          .join(', ');
        const planet = result.state.planets[event.planetId] ?? result.state.planets[result.state.currentPlanetId];
        setNotice(`${planet.name}: верфь — производство завершено — ${names}.`, 'success');
      } else if (event.kind === 'sun-raid') {
        event.notices.forEach((notice) => setNotice(notice.text, notice.tone));
      } else if (event.kind === 'flight') {
        event.events.forEach((flightEvent) => setNotice(
          flightEvent.status === 'spy-report' || flightEvent.status === 'spy-detected'
            ? `Проверьте системные сообщения. ${flightEvent.notice}`
            : flightEvent.notice,
        ));
      }
    });
  }, [cancelNpcReplayContinuation, persistSaveState, setNotice, testTimeScale]);
  runtimeReconcileRef.current = runRuntimeReconcile;

  useEffect(() => {
    runRuntimeReconcile(now);
  }, [now, runRuntimeReconcile]);

  // Replay scheduling lives outside React publication so coalesced snapshots do
  // not pause chronological catch-up. Resume a saved pending prefix on mount and
  // cancel its sole continuation when this App instance is removed.
  useEffect(() => {
    scheduleNpcReplayRef.current();
    return cancelNpcReplayContinuation;
  }, [cancelNpcReplayContinuation]);

  const ownedPlanets = useMemo<PlanetDefinition[]>(() => Object.entries(state.planets).map(([id, planet]) => ({
    id,
    coords: `[${planet.universeGalaxy ?? 1}:${planet.universeSystem ?? 1}:${planet.universePosition ?? 1}]`,
    status: id === 'helion-01' ? 'Основная планета' : 'Колония',
    factionId: state.profile.factionId,
  })), [state.planets, state.profile.factionId]);
  const currentPlanet = ownedPlanets.find((planet) => planet.id === state.currentPlanetId) ?? ownedPlanets[0];
  const currentPlanetState = state.planets[currentPlanet.id];
  const currentPlanetName = currentPlanetState.name;
  const currentEnergyLedger = useMemo(
    () => energySummaryForPlanet(currentPlanetState, state.science.levels),
    [currentPlanetState, state.science.levels],
  );
  const currentEnergyCoordinates = useMemo(
    () => getPlanetEnergyCoordinates(currentPlanetState),
    [currentPlanetState.universeGalaxy, currentPlanetState.universePosition, currentPlanetState.universeSystem, state.sunRaid],
  );
  const fleetSummary = useMemo(
    () => getFleetSummaryForState(state),
    [state],
  );
  const outgoingFleetSummary = useMemo(
    () => getOutgoingFleetSummaryForState(state),
    [state],
  );
  const defenseSummary = useMemo(
    () => getFleetBuildBudget(state).defenseSummary,
    [state],
  );
  const isDefenseFleetView = activeRoute === 'fleets' && activeFleetSection === 'defense';
  const planetPopulation = useMemo(
    () => getPlanetPopulationForState(state),
    [state],
  );
  const headerPopulationSummary = isDefenseFleetView ? defenseSummary : fleetSummary;
  const pendingInboundPopulation = isDefenseFleetView ? 0 : getPendingInboundPopulation(state, currentPlanet.id);
  const currentOverpopulation = useMemo(
    () => getPlanetOverpopulationSummary(state, currentPlanet.id),
    [state, currentPlanet.id],
  );
  const currentSkin = useMemo(
    () => planetSkins.find((skin) => skin.id === currentPlanetState.skin) ?? planetSkins[0],
    [currentPlanetState.skin],
  );
  // Exploration contacts rebuild up to 11 systems; on a 1 s clock that stalled
  // the universe map. Status changes are coarse, a 5 s bucket is enough.
  const explorationClock = Math.floor(now / 5_000) * 5_000;
  const universeExplorationEligibility = useMemo(() => (activeRoute === 'universe'
    ? Object.fromEntries(selectExplorationTargets(state, explorationClock, RUNTIME_MODE).map(node => [node.id, explorationTargetStatus(state, node)]))
    : {}), [activeRoute, explorationClock, state]);
  const universePlayerPlanets = useMemo(() => ownedPlanets.map((planet) => {
    const runtimePlanet = state.planets[planet.id];
    const skin = planetSkins.find((candidate) => candidate.id === runtimePlanet.skin) ?? planetSkins[0];
    const art = 'mapArt' in skin ? skin.mapArt : skin.art;
    return {
      id: planet.id,
      coordinate: {
        galaxy: runtimePlanet.universeGalaxy ?? 1,
        system: runtimePlanet.universeSystem ?? 1,
        position: runtimePlanet.universePosition ?? 1,
      },
      name: runtimePlanet.name,
      art,
      isHomeworld: planet.id === 'helion-01',
      ownerId: state.profile.playerId,
    };
  }), [ownedPlanets, state.planets, state.profile.playerId]);
  const currentQueue = state.queues[currentPlanet.id] ?? [];
  const currentActiveQueueItem = currentQueue[0] ?? null;
  const currentQueueDefinition = currentActiveQueueItem
    ? getBuildingDefinition(currentActiveQueueItem.assetRole, state.profile.factionId)
    : null;
  const resourceWallet: ResourceWallet = {
    ...getPlanetResources(state, currentPlanet.id),
    energy: currentEnergyLedger.availableEnergy,
  };
  const tradeWallet: TradeWallet = {
    ...getPlanetResources(state, currentPlanet.id),
    debris: currentPlanetState.recycling.availableDebris,
  };
  const spaceportWallet: SpaceportUpgradeWallet = {
    ...getPlanetResources(state, currentPlanet.id),
  };
  const resourceIncomePerHour = useMemo(
    () => getProductionBotIncomePerHour(
      getBuildingResourceIncomePerHour(currentPlanetState.buildings, state.science.levels),
      currentPlanetState.productionBots,
    ),
    [currentPlanetState.buildings, currentPlanetState.productionBots, state.science.levels],
  );
  const effectiveResourceIncomePerHour = useMemo(
    () => getEffectiveResourceIncomePerHour(resourceIncomePerHour, RUNTIME_MODE, testTimeScale),
    [resourceIncomePerHour, testTimeScale],
  );
  const storageCapacities = useMemo(
    () => getStorageCapacities(currentPlanetState.buildings),
    [currentPlanetState.buildings],
  );
  const reportsUnreadCount = useMemo(() => {
    const items = buildReportsFeed(state.combat.reports, state.operations, state.command, state.espionage, state.reports.overpopulationReports, state.reports.recyclerArrivalReports, state.reports.gasExtractionArrivalReports, state.pirate?.reconReports, state.flights.records, state.exploration, state.profile.playerId);
    return Object.values(getReportUnreadCounts(items, state.reports)).reduce((total, count) => total + count, 0);
  }, [state.combat.reports, state.operations, state.command, state.espionage, state.reports.overpopulationReports, state.reports.recyclerArrivalReports, state.reports.gasExtractionArrivalReports, state.reports, state.pirate, state.flights, state.exploration]);
  const commandHallLevel = useMemo(() => selectCommandHallLevel(state.planets), [state.planets]);
  const commandHallDefinition = getBuildingDefinition('planetary-government', state.profile.factionId);
  // The race theme lives on <html> so portals and dialogs outside the stage get it too.
  // Same rule as the Fleet screen alert: hostile fleets still on their way in.
  const incomingAttackCount = state.flights.records.filter((flight) => flight.phase === 'outbound'
    && ((flight.ownerSide === 'bot01' && flight.missionId === 'attack') || (flight.ownerSide === 'pirate' && flight.missionId === 'pirate-raid'))).length;
  const sunAlerts = useMemo(() => selectIncomingSunAlerts(state, now), [state, now]);
  const uiFactionId = HEADER_FACTION_PREVIEW ?? state.profile.factionId;
  useEffect(() => {
    document.documentElement.dataset.faction = uiFactionId;
  }, [uiFactionId]);
  // Races of the owners the Command screen can show: the player, Bot 01 (universe NPC) and,
  // in Test Mode, Ira Vel — taken from the same owner profiles the Universe uses.
  const commandOwnerFactions = useMemo<Record<string, string | undefined>>(() => ({
    [UNIVERSE_NPC_OWNER_ID]: createUniverseNpcOwnerProfile().raceId,
    ...(RUNTIME_MODE === 'test' ? { [TEST_MODE_ALLY_PLANET_FIXTURE.owner.id]: TEST_MODE_ALLY_PLANET_FIXTURE.owner.raceId } : {}),
    [state.profile.playerId]: state.profile.factionId,
  }), [state.profile.playerId, state.profile.factionId]);
  const buildingInteriorTarget = buildingInterior
    ? getBuildingInteriorTarget(buildingInterior.buildingRole)
    : null;
  const buildingInteriorDefinition = buildingInterior
    ? getBuildingDefinition(buildingInterior.buildingRole, state.profile.factionId)
    : null;

  const editingPlanet = editingPlanetId ? ownedPlanets.find((planet) => planet.id === editingPlanetId) ?? null : null;
  const editingPlanetState = editingPlanet ? state.planets[editingPlanet.id] : null;

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

  const selectPlanet = (planetId: PlanetId) => {
    const nextPlanet = state.planets[planetId];
    if (!nextPlanet) return;
    clearBuildingInterior();
    setState((current) => selectOwnedPlanet(current, planetId));
    setPlanetMenuOpen(false);
    setPlanetViewMode('overview');
    setNotice(`${nextPlanet.name} ${ownedPlanets.find((planet) => planet.id === planetId)?.coords ?? currentPlanet.coords} выбрана как текущая планета.`);
  };

  const openPlanetEditor = (planetId: PlanetId) => {
    if (!state.planets[planetId]) return;
    clearBuildingInterior();
    setState((current) => selectOwnedPlanet(current, planetId));
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
        ...current.planets,
        [editingPlanetId]: { ...current.planets[editingPlanetId], name: safeName },
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
        ...current.planets,
        [editingPlanetId]: { ...current.planets[editingPlanetId], skin: skin.id },
      },
    }));
    setNotice(`Облик ${state.planets[editingPlanetId].name} изменён: ${skin.label}.`);
  };

  const applyProductionBots = (assignment: BotAssignment) => {
    if (rejectNpcCatchupCommand()) return;
    enqueueApplicationStateUpdate(stateRef, setState, (current) => ({
      state: applyProductionBotsAction(current, {
        planetId: state.currentPlanetId,
        now,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, assignment),
      result: undefined,
    }), flushSync);
    setNotice('Роботы перераспределены');
  };

  const startRecycling = (debrisAmount: number, allocation: ResourceAllocationPercent) => {
    if (rejectNpcCatchupCommand()) return false;
    const startedAt = Date.now();
    const jobId = globalThis.crypto?.randomUUID?.() ?? `recycling-${startedAt}-${Math.random().toString(36).slice(2, 9)}`;
    const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const transition = startRecyclingAction(current, {
        planetId: state.currentPlanetId,
        now: startedAt,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, debrisAmount, allocation, jobId);
      return {
        state: transition.ok ? transition.state : current,
        result: transition,
      };
    }, flushSync);
    if (!result.ok) {
      setNotice(result.reason ?? 'Переработка сейчас недоступна');
      return false;
    }
    setNotice('Переработка запущена');
    return true;
  };

  const collectRecycling = (jobId: string) => {
    if (rejectNpcCatchupCommand()) return false;
    const collectedAt = Date.now();
    const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const transition = collectRecyclingAction(current, {
        planetId: state.currentPlanetId,
        now: collectedAt,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, jobId);
      return { state: transition.state, result: transition };
    }, flushSync);
    if (!result.ok || !result.output) {
      setNotice(result.reason ?? 'Ресурс пока недоступен');
      return false;
    }
    setNotice('Ресурсы получены');
    return true;
  };

  const tradeResources = (request: TradeRequest): TradeExecution => {
    if (rejectNpcCatchupCommand()) return {
      ok: false,
      canTrade: false,
      reason: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE,
      amountLimit: 0,
      received: 0,
      refill: { maxSlots: 0, availableSlots: 0, missingSlots: 0, refillAtQueue: [], nextRefillAt: null,
        fullRefillAt: null, nextRefillMs: 0, fullRefillMs: 0 },
      state: { wallet: { metal: 0, minerals: 0, gas: 0, debris: 0 }, trade: { refillAtQueue: [] } },
      refillAt: null,
    };
    const tradedAt = Date.now();
    const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
      const transition = executeTradeAction(current, {
        planetId: state.currentPlanetId,
        now: tradedAt,
        mode: RUNTIME_MODE,
        testTimeScale,
      }, selectOwnerScores(current)[current.profile.playerId]?.resourcePoints ?? 0, request);
      return { state: transition.state, result: transition.execution };
    }, flushSync);
    if (!result.ok) {
      setNotice(result.reason ?? 'Обмен сейчас недоступен');
      return result;
    }
    setNotice('Обмен выполнен');
    return result;
  };

  const startSpaceportUpgrade = (track: SpaceportUpgradeTrack, shipId: string) => {
    if (rejectNpcCatchupCommand()) return false;
    const enqueuedAt = Date.now();
    const taskId = globalThis.crypto?.randomUUID?.() ?? `spaceport-${track}-${shipId}-${enqueuedAt}-${Math.random().toString(36).slice(2, 9)}`;
    const result = startSpaceportUpgradeAction(stateRef.current, {
      planetId: state.currentPlanetId,
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

  const cancelSpaceportUpgrade = (taskId: string) => {
    if (rejectNpcCatchupCommand()) return false;
    const canceledAt = Date.now();
    const result = cancelSpaceportUpgradeAction(stateRef.current, {
      planetId: state.currentPlanetId,
      now: canceledAt,
      mode: RUNTIME_MODE,
      testTimeScale,
      rng: Math.random,
    }, taskId);
    stateRef.current = result.state;
    setState(result.state);
    if (!result.ok) {
      setNotice(result.reason ?? 'Улучшение недоступно для отмены.');
      return false;
    }
    const cascadedCount = Math.max(0, result.transition.canceledTasks.length - 1);
    const refundLabel = result.transition.refundPercents.length > 1
      ? `Возврат рассчитан отдельно для ${result.transition.refundPercents.length} заданий в диапазоне 60–80%.`
      : `Возвращено ${result.transition.refundPercent}% сохранённой стоимости.`;
    setNotice(`Космодром: улучшение отменено. ${refundLabel}${cascadedCount > 0 ? ` Каскадно отменено ещё ${cascadedCount} зависимых заданий.` : ''}`);
    return true;
  };

  const buildBuilding = (assetRole: BuildingRole) => {
    if (rejectNpcCatchupCommand()) return false;
    const enqueuedAt = Date.now();
    const context = { planetId: state.currentPlanetId, now: enqueuedAt, mode: RUNTIME_MODE, testTimeScale };
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
    }, flushSync);
    if (!result.ok) {
      setNotice(result.reason ?? 'Строительство сейчас недоступно.');
      return false;
    }
    setNotice(`${currentPlanetName}: ${getBuildingDefinition(assetRole, state.profile.factionId).name} добавлено в общую очередь.`);
    return true;
  };

  const cancelBuilding = (queueId: string) => {
    if (rejectNpcCatchupCommand()) return false;
    const canceledAt = Date.now();
    const current = stateRef.current;
    const result = cancelBuildingAction(current, {
      planetId: state.currentPlanetId,
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
      ? getBuildingDefinition(result.canceledRole, state.profile.factionId)
      : null;
    const cascadedCount = result.cascadedCount;
    setNotice(`${canceledDefinition?.name ?? 'Проект'} отменён.${cascadedCount > 0 ? ` Каскадно отменено ещё ${cascadedCount} зависимых проектов.` : ''} ${describeBuildingRefund(BUILDING_CANCEL_REFUND_PERCENT, result.credit)}`);
    return true;
  };

  const destroyBuilding = (assetRole: BuildingRole) => {
    if (rejectNpcCatchupCommand()) return false;
    const current = stateRef.current;
    const result = destroyBuildingAction(current, {
      planetId: state.currentPlanetId,
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
    setNotice(`${getBuildingDefinition(assetRole, state.profile.factionId).name}: уровень разрушен. ${describeBuildingRefund(result.refundPercent ?? 0, result.credit)}`);
    return true;
  };

  const closePlanetEditor = () => {
    setEditingPlanetId(null);
    setEditingName(currentPlanetState.name);
  };

  const reset = () => {
    dispatchRuntimeReset(RUNTIME_MODE, window);
    persistence.clear();
    // Reroll generated free planets, pirates, anomalies and unique objects.
    // Production world layouts are never randomized by the reset control.
    if (RUNTIME_MODE === 'test') rerollTestUniverseLayout();
    const nextState = createInitialSaveState(RUNTIME_MODE);
    // Publish the canonical replacement synchronously. React's effect will
    // persist it again, but a reload between the click and that effect must
    // never observe the old payload or an empty key.
    persistence.write(nextState);
    stateRef.current = nextState;
    setState(nextState);
    setPlanetMenuOpen(false);
    setEditingPlanetId(null);
    setEditingName(DEFAULT_PLANET_NAME);
    setDetailsOpen(true);
    setPlanetViewMode('overview');
    setSelectedBuildingRole(null);
    setBuildingInterior(null);
    setPirateSystem({ galaxy: 1, system: 1 });
    setPirateFocusTarget(null);
    setPirateReportId(undefined);
    setToasts([]);
    setNotice(RUNTIME_MODE === 'test' ? 'Тестовое сохранение сброшено.' : 'Сохранение прототипа сброшено.');
  };

  const acceptOperationsOperation = (operationId: OperationId) => {
    if (rejectNpcCatchupCommand()) return;
    setState((current) => ({ ...current, operations: acceptOperation(current.operations, operationId, RUNTIME_MODE) }));
    setNotice('Операция принята. Подготовьте флот для выполнения.');
  };

  const acceptPirateOperation = (contact: PirateContactPresentation) => {
    if (rejectNpcCatchupCommand()) return;
    const current = stateRef.current;
    const live = selectOwnedPiratePresentations(current, Date.now()).find((item) => item.contactCycleKey === contact.contactCycleKey);
    if (!live) {
      setNotice('Пиратский контакт больше не доступен в системах ваших колоний.', 'error');
      return;
    }
    const id = pirateOperationId(live.contactCycleKey);
    if (current.operations.items.some((item) => item.id === id && item.state === 'active')) return;
    const next = {
      ...current,
      operations: { items: [...current.operations.items.filter((item) => item.id !== id), pirateContactOperation(live, 'active')] },
    };
    stateRef.current = next;
    setState(next);
    setNotice('Пиратская база добавлена в активные операции.');
  };

  const cancelPirateOperation = (contact: PirateContactPresentation) => {
    if (rejectNpcCatchupCommand()) return;
    const current = stateRef.current;
    const id = pirateOperationId(contact.contactCycleKey);
    const next = { ...current, operations: { items: current.operations.items.filter((item) => item.id !== id) } };
    stateRef.current = next;
    setState(next);
    setNotice('Пиратская операция возвращена в доступные.');
  };

  const cancelOperationsOperation = (operationId: OperationId) => {
    if (rejectNpcCatchupCommand()) return;
    setState((current) => ({ ...current, operations: cancelOperation(current.operations, operationId, RUNTIME_MODE) }));
    setNotice('Операция отменена и возвращена в доступные без штрафа.');
  };

  const acceptExplorationContact = (node: import('./domain/universe/types.ts').UniversePlanetNode) => {
    if (rejectNpcCatchupCommand()) return;
    const current = stateRef.current;
    const next = acceptLiveExploration(current, node.id, Date.now(), RUNTIME_MODE);
    if (!next) { setNotice('Контакт уже исчез. Принять операцию нельзя.', 'error'); return; }
    stateRef.current = next;
    setState(next);
    setNotice('Операция принята. Можно отправить разведзонд или экспедицию.');
  };

  const cancelExplorationContact = (id: string) => {
    if (rejectNpcCatchupCommand()) return;
    const next = cancelLiveExploration(stateRef.current, id);
    stateRef.current = next;
    setState(next);
    setNotice('Исследовательская операция отменена.');
  };

  const launchExplorationRecon = (node: import('./domain/universe/types.ts').UniversePlanetNode) => {
    if (rejectNpcCatchupCommand()) return;
    const current = stateRef.current;
    const nowMs = Date.now();
    const live = getExplorationTarget(current, node.id, nowMs, RUNTIME_MODE);
    if (!live) { setNotice('Объект исчез. Исследование невозможно.', 'error'); return; }
    // From the Universe inspector, accepting the contact and launching the probe is one operation.
    const acceptedState = current.exploration?.acceptedContactIds?.includes(node.id)
      ? current
      : acceptLiveExploration(current, node.id, nowMs, RUNTIME_MODE);
    if (!acceptedState) { setNotice('Контакт исчез до исследования.', 'error'); return; }
    const result = dispatchFlight(acceptedState, {
      requestId: 'exploration-recon:' + node.id + ':' + nowMs,
      missionId: 'exploration-recon',
      contactCycleKey: node.id,
      operationId: node.id,
      originPlanetId: current.currentPlanetId,
      destination: { kind: 'coordinate', coordinate: live.coordinate },
      targetKind: live.kind,
      selectedShips: { 'spy-probe': 1 },
      departedAt: nowMs,
    }, { now: nowMs, mode: RUNTIME_MODE, testTimeScale });
    if (!result.ok) {
      if (acceptedState !== current) { stateRef.current = acceptedState; setState(acceptedState); }
      setNotice((acceptedState !== current ? 'Операция принята, но зонд не отправлен: ' : '') + result.error.message, 'error');
      return;
    }
    stateRef.current = result.state;
    setState(result.state);
    setNotice('Зонд отправлен. Отчёт о результатах исследования появится после прибытия.');
    window.dispatchEvent(new CustomEvent(FLIGHT_COMMAND_RESULT_EVENT, { detail: result }));
  };

  const openExpeditionLaunch = (node: import('./domain/universe/types.ts').UniversePlanetNode) => {
    const live = getExplorationTarget(stateRef.current, node.id, Date.now(), RUNTIME_MODE);
    if (!live || explorationTargetStatus(stateRef.current, live) !== 'free') {
      setNotice('Экспедиция недоступна: объект исчез или занят. Проверь актуальные контакты.', 'error');
      return;
    }
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setNotice('Экспедиция: выбери состав кораблей и подтверди перелёт.');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, {
        detail: {
          missionId: 'expedition', contactCycleKey: live.id,
          targetKind: live.kind,
          targetPlanetName: live.name,
          targetRelation: 'neutral',
          destination: { kind: 'coordinate', coordinate: live.coordinate },
        },
      }));
    }, 40);
  };

  const launchBot01Exploration = (node: import('./domain/universe/types.ts').UniversePlanetNode) => {
    if (rejectNpcCatchupCommand()) return;
    if (RUNTIME_MODE !== 'test')return;
    const at=Date.now();
    const result=dispatchBot01Exploration(stateRef.current,node,at,testTimeScale);
    if(!result.ok){setNotice(result.notice,'error');return;}
    stateRef.current=result.state;
    setState(result.state);
    setNotice(result.notice);
  };

  const openExplorationAttackLaunch = (node: import('./domain/universe/types.ts').UniversePlanetNode) => {
    const live = getExplorationTarget(stateRef.current,node.id,Date.now(),RUNTIME_MODE);
    const claim = live && stateRef.current.exploration?.contacts[live.id]?.claim;
    if (!live || !claim || claim.ownerId === stateRef.current.profile.playerId) {
      setNotice('Для атаки нужен объект, занятый чужим реальным флотом.','error');
      return;
    }
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setNotice('Боевой захват объекта: выберите флот, проверьте маршрут и подтвердите атаку.');
    window.setTimeout(() => window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT,{
      detail:{
        missionId:'attack',contactCycleKey:live.id,operationId:live.id,
        targetKind:live.kind,targetRelation:'neutral',targetPlanetName:live.name,
        destination:{kind:'coordinate',coordinate:live.coordinate},
      },
    })),40);
  };

  const openFleetRootFromOperations = () => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    setNotice('Флоты: подготовьте состав для принятой операции.');
  };

  /**
   * Applies one Command-domain action to the authoritative state. The Hall is
   * rechecked here (not only in the locked UI) so a stale screen cannot act.
   */
  const runCommandAction = (
    action: (command: CommandState, at: number, ownerId: string, ownerName: string) => CommandResult<object>,
    success?: string,
  ): CommandActionResult => {
    if (rejectNpcCatchupCommand()) return { ok: false, message: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE };
    const current = stateRef.current;
    if (selectCommandHallLevel(current.planets) <= 0) {
      return { ok: false, message: 'Командование недоступно: на планетах нет здания «Палата управления».' };
    }
    const at = Date.now();
    const result = action(current.command, at, current.profile.playerId, current.profile.displayName);
    if (result.state !== current.command) {
      const applied = {
        ...current,
        command: result.state,
        profile: syncPlayerProfileWithCommand(current.profile, result.state),
      };
      // A membership change turns back any aid fleet that lost its sender, recipient or request at once,
      // and a new member's charge clock is pointed at the current Hall right away.
      const nextState = syncAidState(reconcileAidMembership(applied, at), { now: at, mode: RUNTIME_MODE, testTimeScale });
      stateRef.current = nextState;
      setState(nextState);
    }
    if (!result.ok) return { ok: false, message: result.message };
    if (success) setNotice(success);
    return success ? { ok: true, message: success } : { ok: true };
  };

  /** Applies one resource-request action to the whole save (planets, scores and flights are involved). */
  const runAidAction = (action: (current: SaveState, at: number) => AidActionResult): CommandActionResult => {
    if (rejectNpcCatchupCommand()) return { ok: false, message: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE };
    const current = stateRef.current;
    if (selectCommandHallLevel(current.planets) <= 0) {
      return { ok: false, message: 'Командование недоступно: на планетах нет здания «Палата управления».' };
    }
    const result = action(current, Date.now());
    if (result.state !== current) {
      stateRef.current = result.state;
      setState(result.state);
    }
    if (!result.ok) return { ok: false, message: result.message };
    setNotice(result.message);
    return { ok: true, message: result.message };
  };
  const aidContext = (at: number) => ({ now: at, mode: RUNTIME_MODE, testTimeScale });

  const openAidLaunch = (requestId: string): CommandActionResult => {
    const current = stateRef.current;
    const request = current.command.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'open') return { ok: false, message: 'Запрос закрыт или не найден.' };
    if (selectRequestProgress(current, request).remainder <= 0) {
      return { ok: false, message: 'Весь остаток запроса уже в пути или доставлен.' };
    }
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setNotice(`Помощь союзу: ${request.planetName} [${request.coordinate.galaxy}:${request.coordinate.system}:${request.coordinate.position}] — подготовьте транспортёры.`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, {
        detail: {
          missionId: 'aid',
          aidRequestId: request.id,
          targetRelation: 'ally',
          targetPlanetName: request.planetName,
          targetOwnerName: request.authorName,
          destination: { kind: 'planet', planetId: request.planetId, coordinate: { ...request.coordinate } },
        },
      }));
    }, 40);
    return { ok: true };
  };

  // Test Mode runs the 3-hour truce timers on the same accelerated clock as the aid charges.
  const diplomacyOptions = (at: number) => ({ now: at, elapsedScale: getRuntimeElapsedScale(RUNTIME_MODE, testTimeScale) });

  /** Allied planets of a member known to this save (Test Mode ally planets today). Never shown on the Command screen. */
  const memberPlanetsOf = (current: SaveState, ownerId: string) => Object.values(current.alliedPlanets ?? {})
    .filter((planet) => planet.ownerId === ownerId)
    .map((planet) => ({
      planetId: planet.id,
      coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
    }));

  const sendFleetToMember = (ownerId: string): CommandActionResult => {
    if (rejectNpcCatchupCommand()) return { ok: false, message: NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE };
    const current = stateRef.current;
    const target = memberPlanetsOf(current, ownerId)[0];
    if (!target) return { ok: false, message: 'Планета участника неизвестна: найдите её во «Вселенной».' };
    openTransportLaunch({ planetId: target.planetId, coordinate: target.coordinate, relation: 'ally' });
    return { ok: true };
  };

  const commandActions: CommandActions = {
    declareWar: (targetAllianceId: string) => runCommandAction(
      (command, at, ownerId) => declareWar(command, ownerId, targetAllianceId, diplomacyOptions(at)),
      'Война объявлена.',
    ),
    proposeTruce: (targetAllianceId: string) => runCommandAction(
      (command, at, ownerId) => proposeTruce(command, ownerId, targetAllianceId, diplomacyOptions(at)),
      'Предложение перемирия отправлено.',
    ),
    respondTruce: (fromAllianceId: string, accept: boolean) => runCommandAction(
      (command, at, ownerId) => respondTruce(command, ownerId, fromAllianceId, accept, diplomacyOptions(at)),
      accept ? 'Перемирие заключено. Война окончена.' : 'Предложение перемирия отклонено.',
    ),
    sendFleetToMember,
    canSendFleetToMember: (ownerId: string) => memberPlanetsOf(stateRef.current, ownerId).length > 0,
    createRequest: (planetId: string, resource: AidResource, amount: number) => runAidAction(
      (current, at) => createAidRequest(current, { planetId, resource, amount }, aidContext(at)),
    ),
    cancelRequest: (requestId: string) => runAidAction(
      (current, at) => cancelAidRequest(current, requestId, aidContext(at)),
    ),
    startHelp: openAidLaunch,
    previewOverflow: (planetId: string, resource: AidResource, amount: number) =>
      previewRequestOverflow(stateRef.current, planetId, resource, amount),
    createAlliance: (settings: AllianceSettingsInput) => runCommandAction(
      (command, at, ownerId, ownerName) => createAlliance(command, { ownerId, displayName: ownerName, settings }, { now: at }),
      'Союз создан.',
    ),
    updateSettings: (settings: AllianceSettingsInput) => runCommandAction(
      (command, _at, ownerId) => updateAllianceSettings(command, ownerId, settings),
      'Настройки союза сохранены.',
    ),
    apply: (allianceId: string) => runCommandAction(
      (command, at, ownerId, ownerName) => applyToAlliance(command, { ownerId, displayName: ownerName, allianceId }, { now: at }),
      'Заявка отправлена. Дождитесь решения руководства союза.',
    ),
    withdraw: () => runCommandAction((command, at, ownerId) => withdrawApplication(command, ownerId, at), 'Заявка отозвана.'),
    accept: (applicationId: string) => runCommandAction(
      (command, at, ownerId) => acceptApplication(command, ownerId, applicationId, { now: at }),
      'Заявка принята.',
    ),
    reject: (applicationId: string) => runCommandAction(
      (command, at, ownerId) => rejectApplication(command, ownerId, applicationId, at),
      'Заявка отклонена.',
    ),
    leave: (successorOwnerId?: string) => runCommandAction(
      (command, at, ownerId) => leaveAlliance(command, ownerId, at, { successorOwnerId }),
      'Вы покинули союз.',
    ),
    kick: (targetOwnerId: string) => runCommandAction(
      (command, at, ownerId) => kickMember(command, ownerId, targetOwnerId, at),
      'Участник исключён.',
    ),
    setDeputy: (targetOwnerId: string | null) => runCommandAction(
      (command, _at, ownerId) => setDeputy(command, ownerId, targetOwnerId),
      targetOwnerId ? 'Заместитель назначен.' : 'Заместитель снят.',
    ),
    transferLeadership: (targetOwnerId: string) => runCommandAction(
      (command, at, ownerId) => transferLeadership(command, ownerId, targetOwnerId, at),
      'Лидерство передано.',
    ),
    openHallConstruction: () => {
      clearBuildingInterior();
      navigateTo('planet');
      setPlanetViewMode('military');
      setSelectedBuildingRole('planetary-government');
      setPlanetMenuOpen(false);
      closePlanetEditor();
      setNotice('Постройте «Палату управления», чтобы открыть Командование.');
    },
    ...(RUNTIME_MODE === 'test' ? {
      testIraPrepare: () => runAidAction((current, at) => {
        const prepared = prepareIraAidFixture(current, aidContext(at));
        return prepared.ok
          ? { ok: true, state: prepared.state, message: prepared.message }
          : { ok: false, state: current, code: 'not_allowed', message: prepared.message };
      }),
      testIraRequest: (resource: AidResource, amount: number) => runAidAction(
        (current, at) => createIraAidRequest(current, { resource, amount }, aidContext(at)),
      ),
      testIraHelp: () => runAidAction((current, at) => {
        const request = current.command.requests.find((item) => item.status === 'open'
          && item.authorOwnerId === current.profile.playerId
          && selectRequestProgress(current, item).remainder > 0);
        if (!request) {
          return { ok: false, state: current, code: 'request_not_found', message: 'Нет вашего открытого запроса с непокрытым остатком.' };
        }
        const sequence = current.flights.records.filter((flight) => flight.requestId.startsWith(`aid-npc:${request.id}:`)).length + 1;
        const sent = dispatchNpcAidFlight(current, {
          requestId: `aid-npc:${request.id}:${sequence}`,
          aidRequestId: request.id,
          senderOwnerId: TEST_ALLY_OWNER_ID,
          departedAt: at,
        }, { now: at, mode: RUNTIME_MODE, testTimeScale });
        return sent.ok
          ? { ok: true, state: sent.state, message: 'Тест: Ира Вель отправила помощь реальным флотом. Следите за ним в «Флотах».' }
          : { ok: false, state: current, code: 'request_not_open', message: sent.error.message };
      }),
      testBotApply: () => runCommandAction(
        (command, at, ownerId) => {
          const own = command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === ownerId));
          if (!own) return { ok: false, state: command, code: 'not_member', message: 'Сначала вступите в союз или создайте его.' };
          // The managed bot leaves its own fixture alliance first (it comes back once the bot is free again).
          return applyToAlliance(releaseTestBotFromOwnAlliance(command), { ownerId: UNIVERSE_NPC_OWNER_ID, displayName: 'Бот 01', allianceId: own.id }, { now: at });
        },
        'Тест: Бот 01 подал заявку в ваш союз.',
      ),
      testBotRespondTruce: (accept: boolean) => runCommandAction(
        (command, at, ownerId) => {
          const own = command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === ownerId));
          if (!own) return { ok: false, state: command, code: 'not_member', message: 'Сначала вступите в союз.' };
          return respondTruce(command, UNIVERSE_NPC_OWNER_ID, own.id, accept, diplomacyOptions(at));
        },
        accept ? 'Тест: Бот 01 принял перемирие.' : 'Тест: Бот 01 отклонил перемирие.',
      ),
      testBotProposeTruce: () => runCommandAction(
        (command, at, ownerId) => {
          const own = command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === ownerId));
          if (!own) return { ok: false, state: command, code: 'not_member', message: 'Сначала вступите в союз.' };
          return proposeTruce(command, UNIVERSE_NPC_OWNER_ID, own.id, diplomacyOptions(at));
        },
        'Тест: Бот 01 предложил перемирие.',
      ),
      testBotDeclareWar: () => runCommandAction(
        (command, at, ownerId) => {
          const own = command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === ownerId));
          if (!own) return { ok: false, state: command, code: 'not_member', message: 'Сначала вступите в союз.' };
          if (!command.alliances.some((alliance) => alliance.id === TEST_BOT_ALLIANCE_ID)) return { ok: false, state: command, code: 'alliance_not_found', message: 'Союза Бота 01 сейчас нет.' };
          return declareWar(command, UNIVERSE_NPC_OWNER_ID, own.id, diplomacyOptions(at));
        },
        'Тест: Бот 01 объявил вам войну.',
      ),
    } : {}),
  };

  const openTransportLaunch = (target: { planetId: string; coordinate: { galaxy: number; system: number; position: number }; relation: TargetRelation }) => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    const relationLabel = target.relation === 'self' ? 'Своя' : target.relation === 'ally' ? 'Союзная' : target.relation === 'enemy' ? 'Вражеская' : 'Нейтральная';
    setNotice(`${relationLabel} цель выбрана: [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}].`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, {
        detail: {
          missionId: 'transport',
          targetRelation: target.relation,
          destination: { kind: 'planet', planetId: target.planetId, coordinate: target.coordinate },
        },
      }));
    }, 40);
  };

  const openSpyLaunch = (target: { planetId: string; planetName: string; coordinate: UniverseCoordinate; relation: Extract<TargetRelation, 'enemy' | 'neutral'>; owner: UniverseOwnerProfile; targetKind: 'player' | 'npc' }) => {
    if (rejectNpcCatchupCommand()) return;
    const targetRaceId = target.owner.raceId === 'synod' || target.owner.raceId === 'veyra' ? target.owner.raceId : 'aegis';
    const result = dispatchFlight(stateRef.current, {
      requestId: `spy-universe-${target.planetId}-${Date.now()}`,
      missionId: 'espionage',
      originPlanetId: stateRef.current.currentPlanetId,
      targetKind: target.targetKind,
      targetRelation: target.relation,
      targetPlanetName: target.planetName,
      targetOwnerId: target.owner.id,
      targetOwnerName: target.owner.displayName,
      targetRaceId,
      targetAlliance: target.owner.alliance ?? null,
      selectedShips: { 'spy-probe': 1 },
      destination: { kind: 'planet', planetId: target.planetId, coordinate: target.coordinate },
      departedAt: Date.now(),
    }, { now: Date.now(), mode: RUNTIME_MODE, testTimeScale });
    if (result.ok) {
      stateRef.current = result.state;
      setState(result.state);
      setNotice('Шпионский зонд успешно отправлен.');
    } else if (result.error.message.startsWith('Зонд уже выполняет')) {
      setNotice('На этой планете уже есть шпионский зонд. Откройте раздел «Шпионские зонды».');
    } else {
      setNotice(result.error.message, 'error');
    }
    window.dispatchEvent(new CustomEvent(FLIGHT_COMMAND_RESULT_EVENT, { detail: result }));
  };

  const openAttackLaunch = (target: { planetId: string; planetName: string; coordinate: UniverseCoordinate; relation: Extract<TargetRelation, 'enemy' | 'neutral'>; owner: UniverseOwnerProfile; targetKind: 'player' | 'npc' }) => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setNotice(`Атакующая цель выбрана: ${target.planetName} [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}].`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, {
        detail: {
          missionId: 'attack',
          targetRelation: target.relation,
          targetKind: target.targetKind as UniverseObjectKind,
          targetPlanetName: target.planetName,
          targetOwnerId: target.owner.id,
          targetOwnerName: target.owner.displayName,
          targetRaceId: target.owner.raceId === 'synod' || target.owner.raceId === 'veyra' ? target.owner.raceId : 'aegis',
          targetAlliance: target.owner.alliance ?? null,
          destination: { kind: 'planet', planetId: target.planetId, coordinate: target.coordinate },
        },
      }));
    }, 40);
  };

  const openUniverseTarget = (target: UniverseFocusTarget) => {
    clearBuildingInterior();
    closePlanetEditor();
    // Coordinate links pinpoint the planet with a pulse; the owner name keeps
    // opening the profile inspector.
    setUniverseFocusTarget({ ...target, mode: target.ownerId ? 'inspect' : 'highlight' });
    navigateTo('universe');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    setNotice(`Вселенная: открыта координата [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}].`);
  };
  const openUniverseTargetRef = useRef(openUniverseTarget);
  openUniverseTargetRef.current = openUniverseTarget;
  useEffect(() => {
    const onOpenCoordinate = (event: Event) => {
      const coordinate = (event as CustomEvent<{ coordinate?: UniverseCoordinate }>).detail?.coordinate;
      if (coordinate) openUniverseTargetRef.current({ coordinate });
    };
    window.addEventListener(UNIVERSE_COORDINATE_OPEN_EVENT, onOpenCoordinate);
    return () => window.removeEventListener(UNIVERSE_COORDINATE_OPEN_EVENT, onOpenCoordinate);
  }, []);


  const openSpySimulator = (report: SpyReportSnapshot) => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    closePlanetEditor();
    const scenario = createSimulatorScenarioFromSpyReport(stateRef.current, report);
    window.setTimeout(() => requestSimulatorHandoff(scenario), 50);
    setNotice(`Симулятор подготовлен по полному отчёту: ${report.targetPlanetName}.`);
  };

  const recallSpyFromReport = (missionId: string) => {
    if (rejectNpcCatchupCommand()) return;
    const mission = stateRef.current.espionage?.missions.find((candidate) => candidate.id === missionId);
    const flight = mission ? stateRef.current.flights.records.find((candidate) => candidate.id === mission.flightId) : undefined;
    if (!mission || !flight || mission.status !== 'orbiting') {
      setNotice('Связанный шпионский зонд уже не находится на орбите.');
      return;
    }
    window.dispatchEvent(new CustomEvent(FLIGHT_RECALL_REQUEST_EVENT, { detail: { flightId: flight.id, now: Date.now() } }));
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
      combat: migrateBattleHistory(setBattleReportSaved(current.combat, reportId, saved, RUNTIME_MODE), RUNTIME_MODE),
    };
    stateRef.current = nextState;
    setState(nextState);
    setNotice(saved ? 'Боевой доклад сохранён.' : 'Боевой доклад удалён из сохранённых.');
  };

  const returnToBuilding = () => {
    if (!buildingInterior) return;
    const context = buildingInterior;
    const definition = getBuildingDefinition(context.buildingRole, state.profile.factionId);
    setBuildingInterior(null);
    setState((current) => current.currentPlanetId === context.planetId
      ? current
      : selectOwnedPlanet(current, context.planetId));
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
      setNotice(`${getBuildingDefinition(assetRole, state.profile.factionId).name}: внутренний модуль открыт.`);
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
    if (nextRoute === 'universe') setNotice(`Галактика ${homePlanet?.universeGalaxy ?? 1} загружена. Доступно 40 солнечных систем.`);
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

  /* ---------------------------------------------- Sun raids, Gates, session */
  const homePlanet = state.planets['helion-01'] ?? state.planets[state.currentPlanetId];
  const [commandFocus, setCommandFocus] = useState<{ tab: 'operations' | 'overview'; nonce: number } | null>(null);
  const [selectedSun, setSelectedSun] = useState<SunSelection>(() => ({ galaxy: homePlanet?.universeGalaxy ?? 1, system: homePlanet?.universeSystem ?? 1 }));
  const [gateDialogPlanetId, setGateDialogPlanetId] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  const sunRaidState = currentSunRaidState(state);
  const gateContext = useMemo(() => selectGateContext(state, now), [state, now]);

  const commitSunAction = (result: SunActionResult) => {
    if (rejectNpcCatchupCommand()) return;
    if (result.ok) {
      stateRef.current = result.state;
      setState(result.state);
      setNotice(result.notice, 'success');
    } else {
      setNotice(result.error, 'error');
    }
  };
  const openSunsPanel = (sun?: SunSelection) => {
    // Without an alliance there are no Sun operations: a Sun under attack opens «Поддержка солнца» in «Флоты».
    if (!selectOwnerMembership(stateRef.current.command, stateRef.current.profile.playerId) || selectCommandHallLevel(stateRef.current.planets) <= 0) {
      const target = sun ?? selectedSun;
      const raid = selectIncomingSunAlerts(stateRef.current, Date.now()).find((alert) => alert.raid.galaxy === target.galaxy && alert.raid.system === target.system);
      if (raid) openSunSupportInFleets(raid.raid);
      else setNotice(`Солнце ${target.galaxy}:${target.system}. Рейды на Солнца — операция союза («Командование → Операции»).`);
      return;
    }
    clearBuildingInterior();
    if (sun) setSelectedSun(sun);
    setCommandFocus({ tab: 'operations', nonce: Date.now() });
    navigateTo('command');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
  };
  const openSunFleetLaunch = (detail: FlightLaunchContext) => {
    clearBuildingInterior();
    navigateTo('fleets');
    setPlanetViewMode('overview');
    setPlanetMenuOpen(false);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, { detail })), 40);
  };
  const sunLaunchDestination = (galaxy: number, system: number) => ({
    kind: 'operation' as const, operationId: `sun:${galaxy}:${system}`, coordinate: { galaxy, system, position: 1 },
  });
  const openSunSupportInFleets = (raid: { galaxy: number; system: number }) => openSunFleetLaunch({
    missionId: 'sun-support', operationId: `sun:${raid.galaxy}:${raid.system}`,
    destination: sunLaunchDestination(raid.galaxy, raid.system), targetRelation: 'neutral', targetPlanetName: `Солнце ${raid.galaxy}:${raid.system}`,
  });
  const openSunRecycleInFleets = (sun: SunSelection) => openSunFleetLaunch({
    missionId: 'recycle', operationId: `sun:${sun.galaxy}:${sun.system}`, targetKind: 'empty',
    destination: sunLaunchDestination(sun.galaxy, sun.system), targetPlanetName: `Обломки Солнца ${sun.galaxy}:${sun.system}`,
  });
  /** «Найти обломки» → «Отправить»: recyclers to a planet orbit or, at position 0, to the Sun. */
  const openDebrisRecycleLaunch = (coordinate: UniverseCoordinate) => {
    if (coordinate.position === 0) { openSunRecycleInFleets({ galaxy: coordinate.galaxy, system: coordinate.system }); return; }
    setNotice(`Переработка обломков: [${coordinate.galaxy}:${coordinate.system}:${coordinate.position}].`);
    openSunFleetLaunch({ missionId: 'recycle', destination: { kind: 'coordinate', coordinate: { ...coordinate } } });
  };
  const startGate = () => {
    if (rejectNpcCatchupCommand()) return;
    if (!gateDialogPlanetId) return;
    commitSunAction(startGateConstruction(stateRef.current, gateDialogPlanetId, { now: Date.now(), mode: RUNTIME_MODE, testTimeScale }));
  };
  const testGateAssault = RUNTIME_MODE === 'test' ? () => {
    if (rejectNpcCatchupCommand()) return;
    const gate = currentSunRaidState(stateRef.current).gates.find((item) => item.status === 'building');
    if (!gate || !stateRef.current.planets[gate.hostPlanetId]) { setNotice('Нет строящихся Врат на вашей планете.', 'error'); return; }
    const result = startBot01GateAssault(stateRef.current, gate.hostPlanetId, { now: Date.now(), mode: RUNTIME_MODE, testTimeScale });
    if (result.ok) { stateRef.current = result.state; setState(result.state); setNotice(result.notice); }
    else setNotice(result.error.message, 'error');
  } : undefined;

  const openSunsPanelRef = useRef(openSunsPanel);
  openSunsPanelRef.current = openSunsPanel;
  useEffect(() => {
    const onOpen = () => openSunsPanelRef.current();
    window.addEventListener(OPEN_SUN_OPERATIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SUN_OPERATIONS_EVENT, onOpen);
  }, []);

  // Galaxy-wide warning: every new incoming raid on a Sun of the player's galaxies raises a toast once.
  const announcedSunAlerts = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = sunAlerts.map((alert) => alert.raid.id);
    if (announcedSunAlerts.current === null) { announcedSunAlerts.current = new Set(ids); return; }
    for (const alert of sunAlerts) {
      if (announcedSunAlerts.current.has(alert.raid.id)) continue;
      announcedSunAlerts.current.add(alert.raid.id);
      setNotice(`Входящая атака на Солнце ${formatSun(alert.raid.galaxy, alert.raid.system)}: [${alert.raid.allianceTag}], прибытие через ${Math.ceil(alert.arrivesInMs / 60_000)} мин. Командование → Операции.`, 'error');
    }
  }, [sunAlerts, setNotice]);

  // Play time of the campaign and the slot card (production slots only).
  const lastPlayTickRef = useRef(Date.now());
  /** Adds the time since the last tick (at most 2 min: a sleeping laptop is not play time). */
  const foldPlayTime = useCallback((commit: boolean) => {
    if (RUNTIME_MODE !== 'production') return stateRef.current;
    const at = Date.now();
    const elapsed = Math.min(120_000, Math.max(0, at - lastPlayTickRef.current));
    lastPlayTickRef.current = at;
    if (elapsed <= 0) return stateRef.current;
    const next = { ...stateRef.current, playTimeMs: (stateRef.current.playTimeMs ?? 0) + elapsed };
    stateRef.current = next;
    if (commit) setState(next);
    return next;
  }, []);
  useEffect(() => {
    foldPlayTime(true);
    if (session) refreshSlotMeta(session.slotId, stateRef.current);
  }, [foldPlayTime, presenceMinute, session]);
  useEffect(() => {
    if (!session) return;
    // Only the play time is added on exit, onto the save as stored: the game state is
    // already persisted by every action, and a full write here would overwrite a
    // newer save (another window, an import, a QA patch).
    const onUnload = () => {
      const latest = foldPlayTime(false);
      const loaded = persistence.load();
      if (loaded.status !== 'loaded') return;
      const stored = loaded.state;
      const next = { ...stored, playTimeMs: Math.max(stored.playTimeMs ?? 0, latest.playTimeMs ?? 0) };
      persistence.write(next);
      refreshSlotMeta(session.slotId, next);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [foldPlayTime, persistence, session]);

  const exportCurrentSave = () => {
    const latest = foldPlayTime(true);
    persistence.write(latest);
    const blob = new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `asterion-${RUNTIME_MODE === 'test' ? 'test' : (session?.slotName ?? 'campaign').replace(/[^\p{L}\p{N}_-]+/gu, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNotice('Сохранение выгружено в файл.', 'success');
  };

  // Esc opens the pause menu when nothing else is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || pauseOpen || buildingInterior) return;
      if (document.querySelector('[aria-modal="true"], .resource-building-dialog-backdrop, .universe-modal-backdrop, .skin-picker-backdrop')) return;
      setPauseOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pauseOpen, buildingInterior]);

  const saveNow = () => {
    foldPlayTime(true);
    const result = persistence.write(stateRef.current);
    if (session) refreshSlotMeta(session.slotId, stateRef.current);
    setNotice(result.ok ? 'Игра сохранена.' : `Не удалось сохранить: ${result.error}`, result.ok ? 'success' : 'error');
  };
  const leaveTo = (screen: 'main' | 'load' | 'new') => {
    foldPlayTime(false);
    persistence.write(stateRef.current);
    if (session) refreshSlotMeta(session.slotId, stateRef.current);
    reloadToMenu(screen);
  };
  const restartCampaign = () => {
    const config = stateRef.current.worldConfig;
    const nextState = createInitialSaveState(RUNTIME_MODE, Date.now(), config && !config.legacy ? config : undefined);
    dispatchRuntimeReset(RUNTIME_MODE, window);
    // Restarting is the player's explicit decision to replace this campaign.
    persistence.write(nextState, { replaceUnreadable: true });
    applyCampaignRuntime(nextState, RUNTIME_MODE);
    stateRef.current = nextState;
    setState(nextState);
    if (session) refreshSlotMeta(session.slotId, nextState);
    window.setTimeout(() => window.dispatchEvent(new Event(FLEET_ROOT_REQUEST_EVENT)), 0);
    setPauseOpen(false);
    setResultDismissed(false);
    setPlanetViewMode('overview');
    navigateTo('planet');
    setNotice('Кампания начата заново по тем же настройкам мира.', 'success');
  };

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
      <div className="stage stage-shell-v3 stage-shell-v4" data-faction={uiFactionId} style={{ transform: `scale(${scale})`, '--space-bg': `url(${systemBackground})` } as CSSProperties}>
        <div className="stage-ambient" aria-hidden="true"><i /><i /></div>
        <AsterionHeader
          incomingAttackCount={incomingAttackCount + sunAlerts.length}
          factionId={uiFactionId}
          currentPlanet={{
            id: currentPlanet.id,
            name: currentPlanetName,
            coords: currentPlanet.coords,
            status: currentPlanet.status,
            art: currentSkin.art,
          }}
          planets={ownedPlanets.map((planet) => ({
            id: planet.id,
            name: state.planets[planet.id].name,
            coords: planet.coords,
            status: planet.status,
            art: planetSkins.find((skin) => skin.id === state.planets[planet.id].skin)?.art ?? planetSkins[0].art,
          }))}
          resources={[
             { kind: 'metal', label: 'МЕТАЛЛ', value: resourceWallet.metal, capacity: storageCapacities.metal, hourlyGain: effectiveResourceIncomePerHour.metal },
             { kind: 'mineral', label: 'МИНЕРАЛЫ', value: resourceWallet.minerals, capacity: storageCapacities.minerals, hourlyGain: effectiveResourceIncomePerHour.minerals },
             { kind: 'gas', label: 'ГАЗ', value: resourceWallet.gas, capacity: storageCapacities.gas, hourlyGain: effectiveResourceIncomePerHour.gas },
             { kind: 'energy', label: 'ЭНЕРГИЯ', value: currentEnergyLedger.availableEnergy, debris: currentPlanetState.recycling.availableDebris, description: `Источники: ${currentEnergyLedger.producedEnergy} · Потрачено: ${currentEnergyLedger.consumedEnergy}` },
            {
              kind: 'population',
              label: isDefenseFleetView ? 'НАСЕЛЕНИЕ ОБОРОНЫ' : 'НАСЕЛЕНИЕ',
              value: headerPopulationSummary.population,
              capacity: headerPopulationSummary.capacity,
              showCapacity: isDefenseFleetView,
              populationBreakdown: {
                fleet: {
                  value: outgoingFleetSummary.population,
                  capacity: outgoingFleetSummary.capacity,
                },
                defense: {
                  value: defenseSummary.population,
                  capacity: defenseSummary.capacity,
                },
                satellites: isDefenseFleetView ? undefined : Math.max(0, Math.floor(currentPlanetState.solarSatellites ?? 0)),
                pendingInbound: pendingInboundPopulation,
              },
            },
          ]}
          zoneMeta={zoneMeta}
          activeRoute={activeRoute}
          activeZone={activeRoute === 'planet' && planetViewMode !== 'overview' ? planetViewMode : null}
          reportsUnreadCount={reportsUnreadCount}
          planetMenuOpen={planetMenuOpen}
            campaign={{ now, mode: RUNTIME_MODE, timeScale: testTimeScale, saveKey: persistence.saveKey, timeScaleOptions: TEST_TIME_SCALE_OPTIONS, onTimeScaleChange: setTestTimeScale, label: `Кампания${SPEED_SUFFIX[state.worldConfig?.world.campaignSpeed ?? 'standard'] ?? ''}` }}
          onRouteChange={chooseRoute}
          onZoneChange={chooseZone}
          onPlanetChange={(planetId) => selectPlanet(planetId)}
          onPlanetMenuToggle={() => setPlanetMenuOpen((open) => !open)}
         />

        <button
          className="shell-reset-control shell-pause-control"
          type="button"
          data-qa-pause-open
          onClick={() => setPauseOpen(true)}
          aria-label="Меню игры"
          title="Меню игры (Esc)"
        >
          <span aria-hidden="true">≡</span>
        </button>

        <section className={`workspace workspace-v4 workspace--${workspaceKind}`}>
          {/* Command shows its own «Назад» inside its top bar instead of this overlay (it would cover the tabs). */}
          {buildingInterior && buildingInteriorTarget && buildingInteriorTarget.kind !== 'host' && buildingInteriorTarget.kind !== 'fleet-construction' && buildingInteriorTarget.kind !== 'command' && buildingInteriorDefinition ? (
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
              factionId={state.profile.factionId}
              buildings={currentPlanetState.buildings}
              scienceLevels={state.science.levels}
              productionBots={currentPlanetState.productionBots}
              recycling={currentPlanetState.recycling}
              trade={currentPlanetState.trade}
              tradeWallet={tradeWallet}
              spaceportUpgrades={{ ...currentPlanetState.spaceportUpgrades, shipLevels: getOwnerShipUpgradeLevels(state) }}
              spaceportWallet={spaceportWallet}
              resourceRatingPoints={selectOwnerScores(state)[state.profile.playerId]?.resourcePoints ?? 0}
              now={now}
              testTimeScale={testTimeScale}
              onProductionBotsApply={applyProductionBots}
              onRecyclingStart={startRecycling}
              onRecyclingCollect={collectRecycling}
              onTrade={tradeResources}
              onSpaceportUpgrade={startSpaceportUpgrade}
              onSpaceportCancel={cancelSpaceportUpgrade}
              onBack={returnToBuilding}
            />
          ) : activeRoute === 'universe' ? (
            <UniverseView
              pirateContacts={pirateContacts}
              pirateContactState={state.pirate?.contact}
              pirateFocusTarget={pirateFocusTarget}
              onPirateSystemChange={onPirateSystemChange}
              onPirateRecon={launchPirateRecon}
              onPirateAttack={openPirateAttack}
              onPirateReport={openPirateReport}
              onNotice={setNotice}
              ownedPlanetArt={'mapArt' in currentSkin ? currentSkin.mapArt : currentSkin.art}
              ownedPlanetName={currentPlanetName}
              profile={state.profile}
              ownerScores={selectOwnerScores(state)}
              command={state.command}
              playerPlanets={universePlayerPlanets}
              spyTargets={Object.values(getEspionageTargets(state.espionage))}
              orbitalDebrisByCoordinate={getOrbitalDebrisByCoordinate(getEspionageState(state))}
              asteroidDebrisPresenceBySpawnIndex={Object.fromEntries(Object.entries(state.asteroidDebrisBySpawnIndex ?? {}).map(([spawnIndex, amount]) => [spawnIndex, amount > 0]))}
              asteroidStates={state.asteroidSimulation?.asteroids}
              mode={RUNTIME_MODE}
              onColonize={openColonizationLaunch}
              onAsteroidRecycler={openAsteroidRecyclerLaunch}
              onExpedition={openExpeditionLaunch}
              onExplorationRecon={launchExplorationRecon}
              explorationEligibility={universeExplorationEligibility}
              onTransport={openTransportLaunch}
              onSpy={openSpyLaunch}
              onAttack={openAttackLaunch}
              onSunSelect={(galaxy, system) => openSunsPanel({ galaxy, system })}
              sunAlerts={sunAlerts.map((alert) => ({ galaxy: alert.raid.galaxy, system: alert.raid.system }))}
              homeCoordinate={{ galaxy: homePlanet?.universeGalaxy ?? 1, system: homePlanet?.universeSystem ?? 1 }}
              debrisOrigin={state.planets[state.currentPlanetId] ? {
                planetName: state.planets[state.currentPlanetId]!.name,
                coordinate: {
                  galaxy: state.planets[state.currentPlanetId]!.universeGalaxy ?? 1,
                  system: state.planets[state.currentPlanetId]!.universeSystem ?? 1,
                  position: state.planets[state.currentPlanetId]!.universePosition ?? 1,
                },
              } : null}
              onRecycleDebris={openDebrisRecycleLaunch}
              focusTarget={universeFocusTarget}
              onFocusHandled={() => { setUniverseFocusTarget(null); setPirateFocusTarget(null); }}
            />
          ) : activeRoute === 'operations' ? (
            <OperationsView
              pirateContacts={operationsVariantAFixture?.pirateContacts ?? pirateContacts}
              explorationContacts={operationsVariantAFixture?.explorationContacts ?? selectExplorationOperations(state, now, RUNTIME_MODE)}
              onExpedition={openExpeditionLaunch}
              onExplorationAttack={openExplorationAttackLaunch}
              onBot01Occupy={RUNTIME_MODE === 'test' ? launchBot01Exploration : undefined}
              onExplorationAccept={acceptExplorationContact}
              onExplorationCancel={cancelExplorationContact}
              onExplorationRecon={launchExplorationRecon}
              onExplorationUniverse={(node) => openUniverseTarget({ coordinate: node.coordinate, planetId: node.id })}
              onExplorationReport={openPirateReport}
              pirateOwnerId={state.profile.playerId}
              pirateRaidRolls={state.pirate?.raidRolls}
              pirateAdaptiveDiagnostics={RUNTIME_MODE==='test'?(state.pirate?.ownerAdaptations?.[state.profile.playerId]??defaultPirateOwnerAdaptation()):undefined}
              onPirateBattleExport={RUNTIME_MODE==='test'?exportPirateBattleAnalysis:undefined}
              pirateCheckDelayMs={scaleRuntimeDuration(15*60_000,RUNTIME_MODE,testTimeScale)}
              pirateThreatPercent={100*pirateRaidChance(
                selectOwnerScores(state)[state.profile.playerId]?.resourcePoints??0,
                selectOwnerScores(state)[state.profile.playerId]?.battlePoints??0,
                advancePirateThreat(
                  state.pirate?.ownerThreats?.[state.profile.playerId] ??
                    {version:1,ageHours:0,integratedAt:state.pirate?.raidProcessedAt??now},
                  now,
                ).ageHours,
              )}
              completedPirateOperations={operationsVariantAFixture?.completedPirateOperations ?? completedPirateOperations}
              onPirateBattleReport={openPirateReport}
              nowMs={operationsVariantAFixture?.nowMs ?? now}
              onPirateAccept={acceptPirateOperation}
              onPirateCancel={cancelPirateOperation}
              onPirateRecon={launchPirateRecon}
              onPirateAttack={openPirateAttack}
              onPirateReport={openPirateReport}
              onPirateUniverse={focusPirateUniverse}
              state={operationsVariantAFixture?.state ?? state.operations}
              onAccept={acceptOperationsOperation}
              onCancel={cancelOperationsOperation}
              onOpenFleets={openFleetRootFromOperations}
            />
          ) : activeRoute === 'command' ? (
            <CommandView
              mode={RUNTIME_MODE}
              command={state.command}
              ownerId={state.profile.playerId}
              hall={{
                level: commandHallLevel,
                name: commandHallDefinition.name,
                art: commandHallDefinition.art,
              }}
              ownerScores={withTestOwnerScoreFixtures(selectOwnerScores(state), RUNTIME_MODE)}
              ownerFactions={commandOwnerFactions}
              playerFactionId={state.profile.factionId}
              returnToBuilding={buildingInterior && buildingInteriorTarget?.kind === 'command' && buildingInteriorDefinition
                ? { label: `Назад в ${buildingInteriorDefinition.name}`, onBack: returnToBuilding }
                : undefined}
              testTimeScale={RUNTIME_MODE === 'test' ? testTimeScale : 1}
              aid={selectAidOverview(state, { now, mode: RUNTIME_MODE, testTimeScale })}
              now={now}
              actions={commandActions}
              operationsAlertCount={sunAlerts.length}
              focusTab={commandFocus}
              operationsPanel={(
                <SunRaidPanel
                  state={state}
                  now={now}
                  mode={RUNTIME_MODE}
                  testTimeScale={testTimeScale}
                  selected={selectedSun}
                  onSelect={setSelectedSun}
                  onCommit={commitSunAction}
                  onOpenReport={openPirateReport}
                  onOpenCommand={() => setCommandFocus({ tab: 'overview', nonce: Date.now() })}
                  onOpenGate={() => { setGateDialogPlanetId(state.currentPlanetId); }}
                  onSendSupport={openSunSupportInFleets}
                  onRecycleDebris={openSunRecycleInFleets}
                  onTestGateAssault={testGateAssault}
                />
              )}
            />
          ) : activeRoute === 'reports' ? (
            <ReportsView
              pirateReconReports={state.pirate?.reconReports}
              pirateFlights={state.flights.records}
              exploration={state.exploration}
              initialSelectedReportId={pirateReportId}
              battleReports={state.combat.reports}
              savedBattleReportIds={state.combat.savedReportIds}
              operations={state.operations}
              command={state.command}
              espionage={state.espionage}
              profile={state.profile}
              score={selectOwnerScores(state)[state.profile.playerId] ?? null}
              rating={state.rating}
              mode={RUNTIME_MODE}
              state={state.reports}
              onStateChange={(reports) => {
                const nextState = { ...stateRef.current, reports };
                stateRef.current = nextState;
                setState(nextState);
              }}
              onToggleBattleSaved={toggleBattleSavedFromReports}
              onOpenFleets={openFleetRootFromReports}
              onOpenCommand={openCommandFromReports}
              onSimulateBattle={openSpySimulator}
              onRecallSpy={recallSpyFromReport}
              onOpenUniverseTarget={openUniverseTarget}
              onOpenPirateUniverse={openPirateReconCoordinate}
            />
          ) : activeRoute === 'planet' && planetViewMode !== 'overview' ? (
            <ZoneView
              zone={planetViewMode}
              planetName={currentPlanetName}
              planetCoords={currentPlanet.coords}
              resources={resourceWallet}
              resourceIncomePerHour={effectiveResourceIncomePerHour}
              productionBotAssignment={currentPlanetState.productionBots}
              buildings={currentPlanetState.buildings}
              queue={currentQueue}
              scienceLevels={state.science.levels}
              energyLedger={currentEnergyLedger}
              energyCoordinates={currentEnergyCoordinates}
              now={now}
              selectedRole={selectedBuildingRole}
              onSelectedRoleChange={setSelectedBuildingRole}
              onBuild={buildBuilding}
              onCancelBuilding={cancelBuilding}
              onDestroyBuilding={destroyBuilding}
              onEnterBuilding={enterBuilding}
              factionId={state.profile.factionId}
              gate={(() => {
                const gate = gateContext.gate;
                const here = gate && gate.hostPlanetId === currentPlanet.id ? gate : null;
                const status = here && here.status !== 'cancelled' ? here.status : 'idle';
                return {
                  status,
                  progress: here ? (here.status === 'completed' ? 100 : gateProgressPercent(here, now)) : 0,
                  crystals: here ? here.crystals : gateContext.crystals,
                  caption: status === 'building' ? `Стройка ${Math.floor(gateProgressPercent(here!, now))}%` : status === 'completed' ? 'Достроены' : status === 'destroyed' ? 'Разрушены' : `Кристаллы ${gateContext.crystals.length}/4`,
                  onOpen: () => setGateDialogPlanetId(currentPlanet.id),
                };
              })()}
            />
          ) : activeRoute === 'planet' ? (
            <PlanetOrbitView
              name={currentPlanetName}
              kicker={`ОБЗОР ПЛАНЕТЫ · ${PLAYER_FACTION_LABELS[state.profile.factionId].toUpperCase()}`}
              subtitle={`${currentPlanet.coords} · ${currentPlanet.status}`}
              skinArt={currentSkin.art}
              vitals={[
                { label: 'Население', value: `${planetPopulation} / ${fleetSummary.capacity}` },
                { label: 'Энергия', value: Number(currentEnergyLedger.availableEnergy).toLocaleString('ru-RU') },
                { label: 'Ресурсные здания', value: `${resourceBuildingCount} / 10` },
                { label: 'Стабильность', value: `${currentPlanetState.stability}%`, tone: 'ok' },
              ]}
              worlds={ownedPlanets.map((planet) => {
                const planetState = state.planets[planet.id];
                return {
                  id: planet.id,
                  name: planetState.name,
                  coords: planet.coords,
                  status: planet.status,
                  art: planetSkins.find((skin) => skin.id === planetState.skin)?.art ?? planetSkins[0].art,
                  active: planet.id === currentPlanet.id,
                };
              })}
              zones={(['resource', 'industry', 'military'] as Zone[]).map((zone) => {
                const roles = getBuildingsForZone(zone, state.profile.factionId);
                const building = currentQueue.find((item) => getBuildingDefinition(item.assetRole, state.profile.factionId).zone === zone);
                return {
                  zone,
                  title: zoneMeta[zone].title.replace(' ЗОНА', ''),
                  accent: zoneMeta[zone].accent,
                  art: getBuildingDefinition(PLANET_ZONE_EMBLEM_ROLE[zone], state.profile.factionId).art,
                  built: roles.filter((item) => (currentPlanetState.buildings[item.assetRole] ?? 0) > 0).length,
                  total: roles.length,
                  building: building ? getBuildingDefinition(building.assetRole, state.profile.factionId).name : null,
                };
              })}
              queue={currentQueue.map((item, index) => {
                const definition = getBuildingDefinition(item.assetRole, state.profile.factionId);
                return {
                  id: item.id,
                  zoneLabel: ZONE_VIEW_META[definition.zone].queueLabel,
                  name: definition.name,
                  art: definition.art,
                  fromLevel: Math.max(0, item.targetLevel - 1),
                  toLevel: item.targetLevel,
                  active: index === 0,
                  remaining: index === 0 ? formatCountdown(item.finishAt - now) : null,
                  progress: index === 0 ? progress : 0,
                };
              })}
              queueCapacity={BUILDING_QUEUE_CAPACITY}
              income={effectiveResourceIncomePerHour}
              banner={currentOverpopulation.blocked ? <section className="planet-overpopulation-banner-v3" data-qa-overpopulation-banner role="status">
                <strong>ПЛАНЕТА ПЕРЕНАСЕЛЕНА</strong>
                <span>{currentOverpopulation.actualPopulation} / {currentOverpopulation.capacity} · избыток {currentOverpopulation.excess}</span>
                <small>{currentOverpopulation.episode?.lastResolutionReason === 'no-eligible-units'
                  ? 'Нет кораблей, подходящих для сгорания; планета остаётся заблокированной.'
                  : currentOverpopulation.episode
                    ? `Линейное сжигание флота: ${Math.round(currentOverpopulation.burnProgress * 100)}% за 10 минут.`
                    : 'Запущено линейное сжигание флота на 10 минут.'}</small>
              </section> : null}
              onSelectWorld={(id) => selectPlanet(id as PlanetId)}
              onEditWorld={(id) => openPlanetEditor(id as PlanetId)}
              onChooseZone={chooseZone}
              onColonize={() => navigateTo('universe')}
            />
          ) : (
            <main className="module-placeholder-v3">
              <span>ASTERION COMMAND MODULE</span>
              <h1>{activeTab.toUpperCase()}</h1>
              <p>Верхняя командная панель остаётся неизменной. Этот рабочий экран будет реализован отдельным модулем.</p>
            </main>
          )}
        </section>

        {foreignWriterAt ? (
          <div className="save-conflict-banner" role="alert" data-qa-save-conflict>
            <strong>Игра открыта в другой вкладке со старой версией</strong>
            <span>Она каждую секунду перезаписывает сохранение (так пропадала построенная Палата управления). Закройте другие вкладки Asterion этого сайта — эта вкладка сохранит ваш прогресс.</span>
            <button type="button" onClick={() => { persistence.write(stateRef.current); setForeignWriterAt(null); }}>ЗАКРЫЛ — СОХРАНИТЬ ЗДЕСЬ</button>
          </div>
        ) : null}
        <div className="shell-notice shell-notice-live" data-qa-runtime-mode={RUNTIME_MODE} data-qa-runtime-notice role="status" aria-live="polite">
          <span>{lastNotice}</span>
        </div>

        {createPortal(
          <div className="runtime-toast-stack" data-qa-runtime-toast-stack aria-live="polite">
            {toasts.map((toast) => (
              <div key={toast.id} className={`runtime-toast runtime-toast--${toast.tone}`} data-qa-runtime-toast>
                <span>{toast.text}</span>
                <button type="button" aria-label="Закрыть уведомление" title="Закрыть" onClick={() => dismissToast(toast.id)}>×</button>
              </div>
            ))}
          </div>,
          document.body,
        )}

        {gateDialogPlanetId ? (
          <GateDialog
            state={state}
            planetId={gateDialogPlanetId}
            now={now}
            mode={RUNTIME_MODE}
            testTimeScale={testTimeScale}
            onClose={() => setGateDialogPlanetId(null)}
            onStart={startGate}
            onTestAssault={testGateAssault}
            onOpenSuns={() => { setGateDialogPlanetId(null); openSunsPanel(); }}
          />
        ) : null}
        {pauseOpen ? (session ? (
          <PauseMenu
            variant="slot"
            title={session.slotName}
            factionId={state.profile.factionId}
            playTimeMs={state.playTimeMs ?? 0}
            onResume={() => setPauseOpen(false)}
            onSave={saveNow}
            onLoad={() => leaveTo('load')}
            onExport={exportCurrentSave}
            onRestart={restartCampaign}
            onMainMenu={() => leaveTo('main')}
          />
        ) : (
          <PauseMenu
            variant="test"
            title="Тестовая кампания"
            factionId={state.profile.factionId}
            playTimeMs={0}
            onResume={() => setPauseOpen(false)}
            onSave={saveNow}
            onExport={exportCurrentSave}
            testSpeed={RUNTIME_MODE === 'test' ? { value: testTimeScale, options: TEST_TIME_SCALE_OPTIONS, onChange: (value) => setTestTimeScale(value as TestTimeScale) } : undefined}
            onRestart={() => { setPauseOpen(false); reset(); }}
            onMainMenu={() => { persistence.write(stateRef.current); window.location.href = window.location.pathname; }}
          />
        )) : null}
        {sunRaidState.campaignResult && !resultDismissed ? (
          <CampaignResultOverlay
            result={sunRaidState.campaignResult}
            factionId={state.profile.factionId}
            playTimeMs={state.playTimeMs ?? 0}
            onStay={() => setResultDismissed(true)}
            onNewGame={() => (session ? leaveTo('new') : setResultDismissed(true))}
            onMainMenu={() => (session ? leaveTo('main') : setResultDismissed(true))}
          />
        ) : null}

        {editingPlanet && editingPlanetState ? (
          <div className="skin-picker-backdrop" onMouseDown={closePlanetEditor}>
            <section className="skin-picker-modal planet-editor-modal-v5" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <div><small>РЕДАКТИРОВАТЬ ПЛАНЕТУ</small><h2>{editingPlanetState.name}</h2><p>{editingPlanet.coords} · {editingPlanet.status}</p></div>
                <button
                  type="button"
                  data-asterion-close
                  aria-label="Закрыть редактор планеты"
                  title="Закрыть редактор планеты"
                  onClick={closePlanetEditor}
                >×</button>
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
                  <button key={skin.id} type="button" data-qa-planet-skin={skin.id} className={editingPlanetState.skin === skin.id ? 'active' : ''} onClick={() => chooseSkin(skin)}>
                    <img src={skin.art} alt="" /><span>{skin.label}</span><small>{editingPlanetState.skin === skin.id ? 'АКТИВИРОВАНА' : 'ИСПОЛЬЗОВАТЬ'}</small>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}

      </div>
    </div>
  );
}
