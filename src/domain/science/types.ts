import type { CombatTechnologyId } from '../combat/technologies.ts';

export type ScienceCategoryId = 'weapon-sciences' | 'armor-sciences' | 'maneuver-sciences';
export type ScienceSourceStatus = 'confirmed';

export type ScienceCategory = {
  id: ScienceCategoryId;
  label: string;
  description: string;
  presentationOnly: true;
};

export type ScienceCatalogItem = {
  id: string;
  combatTechnologyId: CombatTechnologyId;
  sourceScienceId: number;
  name: string;
  categoryId: ScienceCategoryId;
  sourceStatus: ScienceSourceStatus;
  position: { x: number; y: number };
  confirmedPrerequisites: readonly string[];
  sourceNote: string;
};

export type ScienceVisualLink = {
  from: string;
  to: string;
  presentationOnly: true;
};
