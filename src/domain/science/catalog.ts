import { COMBAT_TECHNOLOGIES, type CombatTechnologyId } from '../combat/technologies.ts';
import type { ScienceCatalogItem, ScienceCategory, ScienceCategoryId } from './types.ts';

export const NEMEXIA_SCIENCE_SOURCE = Object.freeze({
  repository: 'ratoker-jpg/Nemexia_auto_v2',
  directory: 'saved_pages/наука',
  page: 'saved_pages/наука/page_2026-09-05_22-49-20.html',
  originalUrl: 'https://game.ares.nemexia.com/laboratory.php',
});

export const SCIENCE_CATEGORIES: readonly ScienceCategory[] = Object.freeze([
  { id: 'basic', label: 'ОСНОВНЫЕ НАУКИ', shortLabel: 'ОСНОВНЫЕ', description: 'Базовые исследования экономики, энергии и навигации.', sourceTab: 'TabBasic' },
  { id: 'advanced', label: 'ВЫСОКОТЕХНОЛОГИЧНЫЕ НАУКИ', shortLabel: 'ВЫСОКИЕ', description: 'Разведка, системы, броня, двигатели и оружейные науки.', sourceTab: 'TabAdvanced' },
  { id: 'master', label: 'ЭКСПЕРТНЫЕ НАУКИ', shortLabel: 'ЭКСПЕРТНЫЕ', description: 'Поздние пространственные, строительные и броневые исследования.', sourceTab: 'TabMaster' },
  { id: 'additional', label: 'ДОПОЛНИТЕЛЬНЫЕ НАУКИ', shortLabel: 'ДОПОЛНИТ.', description: 'Специализация боя. В Nemexia можно выбрать только одно направление.', sourceTab: 'TabAdditional', exclusiveChoice: true },
]);

type RawScience = {
  sourceScienceId: number;
  slug: string;
  name: string;
  categoryId: ScienceCategoryId;
  description: string;
  snapshotLevel: number;
  snapshotCost: { metal: number; crystal: number; gas: number; energy: number };
  snapshotTime: string;
  requiredLaboratoryLevel: number;
  requirements: readonly { sourceScienceId: number; level: number }[];
};

const RAW_NEMEXIA_SCIENCES: readonly RawScience[] = [
  { sourceScienceId: 1, slug: 'physics', name: 'Физика', categoryId: 'basic', description: 'Повышает доход энергии на 5%', snapshotLevel: 6, snapshotCost: { metal: 64000, crystal: 32000, gas: 5000, energy: 0 }, snapshotTime: '02:08:59', requiredLaboratoryLevel: 1, requirements: [] },
  { sourceScienceId: 2, slug: 'chemistry', name: 'Химия', categoryId: 'basic', description: 'Снижает потребление газа при отправке экипажей на 5%', snapshotLevel: 5, snapshotCost: { metal: 12800, crystal: 6400, gas: 1600, energy: 0 }, snapshotTime: '00:16:58', requiredLaboratoryLevel: 3, requirements: [] },
  { sourceScienceId: 3, slug: 'mathematics', name: 'Математика', categoryId: 'basic', description: 'Повышает доход ресурсов на 5%', snapshotLevel: 6, snapshotCost: { metal: 64000, crystal: 25600, gas: 4000, energy: 0 }, snapshotTime: '00:32:52', requiredLaboratoryLevel: 1, requirements: [] },
  { sourceScienceId: 4, slug: 'astronomy', name: 'Астрономия', categoryId: 'basic', description: 'Повышает скорость кораблей на 10%', snapshotLevel: 6, snapshotCost: { metal: 32000, crystal: 0, gas: 32000, energy: 0 }, snapshotTime: '00:54:47', requiredLaboratoryLevel: 2, requirements: [] },

  { sourceScienceId: 5, slug: 'espionage', name: 'Шпионаж', categoryId: 'advanced', description: 'Разблокирует разведку', snapshotLevel: 4, snapshotCost: { metal: 800, crystal: 1600, gas: 800, energy: 0 }, snapshotTime: '00:23:08', requiredLaboratoryLevel: 4, requirements: [{ sourceScienceId: 4, level: 2 }] },
  { sourceScienceId: 6, slug: 'computer-systems', name: 'Компьютерные системы', categoryId: 'advanced', description: 'Повышает количество возможных полетов на 1.5', snapshotLevel: 2, snapshotCost: { metal: 0, crystal: 1000, gas: 2000, energy: 0 }, snapshotTime: '00:04:28', requiredLaboratoryLevel: 4, requirements: [{ sourceScienceId: 4, level: 1 }] },
  { sourceScienceId: 7, slug: 'ship-armor', name: 'Броня кораблей', categoryId: 'advanced', description: 'Повышает запас здоровья всех юнитов на 10%', snapshotLevel: 0, snapshotCost: { metal: 100, crystal: 50, gas: 0, energy: 0 }, snapshotTime: '00:04:06', requiredLaboratoryLevel: 5, requirements: [{ sourceScienceId: 1, level: 4 }] },
  { sourceScienceId: 8, slug: 'fuel-cells', name: 'Топливные элементы', categoryId: 'advanced', description: 'Повышает скорость кораблей на 15%', snapshotLevel: 0, snapshotCost: { metal: 500, crystal: 1000, gas: 200, energy: 0 }, snapshotTime: '00:01:54', requiredLaboratoryLevel: 6, requirements: [{ sourceScienceId: 2, level: 4 }] },
  { sourceScienceId: 9, slug: 'jet-engines', name: 'Реактивные двигатели', categoryId: 'advanced', description: 'Повышает скорость кораблей на 15%', snapshotLevel: 0, snapshotCost: { metal: 0, crystal: 1000, gas: 500, energy: 0 }, snapshotTime: '00:07:35', requiredLaboratoryLevel: 7, requirements: [{ sourceScienceId: 2, level: 6 }, { sourceScienceId: 7, level: 5 }] },
  { sourceScienceId: 10, slug: 'laser-science', name: 'Лазерная наука', categoryId: 'advanced', description: 'Повышает урон от лазерных атак всех юнитов на 15%', snapshotLevel: 0, snapshotCost: { metal: 200, crystal: 100, gas: 0, energy: 0 }, snapshotTime: '00:01:35', requiredLaboratoryLevel: 8, requirements: [{ sourceScienceId: 3, level: 3 }] },
  { sourceScienceId: 11, slug: 'ion-science', name: 'Ионная наука', categoryId: 'advanced', description: 'Повышает урон от ионных атак всех юнитов на 15%', snapshotLevel: 0, snapshotCost: { metal: 500, crystal: 250, gas: 50, energy: 0 }, snapshotTime: '00:03:10', requiredLaboratoryLevel: 8, requirements: [{ sourceScienceId: 3, level: 5 }, { sourceScienceId: 10, level: 5 }] },
  { sourceScienceId: 12, slug: 'plasma-science', name: 'Плазменная наука', categoryId: 'advanced', description: 'Повышает урон от плазменных атак всех юнитов на 15%', snapshotLevel: 0, snapshotCost: { metal: 1000, crystal: 1000, gas: 1000, energy: 0 }, snapshotTime: '00:04:44', requiredLaboratoryLevel: 8, requirements: [{ sourceScienceId: 3, level: 7 }, { sourceScienceId: 10, level: 10 }, { sourceScienceId: 11, level: 5 }] },
  { sourceScienceId: 13, slug: 'ecology', name: 'Экология', categoryId: 'advanced', description: 'Повышает доход озона на 250', snapshotLevel: 10, snapshotCost: { metal: 115330, crystal: 86498, gas: 28833, energy: 0 }, snapshotTime: '02:11:42', requiredLaboratoryLevel: 4, requirements: [{ sourceScienceId: 1, level: 3 }, { sourceScienceId: 2, level: 3 }] },

  { sourceScienceId: 14, slug: 'hyperspace', name: 'Гиперпространство', categoryId: 'master', description: 'Повышает скорость кораблей на 20%', snapshotLevel: 0, snapshotCost: { metal: 2500, crystal: 3750, gas: 1500, energy: 0 }, snapshotTime: '00:09:10', requiredLaboratoryLevel: 10, requirements: [{ sourceScienceId: 9, level: 3 }] },
  { sourceScienceId: 15, slug: 'parallel-universes', name: 'Параллельные вселенные', categoryId: 'master', description: 'Разблокирует строительство кораблей мастера', snapshotLevel: 0, snapshotCost: { metal: 0, crystal: 0, gas: 0, energy: 250000 }, snapshotTime: '205:24:00', requiredLaboratoryLevel: 15, requirements: [{ sourceScienceId: 1, level: 10 }, { sourceScienceId: 3, level: 10 }, { sourceScienceId: 4, level: 15 }] },
  { sourceScienceId: 17, slug: 'improved-construction', name: 'Улучшенное строительство', categoryId: 'master', description: 'Снижает ресурсную стоимость построек на 1%', snapshotLevel: 0, snapshotCost: { metal: 10000, crystal: 5000, gas: 0, energy: 0 }, snapshotTime: '00:26:33', requiredLaboratoryLevel: 4, requirements: [{ sourceScienceId: 1, level: 5 }, { sourceScienceId: 3, level: 5 }] },
  { sourceScienceId: 21, slug: 'light-armor', name: 'Легкая Броня', categoryId: 'master', description: 'Повышает легкую броню всех юнитов на 1%', snapshotLevel: 0, snapshotCost: { metal: 1000, crystal: 500, gas: 250, energy: 0 }, snapshotTime: '00:03:19', requiredLaboratoryLevel: 8, requirements: [{ sourceScienceId: 10, level: 2 }] },
  { sourceScienceId: 22, slug: 'medium-armor', name: 'Средняя Броня', categoryId: 'master', description: 'Повышает среднюю броню всех юнитов на 2%', snapshotLevel: 0, snapshotCost: { metal: 1300, crystal: 650, gas: 325, energy: 0 }, snapshotTime: '00:03:19', requiredLaboratoryLevel: 9, requirements: [{ sourceScienceId: 11, level: 2 }] },
  { sourceScienceId: 23, slug: 'heavy-armor', name: 'Тяжелая Броня', categoryId: 'master', description: 'Повышает тяжелую броню всех юнитов на 3%', snapshotLevel: 0, snapshotCost: { metal: 1600, crystal: 800, gas: 400, energy: 0 }, snapshotTime: '00:03:19', requiredLaboratoryLevel: 10, requirements: [{ sourceScienceId: 12, level: 2 }] },

  { sourceScienceId: 18, slug: 'piercing-attack', name: 'Пробивающая атака', categoryId: 'additional', description: 'Повышает атаку кораблей на 5%', snapshotLevel: 0, snapshotCost: { metal: 50000, crystal: 25000, gas: 5000, energy: 0 }, snapshotTime: '00:28:03', requiredLaboratoryLevel: 20, requirements: [{ sourceScienceId: 10, level: 10 }, { sourceScienceId: 11, level: 7 }, { sourceScienceId: 12, level: 5 }] },
  { sourceScienceId: 19, slug: 'maneuver-defense', name: 'Маневренная защита', categoryId: 'additional', description: 'Повышает запас прочности кораблей на 5%', snapshotLevel: 0, snapshotCost: { metal: 0, crystal: 50000, gas: 5000, energy: 0 }, snapshotTime: '00:28:03', requiredLaboratoryLevel: 20, requirements: [{ sourceScienceId: 7, level: 10 }, { sourceScienceId: 23, level: 5 }] },
  { sourceScienceId: 20, slug: 'critical-hit', name: 'Критический удар', categoryId: 'additional', description: 'Повышает шансы на критическую атаку на 1%', snapshotLevel: 0, snapshotCost: { metal: 50000, crystal: 30000, gas: 0, energy: 0 }, snapshotTime: '00:28:03', requiredLaboratoryLevel: 20, requirements: [{ sourceScienceId: 10, level: 7 }, { sourceScienceId: 11, level: 7 }, { sourceScienceId: 12, level: 7 }] },
] as const;

const COMBAT_BY_SOURCE_ID: Partial<Record<number, CombatTechnologyId>> = {
  7: 'shipArmor',
  10: 'laserScience',
  11: 'ionScience',
  12: 'plasmaScience',
  18: 'piercingAttack',
  19: 'maneuverDefense',
  20: 'criticalHit',
  21: 'lightArmor',
  22: 'mediumArmor',
  23: 'heavyArmor',
};

const SOURCE_NOTE = `Наименование, раздел, описание, требования и стоимость следующего уровня взяты из ${NEMEXIA_SCIENCE_SOURCE.repository}/${NEMEXIA_SCIENCE_SOURCE.page}. Уровень/стоимость/время — значения сохранённого снимка Nemexia, а не прогресс кампании Asterion.`;

export const SCIENCE_CATALOG: readonly ScienceCatalogItem[] = Object.freeze(RAW_NEMEXIA_SCIENCES.map((science) => {
  const combatTechnologyId = COMBAT_BY_SOURCE_ID[science.sourceScienceId];
  if (combatTechnologyId) {
    const combat = COMBAT_TECHNOLOGIES.find((technology) => technology.id === combatTechnologyId);
    if (combat && combat.sourceScienceId !== science.sourceScienceId) {
      throw new Error(`Combat science mapping mismatch for ${combatTechnologyId}`);
    }
  }
  return Object.freeze({
    id: `science-${science.sourceScienceId}`,
    sourceScienceId: science.sourceScienceId,
    slug: science.slug,
    name: science.name,
    categoryId: science.categoryId,
    description: science.description,
    snapshotLevel: science.snapshotLevel,
    snapshotNextLevel: science.snapshotLevel + 1,
    snapshotCost: Object.freeze({ ...science.snapshotCost }),
    snapshotTime: science.snapshotTime,
    requiredLaboratoryLevel: science.requiredLaboratoryLevel,
    requirements: Object.freeze(science.requirements.map((requirement) => Object.freeze({ scienceId: `science-${requirement.sourceScienceId}`, level: requirement.level }))),
    sourceStatus: 'nemexia-saved-page' as const,
    sourceNote: SOURCE_NOTE,
    ...(combatTechnologyId ? { combatTechnologyId } : {}),
  });
}));
