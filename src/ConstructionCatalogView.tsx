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
  localizeBuildingNames,
} from './domain/buildings/balance-v1.ts';
import { calculateFleetProductionDurationMs } from './domain/fleet/production.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale } from './domain/runtime/mode.ts';
import { readFleetBuildBudget, type FleetBuildBudget } from './application/fleet.ts';
import { FLEET_PRODUCTION_START_REQUEST_EVENT } from './application/fleet-production.ts';
import { FleetConstructionHeader } from './FleetConstructionHeader';
import { FleetUnitRow } from './ui/fleet/FleetUnitRow';
import { evaluateProductionRequirements } from './domain/fleet/requirements.ts';


export type ConstructionCatalogMode = 'defense' | 'commander';

type CatalogItem = {
  catalog: CatalogEntity;
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

function toCatalogItem(entity: CatalogEntity): CatalogItem {
  if (!entity.tactical) throw new Error(`Tactical traits missing for ${entity.id}`);
  return {
    catalog: entity,
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
        {item.catalog.ship?.speed != null ? (
          <div><small>Скорость</small><strong>{formatNumber(item.catalog.ship.speed)}</strong></div>
        ) : null}
        {item.commanderAbility ? (
          <div className="shipyard-tooltip-level-v1" data-qa-commander-dossier-level={item.id}>
            <small>Уровень командира</small>
            <strong>{item.level}/40</strong>
          </div>
        ) : null}
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
  planetId,
  shipyardLevel,
  advancedFactoryLevel,
  mode,
  onQuantity,
  onBuild,
}: {
  item: CatalogItem;
  quantity: number;
  budget: ShipyardBudget;
  planetId?: string;
  shipyardLevel: number;
  advancedFactoryLevel: number;
  mode: ConstructionCatalogMode;
  onQuantity: (item: CatalogItem, quantity: number) => void;
  onBuild: (item: CatalogItem, quantity: number) => void;
}) {
  const evaluated = evaluateProductionRequirements(item.catalog, {
    planetId,
    scienceLevels: budget.scienceLevels,
    shipyardLevel,
    hangarLevel: budget.hangarLevel,
    advancedFactoryLevel,
    fleet: budget.fleet,
    defense: budget.defense,
    queues: budget.fleetProduction,
    wallet: { metal: budget.metal, minerals: budget.minerals, gas: budget.gas },
    factionId: budget.factionId,
    mode: ACTIVE_RUNTIME_MODE,
  });
  const available = evaluated.met;
  const max = available ? calculateMax(item, budget, mode) : 0;
  const effectiveTimeMs = calculateFleetProductionDurationMs(mode === 'defense' ? 'defense' : 'commanders', item.id, {
    factionId: budget.factionId,
    shipyardLevel,
    advancedFactoryLevel,
    commanderLevel: item.level,
    mode: ACTIVE_RUNTIME_MODE,
    testTimeScale: resolveTestTimeScale(),
  });

  const populationPool = mode === 'defense' ? budget.defenseSummary : budget.summary;

  return (
    <FleetUnitRow
      id={item.id}
      name={item.name}
      role={item.role}
      art={item.art}
      owned={item.owned}
      pending={item.pending}
      levelNode={mode === 'commander' ? (
        <span className="fc-unit__level">
          Уровень <b data-qa-commander-level={item.id}>{Math.min(40, Math.max(0, Math.floor(item.level)))}/40</b>
        </span>
      ) : undefined}
      cost={{ metal: item.metal, minerals: item.minerals, gas: item.gas, population: item.population }}
      wallet={{ metal: budget.metal, minerals: budget.minerals, gas: budget.gas, populationFree: Math.max(0, populationPool.capacity - populationPool.population) }}
      effectiveTime={formatClockDurationMs(effectiveTimeMs)}
      rawTime={item.time}
      quantity={quantity}
      max={max}
      locked={!available}
      lockReason={evaluated.reason ? localizeBuildingNames(evaluated.reason, budget.factionId) : null}
      requirements={item.requirements.map((requirement) => localizeBuildingNames(requirement, budget.factionId))}
      dossier={<CatalogStatsTooltip item={item} />}
      factionName={getCombatFactionName(budget.factionId)}
      onQuantity={(next) => onQuantity(item, next)}
      onBuild={(next) => onBuild(item, next)}
    />
  );
}

export function ConstructionCatalogView({
  mode,
  planetName,
  coords,
  planetId,
  budget: providedBudget,
}: {
  mode: ConstructionCatalogMode;
  planetName: string;
  coords: string;
  planetId?: string;
  budget?: FleetBuildBudget;
}) {
  const savedBudget = useMemo(readFleetBuildBudget, []);
  const budget = providedBudget ?? savedBudget;
  const factionName = getCombatFactionName(budget.factionId);
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

  // Document scrolling (long page) is owned by GlobalPageScrollController.
  useEffect(() => {
    window.scrollTo(0, 0);
    return () => window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    setQuantities({});
    window.scrollTo(0, 0);
  }, [mode, planetId]);

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
    <section className="fc-catalog" data-qa-construction-mode={mode} data-qa-building-asset={shipyardPresentation.art} data-qa-defense-population={mode === 'defense' ? populationSummary.population : undefined} data-qa-defense-capacity={mode === 'defense' ? populationSummary.capacity : undefined}>
      <FleetConstructionHeader
        viewId={mode}
        shipyardPresentation={shipyardPresentation}
        title={mode === 'defense' ? 'Оборона' : 'Командирские корабли'}
        detail={`${planetName} ${coords} · ${shipyardPresentation.name}, уровень ${budget.shipyardLevel}${mode === 'defense' ? ` · ${factionName}` : ''}`}
        noShipyard={budget.shipyardLevel <= 0}
        populationLabel={mode === 'defense' ? 'Население обороны' : 'Население флота'}
        population={populationSummary.population}
        capacity={populationSummary.capacity}
        free={populationSummary.available}
      />

      <div className="fc-unit-list">
        {items.map((item) => (
          <CatalogCard
            key={item.id}
            item={item}
            quantity={quantities[item.id] ?? 0}
            budget={budget}
            planetId={planetId}
            shipyardLevel={budget.shipyardLevel}
            advancedFactoryLevel={budget.advancedFactoryLevel}
            mode={mode}
            onQuantity={setQuantity}
            onBuild={prepareBuild}
          />
        ))}
      </div>
    </section>
  );
}
