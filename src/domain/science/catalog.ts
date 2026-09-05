import { COMBAT_TECHNOLOGIES, type CombatTechnologyId } from '../combat/technologies.ts';
import type { ScienceCatalogItem, ScienceCategory, ScienceCategoryId, ScienceEffectMeta, ScienceVisualLink } from './types.ts';

export const STELLAR_RESEARCH_SOURCE = Object.freeze({
  repository: 'ratoker-jpg/stellar-empires',
  commit: '466ec55f1751d36fd4a30175f7669f89ebe9a6a6',
  path: 'src/simulation/research/completeResearchCatalog.ts',
});

export const SCIENCE_CATEGORIES: readonly ScienceCategory[] = Object.freeze([
  { id: 'energy', label: 'ЭНЕРГЕТИКА', shortLabel: 'ЭНЕРГИЯ', description: 'Фундаментальная физика, химия и топливные системы.' },
  { id: 'infrastructure', label: 'ИНФРАСТРУКТУРА', shortLabel: 'ИНФРА', description: 'Вычисления, исследования, строительство и экология.' },
  { id: 'navigation', label: 'НАВИГАЦИЯ', shortLabel: 'НАВИГАЦИЯ', description: 'Астрономия, двигатели и технологии дальнего пространства.' },
  { id: 'intelligence', label: 'РАЗВЕДКА', shortLabel: 'РАЗВЕДКА', description: 'Сенсоры, шпионаж и глубина разведывательных данных.' },
  { id: 'defense', label: 'ОБОРОНА', shortLabel: 'ОБОРОНА', description: 'Броня и технологии повышения живучести.' },
  { id: 'weapons', label: 'ВООРУЖЕНИЕ', shortLabel: 'ОРУЖИЕ', description: 'Лазерные, ионные, плазменные и ударные технологии.' },
]);

type RawScience = {
  slug: string;
  name: string;
  categoryId: ScienceCategoryId;
  description: string;
  maxLevel: number;
  baseCost: { metal: number; crystal: number; gas: number };
  baseSeconds: number;
  requiredLaboratoryLevel: number;
  requirements: readonly { slug: string; level: number }[];
  effects: readonly ScienceEffectMeta[];
};

const RAW_STELLAR_SCIENCES: readonly RawScience[] = [
  { slug: 'physics', name: 'Физика', categoryId: 'energy', description: 'Фундаментальная наука об энергии и материи. Повышает выход энергетических установок.', maxLevel: 10, baseCost: { metal: 320, crystal: 420, gas: 80 }, baseSeconds: 180, requiredLaboratoryLevel: 1, requirements: [], effects: [{ type: 'ENERGY_OUTPUT', valueLabel: '+2%/уровень' }] },
  { slug: 'chemistry', name: 'Химия', categoryId: 'energy', description: 'Совершенствует топливо, реакционные смеси и переработку энергетического сырья.', maxLevel: 10, baseCost: { metal: 300, crystal: 470, gas: 120 }, baseSeconds: 210, requiredLaboratoryLevel: 1, requirements: [{ slug: 'physics', level: 1 }], effects: [{ type: 'FUEL_EFFICIENCY', valueLabel: '+3%/уровень' }] },
  { slug: 'mathematics', name: 'Математика', categoryId: 'infrastructure', description: 'Улучшает вычислительные модели, планирование исследований и инженерные расчёты.', maxLevel: 10, baseCost: { metal: 280, crystal: 560, gas: 100 }, baseSeconds: 240, requiredLaboratoryLevel: 1, requirements: [{ slug: 'physics', level: 1 }], effects: [{ type: 'RESEARCH_SPEED', valueLabel: '+4%/уровень' }] },
  { slug: 'astronomy', name: 'Астрономия', categoryId: 'navigation', description: 'Уточняет маршруты, небесную механику и расчёт дальних перелётов.', maxLevel: 10, baseCost: { metal: 360, crystal: 620, gas: 180 }, baseSeconds: 300, requiredLaboratoryLevel: 2, requirements: [{ slug: 'mathematics', level: 1 }], effects: [{ type: 'FLEET_SPEED', valueLabel: '+3%/уровень' }] },
  { slug: 'espionage', name: 'Шпионаж', categoryId: 'intelligence', description: 'Повышает глубину разведданных и точность обнаружения вражеских операций.', maxLevel: 10, baseCost: { metal: 340, crystal: 700, gas: 220 }, baseSeconds: 360, requiredLaboratoryLevel: 2, requirements: [{ slug: 'mathematics', level: 2 }, { slug: 'astronomy', level: 1 }], effects: [{ type: 'SENSOR_STRENGTH', valueLabel: '+1/уровень' }] },
  { slug: 'computer-systems', name: 'Компьютерные системы', categoryId: 'infrastructure', description: 'Каждый уровень добавляет один параллельный канал управления полётами.', maxLevel: 10, baseCost: { metal: 420, crystal: 760, gas: 200 }, baseSeconds: 390, requiredLaboratoryLevel: 2, requirements: [{ slug: 'mathematics', level: 2 }], effects: [{ type: 'FLIGHT_SLOTS', valueLabel: '+1 слот/уровень' }] },
  { slug: 'ship-armor', name: 'Корабельная броня', categoryId: 'defense', description: 'Повышает стойкость корпусов кораблей и планетарных защитных сооружений.', maxLevel: 10, baseCost: { metal: 650, crystal: 400, gas: 180 }, baseSeconds: 420, requiredLaboratoryLevel: 2, requirements: [{ slug: 'physics', level: 2 }], effects: [{ type: 'ARMOR_STRENGTH', valueLabel: '+2%/уровень' }] },
  { slug: 'fuel-cells', name: 'Топливные элементы', categoryId: 'energy', description: 'Повышает запас полезной энергии топлива и сокращает расход в перелётах.', maxLevel: 10, baseCost: { metal: 430, crystal: 540, gas: 360 }, baseSeconds: 450, requiredLaboratoryLevel: 2, requirements: [{ slug: 'chemistry', level: 2 }], effects: [{ type: 'FUEL_EFFICIENCY', valueLabel: '+4%/уровень' }] },
  { slug: 'jet-engines', name: 'Реактивные двигатели', categoryId: 'navigation', description: 'Увеличивает маршевую скорость кораблей с реактивными двигательными контурами.', maxLevel: 10, baseCost: { metal: 560, crystal: 520, gas: 420 }, baseSeconds: 510, requiredLaboratoryLevel: 3, requirements: [{ slug: 'fuel-cells', level: 1 }, { slug: 'astronomy', level: 1 }], effects: [{ type: 'FLEET_SPEED', valueLabel: '+5%/уровень' }] },
  { slug: 'laser-science', name: 'Лазерная технология', categoryId: 'weapons', description: 'Открывает и усиливает лазерные боевые системы.', maxLevel: 10, baseCost: { metal: 520, crystal: 650, gas: 260 }, baseSeconds: 540, requiredLaboratoryLevel: 3, requirements: [{ slug: 'physics', level: 2 }, { slug: 'mathematics', level: 1 }], effects: [{ type: 'WEAPON_STRENGTH', valueLabel: '+2%/уровень' }] },
  { slug: 'ion-science', name: 'Ионная технология', categoryId: 'weapons', description: 'Открывает и усиливает ионное вооружение против тяжёлых целей.', maxLevel: 10, baseCost: { metal: 620, crystal: 780, gas: 390 }, baseSeconds: 630, requiredLaboratoryLevel: 4, requirements: [{ slug: 'laser-science', level: 2 }, { slug: 'chemistry', level: 2 }], effects: [{ type: 'WEAPON_STRENGTH', valueLabel: '+3%/уровень' }] },
  { slug: 'plasma-science', name: 'Плазменная технология', categoryId: 'weapons', description: 'Открывает наиболее мощные плазменные орудия поздней стадии развития.', maxLevel: 10, baseCost: { metal: 780, crystal: 920, gas: 560 }, baseSeconds: 750, requiredLaboratoryLevel: 5, requirements: [{ slug: 'ion-science', level: 3 }, { slug: 'physics', level: 4 }], effects: [{ type: 'WEAPON_STRENGTH', valueLabel: '+4%/уровень' }] },
  { slug: 'ecology', name: 'Экология', categoryId: 'infrastructure', description: 'Исследует устойчивость планетарной инфраструктуры; отдельный игровой бонус в текущей Stellar-модели не заявлен.', maxLevel: 10, baseCost: { metal: 500, crystal: 700, gas: 300 }, baseSeconds: 600, requiredLaboratoryLevel: 3, requirements: [{ slug: 'chemistry', level: 3 }], effects: [] },
  { slug: 'hyperspace', name: 'Гиперпространство', categoryId: 'navigation', description: 'Открывает дальние гиперпространственные маршруты и ускоряет тяжёлые флоты.', maxLevel: 10, baseCost: { metal: 820, crystal: 1020, gas: 720 }, baseSeconds: 840, requiredLaboratoryLevel: 5, requirements: [{ slug: 'astronomy', level: 3 }, { slug: 'jet-engines', level: 3 }], effects: [{ type: 'FLEET_SPEED', valueLabel: '+4%/уровень' }] },
  { slug: 'parallel-universes', name: 'Параллельные вселенные', categoryId: 'navigation', description: 'Поздняя пространственная теория. Каждый уровень также увеличивает предел колоний на одну.', maxLevel: 5, baseCost: { metal: 2200, crystal: 2500, gas: 1600 }, baseSeconds: 1200, requiredLaboratoryLevel: 6, requirements: [{ slug: 'hyperspace', level: 4 }, { slug: 'mathematics', level: 5 }], effects: [{ type: 'RESEARCH_SPEED', valueLabel: '+3%/уровень' }] },
  { slug: 'improved-construction', name: 'Улучшенное строительство', categoryId: 'infrastructure', description: 'Оптимизирует проектирование и сокращает время возведения инфраструктуры.', maxLevel: 10, baseCost: { metal: 740, crystal: 620, gas: 260 }, baseSeconds: 660, requiredLaboratoryLevel: 4, requirements: [{ slug: 'mathematics', level: 3 }, { slug: 'physics', level: 3 }], effects: [{ type: 'CONSTRUCTION_SPEED', valueLabel: '+5%/уровень' }] },
  { slug: 'piercing-attack', name: 'Пробивающая атака', categoryId: 'weapons', description: 'Повышает способность вооружения преодолевать броню противника.', maxLevel: 10, baseCost: { metal: 760, crystal: 820, gas: 480 }, baseSeconds: 720, requiredLaboratoryLevel: 4, requirements: [{ slug: 'laser-science', level: 3 }, { slug: 'ship-armor', level: 2 }], effects: [{ type: 'ARMOR_PENETRATION', valueLabel: '+2%/уровень' }] },
  { slug: 'maneuver-defense', name: 'Маневренная защита', categoryId: 'defense', description: 'Повышает живучесть кораблей и обороны на 5% за уровень, максимум на 50%.', maxLevel: 10, baseCost: { metal: 720, crystal: 860, gas: 520 }, baseSeconds: 750, requiredLaboratoryLevel: 4, requirements: [{ slug: 'ship-armor', level: 3 }, { slug: 'astronomy', level: 2 }], effects: [{ type: 'SHIP_DURABILITY', valueLabel: '+5%/уровень' }] },
  { slug: 'critical-hit', name: 'Критический удар', categoryId: 'weapons', description: 'Повышает шанс критического удара; итоговый бонус ограничен двенадцатью процентами.', maxLevel: 10, baseCost: { metal: 900, crystal: 1050, gas: 620 }, baseSeconds: 870, requiredLaboratoryLevel: 5, requirements: [{ slug: 'mathematics', level: 4 }, { slug: 'laser-science', level: 4 }], effects: [{ type: 'CRITICAL_CHANCE', valueLabel: '+120 б.п./уровень' }] },
  { slug: 'light-armor', name: 'Лёгкая броня', categoryId: 'defense', description: 'Открывает лёгкую броню с базовым профилем защиты 3%.', maxLevel: 1, baseCost: { metal: 480, crystal: 360, gas: 140 }, baseSeconds: 360, requiredLaboratoryLevel: 2, requirements: [{ slug: 'ship-armor', level: 1 }], effects: [{ type: 'ARMOR_STRENGTH', valueLabel: '3%' }] },
  { slug: 'medium-armor', name: 'Средняя броня', categoryId: 'defense', description: 'Открывает среднюю броню с базовым профилем защиты 6%.', maxLevel: 1, baseCost: { metal: 760, crystal: 540, gas: 260 }, baseSeconds: 510, requiredLaboratoryLevel: 3, requirements: [{ slug: 'light-armor', level: 1 }, { slug: 'ship-armor', level: 3 }], effects: [{ type: 'ARMOR_STRENGTH', valueLabel: '6%' }] },
  { slug: 'heavy-armor', name: 'Тяжёлая броня', categoryId: 'defense', description: 'Открывает тяжёлую броню с базовым профилем защиты 9%.', maxLevel: 1, baseCost: { metal: 1100, crystal: 820, gas: 480 }, baseSeconds: 720, requiredLaboratoryLevel: 5, requirements: [{ slug: 'medium-armor', level: 1 }, { slug: 'plasma-science', level: 2 }], effects: [{ type: 'ARMOR_STRENGTH', valueLabel: '9%' }] },
] as const;

const COMBAT_BY_SLUG: Partial<Record<string, CombatTechnologyId>> = {
  'laser-science': 'laserScience',
  'ion-science': 'ionScience',
  'plasma-science': 'plasmaScience',
  'piercing-attack': 'piercingAttack',
  'light-armor': 'lightArmor',
  'medium-armor': 'mediumArmor',
  'heavy-armor': 'heavyArmor',
  'ship-armor': 'shipArmor',
  'maneuver-defense': 'maneuverDefense',
  'critical-hit': 'criticalHit',
};

const SOURCE_NOTE = `Полный текущий каталог взят из ${STELLAR_RESEARCH_SOURCE.repository}@${STELLAR_RESEARCH_SOURCE.commit}. Исследовательский runtime Asterion в этом PR не запускается.`;

export const SCIENCE_CATALOG: readonly ScienceCatalogItem[] = Object.freeze(RAW_STELLAR_SCIENCES.map((technology) => {
  const combatTechnologyId = COMBAT_BY_SLUG[technology.slug];
  const combat = combatTechnologyId ? COMBAT_TECHNOLOGIES.find((item) => item.id === combatTechnologyId) : undefined;
  return Object.freeze({
    id: `science-${technology.slug}`,
    slug: technology.slug,
    name: technology.name,
    categoryId: technology.categoryId,
    description: technology.description,
    maxLevel: technology.maxLevel,
    baseCost: Object.freeze({ ...technology.baseCost }),
    baseSeconds: technology.baseSeconds,
    requiredLaboratoryLevel: technology.requiredLaboratoryLevel,
    requirements: Object.freeze(technology.requirements.map((requirement) => Object.freeze({ scienceId: `science-${requirement.slug}`, level: requirement.level }))),
    effects: Object.freeze(technology.effects.map((effect) => Object.freeze({ ...effect }))),
    sourceStatus: 'stellar-current' as const,
    sourceNote: SOURCE_NOTE,
    ...(combatTechnologyId ? { combatTechnologyId, sourceScienceId: combat?.sourceScienceId } : {}),
  });
}));

export const SCIENCE_VISUAL_LINKS: readonly ScienceVisualLink[] = Object.freeze(SCIENCE_CATALOG.flatMap((item) => item.requirements.map((requirement) => Object.freeze({
  from: requirement.scienceId,
  to: item.id,
  requiredLevel: requirement.level,
  sourceBacked: true as const,
}))));
