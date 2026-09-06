import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getPlanetZoneTerrainUrl } from './assets/planetZoneTerrainAssets.ts';
import { RESOURCE_ZONE_SCENE_PLACEMENTS } from './resource-zone-scene.ts';
import {
  ASTER_RESOURCE_BUILDINGS,
  RESOURCE_BASE_INCOME_PER_HOUR,
  RESOURCE_BUILDING_QUEUE_CAPACITY,
  evaluateResourceBuildingBuild,
  getBuildingEffectText,
  getResourceBuildingDefinition,
  type BuildingDefinition,
  type BuildingQueueItem,
  type ResourceBuildingLevels,
  type ResourceBuildingRole,
  type ResourceEconomyState,
  type ResourceWallet,
  type ScienceLevels,
} from './domain/buildings/resource-zone.ts';

const resourceLabels = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
  energy: 'Энергия',
} as const;

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function stateFor(
  economy: ResourceEconomyState,
  role: ResourceBuildingRole,
): { className: string; label: string | null } {
  const definition = getResourceBuildingDefinition(role);
  const level = economy.buildings[role];
  const queueIndex = economy.queue.findIndex((item) => item.assetRole === role);
  if (queueIndex === 0) return { className: 'building', label: 'СТРОИТСЯ' };
  if (queueIndex > 0) return { className: 'queued', label: 'В ОЧЕРЕДИ' };
  if (level >= definition.maxLevel) return { className: 'maxed', label: 'МАКСИМУМ' };
  const availability = evaluateResourceBuildingBuild(economy, role);
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

function playerEffectText(definition: BuildingDefinition, currentLevel: number) {
  return definition.effect
    ? getBuildingEffectText(definition, currentLevel)
    : 'Эффект будет определён после утверждения баланса.';
}

export type ResourceZoneViewProps = {
  planetName: string;
  planetCoords: string;
  resources: ResourceWallet;
  buildings: ResourceBuildingLevels;
  queue: BuildingQueueItem[];
  scienceLevels: ScienceLevels;
  now: number;
  onBuild: (assetRole: ResourceBuildingRole) => boolean;
};

export function ResourceZoneView({
  planetName,
  planetCoords,
  resources,
  buildings,
  queue,
  scienceLevels,
  now,
  onBuild,
}: ResourceZoneViewProps) {
  const [selectedRole, setSelectedRole] = useState<ResourceBuildingRole | null>(null);
  const economy = useMemo<ResourceEconomyState>(
    () => ({ resources, buildings, queue, scienceLevels }),
    [resources, buildings, queue, scienceLevels],
  );
  const selected = selectedRole ? getResourceBuildingDefinition(selectedRole) : null;
  const availability = selectedRole ? evaluateResourceBuildingBuild(economy, selectedRole) : null;
  const activeCount = ASTER_RESOURCE_BUILDINGS.filter((building) => buildings[building.assetRole] > 0).length;
  const terrainUrl = getPlanetZoneTerrainUrl('resource');

  useEffect(() => {
    if (!selectedRole) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedRole(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedRole]);

  const submitBuild = () => {
    if (!selectedRole || !availability?.canBuild) return;
    if (onBuild(selectedRole)) setSelectedRole(null);
  };

  return (
    <div className="resource-zone-view" data-qa-resource-zone>
      <aside className="resource-zone-summary">
        <header className="resource-zone-panel-title">
          <div><small>РЕСУРСНАЯ ЗОНА</small><strong>{planetName}</strong></div>
          <span>{activeCount} / {ASTER_RESOURCE_BUILDINGS.length}</span>
        </header>

        <section className="resource-zone-building-selector" aria-label="Выбор здания">
          <div className="resource-zone-section-label">ЗДАНИЯ</div>
          <div className="resource-zone-selector-grid">
            {ASTER_RESOURCE_BUILDINGS.map((building) => {
              const status = stateFor(economy, building.assetRole);
              const selectedClass = selectedRole === building.assetRole ? 'selected' : '';
              const level = buildings[building.assetRole];
              const statusText = selectorStatusText(status.className, level);
              const tooltipId = `resource-selector-tooltip-${building.assetRole}`;
              return (
                <button
                  key={building.assetRole}
                  type="button"
                  data-resource-selector-role={building.assetRole}
                  className={`resource-zone-selector-tile ${status.className} ${selectedClass}`}
                  aria-label={`${building.name}. Уровень ${level} из ${building.maxLevel}. ${statusText}.`}
                  aria-describedby={tooltipId}
                  onClick={() => setSelectedRole(building.assetRole)}
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

        <section className="resource-zone-economy" aria-label="Добыча ресурсов за 1 час">
          <div className="resource-zone-economy-title">ДОБЫЧА РЕСУРСОВ ЗА 1 ЧАС</div>
          <div className="resource-zone-income-grid">
            <div><small>Металл</small><strong>+{formatNumber(RESOURCE_BASE_INCOME_PER_HOUR.metal)}</strong></div>
            <div><small>Минералы</small><strong>+{formatNumber(RESOURCE_BASE_INCOME_PER_HOUR.minerals)}</strong></div>
            <div><small>Газ</small><strong>+{formatNumber(RESOURCE_BASE_INCOME_PER_HOUR.gas)}</strong></div>
          </div>
        </section>
      </aside>

      <main className="resource-zone-scene">
        <img
          className="resource-zone-terrain"
          src={terrainUrl}
          alt=""
          draggable={false}
          data-qa-zone-terrain
          data-zone="resource"
          data-terrain-source="resource-terrain.png"
        />
        <div className="resource-zone-scene-shade" aria-hidden="true" />
        <div className="resource-zone-scene-copy">
          <small>АСТЕРЫ · {planetCoords}</small>
          <h1>РЕСУРСНАЯ ЗОНА</h1>
          <p>Добыча, энергия и инфраструктура планеты</p>
        </div>
        <div className="resource-zone-building-layer" aria-label="Территория ресурсной зоны">
          {ASTER_RESOURCE_BUILDINGS.map((building) => {
            const status = stateFor(economy, building.assetRole);
            const placement = RESOURCE_ZONE_SCENE_PLACEMENTS[building.assetRole];
            const selectedClass = selectedRole === building.assetRole ? 'selected' : '';
            const level = buildings[building.assetRole];
            return (
              <button
                key={building.assetRole}
                type="button"
                data-resource-building-role={building.assetRole}
                className={`resource-building-node ${status.className} ${selectedClass}`}
                style={{
                  left: placement.left,
                  top: placement.top,
                  '--building-width': `${placement.width}px`,
                  '--ground-shadow-width': `${placement.shadowWidth}px`,
                } as CSSProperties}
                aria-label={`${building.name}. Уровень ${level} из ${building.maxLevel}${status.label ? `. ${status.label}` : ''}`}
                onClick={() => setSelectedRole(building.assetRole)}
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
          <span>{queue.length} / {RESOURCE_BUILDING_QUEUE_CAPACITY}</span>
        </header>

        <div className="resource-zone-queue-slots" data-qa-queue-slots>
          {Array.from({ length: RESOURCE_BUILDING_QUEUE_CAPACITY }, (_, index) => {
            const item = queue[index] ?? null;
            if (!item) {
              return (
                <div className="resource-zone-queue-card empty" key={`empty-${index}`} data-qa-queue-slot={index + 1}>
                  <span>{index + 1}</span>
                  <div><small>СВОБОДНЫЙ СЛОТ</small><strong>Нет проекта</strong><em>Выбери объект на территории</em></div>
                </div>
              );
            }

            const definition = getResourceBuildingDefinition(item.assetRole);
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
                onClick={() => setSelectedRole(item.assetRole)}
              >
                <img src={definition.art} alt="" />
                <span>
                  <small>{isActive ? 'СТРОИТСЯ' : 'ОЖИДАЕТ'}</small>
                  <strong>{definition.name}</strong>
                  <em>{isActive ? `Осталось ${formatDuration(remaining)}` : `Уровень ${item.targetLevel}`}</em>
                </span>
                <b>ур. {Math.max(0, item.targetLevel - 1)} → {item.targetLevel}</b>
                {isActive ? <i><span style={{ width: `${progress}%` }} /></i> : null}
              </button>
            );
          })}
        </div>

        {queue.length >= RESOURCE_BUILDING_QUEUE_CAPACITY ? (
          <div className="resource-zone-queue-full" data-qa-queue-full>Очередь заполнена</div>
        ) : null}
      </aside>

      {selected && selectedRole && availability ? (
        <div className="resource-building-dialog-backdrop" onMouseDown={() => setSelectedRole(null)}>
          <section
            className="resource-building-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resource-building-dialog-title"
            data-qa-building-dialog={selectedRole}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="resource-building-dialog-close" type="button" aria-label="Закрыть сведения о здании" onClick={() => setSelectedRole(null)}>×</button>
            <div className="resource-building-dialog-art"><img src={selected.art} alt={selected.name} draggable={false} /></div>
            <div className="resource-building-dialog-copy">
              <small>РЕСУРСНАЯ ЗОНА · АСТЕРЫ</small>
              <h2 id="resource-building-dialog-title">{selected.name}</h2>
              <p>{selected.purpose}</p>

              <div className="resource-building-levels">
                <div><small>Текущий уровень</small><strong>{availability.currentLevel}</strong></div>
                <div><small>Максимальный</small><strong>{availability.maxLevel}</strong></div>
                <div><small>Следующий в очереди</small><strong>{availability.nextLevel ?? '—'}</strong></div>
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

              <div className="resource-building-effect">
                <small>ЭФФЕКТ</small>
                <strong>{playerEffectText(selected, availability.currentLevel)}</strong>
              </div>

              <div className="resource-building-costs">
                <div className="resource-building-cost-title"><span>СТОИМОСТЬ СЛЕДУЮЩЕГО УРОВНЯ</span><b>{formatDuration(availability.timeMs)}</b></div>
                <div className="resource-building-cost-grid">
                  {(Object.keys(resourceLabels) as Array<keyof typeof resourceLabels>).map((key) => (
                    <div key={key} className={availability.missing[key] ? 'missing' : ''}>
                      <small>{resourceLabels[key]}</small>
                      <strong>{formatNumber(availability.cost[key])}</strong>
                      {availability.missing[key] ? <em>не хватает {formatNumber(availability.missing[key] ?? 0)}</em> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className={`resource-building-availability ${availability.status}`} data-qa-build-status={availability.status}>
                <strong>{availability.canBuild ? 'МОЖНО ДОБАВИТЬ В ОЧЕРЕДЬ' : availability.status === 'max-level' ? 'МАКСИМАЛЬНЫЙ УРОВЕНЬ' : 'ДЕЙСТВИЕ НЕДОСТУПНО'}</strong>
                <span>{availability.reason ?? `Свободно слотов: ${RESOURCE_BUILDING_QUEUE_CAPACITY - queue.length}.`}</span>
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
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
