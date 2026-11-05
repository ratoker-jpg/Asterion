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
  isRepairableDefenseId,
  type RepairAvailability,
  type RepairCategory,
} from './domain/repair/workshop.ts';
import {
  REPAIR_NOTICE_CHANGED_EVENT,
  REPAIR_REQUEST_EVENT,
  type RepairWorkshopSnapshot,
} from './application/repair.ts';
import { ResourceIcon as CanonicalResourceIcon } from './ui/resources/ResourceIcon';
import { EMPTY_ART } from './ui/ui-art.ts';
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

function RepairCard({
  unit,
  available,
  selected,
  tokens,
  availability,
  onQuantity,
  onRepair,
  onRemove,
}: {
  unit: RepairUnit;
  available: number;
  selected: number;
  tokens: number;
  availability: RepairAvailability;
  onQuantity: (unit: RepairUnit, value: number) => void;
  onRepair: (unit: RepairUnit, method: PaymentMethod) => void;
  onRemove: (unit: RepairUnit) => void;
}) {
  const [removeConfirmationOpen, setRemoveConfirmationOpen] = useState(false);
  const capacityReason = availability.capacityReason;
  const paymentReasons = [
    !availability.canPayResources && !capacityReason ? `Ресурсы: ${availability.resourceReason}` : null,
    !availability.canPayTokens && !capacityReason ? `Жетоны: ${availability.tokenReason}` : null,
  ].filter(Boolean).join(' ');
  const disabledReason = capacityReason ?? paymentReasons;

  return (
    <article className="fc-unit fc-unit--repair" data-qa-repair-card={unit.id}>
      <div className="fc-unit__art"><img src={unit.art} alt={unit.name} draggable={false} /></div>

      <div className="fc-unit__name">
        <h3>{unit.name}</h3>
        <small>{unit.role}</small>
      </div>

      <div className="fc-unit__stock has-units">
        <small>Можно вернуть</small>
        <strong data-qa-repair-available>{formatNumber(available)}</strong>
      </div>

      <dl className="fc-unit__cost" aria-label={`Цена за ${formatNumber(selected)}: вдвое дороже постройки`} data-qa-repair-resource-cost={JSON.stringify(availability.cost)}>
        {([
          ['metal', 'Металл', availability.cost.metal],
          ['minerals', 'Минералы', availability.cost.minerals],
          ['gas', 'Газ', availability.cost.gas],
          ['population', 'Население', availability.capacity.addedPopulation],
        ] as const).map(([kind, label, value]) => (
          <div key={kind}>
            <dt><CanonicalResourceIcon kind={kind} label={label} /></dt>
            <dd>{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>

      <div className="fc-unit__amount fc-unit__amount--stepper">
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

      <div className="fc-unit__pay">
        <button
          className="fc-unit__build asterion-button asterion-button--primary"
          type="button"
          data-qa-repair-resource-button={unit.id}
          disabled={!availability.canPayResources}
          onClick={() => onRepair(unit, 'resources')}
        >
          За ресурсы
        </button>
        <button
          className="fc-unit__token"
          type="button"
          data-qa-repair-token-button={unit.id}
          disabled={!availability.canPayTokens}
          onClick={() => onRepair(unit, 'tokens')}
        >
          <TicketIcon />
          <span>За {formatNumber(availability.tokenCost)} {tokenWord(availability.tokenCost)}</span>
        </button>
      </div>

      {removeConfirmationOpen ? (
        <div
          className="fc-unit__confirm"
          role="alertdialog"
          aria-label={`Подтверждение удаления ${unit.name}`}
          data-qa-repair-remove-confirm={unit.id}
        >
          <strong>Удалить {formatNumber(selected)} шт.? Возврата ресурсов не будет.</strong>
          <button
            className="is-danger"
            type="button"
            data-qa-repair-remove-confirm-action={unit.id}
            onClick={() => {
              onRemove(unit);
              setRemoveConfirmationOpen(false);
            }}
          >
            УДАЛИТЬ
          </button>
          <button
            type="button"
            data-qa-repair-remove-cancel={unit.id}
            onClick={() => setRemoveConfirmationOpen(false)}
          >
            ОТМЕНИТЬ
          </button>
        </div>
      ) : (
        <button
          className="fc-unit__remove"
          type="button"
          data-qa-repair-remove-button={unit.id}
          aria-label={`Удалить ${selected} единиц ${unit.name} из ремонтной мастерской`}
          onClick={() => setRemoveConfirmationOpen(true)}
        >
          ×
        </button>
      )}

      {disabledReason ? (
        <div className="fc-unit__reason" data-qa-repair-disabled-reason role="status">
          {disabledReason}
        </div>
      ) : null}
    </article>
  );
}

function SectionTitle({ title, units, population }: { title: string; units: number; population: number }) {
  return (
    <h3 className="fc-repair__section">{title}<small>типов: {units} · население {formatNumber(population)}</small></h3>
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
        <span><b>Удаление</b> Выбранное количество можно удалить из мастерской без возврата ресурсов.</span>
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
    <div className="fc-repair__stat">
      <span className="fc-repair__stat-icon">
        {icon === 'tokens' ? <TicketIcon /> : <CanonicalResourceIcon kind="population" />}
      </span>
      <small>{label}</small>
      <div><strong data-qa-repair-summary-population={label}>{formatNumber(value)}</strong> <span>{unit}</span></div>
      {meta ? <em data-qa-repair-summary-capacity={label}>{meta}</em> : null}
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
}: {
  planetName: string;
  coords: string;
  snapshot: RepairWorkshopSnapshot;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState('Выберите количество и способ действия. Ремонт выполняется мгновенно.');
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
    ...getFactionDefenseCatalog(snapshot.factionId).filter((entity) => isRepairableDefenseId(entity.id)).map((entity) => ({
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
    () => getFleetProductionPopulationSummary(
      snapshot.fleet,
      snapshot.fleetProduction,
      snapshot.hangarLevel,
      snapshot.factionId,
      snapshot.solarSatellites,
    ),
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

  const remove = (unit: RepairUnit) => {
    const available = availableFor(snapshot, unit);
    if (available <= 0) return;
    window.dispatchEvent(new CustomEvent(REPAIR_REQUEST_EVENT, {
      detail: {
        planetId: snapshot.planetId,
        category: unit.category,
        entityId: unit.id,
        quantity: selectedQuantity(unit),
        operation: 'remove',
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
        onRemove={remove}
      />
    );
  });

  return (
    <section className="repair-workshop-v1 fc-repair">
      <header className="fc-head fc-head--plain">
        <div className="fc-head__title">
          <h2>Ремонтная мастерская</h2>
          <p>{planetName} {coords} · возврат техники, потерянной в обороне</p>
        </div>
        <WorkshopHelp />
      </header>

      <section className="fc-repair__stats" aria-label="Сводка ремонтной мастерской">
        <SummaryCard label="ЖЕТОНЫ" value={snapshot.repair.tokens} unit={tokenWord(snapshot.repair.tokens)} icon="tokens" />
        <SummaryCard label="МОЖНО ВЕРНУТЬ" value={totalPopulation} unit="население" icon="population" />
        <SummaryCard
          label="КОРАБЛИ"
          value={shipPopulation}
          unit="население"
          icon="population"
          meta={`ФЛОТ ${formatNumber(fleetCapacity.population)} / ${formatNumber(fleetCapacity.capacity)}`}
        />
        <SummaryCard
          label="ОБОРОНА"
          value={defensePopulation}
          unit="население"
          icon="population"
          meta={`ОБОРОНА ${formatNumber(defenseCapacity.population)} / ${formatNumber(defenseCapacity.capacity)}`}
        />
      </section>

      <p className="fc-repair__notice">{notice}</p>

      {visibleShips.length > 0 ? (
        <section className="fc-repair__group">
          <SectionTitle title="КОРАБЛИ" units={visibleShips.length} population={shipPopulation} />
          <div className="fc-unit-list">{renderCards(visibleShips)}</div>
        </section>
      ) : null}

      {visibleDefense.length > 0 ? (
        <section className="fc-repair__group">
          <SectionTitle title="ОБОРОНА" units={visibleDefense.length} population={defensePopulation} />
          <div className="fc-unit-list">{renderCards(visibleDefense)}</div>
        </section>
      ) : null}

      {totalUnits === 0 ? (
        <section className="fc-empty">
          <img className="ui-empty-art" src={EMPTY_ART.repair} alt="" draggable={false} />
          <strong>Ремонтная мастерская пуста</strong>
          <span>После следующего оборонительного боя доступная для восстановления техника появится здесь.</span>
        </section>
      ) : null}
    </section>
  );
}
