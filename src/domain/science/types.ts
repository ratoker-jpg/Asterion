import type { CombatTechnologyId } from '../combat/technologies.ts';

export type ScienceCategoryId = 'basic' | 'advanced' | 'master' | 'additional';
export type ScienceSourceStatus = 'nemexia-saved-page';

export type ScienceCategory = {
  id: ScienceCategoryId;
  label: string;
  shortLabel: string;
  description: string;
  sourceTab: string;
  exclusiveChoice?: boolean;
};

export type ScienceRequirement = {
  scienceId: string;
  level: number;
};

export type ScienceSnapshotCost = {
  metal: number;
  crystal: number;
  gas: number;
  energy: number;
};

export type ScienceCatalogItem = {
  id: string;
  sourceScienceId: number;
  slug: string;
  name: string;
  categoryId: ScienceCategoryId;
  description: string;
  snapshotLevel: number;
  snapshotNextLevel: number;
  snapshotCost: ScienceSnapshotCost;
  snapshotTime: string;
  requiredLaboratoryLevel: number;
  requirements: readonly ScienceRequirement[];
  sourceStatus: ScienceSourceStatus;
  sourceNote: string;
  combatTechnologyId?: CombatTechnologyId;
};
