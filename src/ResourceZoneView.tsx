import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ASTER_RESOURCE_BUILDINGS,
  RESOURCE_BASE_INCOME_PER_HOUR,
  RESOURCE_PROTOTYPE_DATA_NOTE,
  evaluateResourceBuildingBuild,
  getBuildingEffectText,
  getResourceBuildingDefinition,
  type BuildingQueueItem,
  type ResourceBuildingLevels,
  type ResourceBuildingRole,
  type ResourceEconomyState,
  type ResourceWallet,
} from './domain/buildings/resource-zone.ts';

const scenePositions: Record<ResourceBuildingRole, { left: string; top: string }> = {
  'metal-production-1': { left: '7%', top: '17%' },
  'metal-production-2': { left: '26%', top: '8%' },
  'metal-production-3': { left: '47%', top: '14%' },
  'mineral-production-1': { left: '69%', top: '8%' },
  'mineral-production-2': { left: '82%', top: '27%' },
  'gas-production-1': { left: '10%', top: '58%' },
  'gas-production-2': { left: '30%', top: '68%' },
  'basic-energy': { left: '49%', top: '55%' },
  'advanced-energy': { left: '69%', top: '65%' },
  hangar: { left: '83%', top: '55%' },
};

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
): { className: string; label: string } {
  const definition = getResourceBuildingDefinition(role);
  const level = economy.buildings[role];
  if (economy.queue?.assetRole === role) return { className: 'building', label: 'СТРОИТСЯ' };
  if (level >= definition.maxLevel) return { className: 'maxed', label: 'МАКСИМУМ' };
  const availability = evaluateResourceBuildingBuild(economy, role);
  if (level > 0) return { className: 'active', label: 'АКТИВНО' };
  if (availability.canBuild) return { className: 'unbuilt', label: 'НЕ ПОСТРОЕНО' };
  return { className: 'blocked', label: 'НЕДОСТУПНО' };
}

export type ResourceZoneViewProps = {
  planetName: string;
  planetCoords: string;
  resources: ResourceWallet;
  buildings: ResourceBuildingLevels;
  queue: BuildingQueueItem | null;
  now: number;
  onBuild: (assetRole: ResourceBuildingRole) => boolean;
};

export function ResourceZoneView({
  planetName,
  planetCoords,
  resources,
  buildings,
  queue,
  now,
  onBuild,
}: ResourceZoneViewProps) {
  const [selectedRole, setSelectedRole] = useState<ResourceBuildingRole | null>(null);
  const economy = useMemo<ResourceEconomyState>(() => ({ resources, buildings, queue }), [resources, buildings, queue]);
  const selected = selectedRole ? getResourceBuildingDefinition(selectedRole) : null;
  const availability = selectedRole ? evaluateResourceBuildingBuild(economy, selectedRole) : null;
  const queueDefinition = queue ? getResourceBuildingDefinition(queue.assetRole) : null;
  const remaining = queue ? Math.max(0, queue.finishAt - now) : 0;
  const queueDuration = queue ? Math.max(1, queue.finishAt - queue.startedAt) : 1;
  const queueProgress = queue ? Math.min(100, Math.max(0, ((now - queue.startedAt) / queueDuration) * 100)) : 0;
  const activeCount = ASTER_RESOURCE_BUILDINGS.filter((building) => buildings[building.assetRole] > 0).length;

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

        <section className="resource-zone-economy" aria-label="Экономика ресурсной зоны">
          <div className="resource-zone-section-label">СВОДКА</div>
          <div className="resource-zone-income-grid">
            <div><small>Металл / ч</small><strong>+{formatNumber(RESOURCE_BASE_INCOME_PER_HOUR.metal)}</strong></div>
            <div><small>Минералы / ч</small><strong>+{formatNumber(RESOURCE_BASE_INCOME_PER_HOUR.minerals)}</strong></div>
            <div><small>Газ / ч</small><strong>+{formatNumber(RESOURCE_BASE_INCOME_PER_HOUR.gas)}</strong></div>
            <div><small>Энергия</small><strong>{formatNumber(resources.energy)}</strong></div>
          </div>
        </section>

        <section className="resource-zone-building-list" aria-label="Состояние зданий">
          <div className="resource-zone-section-label">ЗДАНИЯ</div>
          {ASTER_RESOURCE_BUILDINGS.map((building) => {
            const status = stateFor(economy, building.assetRole);
            return (
              <button
                key={building.assetRole}
                type="button"
                className={`resource-zone-list-row ${status.className}`}
                onClick={() => setSelectedRole(building.assetRole)}
              >
                <span><strong>{building.name}</strong><small>{status.label}</small></span>
                <b>ур. {buildings[building.assetRole]} / {building.maxLevel}</b>
                <i>Подробнее</i>
              </button>
            );
          })}
        </section>
      </aside>

      <main className="resource-zone-scene">
        <div className="resource-zone-scene-copy">
          <small>АСТЕРЫ · {planetCoords}</small>
          <h1>РЕСУРСНАЯ ЗОНА</h1>
          <p>Выбери здание на территории, чтобы открыть сведения и действие строительства.</p>
        </div>
        <div className="resource-zone-grid-lines" aria-hidden="true" />
        <div className="resource-zone-horizon" aria-hidden="true" />

        {ASTER_RESOURCE_BUILDINGS.map((building) => {
          const status = stateFor(economy, building.assetRole);
          const position = scenePositions[building.assetRole];
          return (
            <button
              key={building.assetRole}
              type="button"
              data-resource-building-role={building.assetRole}
              className={`resource-building-node ${status.className}`}
              style={{ left: position.left, top: position.top } as CSSProperties}
              aria-label={`${building.name}. Уровень ${buildings[building.assetRole]} из ${building.maxLevel}. ${status.label}`}
              onClick={() => setSelectedRole(building.assetRole)}
            >
              <span className="resource-building-art"><img src={building.art} alt="" draggable={false} /></span>
              <span className="resource-building-caption"><strong>{building.name}</strong><small>{status.label} · ур. {buildings[building.assetRole]}</small></span>
            </button>
          );
        })}
      </main>

      <aside className="resource-zone-queue">
        <header className="resource-zone-panel-title">
          <div><small>ОБЩАЯ ОЧЕРЕДЬ</small><strong>Строительство</strong></div>
          <span>{queue ? '1 / 1' : '0 / 1'}</span>
        </header>

        {queue && queueDefinition ? (
          <button className="resource-zone-queue-card busy" type="button" onClick={() => setSelectedRole(queue.assetRole)}>
            <img src={queueDefinition.art} alt="" />
            <span><small>СТРОИТСЯ</small><strong>{queueDefinition.name}</strong><em>Осталось {formatDuration(remaining)}</em></span>
            <b>ур. {buildings[queue.assetRole]} → {Math.min(queueDefinition.maxLevel, buildings[queue.assetRole] + 1)}</b>
            <i><span style={{ width: `${queueProgress}%` }} /></i>
          </button>
        ) : (
          <div className="resource-zone-queue-card empty"><span>+</span><div><small>СВОБОДНО</small><strong>Очередь готова</strong><em>Выбери здание на карте</em></div></div>
        )}

        <div className="resource-zone-queue-note">
          <strong>Правило вертикального среза</strong>
          <p>Одновременно выполняется один строительный процесс. Прогресс хранится по абсолютному времени и переживает перезагрузку.</p>
        </div>

        <div className="resource-zone-prototype-note">
          <small>ДАННЫЕ ПРОТОТИПА</small>
          <p>{RESOURCE_PROTOTYPE_DATA_NOTE}</p>
        </div>
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
                <div><small>Следующий</small><strong>{availability.nextLevel ?? '—'}</strong></div>
              </div>

              <div className="resource-building-effect">
                <small>ИЗМЕНЕНИЕ ЭФФЕКТА</small>
                <strong>{getBuildingEffectText(selected, availability.currentLevel)}</strong>
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
                <strong>{availability.canBuild ? 'ДОСТУПНО К СТРОИТЕЛЬСТВУ' : 'ДЕЙСТВИЕ НЕДОСТУПНО'}</strong>
                <span>{availability.reason ?? 'Ресурсов достаточно, общая очередь свободна.'}</span>
              </div>

              <button
                className="resource-building-build-button"
                type="button"
                data-qa-build-button
                disabled={!availability.canBuild}
                onClick={submitBuild}
              >
                {availability.currentLevel > 0 ? 'УЛУЧШИТЬ' : 'ПОСТРОИТЬ'}
              </button>
              <small className="resource-building-balance-note">{RESOURCE_PROTOTYPE_DATA_NOTE}</small>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
