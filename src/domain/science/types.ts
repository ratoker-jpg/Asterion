import type { CombatTechnologyId } from '../combat/technologies.ts';

export type ScienceCategoryId = 'energy' | 'infrastructure' | 'navigation' | 'intelligence' | 'defense' | 'weapons';
export type ScienceSourceStatus = 'stellar-current';

export type ScienceCategory = {
  id: ScienceCategoryId;
  label: string;
  shortLabel: string;
  description: string;
};

export type ScienceRequirement = {
  scienceId: string;
  level: number;
};

export type ScienceEffectMeta = {
  type: string;
  valueLabel: string;
};

export type ScienceCatalogItem = {
  id: string;
  slug: string;
  name: string;
  categoryId: ScienceCategoryId;
  description: string;
  maxLevel: number;
  baseCost: {
    metal: number;
    crystal: number;
    gas: number;
  };
  baseSeconds: number;
  requiredLaboratoryLevel: number;
  requirements: readonly ScienceRequirement[];
  effects: readonly ScienceEffectMeta[];
  sourceStatus: ScienceSourceStatus;
  sourceNote: string;
  combatTechnologyId?: CombatTechnologyId;
  sourceScienceId?: number;
};

export type ScienceVisualLink = {
  from: string;
  to: string;
  requiredLevel: number;
  sourceBacked: true;
};
