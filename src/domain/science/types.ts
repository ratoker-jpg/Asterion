import type { CombatTechnologyId } from '../combat/technologies.ts';

export type ScienceSectionId = 'basic' | 'advanced' | 'expert' | 'additional';
export type ScienceId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 17 | 18 | 19 | 20 | 21 | 22 | 23;

export type ScienceResourceCost = {
  metal: number;
  minerals: number;
  gas: number;
  energy: number;
};

export type SciencePrerequisite = {
  scienceId: ScienceId;
  level: number;
};

export type ScienceCatalogDefinition = {
  id: ScienceId;
  section: ScienceSectionId;
  name: string;
  sourceName: string;
  description: string;
  artSlug: string;
  capturedLevel: number;
  capturedNextLevel: number;
  capturedCost: ScienceResourceCost;
  capturedTime: string;
  laboratoryLevel: number;
  prerequisites: readonly SciencePrerequisite[];
  combatTechnologyId?: CombatTechnologyId;
};

export type ScienceQueuePreviewItem = {
  scienceId: ScienceId;
  name: string;
  capturedLevelLabel: string;
  capturedRemainingTime: string;
};
