import { useEffect, useMemo, useState } from 'react';

import {
  COMMANDER_COMBAT_CATALOG,
  type CatalogEntity,
} from './domain/combat/catalog.ts';
import { getFactionDefenseCatalog } from './domain/combat/faction-catalog.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import {
  formatClockDurationMs,
  getBuildingPresentation,
} from './domain/buildings/balance-v1.ts';
import { calculateFleetProductionDurationMs } from './domain/fleet/production.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale } from './domain/runtime/mode.ts';
import { readFleetBuildBudget, type FleetBuildBudget } from './application/fleet.ts';
import { FLEET_PRODUCTION_START_REQUEST_EVENT } from './application/fleet-production.ts';
import { FleetProductionQueueView } from './FleetProductionQueueView';
import { FleetConstructionHeader } from './FleetConstructionHeader';
import { ResourceIcon } from './ui/resources/ResourceIcon';


export type ConstructionCatalogMode = 'defense' | 'commander';

type CatalogItem = {
  id: string;
  name: string;
  role: string;
  art: string;
  owned: number;
  pending: number;
  level: number;
  metal: number;
  minerals: number;
  gas: number;
  population: number;
  maxOwned?: number;
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
  commanderAbility?: {
    ability: string;
    description: string;
    ratePerLevel: string;
  };
};

type ShipyardBudget = FleetBuildBudget;

type ResourceKind = 'metal' | 'minerals' | 'gas' | 'population';

function toCatalogItem(entity: CatalogEntity): CatalogItem {
  if (!entity.tactical) throw new Error(`Tactical traits missing for ${entity.id}`);
  return {
    id: entity.id,
    name: entity.name,
    role: entity.role,
    art: entity.art,
    owned: 0,
    pending: 0,
    level: 0,
    metal: entity.cost.metal,
    minerals: entity.cost.minerals,
    gas: entity.cost.gas,
    population: entity.population,
    maxOwned: entity.maxOwned,
    time: entity.construction.time,
    requiredShipyardLevel: entity.construction.requiredShipyardLevel,
    requirements: entity.construction.requirements,
    stats: {
      category: entity.category,
      ...entity.combat,
      ...entity.tactical,
    },
    commanderAbility: entity.commanderAbility,
  };
}

const commanderItems: CatalogItem[] = COMMANDER_COMBAT_CATALOG.map(toCatalogItem);
const SINGLE_COPY_DEFENSE_IDS = new Set(['tower-shield', 'planetary-shield']);

const catalogConfig: Record<ConstructionCatalogMode, { title: string; kicker: string; description: string; footer: string; unitLabel: string }> = {
  defense: {
    title: 'ОБОРОНА',
    kicker: 'ПЛАНЕТАРНАЯ ОБОРОНА',
    description: 'оборонные установки и щитовые комплексы выбранной расы',
    footer: '9 оборонных комплексов · порядок соответствует технологической линейке.',
    unitLabel: 'установок',
  },
  commander: {
    title: 'КОМАНДИРСКИЕ КОРАБЛИ',
    kicker: 'КОМАНДНЫЙ ФЛОТ',
    description: '13 уникальных командирских корпусов',
    footer: '13 командирских кораблей · единая линейка для всех рас.',
    unitLabel: 'кораблей',
  },
};

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function calculateMax(item: CatalogItem, budget: ShipyardBudget, mode: ConstructionCatalogMode) {
  const limits: number[] = [];
  if (item.metal > 0) limits.push(Math.floor(budget.metal / item.metal));
  if (item.minerals > 0) limits.push(Math.floor(budget.minerals / item.minerals));
  if (item.gas > 0) limits.push(Math.floor(budget.gas / item.gas));
  const population = mode === 'defense' ? budget.defenseSummary : budget.summary;
  if (item.population > 0) limits.push(Math.floor(Math.max(0, population.capacity - population.population) / item.population));
  const resourceLimit = Math.min(...(limits.length ? limits : [0]));
  const ownershipLimit = item.maxOwned == null
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, item.maxOwned - item.owned - item.pending);
  const singleCopyLimit = mode === 'defense' && SINGLE_COPY_DEFENSE_IDS.has(item.id) ? Math.max(0, 1 - item.owned - item.pending) : ownershipLimit;
  return Math.max(0, Math.min(singleCopyLimit, resourceLimit));
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

      {item.commanderAbility ? (
        <div className="shipyard-tooltip-ability-v1">
          <small>СПОСОБНОСТЬ · {item.commanderAbility.ratePerLevel}</small>
          <strong>{item.commanderAbility.ability}</strong>
          <span>{item.commanderAbility.description}</span>
        </div>
      ) : null}
    </div>
  );
}

function CatalogCard({
  item,
  quantity,
  budget,
  shipyardLevel,
  advancedFactoryLevel,
  mode,
  onQuantity,
  onBuild,
}: {
  item: CatalogItem;
  quantity: number;
  budget: ShipyardBudget;
  shipyardLevel: number;
  advancedFactoryLevel: number;
  mode: ConstructionCatalogMode;
  onQuantity: (item: CatalogItem, quantity: number) => void;
  onBuild: (item: CatalogItem, quantity: number) => void;
}) {
  const unlocked = item.requiredShipyardLevel <= shipyardLevel;
  const max = unlocked ? calculateMax(item, budget, mode) : 0;
  const unavailableLabel = mode === 'defense' ? 'КОМПЛЕКС НЕДОСТУПЕН' : 'КОРПУС НЕДОСТУПЕН';
  const effectiveTimeMs = calculateFleetProductionDurationMs(mode === 'defense' ? 'defense' : 'commanders', item.id, {
    factionId: budget.factionId,
    shipyardLevel,
    advancedFactoryLevel,
    commanderLevel: item.level,
    mode: ACTIVE_RUNTIME_MODE,
    testTimeScale: resolveTestTimeScale(),
  });

  return (
    <article className={`shipyard-card-v1 ${unlocked ? '' : 'locked'}`} data-qa-fleet-production-item={item.id}>
      <header className="shipyard-card-title-v1">
        <div className={`shipyard-owned-v1 ${item.owned > 0 ? 'has-ships' : ''}`}>
          <small>{mode === 'defense' ? 'ПОСТРОЕНО' : 'В СТРОЮ'}</small>
          <strong>{formatNumber(item.owned)}</strong>
          {item.pending > 0 ? <span>В очереди {formatNumber(item.pending)}</span> : null}
          {mode === 'commander' ? <em className="fleet-commander-level-v1" data-qa-commander-level={item.id}>УР. {Math.min(40, Math.max(0, Math.floor(item.level)))}/40</em> : null}
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
          <div className="shipyard-time-v1" data-qa-unit-time={item.id}>
            <small>ВРЕМЯ ЗА ЕДИНИЦУ</small>
            <b data-qa-unit-time-effective>{formatClockDurationMs(effectiveTimeMs)}</b>
            <span data-qa-unit-time-raw>RAW {item.time}</span>
            {mode === 'commander' ? <span className="shipyard-unit-level-v1">УРОВЕНЬ КОМАНДИРА {Math.min(40, Math.max(0, Math.floor(item.level)))}/40</span> : null}
          </div>
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
  budget: providedBudget,
}: {
  mode: ConstructionCatalogMode;
  planetName: string;
  coords: string;
  budget?: FleetBuildBudget;
}) {
  const savedBudget = useMemo(readFleetBuildBudget, []);
  const budget = providedBudget ?? savedBudget;
  const config = catalogConfig[mode];
  const factionName = getCombatFactionName(budget.factionId);
  const defenseKicker = `${config.kicker} ${factionName.toUpperCase()}`;
  const defenseDescription = `оборонные установки и щитовые комплексы ${factionName}`;
  const defenseFooter = `9 оборонных комплексов ${factionName} · порядок соответствует технологической линейке.`;
  const shipyardPresentation = useMemo(
    () => getBuildingPresentation('shipyard', budget.factionId),
    [budget.factionId],
  );
  const items = useMemo(
    () => (mode === 'defense' ? getFactionDefenseCatalog(budget.factionId).map(toCatalogItem) : commanderItems).map((item) => ({
      ...item,
      owned: mode === 'commander'
        ? budget.fleet.commanders[item.id as keyof typeof budget.fleet.commanders] ?? 0
        : budget.defense.defenses[item.id as keyof typeof budget.defense.defenses] ?? 0,
      pending: (mode === 'defense' ? budget.fleetProduction.defenseQueue : budget.fleetProduction.commanderQueue)
        .filter((order) => order.itemId === item.id)
        .reduce((total, order) => total + Math.max(0, order.quantity - order.completedQuantity), 0),
      level: Math.max(0, Math.floor(budget.spaceportUpgrades.shipLevels[item.id] ?? 0)),
    })),
    [budget.defense, budget.factionId, budget.fleet, budget.fleetProduction, budget.spaceportUpgrades, mode],
  );
  const [quantities, setQuantities] = useState<Record<string, number>>({});

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
    window.scrollTo(0, 0);
  }, [mode]);

  const setQuantity = (item: CatalogItem, raw: number) => {
    const max = calculateMax(item, budget, mode);
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : 0;
    setQuantities((current) => ({ ...current, [item.id]: next }));
  };

  const prepareBuild = (item: CatalogItem, quantity: number) => {
    window.dispatchEvent(new CustomEvent(FLEET_PRODUCTION_START_REQUEST_EVENT, {
      detail: { queueKind: mode === 'defense' ? 'defense' : 'commanders', itemId: item.id, quantity, now: Date.now() },
    }));
    setQuantities((current) => ({ ...current, [item.id]: 0 }));
  };

  const populationSummary = mode === 'defense' ? budget.defenseSummary : budget.summary;

  return (
    <section className="shipyard-view-v1" data-qa-construction-mode={mode} data-qa-building-asset={shipyardPresentation.art} data-qa-defense-population={mode === 'defense' ? populationSummary.population : undefined} data-qa-defense-capacity={mode === 'defense' ? populationSummary.capacity : undefined}>
      <FleetConstructionHeader
        viewId={mode}
        shipyardPresentation={shipyardPresentation}
        kicker={`${mode === 'defense' ? defenseKicker : config.kicker} · ВЕРФЬ УРОВНЯ ${budget.shipyardLevel}`}
        title={config.title}
        description={mode === 'defense' ? defenseDescription : config.description}
        planetName={planetName}
        coords={coords}
      />

      <FleetProductionQueueView queueKind={mode === 'defense' ? 'defense' : 'commanders'} state={budget.fleetProduction} factionId={budget.factionId} />

      <div className="shipyard-grid-v1">
        {items.map((item) => (
          <CatalogCard
            key={item.id}
            item={item}
            quantity={quantities[item.id] ?? 0}
            budget={budget}
            shipyardLevel={budget.shipyardLevel}
            advancedFactoryLevel={budget.advancedFactoryLevel}
            mode={mode}
            onQuantity={setQuantity}
            onBuild={prepareBuild}
          />
        ))}
      </div>

      <footer className="shipyard-page-foot-v1">
        <span>{mode === 'defense' ? defenseFooter : config.footer}</span>
        <span>{mode === 'defense' ? 'Популяция обороны' : 'Популяция флота'}: {formatNumber(populationSummary.population)} / {formatNumber(populationSummary.capacity)} · свободно {formatNumber(populationSummary.available)}</span>
      </footer>
    </section>
  );
}
