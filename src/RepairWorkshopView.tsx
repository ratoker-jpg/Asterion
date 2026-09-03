import { useMemo, useState } from 'react';

import scoutArt from '../assets/source/New assets/ship/aegis/ship.aegis.scout.png';
import cruiserArt from '../assets/source/New assets/ship/aegis/ship.aegis.cruiser.png';
import battleshipArt from '../assets/source/New assets/ship/aegis/ship.aegis.battleship.png';
import ballisticTurretArt from '../assets/source/New assets/defenses/aegis/defense.aegis.ballistic-turret.png';
import laserTurretArt from '../assets/source/New assets/defenses/aegis/defense.aegis.laser-turret.png';
import './repair-workshop.css';

type RepairCategory = 'ship' | 'defense';
type PaymentMethod = 'resources' | 'tokens';
type ResourceKind = 'metal' | 'minerals' | 'gas' | 'population';

type RepairCost = Record<ResourceKind, number>;

type RepairUnit = {
  id: string;
  category: RepairCategory;
  name: string;
  role: string;
  art: string;
  destroyed: number;
  initialSelected: number;
  repairCost: RepairCost;
  tokenCost: number;
};

// Until battle resolution is connected, these casualties are a deterministic preview pool.
// The workshop itself already applies the agreed 50% recovery rule with mathematical rounding.
const repairUnits: RepairUnit[] = [
  {
    id: 'scout',
    category: 'ship',
    name: 'Скаут',
    role: 'Лёгкий боевой разведчик',
    art: scoutArt,
    destroyed: 4,
    initialSelected: 2,
    repairCost: { metal: 2_400, minerals: 1_600, gas: 0, population: 2 },
    tokenCost: 1,
  },
  {
    id: 'battleship',
    category: 'ship',
    name: 'Линкор',
    role: 'Тяжёлый боевой корабль',
    art: battleshipArt,
    destroyed: 6,
    initialSelected: 3,
    repairCost: { metal: 49_400, minerals: 21_200, gas: 0, population: 15 },
    tokenCost: 1,
  },
  {
    id: 'cruiser',
    category: 'ship',
    name: 'Крейсер',
    role: 'Боевой крейсер',
    art: cruiserArt,
    destroyed: 14,
    initialSelected: 4,
    repairCost: { metal: 10_200, minerals: 8_400, gas: 0, population: 7 },
    tokenCost: 1,
  },
  {
    id: 'ballistic-turret',
    category: 'defense',
    name: 'Баллистическая турель',
    role: 'Базовая оборонная установка',
    art: ballisticTurretArt,
    destroyed: 8,
    initialSelected: 4,
    repairCost: { metal: 2_500, minerals: 1_000, gas: 0, population: 1 },
    tokenCost: 1,
  },
  {
    id: 'laser-turret',
    category: 'defense',
    name: 'Лазерная турель',
    role: 'Лазерная оборонная установка',
    art: laserTurretArt,
    destroyed: 4,
    initialSelected: 2,
    repairCost: { metal: 2_000, minerals: 2_500, gas: 0, population: 1 },
    tokenCost: 1,
  },
];

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const recoverableFromDestroyed = (destroyed: number) => Math.round(Math.max(0, destroyed) * 0.5);

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
          <div className="repair-origin-v1">
            <small>ПОСЛЕ ОБОРОНЫ</small>
            <strong>Уничтожено {unit.destroyed} → ремонт {recoverableFromDestroyed(unit.destroyed)}</strong>
          </div>
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
              <span>ВОССТАНОВИТЬ ЗА РЕСУРСЫ</span>
            </button>
            <button className="repair-button-v1 repair-button-v1--tokens" type="button" disabled={tokenTotal > tokens} onClick={() => onRepair(unit, 'tokens')}>
              <span><TicketIcon /> РЕМОНТ ЗА ЖЕТОНЫ</span>
              <small>{tokenTotal} жет.</small>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function SectionTitle({ title, units, total }: { title: string; units: number; total: number }) {
  return (
    <div className="repair-section-title-v1">
      <div><span>{title}</span><i /></div>
      <small>{units} ТИПА · {total} ЕД.</small>
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
  const shipTotal = visibleShips.reduce((sum, unit) => sum + (remaining[unit.id] ?? 0), 0);
  const defenseTotal = visibleDefense.reduce((sum, unit) => sum + (remaining[unit.id] ?? 0), 0);
  const totalAvailable = shipTotal + defenseTotal;

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
        <button type="button" onClick={onBack}>← К КОРАБЛЯМ</button>
      </header>

      <section className="repair-summary-v1" aria-label="Сводка ремонтной мастерской">
        <div className="repair-summary-card-v1 repair-summary-card-v1--tokens">
          <span className="repair-summary-icon-v1"><TicketIcon /></span>
          <div><small>ЖЕТОНЫ</small><strong>{tokens}</strong></div>
        </div>
        <div className="repair-summary-card-v1">
          <div><small>ДОСТУПНО К ВОССТАНОВЛЕНИЮ</small><strong>{totalAvailable}</strong></div>
          <span>ЕД.</span>
        </div>
        <div className="repair-summary-card-v1">
          <div><small>КОРАБЛИ</small><strong>{shipTotal}</strong></div>
          <span>ЕД.</span>
        </div>
        <div className="repair-summary-card-v1">
          <div><small>ОБОРОНА</small><strong>{defenseTotal}</strong></div>
          <span>ЕД.</span>
        </div>
      </section>

      <section className="repair-info-v1">
        <div><strong>50%</strong><span>После оборонительного боя в мастерскую попадает 50% уничтоженной техники с математическим округлением.</span></div>
        <i />
        <div><strong>МГНОВЕННО</strong><span>Очереди ремонта нет: выбранные единицы возвращаются на планету сразу после оплаты.</span></div>
        <i />
        <div><strong>БЕЗ КОМАНДИРСКИХ</strong><span>Командирские корабли в мастерскую не попадают и восстановлению не подлежат.</span></div>
      </section>

      <div className="repair-notice-v1"><span>●</span><strong>{notice}</strong></div>

      {visibleShips.length > 0 ? (
        <section className="repair-section-v1">
          <SectionTitle title="КОРАБЛИ" units={visibleShips.length} total={shipTotal} />
          <div className="repair-grid-v1">{renderCards(visibleShips)}</div>
        </section>
      ) : null}

      {visibleDefense.length > 0 ? (
        <section className="repair-section-v1">
          <SectionTitle title="ОБОРОНА" units={visibleDefense.length} total={defenseTotal} />
          <div className="repair-grid-v1">{renderCards(visibleDefense)}</div>
        </section>
      ) : null}

      {totalAvailable === 0 ? (
        <section className="repair-empty-v1">
          <strong>РЕМОНТНАЯ МАСТЕРСКАЯ ПУСТА</strong>
          <span>После следующего оборонительного боя доступная для восстановления техника появится здесь.</span>
        </section>
      ) : null}

      <footer className="repair-foot-v1">
        <span>Прототип: ресурсная цена временно повторяет текущую стоимость единицы в каталоге.</span>
        <span>Жетоны: временно 1 жетон за единицу до отдельной настройки баланса.</span>
      </footer>
    </section>
  );
}
