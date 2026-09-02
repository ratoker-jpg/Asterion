import { useEffect, useMemo, useState } from 'react';

import solarSatelliteArt from '../assets/source/New assets/ship/aegis/ship.aegis.solar-satellite.png';
import spyProbeArt from '../assets/source/New assets/ship/aegis/ship.aegis.spy-probe.png';
import transporterArt from '../assets/source/New assets/ship/aegis/ship.aegis.transporter.png';
import megaTransporterArt from '../assets/source/New assets/ship/aegis/ship.aegis.mega-transporter.png';
import colonizerArt from '../assets/source/New assets/ship/aegis/ship.aegis.colonizer.png';
import recyclerArt from '../assets/source/New assets/ship/aegis/ship.aegis.recycler.png';
import scoutArt from '../assets/source/New assets/ship/aegis/ship.aegis.scout.png';
import cruiserArt from '../assets/source/New assets/ship/aegis/ship.aegis.cruiser.png';
import defenderArt from '../assets/source/New assets/ship/aegis/ship.aegis.defender.png';
import battleshipArt from '../assets/source/New assets/ship/aegis/ship.aegis.battleship.png';
import destroyerArt from '../assets/source/New assets/ship/aegis/ship.aegis.destroyer.png';
import bomberArt from '../assets/source/New assets/ship/aegis/ship.aegis.bomber.png';
import deathStarArt from '../assets/source/New assets/ship/aegis/ship.aegis.death-star.png';

const SAVE_KEY = 'asterion.vertical-slice.v1';
const SHIPYARD_LEVEL = 1;

type ShipId =
  | 'solar-satellite'
  | 'spy-probe'
  | 'transporter'
  | 'mega-transporter'
  | 'colonizer'
  | 'recycler'
  | 'scout'
  | 'cruiser'
  | 'defender'
  | 'battleship'
  | 'destroyer'
  | 'bomber'
  | 'death-star';

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

type ShipCombatStats = {
  category: string;
  attack: number;
  life: number;
  weaponType: string;
  armorType: string;
  armorStrength: number;
  cargo: number;
  speed: number;
  fuel: number;
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

// Display order intentionally follows the Nemexia shipyard layout requested for Asterion:
// satellite/probe, transporters, colonizer/recycler, scout/cruiser,
// defender/battleship, destroyer/bomber, then the faction super-heavy ship.
// Aegis names/art come from the Stellar catalog; production values follow the
// corresponding blue Confederation production slots captured from Nemexia Auto v2.
const ships: ShipDefinition[] = [
  {
    id: 'solar-satellite',
    name: 'Спутник «Гелиос»',
    role: 'Солнечный спутник',
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
    role: 'Шпионский зонд',
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
    role: 'Транспортировщик',
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
    role: 'Мегатранспортировщик',
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
    role: 'Переработчик обломков',
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
  {
    id: 'scout',
    name: 'Скаут «Вектор»',
    role: 'Лёгкий боевой разведчик',
    art: scoutArt,
    owned: 10,
    metal: 2_400,
    minerals: 1_600,
    gas: 0,
    population: 2,
    time: '00:20:00',
    requiredShipyardLevel: 1,
    requirements: ['Верфь · уровень 1', 'Астрономия · уровень 1'],
  },
  {
    id: 'cruiser',
    name: 'Крейсер «Копьё»',
    role: 'Крейсер',
    art: cruiserArt,
    owned: 0,
    metal: 10_200,
    minerals: 8_400,
    gas: 0,
    population: 7,
    time: '00:25:40',
    requiredShipyardLevel: 3,
    requirements: ['Верфь · уровень 3', 'Броня кораблей · уровень 2', 'Топливные элементы · уровень 2'],
  },
  {
    id: 'defender',
    name: 'Защитник «Эгида»',
    role: 'Защитный корабль',
    art: defenderArt,
    owned: 0,
    metal: 5_300,
    minerals: 15_900,
    gas: 0,
    population: 6,
    time: '00:35:00',
    requiredShipyardLevel: 5,
    requirements: ['Верфь · уровень 5', 'Ионная наука · уровень 2', 'Топливные элементы · уровень 4'],
  },
  {
    id: 'battleship',
    name: 'Линкор «Бастион»',
    role: 'Линкор',
    art: battleshipArt,
    owned: 0,
    metal: 49_400,
    minerals: 21_200,
    gas: 0,
    population: 15,
    time: '00:55:00',
    requiredShipyardLevel: 7,
    requirements: ['Верфь · уровень 7', 'Реактивные двигатели · уровень 4'],
  },
  {
    id: 'destroyer',
    name: 'Разрушитель «Цитадель»',
    role: 'Тяжёлый эсминец',
    art: destroyerArt,
    owned: 0,
    metal: 93_900,
    minerals: 84_500,
    gas: 9_400,
    population: 30,
    time: '01:20:00',
    requiredShipyardLevel: 9,
    requirements: ['Верфь · уровень 9', 'Реактивные двигатели · уровень 6', 'Гиперпространство · уровень 5'],
  },
  {
    id: 'bomber',
    name: 'Бомбардировщик «Молот»',
    role: 'Бомбардировщик',
    art: bomberArt,
    owned: 0,
    metal: 44_000,
    minerals: 55_000,
    gas: 11_000,
    population: 22,
    time: '00:55:00',
    requiredShipyardLevel: 8,
    requirements: ['Верфь · уровень 8', 'Лазерная наука · уровень 8', 'Плазменная наука · уровень 5'],
  },
  {
    id: 'death-star',
    name: 'Планетолом «Немезида»',
    role: 'Сверхтяжёлый корабль',
    art: deathStarArt,
    owned: 0,
    metal: 2_327_500,
    minerals: 1_862_000,
    gas: 465_500,
    population: 700,
    time: '175:00:00',
    requiredShipyardLevel: 14,
    requirements: ['Верфь · уровень 14', 'Гиперпространство · уровень 13', 'Параллельные вселенные · уровень 1', 'Тяжёлая броня · уровень 10'],
  },
];

// Exact race-1 standard-ship tooltip values captured in Nemexia Auto v2:
// SafePages_Nemexia/312313/Game_nemexia/page_2026-07-26_14-06-48.html.
const shipCombatStats: Record<ShipId, ShipCombatStats> = {
  'solar-satellite': {
    category: 'Обслуживающий корабль', attack: 1, life: 2_200, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6, cargo: 0, speed: 200, fuel: 10,
  },
  'spy-probe': {
    category: 'Гражданский корабль', attack: 1, life: 1, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3, cargo: 1, speed: 200_000_000, fuel: 1,
  },
  transporter: {
    category: 'Гражданский корабль', attack: 10, life: 2_000, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3, cargo: 5_000, speed: 24_000, fuel: 12,
  },
  'mega-transporter': {
    category: 'Гражданский корабль', attack: 10, life: 7_800, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6, cargo: 20_000, speed: 19_000, fuel: 45,
  },
  colonizer: {
    category: 'Гражданский корабль', attack: 600, life: 2_400, weaponType: 'Лазер', armorType: 'Тяжелая Броня', armorStrength: 9, cargo: 7_500, speed: 5_000, fuel: 1_500,
  },
  recycler: {
    category: 'Гражданский корабль', attack: 50, life: 2_200, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6, cargo: 40_000, speed: 7_000, fuel: 120,
  },
  scout: {
    category: 'Боевой корабль', attack: 800, life: 2_400, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3, cargo: 250, speed: 28_000, fuel: 25,
  },
  cruiser: {
    category: 'Боевой корабль', attack: 3_080, life: 9_200, weaponType: 'Ион', armorType: 'Легкая Броня', armorStrength: 3, cargo: 800, speed: 32_000, fuel: 315,
  },
  defender: {
    category: 'Боевой корабль', attack: 2_760, life: 8_300, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3, cargo: 1_500, speed: 20_000, fuel: 280,
  },
  battleship: {
    category: 'Боевой корабль', attack: 9_000, life: 27_000, weaponType: 'Ион', armorType: 'Средняя Броня', armorStrength: 6, cargo: 1_500, speed: 20_000, fuel: 480,
  },
  destroyer: {
    category: 'Боевой корабль', attack: 19_500, life: 58_500, weaponType: 'Плазма', armorType: 'Тяжелая Броня', armorStrength: 9, cargo: 2_000, speed: 13_000, fuel: 900,
  },
  bomber: {
    category: 'Боевой корабль', attack: 13_200, life: 39_600, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6, cargo: 500, speed: 20_000, fuel: 800,
  },
  'death-star': {
    category: 'Боевой корабль', attack: 700_000, life: 2_100_000, weaponType: 'Ион', armorType: 'Тяжелая Броня', armorStrength: 9, cargo: 1_000_000, speed: 200, fuel: 60_000,
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
  const stats = shipCombatStats[ship.id];
  const tooltipId = `ship-stats-${ship.id}`;

  return (
    <article className={`shipyard-card-v1 ${unlocked ? '' : 'locked'}`}>
      <header className="shipyard-card-title-v1">
        <span>{ship.owned}</span>
        <strong>{ship.name}</strong>
        <button type="button" title={ship.role} aria-label={`Информация: ${ship.name}`}>i</button>
      </header>

      <div className="shipyard-card-body-v1">
        <div className="shipyard-art-v1">
          <div
            className="shipyard-art-hover-v1"
            tabIndex={0}
            aria-label={`Характеристики корабля ${ship.name}`}
            aria-describedby={tooltipId}
          >
            <img src={ship.art} alt={ship.name} draggable={false} />
            <div className="shipyard-stats-tooltip-v1" id={tooltipId} role="tooltip">
              <strong>{stats.category}</strong>
              <dl>
                <div><dt>Атака</dt><dd>{formatNumber(stats.attack)}</dd></div>
                <div><dt>Жизнь</dt><dd>{formatNumber(stats.life)}</dd></div>
                <div><dt>Тип оружия</dt><dd>{stats.weaponType}</dd></div>
                <div><dt>Тип брони</dt><dd>{stats.armorType}</dd></div>
                <div><dt>Сила брони</dt><dd>{stats.armorStrength}%</dd></div>
                <div><dt>Грузоподъемность</dt><dd>{formatNumber(stats.cargo)}</dd></div>
                <div><dt>Скорость</dt><dd>{formatNumber(stats.speed)}</dd></div>
                <div><dt>Расход топлива</dt><dd>{formatNumber(stats.fuel)}</dd></div>
              </dl>
            </div>
          </div>
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
          <p>{planetName} {coords} · полный каталог стандартных корпусов Aegis</p>
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
        <span>13 стандартных корпусов Aegis · командирские корабли находятся в отдельном разделе.</span>
        <span>Свободно населения: {Math.max(0, budget.populationMax - budget.population)} / {budget.populationMax}</span>
      </footer>
    </section>
  );
}
