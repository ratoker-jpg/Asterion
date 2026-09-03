import { useMemo, useState } from 'react';

import { getCombatEntity } from './domain/combat/catalog.ts';
import type { DefenseId, ShipId } from './domain/combat/ids.ts';
import './repair-workshop.css';
import './repair-workshop-feedback-v2.css';

type RepairCategory = 'ship' | 'defense';
type PaymentMethod = 'resources' | 'tokens';
type ResourceKind = 'metal' | 'minerals' | 'gas' | 'population';

type RepairCost = Record<ResourceKind, number>;

type RepairUnit = {
  id: ShipId | DefenseId;
  category: RepairCategory;
  name: string;
  role: string;
  art: string;
  destroyed: number;
  initialSelected: number;
  repairCost: RepairCost;
  tokenCost: number;
};

type RepairPreviewDefinition = Pick<RepairUnit, 'id' | 'destroyed' | 'initialSelected' | 'tokenCost'>;

// Until battle resolution is connected, only casualty counts remain deterministic preview data.
// Immutable unit identity, visuals and resource costs come from the shared combat catalog.
const repairPreview: readonly RepairPreviewDefinition[] = [
  { id: 'scout', destroyed: 4, initialSelected: 2, tokenCost: 1 },
  { id: 'battleship', destroyed: 6, initialSelected: 3, tokenCost: 1 },
  { id: 'cruiser', destroyed: 14, initialSelected: 4, tokenCost: 1 },
  { id: 'ballistic-turret', destroyed: 8, initialSelected: 4, tokenCost: 1 },
  { id: 'laser-turret', destroyed: 4, initialSelected: 2, tokenCost: 1 },
];

const repairUnits: RepairUnit[] = repairPreview.map((preview) => {
  const entity = getCombatEntity(preview.id);
  if (entity.kind === 'commander') throw new Error(`Commander ${entity.id} cannot enter repair workshop`);
  return {
    ...preview,
    category: entity.kind,
    name: entity.name,
    role: entity.role,
    art: entity.art,
    repairCost: {
      ...entity.cost,
      population: entity.population,
    },
  };
});

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const recoverableFromDestroyed = (destroyed: number) => Math.round(Math.max(0, destroyed) * 0.5);

function tokenWord(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'ЖЕТОНОВ';
  if (mod10 === 1) return 'ЖЕТОН';
  if (mod10 >= 2 && mod10 <= 4) return 'ЖЕТОНА';
  return 'ЖЕТОНОВ';
}

function ResourceIcon({ kind }: { kind: ResourceKind }) {
  if (kind === 'metal') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7 12 3l8 4-8 4-8-4Z"/><path d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>;
  }
  if (kind === 'minerals') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 7.7 7.4-3.1 10.9H7.4L4.3 10.2 12 2.8Z"/><path d="m12 6.1 3.7 4.6-3.7 7.1-3.7-7.1L12 6.1Z"/></svg>;
  }
  if (kind === 'gas') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c3.8 4.5 6.3 7.9 6.3 11.6A6.3 6.3 0 1 1 5.7 14.4C5.7 10.7 8.2 7.3 12 2.8Z"/><circle cx="10" cy="14.2" r="1.3"/><circle cx="14.5" cy="11.6" r="1"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="16.3" cy="9.4" r="2.4"/><path d="M3.8 19c.4-4 2.1-6.1 5.2-6.1s4.8 2.1 5.2 6.1H3.8Z"/><path d="M13 18.7c.3-3 1.5-4.6 3.7-4.6 2.1 0 3.3 1.6 3.6 4.6H13Z"/></svg>;
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
      <span className="repair-cost-icon-v1"><ResourceIcon kind={kind} /></span>
      <span><small>{label}</small><strong>{formatNumber(value)}</strong></span>
    </div>
  );
}

function RepairCard({
  unit,
  available,
  selected,
  tokens,
  onQuantity,
  onRepair,
}: {
  unit: RepairUnit;
  available: number;
  selected: number;
  tokens: number;
  onQuantity: (unit: RepairUnit, value: number) => void;
  onRepair: (unit: RepairUnit, method: PaymentMethod) => void;
}) {
  const tokenTotal = selected * unit.tokenCost;
  const totalCost = {
    metal: unit.repairCost.metal * selected,
    minerals: unit.repairCost.minerals * selected,
    gas: unit.repairCost.gas * selected,
    population: unit.repairCost.population * selected,
  };

  return (
    <article className="repair-card-v1">
      <header className="repair-card-title-v1">
        <div className="repair-available-v1">
          <small>ДОСТУПНО</small>
          <strong>{available}</strong>
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
          <section className="repair-costs-v1">
            <div className="repair-mini-title-v1"><span>СТОИМОСТЬ ВЫБРАННОГО РЕМОНТА</span><i /></div>
            <div className="repair-cost-grid-v1">
              <CostRow kind="metal" label="Металл" value={totalCost.metal} />
              <CostRow kind="minerals" label="Минералы" value={totalCost.minerals} />
              <CostRow kind="gas" label="Газ" value={totalCost.gas} />
              <CostRow kind="population" label="Население" value={totalCost.population} />
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
                aria-label={`Количество для ремонта: ${unit.name}`}
                onChange={(event) => onQuantity(unit, Number(event.target.value))}
              />
              <button type="button" onClick={() => onQuantity(unit, selected + 1)} aria-label={`Увеличить количество ${unit.name}`}>+</button>
              <button className="repair-shortcut-v1" type="button" onClick={() => onQuantity(unit, 1)}>МИН.</button>
              <button className="repair-shortcut-v1" type="button" onClick={() => onQuantity(unit, available)}>МАКС.</button>
            </div>
          </section>

          <div className="repair-payment-v1">
            <button className="repair-button-v1 repair-button-v1--resources" type="button" onClick={() => onRepair(unit, 'resources')}>
              ВОССТАНОВИТЬ ЗА РЕСУРСЫ
            </button>
            <button className="repair-button-v1 repair-button-v1--tokens" type="button" disabled={tokenTotal > tokens} onClick={() => onRepair(unit, 'tokens')}>
              <TicketIcon />
              <span>РЕМОНТ ЗА {tokenTotal} {tokenWord(tokenTotal)}</span>
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

function SummaryCard({ label, value, unit, icon }: { label: string; value: number; unit: string; icon: SummaryIcon }) {
  return (
    <div className="repair-summary-card-v1">
      <span className={`repair-summary-icon-v2 repair-summary-icon-v2--${icon}`}>
        {icon === 'tokens' ? <TicketIcon /> : <ResourceIcon kind="population" />}
      </span>
      <div className="repair-summary-copy-v2">
        <small>{label}</small>
        <div className="repair-summary-value-v1"><strong>{formatNumber(value)}</strong><span>{unit}</span></div>
      </div>
    </div>
  );
}

export function RepairWorkshopView({ planetName, coords, onBack }: { planetName: string; coords: string; onBack: () => void }) {
  const [remaining, setRemaining] = useState<Record<string, number>>(() => Object.fromEntries(
    repairUnits.map((unit) => [unit.id, recoverableFromDestroyed(unit.destroyed)]),
  ));
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(
    repairUnits.map((unit) => {
      const available = recoverableFromDestroyed(unit.destroyed);
      return [unit.id, Math.max(1, Math.min(available, unit.initialSelected))];
    }),
  ));
  const [tokens, setTokens] = useState(31);
  const [notice, setNotice] = useState('Выберите количество и способ оплаты. Ремонт выполняется мгновенно.');

  const visibleShips = useMemo(() => repairUnits.filter((unit) => unit.category === 'ship' && (remaining[unit.id] ?? 0) > 0), [remaining]);
  const visibleDefense = useMemo(() => repairUnits.filter((unit) => unit.category === 'defense' && (remaining[unit.id] ?? 0) > 0), [remaining]);

  const shipUnits = visibleShips.reduce((sum, unit) => sum + (remaining[unit.id] ?? 0), 0);
  const defenseUnits = visibleDefense.reduce((sum, unit) => sum + (remaining[unit.id] ?? 0), 0);
  const totalUnits = shipUnits + defenseUnits;

  const shipPopulation = visibleShips.reduce(
    (sum, unit) => sum + (remaining[unit.id] ?? 0) * unit.repairCost.population,
    0,
  );
  const defensePopulation = visibleDefense.reduce(
    (sum, unit) => sum + (remaining[unit.id] ?? 0) * unit.repairCost.population,
    0,
  );
  const totalPopulation = shipPopulation + defensePopulation;

  const setQuantity = (unit: RepairUnit, raw: number) => {
    const available = remaining[unit.id] ?? 0;
    if (available <= 0) return;
    const next = Number.isFinite(raw) ? Math.max(1, Math.min(available, Math.floor(raw))) : 1;
    setQuantities((current) => ({ ...current, [unit.id]: next }));
  };

  const repair = (unit: RepairUnit, method: PaymentMethod) => {
    const available = remaining[unit.id] ?? 0;
    const selected = Math.max(1, Math.min(available, quantities[unit.id] ?? 1));
    if (available <= 0) return;

    const tokenTotal = selected * unit.tokenCost;
    if (method === 'tokens' && tokenTotal > tokens) {
      setNotice(`Недостаточно жетонов для ремонта ${selected} × ${unit.name}.`);
      return;
    }

    const nextAvailable = available - selected;
    setRemaining((current) => ({ ...current, [unit.id]: nextAvailable }));
    setQuantities((current) => ({ ...current, [unit.id]: Math.max(1, Math.min(nextAvailable || 1, current[unit.id] ?? 1)) }));
    if (method === 'tokens') setTokens((current) => current - tokenTotal);

    const destination = unit.category === 'ship' ? 'на планету' : 'в оборону планеты';
    setNotice(`${selected} × ${unit.name} восстановлено ${method === 'tokens' ? 'за жетоны' : 'за ресурсы'} и мгновенно возвращено ${destination}.`);
  };

  const renderCards = (units: RepairUnit[]) => units.map((unit) => (
    <RepairCard
      key={unit.id}
      unit={unit}
      available={remaining[unit.id] ?? 0}
      selected={quantities[unit.id] ?? 1}
      tokens={tokens}
      onQuantity={setQuantity}
      onRepair={repair}
    />
  ));

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
        <SummaryCard label="ЖЕТОНЫ" value={tokens} unit={tokenWord(tokens)} icon="tokens" />
        <SummaryCard label="ДОСТУПНО К ВОССТАНОВЛЕНИЮ" value={totalPopulation} unit="НАС." icon="population" />
        <SummaryCard label="КОРАБЛИ" value={shipPopulation} unit="НАС." icon="population" />
        <SummaryCard label="ОБОРОНА" value={defensePopulation} unit="НАС." icon="population" />
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
