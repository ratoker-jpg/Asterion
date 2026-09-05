import { COMBAT_TECHNOLOGIES, type CombatTechnologyId } from '../combat/technologies.ts';
import type { ScienceCatalogItem, ScienceCategory, ScienceCategoryId, ScienceVisualLink } from './types.ts';

export const SCIENCE_CATEGORIES: readonly ScienceCategory[] = Object.freeze([
  {
    id: 'weapon-sciences',
    label: 'ОРУЖЕЙНЫЕ НАУКИ',
    description: 'Подтверждённые входы симулятора, связанные с типами атаки и ударными параметрами.',
    presentationOnly: true,
  },
  {
    id: 'armor-sciences',
    label: 'БРОНЕЗАЩИТА',
    description: 'Подтверждённые входы симулятора, связанные с бронёй и защитой кораблей.',
    presentationOnly: true,
  },
  {
    id: 'maneuver-sciences',
    label: 'МАНЕВРЕННАЯ ЗАЩИТА',
    description: 'Отдельный визуальный раздел для подтверждённой науки маневренной защиты.',
    presentationOnly: true,
  },
]);

type PresentationMeta = {
  categoryId: ScienceCategoryId;
  x: number;
  y: number;
};

/**
 * Layout metadata only. These positions/categories make the Science screen
 * readable; they do not define prerequisites, balance or research rules.
 */
const PRESENTATION_BY_TECH: Record<CombatTechnologyId, PresentationMeta> = {
  laserScience: { categoryId: 'weapon-sciences', x: 15, y: 20 },
  ionScience: { categoryId: 'weapon-sciences', x: 39, y: 18 },
  plasmaScience: { categoryId: 'weapon-sciences', x: 64, y: 24 },
  piercingAttack: { categoryId: 'weapon-sciences', x: 28, y: 52 },
  criticalHit: { categoryId: 'weapon-sciences', x: 57, y: 56 },
  lightArmor: { categoryId: 'armor-sciences', x: 16, y: 24 },
  mediumArmor: { categoryId: 'armor-sciences', x: 40, y: 20 },
  heavyArmor: { categoryId: 'armor-sciences', x: 65, y: 25 },
  shipArmor: { categoryId: 'armor-sciences', x: 41, y: 58 },
  maneuverDefense: { categoryId: 'maneuver-sciences', x: 40, y: 38 },
};

const SOURCE_NOTE = 'Название и source science ID подтверждены текущим Asterion Combat contract, основанным на сохранённом симуляторе Nemexia. Стоимость, время, максимальный уровень, зависимости и точный боевой коэффициент не подтверждены.';

export const SCIENCE_CATALOG: readonly ScienceCatalogItem[] = Object.freeze(
  COMBAT_TECHNOLOGIES.map((technology) => {
    const presentation = PRESENTATION_BY_TECH[technology.id];
    return Object.freeze({
      id: `science-${technology.sourceScienceId}`,
      combatTechnologyId: technology.id,
      sourceScienceId: technology.sourceScienceId,
      name: technology.name,
      categoryId: presentation.categoryId,
      sourceStatus: 'confirmed' as const,
      position: Object.freeze({ x: presentation.x, y: presentation.y }),
      confirmedPrerequisites: Object.freeze([]) as readonly string[],
      sourceNote: SOURCE_NOTE,
    });
  }),
);

/**
 * No prerequisite graph was confirmed in the inspected sources. Decorative
 * connection lines therefore remain empty rather than implying gameplay rules.
 */
export const SCIENCE_VISUAL_LINKS: readonly ScienceVisualLink[] = Object.freeze([]);
