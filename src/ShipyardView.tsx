import { useEffect, useMemo, useState } from 'react';

import { getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import { getCombatFactionName, type CombatFactionId } from './domain/combat/factions.ts';
import type { ShipId } from './domain/combat/ids.ts';
import type { CatalogEntity } from './domain/combat/catalog.ts';
import {
  formatClockDurationMs,
  getBuildingPresentation,
  localizeBuildingNames,
} from './domain/buildings/balance-v1.ts';
import {
  calculateFleetProductionDurationMs,
} from './domain/fleet/production.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale } from './domain/runtime/mode.ts';
import { FLEET_PRODUCTION_START_REQUEST_EVENT } from './application/fleet-production.ts';
import { readFleetBuildBudget, type FleetBuildBudget } from './application/fleet.ts';
import { FleetConstructionHeader } from './FleetConstructionHeader';
import { FLEET_PLANNER_OPEN_EVENT } from './building-interior-navigation.ts';
import { FleetUnitRow } from './ui/fleet/FleetUnitRow';
import { evaluateProductionRequirements } from './domain/fleet/requirements.ts';

type ShipDefinition = {
  catalog: CatalogEntity;
  id: ShipId;
  name: string;
  role: string;
  art: string;
  owned: number;
  pending: number;
  metal: number;
  minerals: number;
  gas: number;
  population: number;
  time: string;
  requiredShipyardLevel: number;
  requirements: readonly string[];
};

type ShipCombatStats = {
  category: string;
  attack: number;
  life: number;
  weaponType: string;
  armorType: string;
  armorStrength: number;
  cargo: number | null;
  speed: number | null;
  fuel: number | null;
};

type ShipyardBudget = FleetBuildBudget;

function getShipDefinitions(factionId: CombatFactionId): ShipDefinition[] {
  return getFactionShipCatalog(factionId).map((entity) => ({
    catalog: entity,
    id: entity.id,
    name: entity.name,
    role: entity.role,
    art: entity.art,
    owned: 0,
    pending: 0,
    metal: entity.cost.metal,
    minerals: entity.cost.minerals,
    gas: entity.cost.gas,
    population: entity.population,
    time: entity.construction.time,
    requiredShipyardLevel: entity.construction.requiredShipyardLevel,
    requirements: entity.construction.requirements,
  }));
}

function getShipCombatStats(factionId: CombatFactionId): Record<ShipId, ShipCombatStats> {
  return Object.fromEntries(
    getFactionShipCatalog(factionId).map((entity) => [entity.id, {
      category: entity.category,
      ...entity.combat,
      cargo: entity.ship?.cargo ?? null,
      speed: entity.ship?.speed ?? null,
      fuel: entity.ship?.fuel ?? null,
    } satisfies ShipCombatStats] as const),
  ) as Record<ShipId, ShipCombatStats>;
}

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function calculateMax(ship: ShipDefinition, budget: ShipyardBudget) {
  const limits: number[] = [];
  if (ship.metal > 0) limits.push(Math.floor(budget.metal / ship.metal));
  if (ship.minerals > 0) limits.push(Math.floor(budget.minerals / ship.minerals));
  if (ship.gas > 0) limits.push(Math.floor(budget.gas / ship.gas));
  if (ship.population > 0) limits.push(Math.floor(Math.max(0, budget.populationMax - budget.population) / ship.population));
  return Math.max(0, Math.min(...(limits.length ? limits : [0])));
}

function formatMetric(value: number | null) {
  return value == null ? '—' : formatNumber(value);
}

function ShipStatsTooltip({ ship, stats, level }: { ship: ShipDefinition; stats: ShipCombatStats; level: number }) {
  return (
    <div className="shipyard-stats-tooltip-v1" role="tooltip">
      <header className="shipyard-tooltip-head-v1">
        <div><small>{stats.category}</small><strong>{ship.name}</strong></div>
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
        <div><small>Грузоподъёмность</small><strong>{formatMetric(stats.cargo)}</strong></div>
        <div><small>Скорость</small><strong>{formatMetric(stats.speed)}</strong></div>
        <div><small>Расход топлива</small><strong>{formatMetric(stats.fuel)}</strong></div>
        <div className="shipyard-tooltip-level-v1" data-qa-fleet-level={ship.id}><small>Уровень корабля</small><strong>{level}/10</strong></div>
      </div>
    </div>
  );
}

function ShipCard({
  ship,
  quantity,
  budget,
  planetId,
  shipyardLevel,
  advancedFactoryLevel,
  scienceLevels,
  shipCombatStats,
  onQuantity,
  onBuild,
}: {
  ship: ShipDefinition;
  quantity: number;
  budget: ShipyardBudget;
  planetId?: string;
  shipyardLevel: number;
  advancedFactoryLevel: number;
  scienceLevels: ShipyardBudget['scienceLevels'];
  shipCombatStats: Record<ShipId, ShipCombatStats>;
  onQuantity: (ship: ShipDefinition, quantity: number) => void;
  onBuild: (ship: ShipDefinition, quantity: number) => void;
}) {
  const requirements = evaluateProductionRequirements(ship.catalog, {
    planetId,
    scienceLevels,
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
  const unlocked = requirements.met;
  const max = unlocked ? calculateMax(ship, budget) : 0;
  const stats = shipCombatStats[ship.id];
  const effectiveTimeMs = calculateFleetProductionDurationMs('ships', ship.id, {
    factionId: budget.factionId,
    shipyardLevel,
    advancedFactoryLevel,
    mode: ACTIVE_RUNTIME_MODE,
    testTimeScale: resolveTestTimeScale(),
  });
  const shipLevel = Math.min(10, Math.max(0, Math.floor(budget.spaceportUpgrades.shipLevels[ship.id] ?? 0)));

  return (
    <FleetUnitRow
      id={ship.id}
      name={ship.name}
      role={ship.role}
      art={ship.art}
      owned={ship.owned}
      pending={ship.pending}
      levelNode={(
        <span className="fc-unit__level" data-qa-fleet-visible-level={ship.id} aria-label={`Уровень корабля ${ship.name}: ${shipLevel} из 10`}>
          Уровень <b>{shipLevel}/10</b>
        </span>
      )}
      cost={{ metal: ship.metal, minerals: ship.minerals, gas: ship.gas, population: ship.population }}
      wallet={{ metal: budget.metal, minerals: budget.minerals, gas: budget.gas, populationFree: Math.max(0, budget.populationMax - budget.population) }}
      effectiveTime={formatClockDurationMs(effectiveTimeMs)}
      rawTime={ship.time}
      quantity={quantity}
      max={max}
      locked={!unlocked}
      lockReason={requirements.reason ? localizeBuildingNames(requirements.reason, budget.factionId) : null}
      requirements={ship.requirements.map((requirement) => localizeBuildingNames(requirement, budget.factionId))}
      dossier={<ShipStatsTooltip ship={ship} stats={stats} level={shipLevel} />}
      onQuantity={(next) => onQuantity(ship, next)}
      onBuild={(next) => onBuild(ship, next)}
    />
  );
}

export function ShipyardView({ planetName, coords, planetId, budget: providedBudget }: { planetName: string; coords: string; planetId?: string; budget?: FleetBuildBudget }) {
  const savedBudget = useMemo(readFleetBuildBudget, []);
  const budget = providedBudget ?? savedBudget;
  const factionName = getCombatFactionName(budget.factionId);
  const shipyardPresentation = useMemo(
    () => getBuildingPresentation('shipyard', budget.factionId),
    [budget.factionId],
  );
  const ships = useMemo(() => getShipDefinitions(budget.factionId), [budget.factionId]);
  const shipCombatStats = useMemo(() => getShipCombatStats(budget.factionId), [budget.factionId]);
  const fleetSummary = budget.summary;
  const ownedShips = useMemo(
    () => ships.map((ship) => ({
      ...ship,
      owned: budget.fleet.ships[ship.id] ?? 0,
      pending: budget.fleetProduction.shipQueue
        .filter((order) => order.itemId === ship.id)
        .reduce((total, order) => total + Math.max(0, order.quantity - order.completedQuantity), 0),
    })),
    [budget.fleet, budget.fleetProduction.shipQueue, ships],
  );
  const [quantities, setQuantities] = useState<Partial<Record<ShipId, number>>>({});

  // Document scrolling (long page) is owned by GlobalPageScrollController.
  useEffect(() => {
    window.scrollTo(0, 0);
    return () => window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    setQuantities({});
  }, [planetId]);

  const setQuantity = (ship: ShipDefinition, raw: number) => {
    const max = calculateMax(ship, { ...budget, population: fleetSummary.population, populationMax: fleetSummary.capacity });
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : 0;
    setQuantities((current) => ({ ...current, [ship.id]: next }));
  };

  const prepareBuild = (ship: ShipDefinition, quantity: number) => {
    window.dispatchEvent(new CustomEvent(FLEET_PRODUCTION_START_REQUEST_EVENT, {
      detail: { queueKind: 'ships', itemId: ship.id, quantity, now: Date.now() },
    }));
    setQuantities((current) => ({ ...current, [ship.id]: 0 }));
  };

  return (
    <section
      className="fc-catalog"
      data-qa-construction-mode="ships"
      data-qa-building-role="shipyard"
      data-qa-building-asset={shipyardPresentation.art}
      data-qa-building-faction={budget.factionId}
      data-qa-building-name={shipyardPresentation.name}
      data-qa-fleet-population={fleetSummary.population}
      data-qa-fleet-capacity={fleetSummary.capacity}
    >
      <FleetConstructionHeader
        viewId="ships"
        shipyardPresentation={shipyardPresentation}
        title="Корабли"
        detail={`${planetName} ${coords} · ${shipyardPresentation.name}, уровень ${budget.shipyardLevel} · ${factionName}`}
        noShipyard={budget.shipyardLevel <= 0}
        populationLabel="Население флота"
        population={fleetSummary.population}
        capacity={fleetSummary.capacity}
        free={fleetSummary.available}
        action={planetId ? (
          <button type="button" className="fc-head__plan" data-qa-fleet-planner-open onClick={() => window.dispatchEvent(new CustomEvent(FLEET_PLANNER_OPEN_EVENT, { detail: { planetId } }))}>
            <img src={ships.find((ship) => ship.id === 'battleship')?.art ?? ships[0]?.art} alt="" draggable={false} />
            Эталонный флот
          </button>
        ) : null}
      />

      <div className="fc-unit-list">
        {ownedShips.map((ship) => (
          <ShipCard
            key={ship.id}
            ship={ship}
            quantity={quantities[ship.id] ?? 0}
            budget={budget}
            planetId={planetId}
            shipyardLevel={budget.shipyardLevel}
            advancedFactoryLevel={budget.advancedFactoryLevel}
            scienceLevels={budget.scienceLevels}
            shipCombatStats={shipCombatStats}
            onQuantity={setQuantity}
            onBuild={prepareBuild}
          />
        ))}
      </div>
    </section>
  );
}
