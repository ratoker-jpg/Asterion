import { useEffect, useMemo, useState } from 'react';

import {
  COMMANDER_COMBAT_CATALOG,
  DEFENSE_COMBAT_CATALOG,
  type CatalogEntity,
} from './domain/combat/catalog.ts';

const SAVE_KEY = 'asterion.vertical-slice.v1';
const SHIPYARD_LEVEL = 1;

export type ConstructionCatalogMode = 'defense' | 'commander';

type CatalogItem = {
  id: string;
  name: string;
  role: string;
  art: string;
  owned: number;
  metal: number;
  minerals: number;
  gas: number;
  population: number;
  time: string;
  requiredShipyardLevel: number;
  requirements: readonly string[];
  stats: {
    category: string;
    attack: number;
    life: number;
    weaponType: string;
    armorType: string;
    armorStrength: number;
    specialization: string;
    range: string;
    priority: string;
  };
};

type ShipyardBudget = {
  metal: number;
  minerals: number;
  gas: number;
  population: number;
  populationMax: number;
};

type StoredSave = {
  metal?: number;
  minerals?: number;
  gas?: number;
  planets?: Record<string, { population?: number; populationMax?: number }>;
};

type ResourceKind = 'metal' | 'minerals' | 'gas' | 'population';

function toCatalogItem(entity: CatalogEntity): CatalogItem {
  if (!entity.tactical) throw new Error(`Tactical traits missing for ${entity.id}`);
  return {
    id: entity.id,
    name: entity.name,
    role: entity.role,
    art: entity.art,
    owned: 0,
    metal: entity.cost.metal,
    minerals: entity.cost.minerals,
    gas: entity.cost.gas,
    population: entity.population,
    time: entity.construction.time,
    requiredShipyardLevel: entity.construction.requiredShipyardLevel,
    requirements: entity.construction.requirements,
    stats: {
      category: entity.category,
      ...entity.combat,
      ...entity.tactical,
    },
  };
}

const defenseItems: CatalogItem[] = DEFENSE_COMBAT_CATALOG.map(toCatalogItem);
const commanderItems: CatalogItem[] = COMMANDER_COMBAT_CATALOG.map(toCatalogItem);

const catalogConfig: Record<ConstructionCatalogMode, { title: string; kicker: string; description: string; footer: string; items: CatalogItem[]; unitLabel: string }> = {
  defense: {
    title: 'ОБОРОНА',
    kicker: 'ПЛАНЕТАРНАЯ ОБОРОНА АСТЕРОВ',
    description: 'оборонные установки и щитовые комплексы Астеров',
    footer: '9 оборонных комплексов Астеров · порядок соответствует технологической линейке.',
    items: defenseItems,
    unitLabel: 'установок',
  },
  commander: {
    title: 'КОМАНДИРСКИЕ КОРАБЛИ',
    kicker: 'КОМАНДНЫЙ ФЛОТ',
    description: '13 уникальных командирских корпусов',
    footer: '13 командирских кораблей · единая линейка для всех рас.',
    items: commanderItems,
    unitLabel: 'кораблей',
  },
};

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function readBudget(): ShipyardBudget {
  const fallback: ShipyardBudget = { metal: 15_880, minerals: 12_712, gas: 6_421, population: 20, populationMax: 70 };

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredSave;
    const homeworld = parsed.planets?.['helion-01'];
    return {
      metal: typeof parsed.metal === 'number' ? parsed.metal : fallback.metal,
      minerals: typeof parsed.minerals === 'number' ? parsed.minerals : fallback.minerals,
      gas: typeof parsed.gas === 'number' ? parsed.gas : fallback.gas,
      population: typeof homeworld?.population === 'number' ? homeworld.population : fallback.population,
      populationMax: typeof homeworld?.populationMax === 'number' ? homeworld.populationMax : fallback.populationMax,
    };
  } catch {
    return fallback;
  }
}

function calculateMax(item: CatalogItem, budget: ShipyardBudget) {
  const limits: number[] = [];
  if (item.metal > 0) limits.push(Math.floor(budget.metal / item.metal));
  if (item.minerals > 0) limits.push(Math.floor(budget.minerals / item.minerals));
  if (item.gas > 0) limits.push(Math.floor(budget.gas / item.gas));
  if (item.population > 0) limits.push(Math.floor(Math.max(0, budget.populationMax - budget.population) / item.population));
  return Math.max(0, Math.min(999, ...(limits.length ? limits : [0])));
}

function ResourceIcon({ kind }: { kind: ResourceKind }) {
  if (kind === 'metal') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 5.2h11.6l3 5.8-4.1 7.8H7.3L3.2 11l3-5.8Z"/><path d="m7.4 8.2 4.6-2 4.6 2-1.2 6.9H8.6L7.4 8.2Z"/></svg>;
  }
  if (kind === 'minerals') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 7.7 7.4-3.1 10.9H7.4L4.3 10.2 12 2.8Z"/><path d="m12 6.1 3.7 4.6-3.7 7.1-3.7-7.1L12 6.1Z"/></svg>;
  }
  if (kind === 'gas') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c3.8 4.5 6.3 7.9 6.3 11.6A6.3 6.3 0 1 1 5.7 14.4C5.7 10.7 8.2 7.3 12 2.8Z"/><circle cx="10" cy="14.2" r="1.3"/><circle cx="14.5" cy="11.6" r="1"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="16.3" cy="9.4" r="2.4"/><path d="M3.8 19c.4-4 2.1-6.1 5.2-6.1s4.8 2.1 5.2 6.1H3.8Z"/><path d="M13 18.7c.3-3 1.5-4.6 3.7-4.6 2.1 0 3.3 1.6 3.6 4.6H13Z"/></svg>;
}

function CostRow({ kind, label, value }: { kind: ResourceKind; label: string; value: number }) {
  return (
    <div className={`shipyard-cost-row-v1 ${kind}`}>
      <span className="shipyard-cost-icon-v1"><ResourceIcon kind={kind} /></span>
      <span className="shipyard-cost-copy-v1"><small>{label}</small><strong>{formatNumber(value)}</strong></span>
    </div>
  );
}

function CatalogStatsTooltip({ item }: { item: CatalogItem }) {
  const { stats } = item;
  return (
    <div className="shipyard-stats-tooltip-v1" role="tooltip">
      <header className="shipyard-tooltip-head-v1">
        <div><small>{stats.category}</small><strong>{item.name}</strong></div>
        <span>ТТХ</span>
      </header>

      <div className="shipyard-tooltip-primary-v1">
        <div><small>АТАКА</small><strong>{formatNumber(stats.attack)}</strong></div>
        <div><small>ЖИЗНЬ</small><strong>{formatNumber(stats.life)}</strong></div>
      </div>

      <div className="shipyard-tooltip-grid-v1">
        <div><small>Тип оружия</small><strong>{stats.weaponType}</strong></div>
        <div><small>Тип брони</small><strong>{stats.armorType}</strong></div>
        <div><small>Сила брони</small><strong>{stats.armorStrength}%</strong></div>
        <div><small>Специализация</small><strong>{stats.specialization}</strong></div>
        <div><small>Дистанция</small><strong>{stats.range}</strong></div>
        <div><small>Приоритет</small><strong>{stats.priority}</strong></div>
      </div>
    </div>
  );
}

function CatalogCard({
  item,
  quantity,
  budget,
  mode,
  onQuantity,
  onBuild,
}: {
  item: CatalogItem;
  quantity: number;
  budget: ShipyardBudget;
  mode: ConstructionCatalogMode;
  onQuantity: (item: CatalogItem, quantity: number) => void;
  onBuild: (item: CatalogItem, quantity: number) => void;
}) {
  const unlocked = item.requiredShipyardLevel <= SHIPYARD_LEVEL;
  const max = unlocked ? calculateMax(item, budget) : 0;
  const unavailableLabel = mode === 'defense' ? 'КОМПЛЕКС НЕДОСТУПЕН' : 'КОРПУС НЕДОСТУПЕН';

  return (
    <article className={`shipyard-card-v1 ${unlocked ? '' : 'locked'}`}>
      <header className="shipyard-card-title-v1">
        <div className={`shipyard-owned-v1 ${item.owned > 0 ? 'has-ships' : ''}`}>
          <small>{mode === 'defense' ? 'ПОСТРОЕНО' : 'В СТРОЮ'}</small>
          <strong>{formatNumber(item.owned)}</strong>
        </div>
        <div className="shipyard-title-copy-v1"><strong>{item.name}</strong><small>{item.role}</small></div>
        <button type="button" title={item.role} aria-label={`Информация: ${item.name}`}>i</button>
      </header>

      <div className="shipyard-card-body-v1">
        <div className="shipyard-art-v1">
          <div className="shipyard-art-hover-v1" aria-label={`Характеристики: ${item.name}`}>
            <img src={item.art} alt={item.name} draggable={false} />
            <CatalogStatsTooltip item={item} />
          </div>
          <div className="shipyard-time-v1"><small>ВРЕМЯ ЗА ЕДИНИЦУ</small><b>{item.time}</b></div>
        </div>

        <div className="shipyard-card-data-v1">
          <div className="shipyard-costs-v1">
            <div className="shipyard-costs-title-v1"><span>СТОИМОСТЬ ЕДИНИЦЫ</span><i /></div>
            <div className="shipyard-cost-grid-v1">
              <CostRow kind="metal" label="Металл" value={item.metal} />
              <CostRow kind="minerals" label="Минералы" value={item.minerals} />
              <CostRow kind="gas" label="Газ" value={item.gas} />
              <CostRow kind="population" label="Население" value={item.population} />
            </div>
          </div>

          {unlocked ? (
            <div className="shipyard-build-v1">
              <div className="shipyard-count-v1">
                <input
                  type="number"
                  min="0"
                  max={max}
                  value={quantity}
                  aria-label={`Количество: ${item.name}`}
                  onChange={(event) => onQuantity(item, Number(event.target.value))}
                />
                <button type="button" onClick={() => onQuantity(item, max)}>Макс. {max}</button>
                <button type="button" onClick={() => onQuantity(item, 0)}>Мин.</button>
              </div>
              <button className="shipyard-build-button-v1" type="button" disabled={quantity <= 0 || max <= 0} onClick={() => onBuild(item, quantity)}>
                В ПРОИЗВОДСТВО
              </button>
            </div>
          ) : (
            <div className="shipyard-requirements-v1">
              <div className="shipyard-requirements-head-v1">
                <span className="shipyard-lock-v1" aria-hidden="true">◆</span>
                <div><small>{unavailableLabel}</small><strong>Требования для постройки</strong></div>
              </div>
              <div className="shipyard-requirements-list-v1">
                {item.requirements.map((requirement) => <span key={requirement}>{requirement}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function ConstructionCatalogView({
  mode,
  planetName,
  coords,
  onBack,
}: {
  mode: ConstructionCatalogMode;
  planetName: string;
  coords: string;
  onBack: () => void;
}) {
  const budget = useMemo(readBudget, []);
  const config = catalogConfig[mode];
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [process, setProcess] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('asterion-long-page');
    window.scrollTo(0, 0);
    return () => {
      document.documentElement.classList.remove('asterion-long-page');
      window.scrollTo(0, 0);
    };
  }, []);

  useEffect(() => {
    setQuantities({});
    setProcess(null);
    window.scrollTo(0, 0);
  }, [mode]);

  const setQuantity = (item: CatalogItem, raw: number) => {
    const max = calculateMax(item, budget);
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : 0;
    setQuantities((current) => ({ ...current, [item.id]: next }));
  };

  const prepareBuild = (item: CatalogItem, quantity: number) => {
    setProcess(`${quantity} × ${item.name} подготовлено к постановке в очередь. Реальное списание ресурсов подключим вместе с системой производства.`);
  };

  return (
    <section className="shipyard-view-v1">
      <header className="shipyard-page-head-v1">
        <div>
          <small>{config.kicker} · ВЕРФЬ УРОВНЯ {SHIPYARD_LEVEL}</small>
          <h2>{config.title}</h2>
          <p>{planetName} {coords} · {config.description}</p>
        </div>
        <button type="button" onClick={onBack}>← К ФЛОТАМ</button>
      </header>

      <section className="shipyard-processes-v1">
        <strong>ТЕКУЩИЕ ПРОЦЕССЫ</strong>
        <span>{process ?? 'Очередь производства пуста.'}</span>
      </section>

      <div className="shipyard-grid-v1">
        {config.items.map((item) => (
          <CatalogCard
            key={item.id}
            item={item}
            quantity={quantities[item.id] ?? 0}
            budget={budget}
            mode={mode}
            onQuantity={setQuantity}
            onBuild={prepareBuild}
          />
        ))}
      </div>

      <footer className="shipyard-page-foot-v1">
        <span>{config.footer}</span>
        <span>Свободно населения: {Math.max(0, budget.populationMax - budget.population)} / {budget.populationMax}</span>
      </footer>
    </section>
  );
}
