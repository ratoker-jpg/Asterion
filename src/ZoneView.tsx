import { localizeBuildingNames } from './domain/buildings/balance-v1.ts';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { getPlanetZoneTerrainUrl } from './assets/planetZoneTerrainAssets.ts';
import { canEnterBuildingInterior } from './building-interior-navigation.ts';
import { getZoneScenePlacement } from './zone-scene.ts';
import { describeQuickUpgrade, formatQuickAmount } from './zone-quick-upgrade.ts';
import {
  BUILDING_QUEUE_CAPACITY,
  evaluateBuildingBuild,
  formatBalanceEffect,
  getBuildingDefinition,
  getBuildingEffect,
  getBuildingEffectWithScience,
  getBuildingsForZone,
  type BuildingDefinition,
  type BuildingEconomyState,
  type BuildingLevels,
  type BuildingQueueItem,
  type BuildingRole,
  type BuildingZone,
  type ResourceWallet,
  type ScienceLevels,
} from './domain/buildings/resource-zone.ts';
import {
  calculateNuclearReactorContribution,
  calculateSolarStationContribution,
  type EnergyLedger,
} from './domain/energy/runtime.ts';
import type { PlanetEnergyCoordinates } from './application/energy.ts';
import { getProductionBotBonusPercent, type BotAssignment, type ProductionResourceIncome } from './domain/buildings/production-bots.ts';
import { RUNTIME_RESET_EVENT } from './domain/runtime/mode.ts';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import { gateArt } from './ui/sun-raid/gate-art.ts';
import { SOLAR_CRYSTALS, SOLAR_CRYSTAL_IDS } from './domain/sun-raid/config.ts';
import './ui/sun-raid/gate.css';
import type { SolarCrystalId } from './domain/sun-raid/config.ts';
import { PLAYER_FACTION_LABELS } from './domain/profile/repository.ts';
import type { PlayerFactionId } from './domain/profile/types.ts';

export const ZONE_VIEW_META: Readonly<Record<BuildingZone, {
  title: string;
  subtitle: string;
  queueLabel: string;
  terrainFile: string;
}>> = {
  resource: {
    title: 'Ресурсная зона',
    subtitle: 'Добыча, энергия и инфраструктура планеты',
    queueLabel: 'Ресурсная',
    terrainFile: 'resource-terrain.png',
  },
  industry: {
    title: 'Промышленная зона',
    subtitle: 'Производство и инфраструктура планеты',
    queueLabel: 'Промышленная',
    terrainFile: 'industry-terrain.png',
  },
  military: {
    title: 'Военная зона',
    subtitle: 'Флот, исследования и управление планетой',
    queueLabel: 'Военная',
    terrainFile: 'military-terrain.png',
  },
};

const resourceLabels = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
  energy: 'Энергия',
} as const;

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatDurationLabel(ms: number | null) {
  if (ms == null) return '—';
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} ч ${String(minutes).padStart(2, '0')} мин ${String(seconds).padStart(2, '0')} сек`;
  if (minutes > 0) return `${minutes} мин ${String(seconds).padStart(2, '0')} сек`;
  return `${seconds} сек`;
}

/**
 * What the player reads in «Что даст улучшение»: one plain line per level, no
 * formula. Energy shows the total, the next level adds «(+N)»; mines show the
 * hourly output with science and robots already included.
 */
function playerEffectForLevel(
  role: BuildingRole,
  level: number,
  productionBots: BotAssignment,
  scienceLevels: ScienceLevels,
  energyCoordinates: PlanetEnergyCoordinates,
  energyComparisonValue: number | null = null,
) {
  const effect = getBuildingEffect(role, level);
  if ((role === 'basic-energy' || role === 'advanced-energy') && level > 0) {
    const physicsLevel = scienceLevels[1] ?? 0;
    const value = role === 'basic-energy'
      ? calculateSolarStationContribution(level, physicsLevel, energyCoordinates.system, energyCoordinates.position, energyCoordinates.galaxy)
      : calculateNuclearReactorContribution(level, physicsLevel);
    return {
      primary: energyComparisonValue == null
        ? `Энергия: ${formatNumber(value)}`
        : `Энергия: ${formatNumber(value)} (+${formatNumber(value - energyComparisonValue)})`,
      value,
      energy: true,
    };
  }
  const scienceEffect = getBuildingEffectWithScience(role, level, scienceLevels);
  if (scienceEffect.kind !== 'resource-income') {
    return { primary: formatBalanceEffect(scienceEffect.kind === 'energy-income' ? scienceEffect : effect), value: null, energy: false };
  }
  const productionBotBonusPercent = getProductionBotBonusPercent(productionBots, scienceEffect.resource);
  return {
    primary: formatBalanceEffect({
      ...scienceEffect,
      amountPerHour: Math.round(scienceEffect.amountPerHour * (1 + productionBotBonusPercent / 100)),
    }),
    value: null,
    energy: false,
  };
}

function stateFor(
  economy: BuildingEconomyState,
  role: BuildingRole,
): { className: string; label: string | null } {
  const item = getBuildingDefinition(role);
  const level = economy.buildings[role];
  const queueIndex = economy.queue.findIndex((queueItem) => queueItem.assetRole === role);
  if (queueIndex === 0) return { className: 'building', label: 'Строится' };
  if (queueIndex > 0) return { className: 'queued', label: 'В очереди' };
  if (level >= item.maxLevel) return { className: 'maxed', label: 'Максимум' };
  const availability = evaluateBuildingBuild(economy, role);
  if (availability.status === 'requirements-unmet') return { className: 'blocked', label: 'Нужны требования' };
  if (level > 0) return { className: 'active', label: null };
  return { className: 'unbuilt', label: null };
}

function selectorStatusText(className: string, level: number) {
  if (className === 'building') return 'Строится';
  if (className === 'queued') return 'В очереди';
  if (className === 'blocked') return 'Требования не выполнены';
  if (className === 'maxed') return 'Максимальный уровень';
  return level > 0 ? 'Доступно к улучшению' : 'Доступно';
}

function EnterIcon() {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...common} d="M4 4h9v16H4zM13 12h7M17 8l4 4-4 4" />
      <path {...common} d="M8 12h.01" />
    </svg>
  );
}

export type ZoneViewProps = {
  zone: BuildingZone;
  planetName: string;
  planetCoords: string;
  resources: ResourceWallet;
  resourceIncomePerHour: ProductionResourceIncome;
  productionBotAssignment: BotAssignment;
  buildings: BuildingLevels;
  queue: BuildingQueueItem[];
  scienceLevels: ScienceLevels;
  energyLedger: EnergyLedger;
  energyCoordinates: PlanetEnergyCoordinates;
  now: number;
  selectedRole: BuildingRole | null;
  onSelectedRoleChange: (role: BuildingRole | null) => void;
  onBuild: (assetRole: BuildingRole) => boolean;
  onCancelBuilding: (queueId: string) => boolean;
  onDestroyBuilding: (assetRole: BuildingRole) => boolean;
  onEnterBuilding: (assetRole: BuildingRole) => void;
  /** Player race: building names and art follow it (they used to always be Астеры). */
  factionId?: PlayerFactionId;
  /** Military zone only: the «Звёздные Врата» slot in the free bottom-right spot. */
  gate?: ZoneGateSlot;
};

export type ZoneGateSlot = {
  status: 'idle' | 'building' | 'completed' | 'destroyed';
  progress: number;
  crystals: readonly SolarCrystalId[];
  caption: string;
  onOpen: () => void;
};

/** The floating tile tooltip: portaled to <body> so map captions never cover it. */
type TileTip = { role: BuildingRole; kind: 'tile' | 'quick'; left: number; top: number };

type PendingBuildingAction =
  | { kind: 'cancel'; queueId: string; assetRole: BuildingRole; targetLevel: number }
  | { kind: 'destroy'; assetRole: BuildingRole; currentLevel: number };

export function ZoneView({
  zone,
  planetName,
  planetCoords,
  resources,
  resourceIncomePerHour,
  productionBotAssignment,
  buildings,
  queue,
  scienceLevels,
  energyLedger,
  energyCoordinates,
  now,
  selectedRole,
  onSelectedRoleChange,
  onBuild,
  onCancelBuilding,
  onDestroyBuilding,
  onEnterBuilding,
  factionId = 'aegis',
  gate,
}: ZoneViewProps) {
  const economy = useMemo<BuildingEconomyState>(
    () => ({ resources, buildings, queue, scienceLevels }),
    [resources, buildings, queue, scienceLevels],
  );
  const zoneBuildings = getBuildingsForZone(zone, factionId);
  const meta = ZONE_VIEW_META[zone];
  const selected = selectedRole ? getBuildingDefinition(selectedRole, factionId) : null;
  const availability = selectedRole ? evaluateBuildingBuild(economy, selectedRole) : null;
  const selectedHasQueue = selectedRole ? queue.some((item) => item.assetRole === selectedRole) : false;
  const [pendingAction, setPendingAction] = useState<PendingBuildingAction | null>(null);
  const [quickQueuedRole, setQuickQueuedRole] = useState<BuildingRole | null>(null);
  const [tileTip, setTileTip] = useState<TileTip | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const confirmYesRef = useRef<HTMLButtonElement>(null);
  const confirmNoRef = useRef<HTMLButtonElement>(null);
  const activeCount = zoneBuildings.filter((building) => buildings[building.assetRole] > 0).length;
  const terrainUrl = getPlanetZoneTerrainUrl(zone);
  const canEnterSelected = selectedRole
    ? canEnterBuildingInterior(selectedRole, buildings[selectedRole])
    : false;
  // Only the unmet requirements are shown: a met one is noise.
  const missingRequirements = availability ? availability.requirements.filter((requirement) => !requirement.met) : [];
  const currentEffect = selectedRole && availability
    ? playerEffectForLevel(selectedRole, availability.currentLevel, productionBotAssignment, scienceLevels, energyCoordinates)
    : null;
  const nextEffect = selectedRole && availability?.nextLevel != null
    ? playerEffectForLevel(
      selectedRole,
      availability.nextLevel,
      productionBotAssignment,
      scienceLevels,
      energyCoordinates,
      currentEffect?.energy && currentEffect.value != null ? currentEffect.value : null,
    )
    : null;
  const levelProgress = availability && availability.maxLevel > 0
    ? Math.min(availability.maxLevel, Math.max(0, availability.currentLevel))
    : 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingAction) {
        setPendingAction(null);
      } else if (selectedRole) {
        onSelectedRoleChange(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSelectedRoleChange, pendingAction, selectedRole]);

  useEffect(() => {
    const onRuntimeReset = () => {
      setPendingAction(null);
      onSelectedRoleChange(null);
    };
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    return () => window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
  }, [onSelectedRoleChange]);

  useEffect(() => {
    if (!pendingAction) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => confirmYesRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [confirmYesRef.current, confirmNoRef.current].filter((control): control is HTMLButtonElement => Boolean(control));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      if (previousActiveElement?.isConnected) previousActiveElement.focus();
    };
  }, [pendingAction]);

  const submitBuild = () => {
    if (!selectedRole || !availability?.canBuild) return;
    if (onBuild(selectedRole)) onSelectedRoleChange(null);
  };


  const showTileTip = (role: BuildingRole, kind: TileTip['kind'], target: HTMLElement) => {
    const anchor = target.getBoundingClientRect();
    const panel = summaryRef.current?.getBoundingClientRect();
    setTileTip({ role, kind, left: (panel?.right ?? anchor.right) + 12, top: anchor.top + anchor.height / 2 });
  };
  const hideTileTip = () => setTileTip(null);

  useEffect(() => {
    if (!quickQueuedRole) return;
    const timer = window.setTimeout(() => setQuickQueuedRole(null), 700);
    return () => window.clearTimeout(timer);
  }, [quickQueuedRole]);

  // The tile's «+» runs the dialog's own «Улучшить» command without opening the dialog.
  const submitQuickBuild = (role: BuildingRole) => {
    if (!evaluateBuildingBuild(economy, role).canBuild) return;
    if (onBuild(role)) setQuickQueuedRole(role);
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;
    const succeeded = pendingAction.kind === 'cancel'
      ? onCancelBuilding(pendingAction.queueId)
      : onDestroyBuilding(pendingAction.assetRole);
    if (succeeded) setPendingAction(null);
  };

  return (
    <div
      className="resource-zone-view"
      data-qa-zone-view
      data-zone={zone}
      data-qa-resource-zone={zone === 'resource' ? 'true' : undefined}
    >
      <aside className="resource-zone-summary" ref={summaryRef}>
        <header className="resource-zone-panel-title">
          <div><strong>{meta.title}</strong><small>{planetName}</small></div>
          <span aria-label={`Построено ${activeCount} из ${zoneBuildings.length}`}>{activeCount} / {zoneBuildings.length}</span>
        </header>

        <section className="resource-zone-building-selector" aria-label={`Выбор здания: ${meta.title.toLowerCase()}`}>
          <div className="resource-zone-selector-grid">
            {zoneBuildings.map((building) => {
              const status = stateFor(economy, building.assetRole);
              const selectedClass = selectedRole === building.assetRole ? 'selected' : '';
              const level = buildings[building.assetRole];
              const statusText = selectorStatusText(status.className, level);
              const tooltipId = `zone-selector-tooltip-${building.assetRole}`;
              const buildAvailability = evaluateBuildingBuild(economy, building.assetRole);
              const quick = describeQuickUpgrade(
                building.name,
                buildAvailability,
                BUILDING_QUEUE_CAPACITY - queue.length,
                buildAvailability.reason ? localizeBuildingNames(buildAvailability.reason, factionId) : null,
              );
              return (
                <div className="resource-zone-selector-cell" key={building.assetRole}>
                  <button
                    type="button"
                    data-zone-selector-role={building.assetRole}
                    data-resource-selector-role={building.assetRole}
                    className={`resource-zone-selector-tile ${status.className} ${selectedClass}`}
                    aria-label={`${building.name}. Уровень ${level} из ${building.maxLevel}. ${statusText}.`}
                    aria-describedby={tooltipId}
                    onClick={() => onSelectedRoleChange(building.assetRole)}
                    onMouseEnter={(event) => showTileTip(building.assetRole, 'tile', event.currentTarget)}
                    onMouseLeave={hideTileTip}
                    onFocus={(event) => showTileTip(building.assetRole, 'tile', event.currentTarget)}
                    onBlur={hideTileTip}
                  >
                    <img src={building.art} alt="" draggable={false} />
                    <b className="resource-zone-selector-level">{level}/{building.maxLevel}</b>
                    {status.className === 'blocked' ? <span className="resource-zone-selector-lock" aria-hidden="true" /> : null}
                    {status.className === 'building' || status.className === 'queued' ? (
                      <span className={`resource-zone-selector-queue-indicator ${status.className}`} aria-hidden="true" />
                    ) : null}
                    <span className="resource-zone-selector-tooltip" id={tooltipId} role="tooltip">
                      <strong>{building.name}</strong>
                      <small>Уровень {level}/{building.maxLevel} · {statusText}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`resource-zone-selector-quick${quick.enabled ? '' : ' is-disabled'}${quickQueuedRole === building.assetRole ? ' is-queued' : ''}`}
                    data-qa-quick-build={building.assetRole}
                    data-qa-quick-build-status={buildAvailability.status}
                    aria-disabled={!quick.enabled}
                    data-qa-quick-build-summary={quick.summary}
                    aria-label={quick.ariaLabel}
                    onClick={(event) => {
                      event.stopPropagation();
                      submitQuickBuild(building.assetRole);
                    }}
                    onMouseEnter={(event) => showTileTip(building.assetRole, 'quick', event.currentTarget)}
                    onMouseLeave={hideTileTip}
                    onFocus={(event) => showTileTip(building.assetRole, 'quick', event.currentTarget)}
                    onBlur={hideTileTip}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {zone === 'resource' ? (
          <>
          <section className="resource-zone-economy" aria-label="Добыча за 1 час">
            <div className="resource-zone-economy-title">Добыча за час</div>
            <div className="resource-zone-income-list">
              {(['metal', 'minerals', 'gas'] as const).map((key) => (
                <div className="resource-zone-income-row" data-resource-income={key} key={key}>
                  <span className="resource-zone-income-icon"><ResourceIcon kind={key} /></span>
                  <span className="resource-zone-income-name">{resourceLabels[key]}</span>
                  <strong>{formatNumber(resourceIncomePerHour[key])}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="resource-zone-energy-summary" aria-label="Баланс энергии" data-qa-energy-summary>
            <div className="resource-zone-economy-title">Энергия</div>
            <div className="resource-zone-energy-total-row"><span>Произведено</span><strong>{formatNumber(energyLedger.producedEnergy)}</strong></div>
            <div className="resource-zone-energy-total-row"><span>Потрачено</span><strong>{formatNumber(energyLedger.consumedEnergy)}</strong></div>
            <div className="resource-zone-energy-total-row available"><span>Доступно</span><strong>{formatNumber(energyLedger.availableEnergy)}</strong></div>
            <div className="resource-zone-energy-sources">
              {energyLedger.sources.map((source) => (
                <div key={source.id} data-qa-energy-source={source.id}>
                  <span>{source.id === 'solar-satellite' ? 'Спутники' : source.id === 'solar-station' ? 'Солнечная станция' : 'Ядерный реактор'}</span>
                  <strong>{formatNumber(source.fullContribution)}</strong>
                </div>
              ))}
            </div>
          </section>
          </>
        ) : null}
      </aside>

      <main className="resource-zone-scene">
        <img
          className="resource-zone-terrain"
          src={terrainUrl}
          alt=""
          draggable={false}
          data-qa-zone-terrain
          data-zone={zone}
          data-terrain-source={meta.terrainFile}
        />
        <div className="resource-zone-scene-shade" aria-hidden="true" />
        <div className="resource-zone-scene-copy">
          <small>{PLAYER_FACTION_LABELS[factionId]} · {planetCoords}</small>
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </div>
        <div className="resource-zone-building-layer" aria-label={`Территория: ${meta.title.toLowerCase()}`}>
          {zoneBuildings.map((building) => {
            const status = stateFor(economy, building.assetRole);
            const placement = getZoneScenePlacement(zone, building.assetRole);
            const selectedClass = selectedRole === building.assetRole ? 'selected' : '';
            const level = buildings[building.assetRole];
            return (
              <button
                key={building.assetRole}
                type="button"
                data-zone-building-role={building.assetRole}
                data-resource-building-role={building.assetRole}
                className={`resource-building-node ${status.className} ${selectedClass}`}
                style={{
                  left: placement.left,
                  top: placement.top,
                  '--building-width': `${placement.width}px`,
                  '--ground-shadow-width': `${placement.shadowWidth}px`,
                } as CSSProperties}
                aria-label={`${building.name}. Уровень ${level} из ${building.maxLevel}${status.label ? `. ${status.label}` : ''}`}
                onClick={() => onSelectedRoleChange(building.assetRole)}
              >
                <span className="resource-building-ground-shadow" aria-hidden="true" />
                <span className="resource-building-art">
                  <img src={building.art} alt="" draggable={false} />
                  {/* Perf PR 6: the construction glow is this pre-glowed copy fading in (opacity on the GPU). */}
                  {status.className === 'building' ? <img className="resource-building-art__glow" src={building.art} alt="" aria-hidden="true" draggable={false} /> : null}
                </span>
                <span className="resource-building-caption">
                  <strong>{building.name}</strong>
                  <small>{status.label ? `${status.label} · ` : ''}ур. {level}/{building.maxLevel}</small>
                </span>
              </button>
            );
          })}
          {zone === 'military' && gate ? (
            <button
              type="button"
              className={`resource-building-node gate-node is-${gate.status}${gate.status === 'idle' ? ' is-empty' : ''}`}
              style={{ left: '64%', top: '66%', '--building-width': '196px', '--ground-shadow-width': '140px' } as CSSProperties}
              aria-label={`Звёздные Врата. ${gate.caption}`}
              onClick={gate.onOpen}
              data-qa-gate-slot={gate.status}
            >
              <span className="resource-building-ground-shadow" aria-hidden="true" />
              <span className="resource-building-art">
                <img src={gateArt(factionId, gate.status === 'building' ? 'construction' : gate.status === 'destroyed' ? 'ruined' : 'built')} alt="" draggable={false} />
                {/* Perf PR 6: the charge glow is this pre-filtered copy fading in (opacity on the GPU). */}
                {gate.status === 'building' ? <img className="resource-building-art__glow" src={gateArt(factionId, 'construction')} alt="" aria-hidden="true" draggable={false} /> : null}
              </span>
              <span className="gate-node__crystals" aria-hidden="true">
                {SOLAR_CRYSTAL_IDS.map((id) => <i key={id} className={gate.crystals.includes(id) ? 'is-on' : ''} style={{ '--gem': SOLAR_CRYSTALS[id].color } as CSSProperties} />)}
              </span>
              {gate.status === 'building' ? <span className="gate-node__bar" aria-hidden="true"><i style={{ width: `${gate.progress}%` }} /></span> : null}
              <span className="resource-building-caption">
                <strong>Звёздные Врата</strong>
                <small>{gate.caption}</small>
              </span>
            </button>
          ) : null}
        </div>
      </main>

      <aside className="resource-zone-queue">
        <header className="resource-zone-panel-title">
          <div><strong>Очередь стройки</strong><small>Общая для всех зон</small></div>
          <span>{queue.length} / {BUILDING_QUEUE_CAPACITY}</span>
        </header>

        <div className="resource-zone-queue-slots" data-qa-queue-slots>
          {Array.from({ length: BUILDING_QUEUE_CAPACITY }, (_, index) => {
            const item = queue[index] ?? null;
            if (!item) {
              return (
                <div className="resource-zone-queue-card empty" key={`empty-${index}`} data-qa-queue-slot={index + 1}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>Свободное место</strong>
                    {index === queue.length ? <em>Выберите здание на карте или нажмите «+»</em> : null}
                  </div>
                </div>
              );
            }

            const queueDefinition = getBuildingDefinition(item.assetRole, factionId);
            const isActive = index === 0;
            const remaining = Math.max(0, item.finishAt - now);
            const duration = Math.max(1, item.finishAt - item.startedAt);
            const progress = isActive ? Math.min(100, Math.max(0, ((now - item.startedAt) / duration) * 100)) : 0;
            return (
              <div
                className={`resource-zone-queue-card ${isActive ? 'busy' : 'waiting'}`}
                key={`${item.assetRole}-${item.enqueuedAt}-${index}`}
                data-qa-queue-slot={index + 1}
                data-qa-queue-role={item.assetRole}
                data-qa-queue-zone={queueDefinition.zone}
              >
                <button
                  className="resource-zone-queue-card-main"
                  type="button"
                  aria-label={`Открыть ${queueDefinition.name}, уровень ${item.targetLevel}`}
                  onClick={() => onSelectedRoleChange(item.assetRole)}
                >
                  <img src={queueDefinition.art} alt="" />
                  <span className="resource-zone-queue-card-copy">
                    <small>{isActive ? 'Строится' : 'В очереди'}</small>
                    <strong>{queueDefinition.name}</strong>
                    <em>{ZONE_VIEW_META[queueDefinition.zone].title}</em>
                  </span>
                  <span className="resource-zone-queue-card-meta">
                    <b>ур. {Math.max(0, item.targetLevel - 1)} → {item.targetLevel}</b>
                    {isActive ? <time><span>Осталось</span> {formatDuration(remaining)}</time> : null}
                  </span>
                  {isActive ? <i><span style={{ width: `${progress}%` }} /></i> : null}
                </button>
                <button
                  className="resource-zone-queue-cancel"
                  type="button"
                  aria-label={`Отменить ${queueDefinition.name}, уровень ${item.targetLevel}`}
                  data-qa-queue-cancel={index + 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingAction({ kind: 'cancel', queueId: item.id, assetRole: item.assetRole, targetLevel: item.targetLevel });
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {queue.length >= BUILDING_QUEUE_CAPACITY ? (
          <div className="resource-zone-queue-full" data-qa-queue-full>Очередь заполнена</div>
        ) : null}
      </aside>

      {tileTip ? createPortal(
        <ZoneTileTooltip
          tip={tileTip}
          economy={economy}
          freeSlots={BUILDING_QUEUE_CAPACITY - queue.length}
          factionId={factionId}
        />,
        document.body,
      ) : null}

      {selected && selectedRole && availability ? createPortal(
        <div className="resource-building-dialog-backdrop" onMouseDown={() => onSelectedRoleChange(null)}>
          <section
            className="resource-building-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resource-building-dialog-title"
            data-qa-building-dialog={selectedRole}
            data-qa-building-zone={selected.zone}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="resource-building-dialog-close" data-asterion-close type="button" aria-label="Закрыть сведения о здании" onClick={() => onSelectedRoleChange(null)}>×</button>
            <header className="resource-building-dialog-head">
              <div className="resource-building-dialog-art"><img src={selected.art} alt={selected.name} draggable={false} /></div>
              <div className="resource-building-dialog-copy">
                <small>{ZONE_VIEW_META[selected.zone].title} · {PLAYER_FACTION_LABELS[factionId]}</small>
                <h2 id="resource-building-dialog-title">{selected.name}</h2>
                <p>{selected.purpose}</p>
              </div>
            </header>

            <div
              className={`resource-building-levels${availability.status === 'max-level' ? ' max-level' : ''}`}
              data-qa-level-track
              aria-label={`Уровень ${availability.currentLevel} из ${availability.maxLevel}. Следующий уровень: ${availability.nextLevel ?? 'максимальный уровень'}.`}
              style={{ '--building-level-count': availability.maxLevel } as CSSProperties}
            >
              <div className="resource-building-level resource-building-level--current">
                <small>Текущий уровень</small>
                <strong>{availability.currentLevel}</strong>
              </div>
              <div className="resource-building-level resource-building-level--next">
                <small>Следующий уровень</small>
                <strong>{availability.nextLevel ?? '—'}</strong>
              </div>
              <div className="resource-building-level resource-building-level--max">
                <small>Максимальный</small>
                <strong>{availability.maxLevel}</strong>
              </div>
              <div className="resource-building-level-queue" aria-hidden="true">
                <small>В очереди</small>
                <strong>{queue.filter((item) => item.assetRole === selectedRole).length}</strong>
              </div>
              <div
                className="resource-building-level-track"
                data-qa-level-segments={availability.maxLevel}
                aria-hidden="true"
              >
                {Array.from({ length: availability.maxLevel }, (_, index) => (
                  <span
                    className={index < levelProgress ? 'filled' : undefined}
                    key={`${selectedRole}-level-segment-${index + 1}`}
                  />
                ))}
              </div>
            </div>

            {availability.status === 'max-level' ? (
              <div className="resource-building-max-state" data-qa-max-level-state role="status">
                <strong>Здание улучшено до максимального уровня</strong>
                <span>Дальнейшие улучшения недоступны.</span>
              </div>
            ) : (
              <>
                {missingRequirements.length > 0 ? (
                  <div className="resource-building-requirements" data-qa-requirements>
                    <small>Сначала нужно</small>
                    {missingRequirements.map((requirement) => (
                      <div key={`${requirement.kind}-${requirement.label}`} className={requirement.met ? 'met' : 'missing'}>
                        <strong>{localizeBuildingNames(requirement.label, factionId)} — ур. {requirement.requiredLevel}</strong>
                        <span>сейчас {requirement.currentLevel}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <section className="resource-building-effect" data-qa-building-effect aria-label="Что даст улучшение">
                  <div className="resource-building-section-head">
                    <small>Что даст улучшение</small>
                  </div>
                  <div className="resource-building-effect-grid">
                    <div className="resource-building-effect-card current" data-qa-building-effect-current>
                      <small>Сейчас · ур. {availability.currentLevel}</small>
                      <strong>{currentEffect?.primary}</strong>
                    </div>
                    {availability.nextLevel != null ? (
                      <>
                        <i className="resource-building-effect-arrow" aria-hidden="true">→</i>
                        <div className="resource-building-effect-card next" data-qa-building-effect-next>
                          <small>После · ур. {availability.nextLevel}</small>
                          <strong>{nextEffect?.primary}</strong>
                        </div>
                      </>
                    ) : null}
                  </div>
                </section>

                <section className="resource-building-costs" aria-label="Стоимость">
                  <div className="resource-building-section-head">
                    <small>Стоимость уровня {availability.nextLevel ?? availability.maxLevel}</small>
                    <div className="resource-building-time-panel" data-qa-building-time-effective>
                      <small>Время</small>
                      <strong data-qa-building-time-value>{formatDurationLabel(availability.timeMs)}</strong>
                    </div>
                  </div>
                  <div className="resource-building-cost-grid">
                    {(Object.keys(resourceLabels) as Array<keyof typeof resourceLabels>).map((key) => (
                      <div key={key} className={availability.missing[key] ? 'missing' : ''} data-qa-building-cost={key}>
                        <span className={`resource-building-cost-icon resource-building-cost-icon--${key}`} data-qa-building-cost-icon>
                          <ResourceIcon kind={key} />
                        </span>
                        <span className="resource-building-cost-copy">
                          <small>{resourceLabels[key]}</small>
                          <strong>{availability.cost ? formatNumber(availability.cost[key]) : '—'}</strong>
                          {availability.missing[key] ? <em>не хватает {formatNumber(availability.missing[key] ?? 0)}</em> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <div className={`resource-building-availability ${availability.status}`} data-qa-build-status={availability.status} role="status">
                  <strong>{availability.canBuild ? 'Можно строить' : 'Пока нельзя'}</strong>
                  <span>{availability.status === 'requirements-unmet' && missingRequirements.length > 0
                    ? 'Сначала постройте то, что указано выше.'
                    : availability.reason ? localizeBuildingNames(availability.reason, factionId) : `Свободно слотов: ${BUILDING_QUEUE_CAPACITY - queue.length}.`}</span>
                </div>
              </>
            )}

            <div className="resource-building-actions">
              {availability.status !== 'max-level' ? (
                <button
                  className="resource-building-build-button"
                  type="button"
                  data-qa-build-button
                  disabled={!availability.canBuild}
                  onClick={submitBuild}
                >
                  {availability.currentLevel > 0 || availability.projectedLevel > 0 ? 'Улучшить' : 'Построить'}
                  {availability.nextLevel != null ? <small> до ур. {availability.nextLevel}</small> : null}
                </button>
              ) : null}
              {canEnterSelected ? (
                <button
                  className="resource-building-enter-button"
                  type="button"
                  data-qa-enter-building={selectedRole}
                  onClick={() => onEnterBuilding(selectedRole)}
                >
                  <EnterIcon />
                  <span>Войти</span>
                </button>
              ) : null}
            </div>

            {availability.currentLevel > 0 ? (
              <footer className="resource-building-dialog-foot">
                <button
                  className="resource-building-destroy-button"
                  type="button"
                  aria-label="Разрушить один уровень здания"
                  aria-describedby={selectedHasQueue ? 'resource-building-destroy-reason' : undefined}
                  data-qa-destroy-building
                  disabled={selectedHasQueue}
                  onClick={() => setPendingAction({ kind: 'destroy', assetRole: selectedRole, currentLevel: availability.currentLevel })}
                >
                  Разрушить 1 уровень
                </button>
                {selectedHasQueue ? <span id="resource-building-destroy-reason">Нельзя, пока здание в очереди строительства</span> : null}
              </footer>
            ) : null}
          </section>
        </div>,
        document.body,
      ) : null}

      {pendingAction ? createPortal(
        <div className="resource-building-action-confirm-backdrop" onMouseDown={() => setPendingAction(null)}>
          <section
            className={`resource-building-action-confirm resource-building-action-confirm--${pendingAction.kind}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="resource-building-action-confirm-title"
            data-qa-action-confirm
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="resource-building-action-confirm-title">
              {pendingAction.kind === 'cancel' ? 'Отменить строительство?' : 'Разрушить один уровень?'}
            </h3>
            <p>
              {pendingAction.kind === 'cancel'
                ? `Вы уверены, что хотите отменить строительство «${getBuildingDefinition(pendingAction.assetRole, factionId).name}», ур. ${pendingAction.targetLevel}? 90% затраченных ресурсов будут возвращены.`
                : `Вы уверены, что хотите разрушить 1 уровень здания «${getBuildingDefinition(pendingAction.assetRole, factionId).name}»? 50–80% из затраченных ресурсов будут возвращены, остальные ресурсы за этот уровень будут потеряны.`}
            </p>
            <div className="resource-building-action-confirm-actions">
              <button ref={confirmYesRef} type="button" data-qa-action-confirm-yes onClick={confirmPendingAction}>
                {pendingAction.kind === 'cancel' ? 'Да, отменить' : 'Да, разрушить'}
              </button>
              <button ref={confirmNoRef} type="button" data-qa-action-confirm-no onClick={() => setPendingAction(null)}>Нет</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function ZoneTileTooltip({ tip, economy, freeSlots, factionId }: {
  tip: TileTip;
  economy: BuildingEconomyState;
  freeSlots: number;
  factionId: PlayerFactionId;
}) {
  const building = getBuildingDefinition(tip.role, factionId);
  const level = economy.buildings[tip.role];
  // Centred on the tile, kept inside the viewport.
  const style = { left: tip.left, top: Math.min(Math.max(tip.top, 96), window.innerHeight - 96) } as CSSProperties;
  if (tip.kind === 'tile') {
    const status = stateFor(economy, tip.role);
    return (
      <div className="zone-tile-tip" role="tooltip" style={style} data-qa-tile-tooltip={tip.role}>
        <strong>{building.name}</strong>
        <small>Уровень {level}/{building.maxLevel} · {selectorStatusText(status.className, level)}</small>
      </div>
    );
  }
  const availability = evaluateBuildingBuild(economy, tip.role);
  const quick = describeQuickUpgrade(
    building.name,
    availability,
    freeSlots,
    availability.reason ? localizeBuildingNames(availability.reason, factionId) : null,
  );
  return (
    <div
      className={`zone-tile-tip zone-tile-tip--quick ${quick.enabled ? 'is-ready' : 'is-blocked'}`}
      role="tooltip"
      style={style}
      data-qa-quick-tooltip={tip.role}
    >
      <strong>{building.name}</strong>
      <small>{quick.heading}</small>
      {quick.costs.length > 0 ? (
        <ul className="zone-tile-tip__costs">
          {quick.costs.map((cost) => (
            <li key={cost.key} className={cost.missing ? 'is-missing' : undefined}>
              <ResourceIcon kind={cost.key} />
              <span>{formatQuickAmount(cost.amount)}</span>
              {cost.missing ? <em>не хватает {formatQuickAmount(cost.missing)}</em> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="zone-tile-tip__status">{quick.enabled ? `Можно строить · ${quick.status}` : quick.status}</p>
    </div>
  );
}
