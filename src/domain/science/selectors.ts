import { SCIENCE_CATALOG } from './catalog.ts';
import type { ScienceId, ScienceSectionId } from './types.ts';

export function sciencesForSection(section: ScienceSectionId) {
  return SCIENCE_CATALOG.filter((science) => science.section === section);
}

export function scienceById(id: ScienceId) {
  return SCIENCE_CATALOG.find((science) => science.id === id) ?? null;
}

export function scienceName(id: ScienceId) {
  return scienceById(id)?.name ?? `Наука ${id}`;
}
