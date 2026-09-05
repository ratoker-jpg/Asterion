import { SCIENCE_CATALOG, SCIENCE_CATEGORIES } from './catalog.ts';
import type { ScienceCatalogItem, ScienceCategoryId } from './types.ts';

export function getScienceCategory(categoryId: ScienceCategoryId) {
  return SCIENCE_CATEGORIES.find((category) => category.id === categoryId) ?? null;
}

export function getScienceNodesByCategory(categoryId: ScienceCategoryId) {
  return SCIENCE_CATALOG.filter((item) => item.categoryId === categoryId);
}

export function getScienceNode(nodeId: string) {
  return SCIENCE_CATALOG.find((item) => item.id === nodeId) ?? null;
}

export function getConfirmedPrerequisites(item: ScienceCatalogItem) {
  const ids = new Set(SCIENCE_CATALOG.map((candidate) => candidate.id));
  return item.confirmedPrerequisites.filter((id) => ids.has(id));
}

export function searchScienceCatalog(query: string) {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return [...SCIENCE_CATALOG];
  return SCIENCE_CATALOG.filter((item) => (
    item.name.toLocaleLowerCase('ru-RU').includes(needle)
    || item.combatTechnologyId.toLocaleLowerCase('ru-RU').includes(needle)
    || String(item.sourceScienceId).includes(needle)
  ));
}
