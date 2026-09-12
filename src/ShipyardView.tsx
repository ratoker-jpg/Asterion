import { useEffect, useMemo, useState } from 'react';

import { getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import { getCombatFactionName, type CombatFactionId } from './domain/combat/factions.ts';
import type { ShipId } from './domain/combat/ids.ts';
import {
  calculateUnitProductionDurationMs,
  formatClockDurationMs,
  parseClockDurationMs,
  getBuildingPresentation,
} from './domain/buildings/balance-v1.ts';
import { readFleetBuildBudget, type FleetBuildBudget } from './application/fleet.ts';
import { FleetConstructionHeader } from './FleetConstructionHeader';
import { ResourceIcon } from './ui/resources/ResourceIcon';

type ShipDefinition = {
  id: ShipId;
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

type ResourceKind = 'metal' | 'minerals' | 'gas' | 'population';

function getShipDefinitions(factionId: CombatFactionId): ShipDefinition[] {
  return getFactionShipCatalog(factionId).map((entity) => ({
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
  return Math.max(0, Math.min(999, ...(limits.length ? limits : [0])));
}

function CostRow({ kind, label, value }: { kind: ResourceKind; label: string; value: number }) {
  return (
    <div className={`shipyard-cost-row-v1 ${kind}`}>
      <span className="shipyard-cost-icon-v1"><ResourceIcon kind={kind} /></span>
      <span className="shipyard-cost-copy-v1"><small>{label}</small><strong>{formatNumber(value)}</strong></span>
    </div>
  );
}

function formatMetric(value: number | null) {
  return value == null ? '—' : formatNumber(value);
}

function ShipStatsTooltip({ ship, stats }: { ship: ShipDefinition; stats: ShipCombatStats }) {
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
      </div>
    </div>
  );
}

function ShipCard({
  ship,
  quantity,
  budget,
  shipyardLevel,
  advancedFactoryLevel,
  shipCombatStats,
  onQuantity,
  onBuild,
}: {
  ship: ShipDefinition;
  quantity: number;
  budget: ShipyardBudget;
  shipyardLevel: number;
  advancedFactoryLevel: number;
  shipCombatStats: Record<ShipId, ShipCombatStats>;
  onQuantity: (ship: ShipDefinition, quantity: number) => void;
  onBuild: (ship: ShipDefinition, quantity: number) => void;
}) {
  const unlocked = ship.requiredShipyardLevel <= shipyardLevel;
  const max = unlocked ? calculateMax(ship, budget) : 0;
  const stats = shipCombatStats[ship.id];
  const rawTimeMs = parseClockDurationMs(ship.time) ?? 1;
  const effectiveTimeMs = calculateUnitProductionDurationMs(rawTimeMs, shipyardLevel, advancedFactoryLevel);

  return (
    <article className={`shipyard-card-v1 ${unlocked ? '' : 'locked'}`}>
      <header className="shipyard-card-title-v1">
        <div className={`shipyard-owned-v1 ${ship.owned > 0 ? 'has-ships' : ''}`}>
          <small>В СТРОЮ</small>
          <strong>{formatNumber(ship.owned)}</strong>
        </div>
        <div className="shipyard-title-copy-v1"><strong>{ship.name}</strong><small>{ship.role}</small></div>
        <button type="button" title={ship.role} aria-label={`Информация: ${ship.name}`}>i</button>
      </header>

      <div className="shipyard-card-body-v1">
        <div className="shipyard-art-v1">
          <div className="shipyard-art-hover-v1" aria-label={`Характеристики корабля ${ship.name}`}>
            <img src={ship.art} alt={ship.name} draggable={false} />
            <ShipStatsTooltip ship={ship} stats={stats} />
          </div>
          <div className="shipyard-time-v1" data-qa-unit-time={ship.id}>
            <small>ВРЕМЯ ЗА ЕДИНИЦУ</small>
            <b data-qa-unit-time-effective>{formatClockDurationMs(effectiveTimeMs)}</b>
            <span data-qa-unit-time-raw>RAW {ship.time}</span>
          </div>
        </div>

        <div className="shipyard-card-data-v1">
          <div className="shipyard-costs-v1">
            <div className="shipyard-costs-title-v1"><span>СТОИМОСТЬ ЕДИНИЦЫ</span><i /></div>
            <div className="shipyard-cost-grid-v1">
              <CostRow kind="metal" label="Металл" value={ship.metal} />
              <CostRow kind="minerals" label="Минералы" value={ship.minerals} />
              <CostRow kind="gas" label="Газ" value={ship.gas} />
              <CostRow kind="population" label="Население" value={ship.population} />
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
                  aria-label={`Количество: ${ship.name}`}
                  onChange={(event) => onQuantity(ship, Number(event.target.value))}
                />
                <button type="button" onClick={() => onQuantity(ship, max)}>Макс. {max}</button>
                <button type="button" onClick={() => onQuantity(ship, 0)}>Мин.</button>
              </div>
              <button className="shipyard-build-button-v1" type="button" disabled={quantity <= 0 || max <= 0} onClick={() => onBuild(ship, quantity)}>
                В ПРОИЗВОДСТВО
              </button>
            </div>
          ) : (
            <div className="shipyard-requirements-v1">
              <div className="shipyard-requirements-head-v1">
                <span className="shipyard-lock-v1" aria-hidden="true">◆</span>
                <div><small>КОРПУС НЕДОСТУПЕН</small><strong>Требования для постройки</strong></div>
              </div>
              <div className="shipyard-requirements-list-v1">
                {ship.requirements.map((requirement) => <span key={requirement}>{requirement}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function ShipyardView({ planetName, coords }: { planetName: string; coords: string }) {
  const budget = useMemo(readFleetBuildBudget, []);
  const factionName = getCombatFactionName(budget.factionId);
  const shipyardPresentation = useMemo(
    () => getBuildingPresentation('shipyard', budget.factionId),
    [budget.factionId],
  );
  const ships = useMemo(() => getShipDefinitions(budget.factionId), [budget.factionId]);
  const shipCombatStats = useMemo(() => getShipCombatStats(budget.factionId), [budget.factionId]);
  const fleetSummary = budget.summary;
  const ownedShips = useMemo(
    () => ships.map((ship) => ({ ...ship, owned: budget.fleet.ships[ship.id] ?? 0 })),
    [budget.fleet, ships],
  );
  const [quantities, setQuantities] = useState<Partial<Record<ShipId, number>>>({});
  const [process, setProcess] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('asterion-long-page');
    window.scrollTo(0, 0);
    return () => {
      document.documentElement.classList.remove('asterion-long-page');
      window.scrollTo(0, 0);
    };
  }, []);

  const setQuantity = (ship: ShipDefinition, raw: number) => {
    const max = calculateMax(ship, { ...budget, population: fleetSummary.population, populationMax: fleetSummary.capacity });
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : 0;
    setQuantities((current) => ({ ...current, [ship.id]: next }));
  };

  const prepareBuild = (ship: ShipDefinition, quantity: number) => {
    setProcess(`${quantity} × ${ship.name} подготовлено к постановке в очередь. Реальное списание ресурсов подключим вместе с системой производства.`);
  };

  return (
    <section
      className="shipyard-view-v1"
      data-qa-construction-mode="ships"
      data-qa-building-role="shipyard"
      data-qa-building-asset={shipyardPresentation.art}
      data-qa-building-faction={budget.factionId}
      data-qa-fleet-population={fleetSummary.population}
      data-qa-fleet-capacity={fleetSummary.capacity}
    >
      <FleetConstructionHeader
        viewId="ships"
        shipyardPresentation={shipyardPresentation}
        kicker={`${shipyardPresentation.name.toUpperCase()} · УРОВЕНЬ ${budget.shipyardLevel}`}
        title={shipyardPresentation.name}
        description={`полный каталог стандартных корпусов ${factionName}`}
        planetName={planetName}
        coords={coords}
      />

      <section className="shipyard-processes-v1">
        <strong>ТЕКУЩИЕ ПРОЦЕССЫ</strong>
        <span>{process ?? 'Очередь верфи пуста.'}</span>
      </section>

      <div className="shipyard-grid-v1">
        {ownedShips.map((ship) => (
          <ShipCard
            key={ship.id}
            ship={ship}
            quantity={quantities[ship.id] ?? 0}
            budget={budget}
            shipyardLevel={budget.shipyardLevel}
            advancedFactoryLevel={budget.advancedFactoryLevel}
            shipCombatStats={shipCombatStats}
            onQuantity={setQuantity}
            onBuild={prepareBuild}
          />
        ))}
      </div>

      <footer className="shipyard-page-foot-v1">
        <span>13 стандартных корпусов {factionName} · командирские корабли находятся в отдельном разделе.</span>
        <span data-qa-fleet-summary>Популяция флота: {formatNumber(fleetSummary.population)} / {formatNumber(fleetSummary.capacity)} · свободно {formatNumber(fleetSummary.available)}</span>
      </footer>
    </section>
  );
}
