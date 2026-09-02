import { useEffect, useMemo, useState } from 'react';

import transporterArt from '../assets/source/New assets/ship/aegis/ship.aegis.transporter.png';
import megaTransporterArt from '../assets/source/New assets/ship/aegis/ship.aegis.mega-transporter.png';
import colonizerArt from '../assets/source/New assets/ship/aegis/ship.aegis.colonizer.png';
import recyclerArt from '../assets/source/New assets/ship/aegis/ship.aegis.recycler.png';
import spyProbeArt from '../assets/source/New assets/ship/aegis/ship.aegis.spy-probe.png';
import solarSatelliteArt from '../assets/source/New assets/ship/aegis/ship.aegis.solar-satellite.png';

const SAVE_KEY = 'asterion.vertical-slice.v1';
const SHIPYARD_LEVEL = 1;

type ShipId = 'solar-satellite' | 'spy-probe' | 'transporter' | 'mega-transporter' | 'colonizer' | 'recycler';

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
  requirements: string[];
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

// Aegis names come from the Stellar catalog. Cost/time/requirements follow the
// blue Confederation production slots captured from Nemexia Auto v2.
const ships: ShipDefinition[] = [
  {
    id: 'solar-satellite',
    name: 'Спутник «Гелиос»',
    role: 'Обслуживающий корабль',
    art: solarSatelliteArt,
    owned: 0,
    metal: 500,
    minerals: 2_000,
    gas: 500,
    population: 1,
    time: '00:02:30',
    requiredShipyardLevel: 1,
    requirements: ['Верфь · уровень 1'],
  },
  {
    id: 'spy-probe',
    name: 'Зонд «Призма»',
    role: 'Разведывательный зонд',
    art: spyProbeArt,
    owned: 0,
    metal: 0,
    minerals: 1_000,
    gas: 0,
    population: 1,
    time: '00:01:00',
    requiredShipyardLevel: 3,
    requirements: ['Верфь · уровень 3', 'Топливные элементы · уровень 3', 'Шпионаж · уровень 2'],
  },
  {
    id: 'transporter',
    name: 'Транспорт «Тракт»',
    role: 'Малый транспорт',
    art: transporterArt,
    owned: 0,
    metal: 2_400,
    minerals: 1_400,
    gas: 0,
    population: 1,
    time: '00:10:00',
    requiredShipyardLevel: 2,
    requirements: ['Верфь · уровень 2', 'Математика · уровень 2'],
  },
  {
    id: 'mega-transporter',
    name: 'Мегатранспорт «Артерия»',
    role: 'Тяжёлый транспорт',
    art: megaTransporterArt,
    owned: 0,
    metal: 6_400,
    minerals: 5_000,
    gas: 0,
    population: 3,
    time: '00:20:00',
    requiredShipyardLevel: 4,
    requirements: ['Верфь · уровень 4', 'Астрономия · уровень 6'],
  },
  {
    id: 'colonizer',
    name: 'Колонизатор «Форпост»',
    role: 'Колониальный корабль',
    art: colonizerArt,
    owned: 0,
    metal: 12_500,
    minerals: 25_000,
    gas: 10_600,
    population: 12,
    time: '00:58:00',
    requiredShipyardLevel: 4,
    requirements: ['Верфь · уровень 4', 'Топливные элементы · уровень 3'],
  },
  {
    id: 'recycler',
    name: 'Переработчик «Сборщик»',
    role: 'Сборщик обломков',
    art: recyclerArt,
    owned: 0,
    metal: 10_500,
    minerals: 5_300,
    gas: 1_800,
    population: 5,
    time: '00:41:40',
    requiredShipyardLevel: 4,
    requirements: ['Верфь · уровень 4', 'Топливные элементы · уровень 6', 'Броня кораблей · уровень 2'],
  },
];

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

function calculateMax(ship: ShipDefinition, budget: ShipyardBudget) {
  const limits: number[] = [];
  if (ship.metal > 0) limits.push(Math.floor(budget.metal / ship.metal));
  if (ship.minerals > 0) limits.push(Math.floor(budget.minerals / ship.minerals));
  if (ship.gas > 0) limits.push(Math.floor(budget.gas / ship.gas));
  if (ship.population > 0) limits.push(Math.floor(Math.max(0, budget.populationMax - budget.population) / ship.population));
  return Math.max(0, Math.min(999, ...(limits.length ? limits : [0])));
}

function CostRow({ code, label, value }: { code: string; label: string; value: number }) {
  return (
    <div className="shipyard-cost-row-v1" title={label}>
      <span>{code}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function ShipCard({
  ship,
  quantity,
  budget,
  onQuantity,
  onBuild,
}: {
  ship: ShipDefinition;
  quantity: number;
  budget: ShipyardBudget;
  onQuantity: (ship: ShipDefinition, quantity: number) => void;
  onBuild: (ship: ShipDefinition, quantity: number) => void;
}) {
  const unlocked = ship.requiredShipyardLevel <= SHIPYARD_LEVEL;
  const max = unlocked ? calculateMax(ship, budget) : 0;

  return (
    <article className={`shipyard-card-v1 ${unlocked ? '' : 'locked'}`}>
      <header className="shipyard-card-title-v1">
        <span>{ship.owned}</span>
        <strong>{ship.name}</strong>
        <button type="button" title={ship.role} aria-label={`Информация: ${ship.name}`}>i</button>
      </header>

      <div className="shipyard-card-body-v1">
        <div className="shipyard-art-v1">
          <img src={ship.art} alt={ship.name} draggable={false} />
          <small>Время за единицу</small>
          <b>{ship.time}</b>
        </div>

        <div className="shipyard-card-data-v1">
          <div className="shipyard-costs-v1">
            <CostRow code="M" label="Металл" value={ship.metal} />
            <CostRow code="C" label="Минералы" value={ship.minerals} />
            <CostRow code="G" label="Газ" value={ship.gas} />
            <CostRow code="P" label="Население" value={ship.population} />
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
              <strong>НЕДОСТУПНО</strong>
              {ship.requirements.map((requirement) => <span key={requirement}>{requirement}</span>)}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function ShipyardView({ planetName, coords, onBack }: { planetName: string; coords: string; onBack: () => void }) {
  const budget = useMemo(readBudget, []);
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
    const max = calculateMax(ship, budget);
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : 0;
    setQuantities((current) => ({ ...current, [ship.id]: next }));
  };

  const prepareBuild = (ship: ShipDefinition, quantity: number) => {
    setProcess(`${quantity} × ${ship.name} подготовлено к постановке в очередь. Реальное списание ресурсов подключим вместе с системой производства.`);
  };

  return (
    <section className="shipyard-view-v1">
      <header className="shipyard-page-head-v1">
        <div>
          <small>ОРБИТАЛЬНАЯ ВЕРФЬ · УРОВЕНЬ {SHIPYARD_LEVEL}</small>
          <h2>КОРАБЛИ</h2>
          <p>{planetName} {coords} · гражданские и обслуживающие корпуса Aegis</p>
        </div>
        <button type="button" onClick={onBack}>← К ФЛОТАМ</button>
      </header>

      <section className="shipyard-processes-v1">
        <strong>ТЕКУЩИЕ ПРОЦЕССЫ</strong>
        <span>{process ?? 'Очередь верфи пуста.'}</span>
      </section>

      <div className="shipyard-grid-v1">
        {ships.map((ship) => (
          <ShipCard
            key={ship.id}
            ship={ship}
            quantity={quantities[ship.id] ?? 0}
            budget={budget}
            onQuantity={setQuantity}
            onBuild={prepareBuild}
          />
        ))}
      </div>

      <footer className="shipyard-page-foot-v1">
        <span>Корабли боевого класса будут вынесены в отдельный раздел «Боевые корабли».</span>
        <span>Свободно населения: {Math.max(0, budget.populationMax - budget.population)} / {budget.populationMax}</span>
      </footer>
    </section>
  );
}
