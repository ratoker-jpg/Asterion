import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { getPlanetZoneTerrainUrl } from './assets/planetZoneTerrainAssets.ts';
import { canEnterBuildingInterior } from './building-interior-navigation.ts';
import { getZoneScenePlacement } from './zone-scene.ts';
import {
  BUILDING_QUEUE_CAPACITY,
  evaluateBuildingBuild,
  formatBalanceEffect,
  getBuildingDefinition,
  getBuildingEffect,
  getBuildingEffectWithScience,
  getScienceIncomeBonusPercent,
  getBuildingsForZone,
  getConstructionTimeFactor,
  type BuildingDefinition,
  type BuildingEconomyState,
  type BuildingLevels,
  type BuildingQueueItem,
  type BuildingRole,
  type BuildingZone,
  type ResourceWallet,
  type ScienceLevels,
} from './domain/buildings/resource-zone.ts';
import { getProductionBotBonusPercent, type BotAssignment, type ProductionResourceIncome } from './domain/buildings/production-bots.ts';

export const ZONE_VIEW_META: Readonly<Record<BuildingZone, {
  title: string;
  subtitle: string;
  queueLabel: string;
  terrainFile: string;
}>> = {
  resource: {
    title: 'РЕСУРСНАЯ ЗОНА',
    subtitle: 'Добыча, энергия и инфраструктура планеты',
    queueLabel: 'РЕСУРСНАЯ',
    terrainFile: 'resource-terrain.png',
  },
  industry: {
    title: 'ПРОМЫШЛЕННАЯ ЗОНА',
    subtitle: 'Производство и инфраструктура планеты',
    queueLabel: 'ПРОМЫШЛЕННАЯ',
    terrainFile: 'industry-terrain.png',
  },
  military: {
    title: 'ВОЕННАЯ ЗОНА',
    subtitle: 'Флот, исследования и управление планетой',
    queueLabel: 'ВОЕННАЯ',
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

function playerEffectForLevel(
  role: BuildingRole,
  level: number,
  productionBots: BotAssignment,
  scienceLevels: ScienceLevels,
) {
  const effect = getBuildingEffect(role, level);
  const scienceEffect = getBuildingEffectWithScience(role, level, scienceLevels);
  if (scienceEffect.kind !== 'resource-income' && scienceEffect.kind !== 'energy-income') {
    return { primary: formatBalanceEffect(effect), secondary: null };
  }

  const scienceBonusPercent = scienceEffect.kind === 'resource-income'
    ? getScienceIncomeBonusPercent(scienceLevels, 3)
    : getScienceIncomeBonusPercent(scienceLevels, 1);
  const productionBotBonusPercent = scienceEffect.kind === 'resource-income'
    ? getProductionBotBonusPercent(productionBots, scienceEffect.resource)
    : 0;
  const boostedEffect = {
    ...scienceEffect,
    amountPerHour: Math.round(scienceEffect.amountPerHour * (1 + productionBotBonusPercent / 100)),
  };
  const bonusParts = [
    scienceBonusPercent > 0 ? `${scienceEffect.kind === 'resource-income' ? 'Математика' : 'Физика'} +${scienceBonusPercent}%` : null,
    productionBotBonusPercent > 0 ? `production bots +${productionBotBonusPercent}%` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    primary: formatBalanceEffect(boostedEffect),
    secondary: bonusParts.length > 0
      ? `База ${formatBalanceEffect(effect)} · ${bonusParts.join(' · ')}`
      : null,
  };
}

function stateFor(
  economy: BuildingEconomyState,
  role: BuildingRole,
): { className: string; label: string | null } {
  const item = getBuildingDefinition(role);
  const level = economy.buildings[role];
  const queueIndex = economy.queue.findIndex((queueItem) => queueItem.assetRole === role);
  if (queueIndex === 0) return { className: 'building', label: 'СТРОИТСЯ' };
  if (queueIndex > 0) return { className: 'queued', label: 'В ОЧЕРЕДИ' };
  if (level >= item.maxLevel) return { className: 'maxed', label: 'МАКСИМУМ' };
  const availability = evaluateBuildingBuild(economy, role);
  if (availability.status === 'requirements-unmet') return { className: 'blocked', label: 'ТРЕБОВАНИЯ' };
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

function ResourceIncomeIcon({ kind }: { kind: 'metal' | 'mineral' | 'gas' | 'energy' }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.65,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'metal') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 7 12 3l8 4-8 4-8-4Z"/><path {...common} d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>;
  }
  if (kind === 'mineral') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 7 7-7 13L5 9l7-7Z"/><path {...common} d="M5 9h14M12 2v20"/></svg>;
  }
  if (kind === 'energy') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m13 2-8 12h6l-1 8 8-12h-6l1-8Z"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3c4 4.7 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2-6.3 6-11Z"/><circle {...common} cx="10" cy="13" r="1.8"/><circle {...common} cx="14.5" cy="15.5" r="1.2"/></svg>;
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
  now: number;
  selectedRole: BuildingRole | null;
  onSelectedRoleChange: (role: BuildingRole | null) => void;
  onBuild: (assetRole: BuildingRole) => boolean;
  onCancelBuilding: (queueId: string) => boolean;
  onDestroyBuilding: (assetRole: BuildingRole) => boolean;
  onEnterBuilding: (assetRole: BuildingRole) => void;
};

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
  now,
  selectedRole,
  onSelectedRoleChange,
  onBuild,
  onCancelBuilding,
  onDestroyBuilding,
  onEnterBuilding,
}: ZoneViewProps) {
  const economy = useMemo<BuildingEconomyState>(
    () => ({ resources, buildings, queue, scienceLevels }),
    [resources, buildings, queue, scienceLevels],
  );
  const zoneBuildings = getBuildingsForZone(zone);
  const meta = ZONE_VIEW_META[zone];
  const selected = selectedRole ? getBuildingDefinition(selectedRole) : null;
  const availability = selectedRole ? evaluateBuildingBuild(economy, selectedRole) : null;
  const selectedHasQueue = selectedRole ? queue.some((item) => item.assetRole === selectedRole) : false;
  const [pendingAction, setPendingAction] = useState<PendingBuildingAction | null>(null);
  const confirmYesRef = useRef<HTMLButtonElement>(null);
  const confirmNoRef = useRef<HTMLButtonElement>(null);
  const activeCount = zoneBuildings.filter((building) => buildings[building.assetRole] > 0).length;
  const terrainUrl = getPlanetZoneTerrainUrl(zone);
  const canEnterSelected = selectedRole
    ? canEnterBuildingInterior(selectedRole, buildings[selectedRole])
    : false;
  const constructionFactor = getConstructionTimeFactor(buildings.construction);
  const constructionBonusPercent = Math.round((1 - constructionFactor) * 100);
  const currentEffect = selectedRole && availability
    ? playerEffectForLevel(selectedRole, availability.currentLevel, productionBotAssignment, scienceLevels)
    : null;
  const nextEffect = selectedRole && availability?.nextLevel != null
    ? playerEffectForLevel(selectedRole, availability.nextLevel, productionBotAssignment, scienceLevels)
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
      <aside className="resource-zone-summary">
        <header className="resource-zone-panel-title">
          <div><small>{meta.title}</small><strong>{planetName}</strong></div>
          <span>{activeCount} / {zoneBuildings.length}</span>
        </header>

        <section className="resource-zone-building-selector" aria-label={`Выбор здания: ${meta.title.toLowerCase()}`}>
          <div className="resource-zone-section-label">ЗДАНИЯ</div>
          <div className="resource-zone-selector-grid">
            {zoneBuildings.map((building) => {
              const status = stateFor(economy, building.assetRole);
              const selectedClass = selectedRole === building.assetRole ? 'selected' : '';
              const level = buildings[building.assetRole];
              const statusText = selectorStatusText(status.className, level);
              const tooltipId = `zone-selector-tooltip-${building.assetRole}`;
              return (
                <button
                  key={building.assetRole}
                  type="button"
                  data-zone-selector-role={building.assetRole}
                  data-resource-selector-role={building.assetRole}
                  className={`resource-zone-selector-tile ${status.className} ${selectedClass}`}
                  aria-label={`${building.name}. Уровень ${level} из ${building.maxLevel}. ${statusText}.`}
                  aria-describedby={tooltipId}
                  onClick={() => onSelectedRoleChange(building.assetRole)}
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
              );
            })}
          </div>
        </section>

        {zone === 'resource' ? (
          <section className="resource-zone-economy" aria-label="Добыча за 1 час">
            <div className="resource-zone-economy-title">ДОБЫЧА ЗА 1 ЧАС</div>
            <div className="resource-zone-income-list">
              <div className="resource-zone-income-row" data-resource-income="metal">
                <span className="resource-zone-income-icon"><ResourceIncomeIcon kind="metal" /></span>
                <span className="resource-zone-income-name">Металл</span>
                <strong>{formatNumber(resourceIncomePerHour.metal)}</strong>
              </div>
              <div className="resource-zone-income-row" data-resource-income="minerals">
                <span className="resource-zone-income-icon"><ResourceIncomeIcon kind="mineral" /></span>
                <span className="resource-zone-income-name">Минералы</span>
                <strong>{formatNumber(resourceIncomePerHour.minerals)}</strong>
              </div>
              <div className="resource-zone-income-row" data-resource-income="gas">
                <span className="resource-zone-income-icon"><ResourceIncomeIcon kind="gas" /></span>
                <span className="resource-zone-income-name">Газ</span>
                <strong>{formatNumber(resourceIncomePerHour.gas)}</strong>
              </div>
            </div>
          </section>
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
          <small>АСТЕРЫ · {planetCoords}</small>
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
                <span className="resource-building-art"><img src={building.art} alt="" draggable={false} /></span>
                <span className="resource-building-caption">
                  <strong>{building.name}</strong>
                  <small>{status.label ? `${status.label} · ` : ''}ур. {level}/{building.maxLevel}</small>
                </span>
              </button>
            );
          })}
        </div>
      </main>

      <aside className="resource-zone-queue">
        <header className="resource-zone-panel-title">
          <div><small>ОБЩАЯ ОЧЕРЕДЬ</small><strong>Строительство</strong></div>
          <span>{queue.length} / {BUILDING_QUEUE_CAPACITY}</span>
        </header>

        <div className="resource-zone-queue-slots" data-qa-queue-slots>
          {Array.from({ length: BUILDING_QUEUE_CAPACITY }, (_, index) => {
            const item = queue[index] ?? null;
            if (!item) {
              return (
                <div className="resource-zone-queue-card empty" key={`empty-${index}`} data-qa-queue-slot={index + 1}>
                  <span>{index + 1}</span>
                  <div><small>СВОБОДНЫЙ СЛОТ</small><strong>Нет проекта</strong><em>Выбери объект на территории</em></div>
                </div>
              );
            }

            const queueDefinition = getBuildingDefinition(item.assetRole);
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
                  <span>
                    <small>{ZONE_VIEW_META[queueDefinition.zone].queueLabel} · {isActive ? 'СТРОИТСЯ' : 'ОЖИДАЕТ'}</small>
                    <strong>{queueDefinition.name}</strong>
                    <em>{isActive ? `Осталось ${formatDuration(remaining)}` : `Уровень ${item.targetLevel}`}</em>
                  </span>
                  <b>ур. {Math.max(0, item.targetLevel - 1)} → {item.targetLevel}</b>
                  {isActive ? <i><span style={{ width: `${progress}%` }} /></i> : null}
                </button>
                <button
                  className="resource-zone-queue-cancel"
                  type="button"
                  aria-label={`Отменить ${queueDefinition.name}, уровень ${item.targetLevel}`}
                  title="Отменить строительство"
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
            <button className="resource-building-dialog-close" type="button" aria-label="Закрыть сведения о здании" onClick={() => onSelectedRoleChange(null)}>×</button>
            {availability.currentLevel > 0 ? (
              <button
                className="resource-building-destroy-button"
                type="button"
                aria-label="Разрушить один уровень здания"
                title={selectedHasQueue ? 'Нельзя разрушить здание во время строительства.' : 'Разрушить один уровень'}
                data-qa-destroy-building
                disabled={selectedHasQueue}
                onClick={() => setPendingAction({ kind: 'destroy', assetRole: selectedRole, currentLevel: availability.currentLevel })}
              >
                РАЗРУШИТЬ 1 УРОВЕНЬ
              </button>
            ) : null}
            <div className="resource-building-dialog-art"><img src={selected.art} alt={selected.name} draggable={false} /></div>
            <div className="resource-building-dialog-copy">
              <small>{ZONE_VIEW_META[selected.zone].title} · АСТЕРЫ</small>
              <h2 id="resource-building-dialog-title">{selected.name}</h2>
              <p>{selected.purpose}</p>

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
                <div className="resource-building-level resource-building-level--max">
                  <small>Максимальный</small>
                  <strong>{availability.maxLevel}</strong>
                </div>
                <div className="resource-building-level-queue" aria-hidden="true">
                  <small>В очереди</small>
                  <strong>{queue.filter((item) => item.assetRole === selectedRole).length}</strong>
                </div>
                <div className="resource-building-level resource-building-level--next">
                  <small>Следующий уровень</small>
                  <strong>{availability.nextLevel ?? '—'}</strong>
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
                  <small>ФИНАЛЬНЫЙ СТАТУС</small>
                  <strong>ЗДАНИЕ УЛУЧШЕНО ДО МАКСИМАЛЬНОГО УРОВНЯ</strong>
                  <span>Дальнейшие улучшения недоступны.</span>
                </div>
              ) : (
                <>
                  {availability.requirements.length > 0 ? (
                    <div className="resource-building-requirements" data-qa-requirements>
                      <small>ТРЕБОВАНИЯ</small>
                      {availability.requirements.map((requirement) => (
                        <div key={`${requirement.kind}-${requirement.label}`} className={requirement.met ? 'met' : 'missing'}>
                          <strong>{requirement.label} — ур. {requirement.requiredLevel}</strong>
                          <span>сейчас {requirement.currentLevel}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="resource-building-effect" data-qa-building-effect>
                    <div className="resource-building-effect-heading">
                      <small>ЭФФЕКТ УЛУЧШЕНИЯ</small>
                      <span>СРАВНЕНИЕ УРОВНЕЙ</span>
                    </div>
                    <div className="resource-building-effect-grid">
                      <div className="resource-building-effect-card current" data-qa-building-effect-current>
                        <small>ТЕКУЩИЙ УРОВЕНЬ · {availability.currentLevel}</small>
                        <strong>{currentEffect?.primary}</strong>
                        {currentEffect?.secondary ? <span>{currentEffect.secondary}</span> : null}
                      </div>
                      {availability.nextLevel != null ? (
                        <div className="resource-building-effect-card next" data-qa-building-effect-next>
                          <small>СЛЕДУЮЩИЙ УРОВЕНЬ · {availability.nextLevel}</small>
                          <strong>{nextEffect?.primary}</strong>
                          {nextEffect?.secondary ? <span>{nextEffect.secondary}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="resource-building-costs">
                    <div className="resource-building-time-panel" data-qa-building-time-effective>
                      <div className="resource-building-time-summary">
                        <small>ВРЕМЯ СТРОИТЕЛЬСТВА</small>
                        <strong data-qa-building-time-value>{formatDurationLabel(availability.timeMs)}</strong>
                        <span>ФАКТИЧЕСКОЕ · С УЧЁТОМ БОНУСОВ</span>
                      </div>
                      <div className="resource-building-time-breakdown">
                        <div>
                          <small>БАЗОВОЕ ВРЕМЯ (RAW)</small>
                          <b data-qa-building-time-raw>{formatDurationLabel(availability.rawTimeMs)}</b>
                        </div>
                        <div>
                          <small>ФАБРИКА</small>
                          <b className={constructionBonusPercent > 0 ? 'bonus' : ''} data-qa-building-time-bonus>
                            {constructionBonusPercent > 0 ? `−${constructionBonusPercent}%` : 'НЕТ'}
                          </b>
                        </div>
                      </div>
                    </div>
                    <div className="resource-building-cost-title">
                      <span>СТОИМОСТЬ ПЕРЕХОДА В УР. {availability.nextLevel ?? availability.maxLevel}</span>
                    </div>
                    <div className="resource-building-cost-grid">
                      {(Object.keys(resourceLabels) as Array<keyof typeof resourceLabels>).map((key) => (
                        <div key={key} className={availability.missing[key] ? 'missing' : ''} data-qa-building-cost={key}>
                          <span className={`resource-building-cost-icon resource-building-cost-icon--${key}`} data-qa-building-cost-icon>
                            <ResourceIncomeIcon kind={key === 'minerals' ? 'mineral' : key} />
                          </span>
                          <span className="resource-building-cost-copy">
                            <small>{resourceLabels[key]}</small>
                            <strong>{availability.cost ? formatNumber(availability.cost[key]) : '—'}</strong>
                            {availability.missing[key] ? <em>не хватает {formatNumber(availability.missing[key] ?? 0)}</em> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`resource-building-availability ${availability.status}`} data-qa-build-status={availability.status}>
                    <strong>{availability.canBuild ? 'МОЖНО ДОБАВИТЬ В ОЧЕРЕДЬ' : 'ДЕЙСТВИЕ НЕДОСТУПНО'}</strong>
                    <span>{availability.reason ?? `Свободно слотов: ${BUILDING_QUEUE_CAPACITY - queue.length}.`}</span>
                  </div>

                  <button
                    className="resource-building-build-button"
                    type="button"
                    data-qa-build-button
                    disabled={!availability.canBuild}
                    onClick={submitBuild}
                  >
                    {availability.currentLevel > 0 || availability.projectedLevel > 0 ? 'УЛУЧШИТЬ' : 'ПОСТРОИТЬ'}
                  </button>
                </>
              )}

              {canEnterSelected ? (
                <button
                  className="resource-building-enter-button"
                  type="button"
                  data-qa-enter-building={selectedRole}
                  onClick={() => onEnterBuilding(selectedRole)}
                >
                  <EnterIcon />
                  <span>ВОЙТИ</span>
                </button>
              ) : null}
            </div>
          </section>
        </div>,
        document.body,
      ) : null}

      {pendingAction ? createPortal(
        <div className="resource-building-action-confirm-backdrop" onMouseDown={() => setPendingAction(null)}>
          <section
            className="resource-building-action-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="resource-building-action-confirm-title"
            data-qa-action-confirm
            onMouseDown={(event) => event.stopPropagation()}
          >
            <small>ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ</small>
            <h3 id="resource-building-action-confirm-title">
              {pendingAction.kind === 'cancel' ? 'Отменить строительство?' : 'Разрушить один уровень?'}
            </h3>
            <p>
              {pendingAction.kind === 'cancel'
                ? `Вы уверены, что хотите отменить строительство «${getBuildingDefinition(pendingAction.assetRole).name}», ур. ${pendingAction.targetLevel}? 90% затраченных ресурсов будут возвращены.`
                : `Вы уверены, что хотите разрушить 1 уровень здания «${getBuildingDefinition(pendingAction.assetRole).name}»? 50–80% из затраченных ресурсов будут возвращены, остальные ресурсы за этот уровень будут потеряны.`}
            </p>
            <div className="resource-building-action-confirm-actions">
              <button ref={confirmYesRef} type="button" data-qa-action-confirm-yes onClick={confirmPendingAction}>ДА</button>
              <button ref={confirmNoRef} type="button" data-qa-action-confirm-no onClick={() => setPendingAction(null)}>НЕТ</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
