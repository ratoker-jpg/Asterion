import { useEffect, useMemo, useState } from 'react';

import {
  getFactionDefenseCatalog,
  getFactionShipCatalog,
} from './domain/combat/faction-catalog.ts';
import type { DefenseId, ShipId } from './domain/combat/ids.ts';
import {
  getDefensePopulationSummary,
  getFleetProductionPopulationSummary,
} from './domain/fleet/production.ts';
import {
  evaluateRepairAvailability,
  type RepairAvailability,
  type RepairCategory,
} from './domain/repair/workshop.ts';
import {
  REPAIR_NOTICE_CHANGED_EVENT,
  REPAIR_REQUEST_EVENT,
  type RepairWorkshopSnapshot,
} from './application/repair.ts';
import { ResourceIcon as CanonicalResourceIcon } from './ui/resources/ResourceIcon';
import './repair-workshop.css';
import './repair-workshop-feedback-v2.css';

type PaymentMethod = 'resources' | 'tokens';
type ResourceKind = 'metal' | 'minerals' | 'gas' | 'population';

type RepairUnit = {
  id: ShipId | DefenseId;
  category: RepairCategory;
  name: string;
  role: string;
  art: string;
  population: number;
  cost: { metal: number; minerals: number; gas: number };
};

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function tokenWord(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'ЖЕТОНОВ';
  if (mod10 === 1) return 'ЖЕТОН';
  if (mod10 >= 2 && mod10 <= 4) return 'ЖЕТОНА';
  return 'ЖЕТОНОВ';
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v4a2.5 2.5 0 0 0 0 5v3H4v-3a2.5 2.5 0 0 0 0-5V6Z" />
      <path d="M12 7.5v9" />
    </svg>
  );
}

function CostRow({ kind, label, value }: { kind: ResourceKind; label: string; value: number }) {
  return (
    <div className={`repair-cost-row-v1 repair-cost-row-v1--${kind}`}>
      <span className="repair-cost-icon-v1"><CanonicalResourceIcon kind={kind === 'population' ? 'population' : kind} /></span>
      <span><small>{label}</small><strong>{formatNumber(value)}</strong></span>
    </div>
  );
}

function RepairCard({
  unit,
  available,
  selected,
  tokens,
  availability,
  onQuantity,
  onRepair,
}: {
  unit: RepairUnit;
  available: number;
  selected: number;
  tokens: number;
  availability: RepairAvailability;
  onQuantity: (unit: RepairUnit, value: number) => void;
  onRepair: (unit: RepairUnit, method: PaymentMethod) => void;
}) {
  const capacityReason = availability.capacityReason;
  const paymentReasons = [
    !availability.canPayResources && !capacityReason ? `Ресурсы: ${availability.resourceReason}` : null,
    !availability.canPayTokens && !capacityReason ? `Жетоны: ${availability.tokenReason}` : null,
  ].filter(Boolean).join(' ');
  const disabledReason = capacityReason ?? paymentReasons;

  return (
    <article className="repair-card-v1" data-qa-repair-card={unit.id}>
      <header className="repair-card-title-v1">
        <div className="repair-available-v1">
          <small>ДОСТУПНО</small>
          <strong data-qa-repair-available>{available}</strong>
        </div>
        <div className="repair-card-name-v1">
          <strong>{unit.name}</strong>
          <small>{unit.role}</small>
        </div>
        <span className="repair-ready-mark-v1" title="Готово к мгновенному ремонту">✓</span>
      </header>

      <div className="repair-card-body-v1">
        <div className="repair-card-art-v1">
          <img src={unit.art} alt={unit.name} draggable={false} />
        </div>

        <div className="repair-card-data-v1">
          <section className="repair-costs-v1" data-qa-repair-resource-cost={JSON.stringify(availability.cost)}>
            <div className="repair-mini-title-v1"><span>2 × КАНОНИЧЕСКАЯ СТОИМОСТЬ</span><i /></div>
            <div className="repair-cost-grid-v1">
              <CostRow kind="metal" label="Металл" value={availability.cost.metal} />
              <CostRow kind="minerals" label="Минералы" value={availability.cost.minerals} />
              <CostRow kind="gas" label="Газ" value={availability.cost.gas} />
              <CostRow kind="population" label="Население" value={availability.capacity.addedPopulation} />
            </div>
          </section>

          <section className="repair-quantity-v1">
            <div className="repair-mini-title-v1"><span>КОЛИЧЕСТВО</span><i /></div>
            <div className="repair-stepper-v1">
              <button type="button" onClick={() => onQuantity(unit, selected - 1)} aria-label={`Уменьшить количество ${unit.name}`}>−</button>
              <input
                type="number"
                min="1"
                max={available}
                value={selected}
                data-qa-repair-quantity={unit.id}
                aria-label={`Количество для ремонта: ${unit.name}`}
                onChange={(event) => onQuantity(unit, Number(event.target.value))}
              />
              <button type="button" onClick={() => onQuantity(unit, selected + 1)} aria-label={`Увеличить количество ${unit.name}`}>+</button>
              <button className="repair-shortcut-v1" type="button" onClick={() => onQuantity(unit, 1)}>МИН.</button>
              <button className="repair-shortcut-v1" type="button" onClick={() => onQuantity(unit, available)}>МАКС.</button>
            </div>
          </section>

          {disabledReason ? (
            <div className="repair-payment-reason-v1" data-qa-repair-disabled-reason role="status">
              {disabledReason}
            </div>
          ) : null}

          <div className="repair-payment-v1">
            <button
              className="repair-button-v1 repair-button-v1--resources"
              type="button"
              data-qa-repair-resource-button={unit.id}
              disabled={!availability.canPayResources}
              title={availability.resourceReason ?? undefined}
              onClick={() => onRepair(unit, 'resources')}
            >
              ВОССТАНОВИТЬ ЗА РЕСУРСЫ
            </button>
            <button
              className="repair-button-v1 repair-button-v1--tokens"
              type="button"
              data-qa-repair-token-button={unit.id}
              disabled={!availability.canPayTokens}
              title={availability.tokenReason ?? undefined}
              onClick={() => onRepair(unit, 'tokens')}
            >
              <TicketIcon />
              <span>РЕМОНТ ЗА {availability.tokenCost} {tokenWord(availability.tokenCost)} · {tokens} ДОСТУПНО</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function SectionTitle({ title, units, population }: { title: string; units: number; population: number }) {
  return (
    <div className="repair-section-title-v1">
      <div><span>{title}</span><i /></div>
      <small>{units} ТИПА · {formatNumber(population)} НАС.</small>
    </div>
  );
}

function WorkshopHelp() {
  return (
    <div className="repair-help-v1">
      <button type="button" aria-label="Правила ремонтной мастерской">i</button>
      <div className="repair-help-popover-v1" role="tooltip">
        <strong>ПРАВИЛА РЕМОНТА</strong>
        <span><b>50%</b> После оборонительного боя в мастерскую попадает 50% уничтоженной техники с математическим округлением.</span>
        <span><b>Мгновенно</b> Очереди ремонта нет: выбранные единицы возвращаются на планету сразу после оплаты.</span>
        <span><b>Без командирских</b> Командирские корабли не попадают в мастерскую и не восстанавливаются.</span>
      </div>
    </div>
  );
}

type SummaryIcon = 'tokens' | 'population';

function SummaryCard({
  label,
  value,
  unit,
  icon,
  meta,
}: {
  label: string;
  value: number;
  unit: string;
  icon: SummaryIcon;
  meta?: string;
}) {
  return (
    <div className="repair-summary-card-v1">
      <span className={`repair-summary-icon-v2 repair-summary-icon-v2--${icon}`}>
        {icon === 'tokens' ? <TicketIcon /> : <CanonicalResourceIcon kind="population" />}
      </span>
      <div className="repair-summary-copy-v2">
        <small>{label}</small>
        <div className="repair-summary-value-v1"><strong data-qa-repair-summary-population={label}>{formatNumber(value)}</strong><span>{unit}</span></div>
        {meta ? <em data-qa-repair-summary-capacity={label}>{meta}</em> : null}
      </div>
    </div>
  );
}

function availableFor(snapshot: RepairWorkshopSnapshot, unit: RepairUnit): number {
  return unit.category === 'ship'
    ? snapshot.repair.ships[unit.id as ShipId] ?? 0
    : snapshot.repair.defenses[unit.id as DefenseId] ?? 0;
}

export function RepairWorkshopView({
  planetName,
  coords,
  snapshot,
  onBack,
}: {
  planetName: string;
  coords: string;
  snapshot: RepairWorkshopSnapshot;
  onBack: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState('Выберите количество и способ оплаты. Ремонт выполняется мгновенно.');
  const repairUnits = useMemo<RepairUnit[]>(() => [
    ...getFactionShipCatalog(snapshot.factionId).map((entity) => ({
      id: entity.id,
      category: 'ship' as const,
      name: entity.name,
      role: entity.role,
      art: entity.art,
      population: entity.population,
      cost: entity.cost,
    })),
    ...getFactionDefenseCatalog(snapshot.factionId).map((entity) => ({
      id: entity.id,
      category: 'defense' as const,
      name: entity.name,
      role: entity.role,
      art: entity.art,
      population: entity.population,
      cost: entity.cost,
    })),
  ], [snapshot.factionId]);

  useEffect(() => {
    const onNotice = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      if (typeof value === 'string' && value) setNotice(value);
    };
    window.addEventListener(REPAIR_NOTICE_CHANGED_EVENT, onNotice);
    return () => window.removeEventListener(REPAIR_NOTICE_CHANGED_EVENT, onNotice);
  }, []);

  const visibleShips = useMemo(
    () => repairUnits.filter((unit) => unit.category === 'ship' && availableFor(snapshot, unit) > 0),
    [repairUnits, snapshot],
  );
  const visibleDefense = useMemo(
    () => repairUnits.filter((unit) => unit.category === 'defense' && availableFor(snapshot, unit) > 0),
    [repairUnits, snapshot],
  );
  const fleetCapacity = useMemo(
    () => getFleetProductionPopulationSummary(snapshot.fleet, snapshot.fleetProduction, snapshot.hangarLevel, snapshot.factionId),
    [snapshot],
  );
  const defenseCapacity = useMemo(
    () => getDefensePopulationSummary(snapshot.defense, snapshot.fleetProduction, snapshot.hangarLevel, snapshot.factionId),
    [snapshot],
  );

  const shipUnits = visibleShips.reduce((sum, unit) => sum + availableFor(snapshot, unit), 0);
  const defenseUnits = visibleDefense.reduce((sum, unit) => sum + availableFor(snapshot, unit), 0);
  const totalUnits = shipUnits + defenseUnits;
  const shipPopulation = visibleShips.reduce((sum, unit) => sum + availableFor(snapshot, unit) * unit.population, 0);
  const defensePopulation = visibleDefense.reduce((sum, unit) => sum + availableFor(snapshot, unit) * unit.population, 0);
  const totalPopulation = shipPopulation + defensePopulation;

  const setQuantity = (unit: RepairUnit, raw: number) => {
    const available = availableFor(snapshot, unit);
    if (available <= 0) return;
    const next = Number.isFinite(raw) ? Math.max(1, Math.min(available, Math.floor(raw))) : 1;
    setQuantities((current) => ({ ...current, [unit.id]: next }));
  };

  const selectedQuantity = (unit: RepairUnit) => {
    const available = availableFor(snapshot, unit);
    return Math.max(1, Math.min(available, quantities[unit.id] ?? 1));
  };

  const repair = (unit: RepairUnit, method: PaymentMethod) => {
    const available = availableFor(snapshot, unit);
    if (available <= 0) return;
    window.dispatchEvent(new CustomEvent(REPAIR_REQUEST_EVENT, {
      detail: {
        planetId: snapshot.planetId,
        category: unit.category,
        entityId: unit.id,
        quantity: selectedQuantity(unit),
        method,
      },
    }));
  };

  const renderCards = (units: RepairUnit[]) => units.map((unit) => {
    const available = availableFor(snapshot, unit);
    const selected = selectedQuantity(unit);
    const availability = evaluateRepairAvailability(snapshot, unit.category, unit.id, selected);
    return (
      <RepairCard
        key={unit.id}
        unit={unit}
        available={available}
        selected={selected}
        tokens={snapshot.repair.tokens}
        availability={availability}
        onQuantity={setQuantity}
        onRepair={repair}
      />
    );
  });

  return (
    <section className="repair-workshop-v1">
      <header className="repair-page-head-v1">
        <div>
          <small>СЕРВИСНЫЙ МОДУЛЬ · ОБОРОНИТЕЛЬНЫЕ ПОТЕРИ</small>
          <h2>РЕМОНТНАЯ МАСТЕРСКАЯ</h2>
          <p>{planetName} {coords} · корабли и планетарная оборона</p>
        </div>
        <div className="repair-head-actions-v1">
          <WorkshopHelp />
          <button className="repair-back-v1" type="button" onClick={onBack}>← К ФЛОТАМ</button>
        </div>
      </header>

      <section className="repair-summary-v1" aria-label="Сводка ремонтной мастерской">
        <SummaryCard label="ЖЕТОНЫ" value={snapshot.repair.tokens} unit={tokenWord(snapshot.repair.tokens)} icon="tokens" />
        <SummaryCard label="ДОСТУПНО К ВОССТАНОВЛЕНИЮ" value={totalPopulation} unit="НАС." icon="population" />
        <SummaryCard
          label="КОРАБЛИ"
          value={shipPopulation}
          unit="НАС."
          icon="population"
          meta={`ФЛОТ ${formatNumber(fleetCapacity.population)} / ${formatNumber(fleetCapacity.capacity)}`}
        />
        <SummaryCard
          label="ОБОРОНА"
          value={defensePopulation}
          unit="НАС."
          icon="population"
          meta={`ОБОРОНА ${formatNumber(defenseCapacity.population)} / ${formatNumber(defenseCapacity.capacity)}`}
        />
      </section>

      <div className="repair-notice-v1"><span>●</span><strong>{notice}</strong></div>

      {visibleShips.length > 0 ? (
        <section className="repair-section-v1">
          <SectionTitle title="КОРАБЛИ" units={visibleShips.length} population={shipPopulation} />
          <div className="repair-grid-v1">{renderCards(visibleShips)}</div>
        </section>
      ) : null}

      {visibleDefense.length > 0 ? (
        <section className="repair-section-v1">
          <SectionTitle title="ОБОРОНА" units={visibleDefense.length} population={defensePopulation} />
          <div className="repair-grid-v1">{renderCards(visibleDefense)}</div>
        </section>
      ) : null}

      {totalUnits === 0 ? (
        <section className="repair-empty-v1">
          <strong>РЕМОНТНАЯ МАСТЕРСКАЯ ПУСТА</strong>
          <span>После следующего оборонительного боя доступная для восстановления техника появится здесь.</span>
        </section>
      ) : null}
    </section>
  );
}
