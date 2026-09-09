import { useEffect, useMemo, type CSSProperties } from 'react';
import { getPlanetZoneTerrainUrl } from './assets/planetZoneTerrainAssets.ts';
import { canEnterBuildingInterior } from './building-interior-navigation.ts';
import { getZoneScenePlacement } from './zone-scene.ts';
import {
  BUILDING_QUEUE_CAPACITY,
  evaluateBuildingBuild,
  formatBalanceEffect,
  getBuildingDefinition,
  getBuildingEffect,
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

function playerEffectForLevel(role: BuildingRole, level: number, productionBots: BotAssignment) {
  const effect = getBuildingEffect(role, level);
  if (effect.kind !== 'resource-income') {
    return { primary: formatBalanceEffect(effect), secondary: null };
  }

  const bonusPercent = getProductionBotBonusPercent(productionBots, effect.resource);
  const boostedEffect = { ...effect, amountPerHour: effect.amountPerHour * (1 + bonusPercent / 100) };
  return {
    primary: formatBalanceEffect(boostedEffect),
    secondary: bonusPercent > 0
      ? `База ${formatBalanceEffect(effect)} · production bots +${bonusPercent}%`
      : 'Бонус production bots не применён',
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
  onEnterBuilding: (assetRole: BuildingRole) => void;
};

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
  const activeCount = zoneBuildings.filter((building) => buildings[building.assetRole] > 0).length;
  const terrainUrl = getPlanetZoneTerrainUrl(zone);
  const canEnterSelected = selectedRole
    ? canEnterBuildingInterior(selectedRole, buildings[selectedRole])
    : false;
  const constructionFactor = getConstructionTimeFactor(buildings.construction);
  const constructionBonusPercent = Math.round((1 - constructionFactor) * 100);
  const currentEffect = selectedRole && availability
    ? playerEffectForLevel(selectedRole, availability.currentLevel, productionBotAssignment)
    : null;
  const nextEffect = selectedRole && availability?.nextLevel != null
    ? playerEffectForLevel(selectedRole, availability.nextLevel, productionBotAssignment)
    : null;

  useEffect(() => {
    if (!selectedRole) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSelectedRoleChange(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSelectedRoleChange, selectedRole]);

  const submitBuild = () => {
    if (!selectedRole || !availability?.canBuild) return;
    if (onBuild(selectedRole)) onSelectedRoleChange(null);
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
              <button
                className={`resource-zone-queue-card ${isActive ? 'busy' : 'waiting'}`}
                type="button"
                key={`${item.assetRole}-${item.enqueuedAt}-${index}`}
                data-qa-queue-slot={index + 1}
                data-qa-queue-role={item.assetRole}
                data-qa-queue-zone={queueDefinition.zone}
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
            );
          })}
        </div>

        {queue.length >= BUILDING_QUEUE_CAPACITY ? (
          <div className="resource-zone-queue-full" data-qa-queue-full>Очередь заполнена</div>
        ) : null}
      </aside>

      {selected && selectedRole && availability ? (
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
            <div className="resource-building-dialog-art"><img src={selected.art} alt={selected.name} draggable={false} /></div>
            <div className="resource-building-dialog-copy">
              <small>{ZONE_VIEW_META[selected.zone].title} · АСТЕРЫ</small>
              <h2 id="resource-building-dialog-title">{selected.name}</h2>
              <p>{selected.purpose}</p>

              <div className="resource-building-levels">
                <div><small>Текущий уровень</small><strong>{availability.currentLevel}</strong></div>
                <div><small>Максимальный</small><strong>{availability.maxLevel}</strong></div>
                <div><small>В очереди</small><strong>{queue.filter((item) => item.assetRole === selectedRole).length}</strong></div>
                <div><small>Следующий уровень</small><strong>{availability.nextLevel ?? '—'}</strong></div>
              </div>

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
                <div className="resource-building-cost-title">
                  <span>СТОИМОСТЬ ПЕРЕХОДА В УР. {availability.nextLevel ?? availability.maxLevel}</span>
                  <b>{availability.rawTimeMs == null ? '—' : `RAW ${formatDuration(availability.rawTimeMs)}`} · ФАКТ {availability.timeMs == null ? '—' : formatDuration(availability.timeMs)}</b>
                </div>
                <div className="resource-building-cost-time" data-qa-building-time-effective>
                  {constructionBonusPercent > 0 ? `ФАБРИКА УР. ${buildings.construction} · −${constructionBonusPercent}% ОТ RAW` : 'БЕЗ БОНУСА ФАБРИКИ'}
                </div>
                <div className="resource-building-cost-grid">
                  {(Object.keys(resourceLabels) as Array<keyof typeof resourceLabels>).map((key) => (
                    <div key={key} className={availability.missing[key] ? 'missing' : ''} data-qa-building-cost={key}>
                      <span className={`resource-building-cost-icon resource-building-cost-icon--${key}`} data-qa-building-cost-icon>
                        <ResourceIncomeIcon kind={key === 'minerals' ? 'mineral' : key} />
                      </span>
                      <span className="resource-building-cost-copy">
                        <small>{key === 'energy' ? 'Энергия строительства' : resourceLabels[key]}</small>
                        <strong>{availability.cost ? formatNumber(availability.cost[key]) : '—'}</strong>
                        {availability.missing[key] ? <em>не хватает {formatNumber(availability.missing[key] ?? 0)}</em> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`resource-building-availability ${availability.status}`} data-qa-build-status={availability.status}>
                <strong>{availability.canBuild ? 'МОЖНО ДОБАВИТЬ В ОЧЕРЕДЬ' : availability.status === 'max-level' ? 'МАКСИМАЛЬНЫЙ УРОВЕНЬ' : 'ДЕЙСТВИЕ НЕДОСТУПНО'}</strong>
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
        </div>
      ) : null}
    </div>
  );
}
