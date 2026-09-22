import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceLevels } from '../science/runtime.ts';
import type { ScienceId } from '../science/types.ts';
import type { CatalogEntity } from '../combat/catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { RuntimeMode } from '../runtime/mode.ts';

export type ProductionRequirementContext = {
  scienceLevels: ScienceLevels;
  shipyardLevel: number;
  hangarLevel: number;
  advancedFactoryLevel: number;
  /** The selected planet and its current runtime snapshot are explicit inputs. */
  planetId?: string;
  fleet?: { ships: Record<string, number>; commanders: Record<string, number> };
  defense?: { defenses: Record<string, number> };
  queues?: {
    shipQueue: readonly unknown[];
    defenseQueue: readonly unknown[];
    commanderQueue: readonly unknown[];
  };
  wallet?: { metal: number; minerals: number; gas: number };
  capacities?: Readonly<Partial<Record<'metal' | 'minerals' | 'gas', unknown>>>;
  factionId?: CombatFactionId;
  mode?: RuntimeMode;
};

export type ProductionRequirementState = {
  kind: 'shipyard' | 'science' | 'unresolved';
  label: string;
  source: string;
  requiredLevel: number | null;
  currentLevel: number | null;
  scienceId?: ScienceId;
  met: boolean;
};

export type ProductionRequirementsEvaluation = {
  met: boolean;
  requirements: readonly ProductionRequirementState[];
  missing: readonly ProductionRequirementState[];
  reason: string | null;
};

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[·—–-].*$/, '')
    .replace(/\s+/g, ' ');
}

const scienceByLabel = new Map<string, { scienceId: ScienceId; label: string }>(
  SCIENCE_CATALOG.flatMap((science) => [
    [normalizeLabel(science.name), { scienceId: science.id, label: science.name }] as const,
    [normalizeLabel(science.sourceName), { scienceId: science.id, label: science.name }] as const,
  ]),
);

function parseLevelRequirement(source: string): { label: string; level: number } | null {
  const match = source.match(/^(.+?)\s*[·—–-]\s*уровень\s*(\d+)\s*$/iu);
  if (!match) return null;
  const level = Number(match[2]);
  return Number.isFinite(level) && level >= 0 ? { label: match[1].trim(), level } : null;
}

function scienceRequirementStates(
  entity: CatalogEntity,
  scienceLevels: ScienceLevels,
): ProductionRequirementState[] {
  const explicit = entity.construction.scienceRequirements ?? [];
  const explicitById = new Map(explicit.map((requirement) => [requirement.scienceId, requirement.level]));
  const states: ProductionRequirementState[] = [];

  for (const source of entity.construction.requirements) {
    const parsed = parseLevelRequirement(source);
    if (!parsed || normalizeLabel(parsed.label) === normalizeLabel('Верфь')) continue;
    const mapped = scienceByLabel.get(normalizeLabel(parsed.label));
    if (!mapped) {
      states.push({
        kind: 'unresolved',
        label: parsed.label,
        source,
        requiredLevel: parsed.level,
        currentLevel: null,
        met: false,
      });
      continue;
    }
    const requiredLevel = explicitById.get(mapped.scienceId) ?? parsed.level;
    const currentLevel = Math.max(0, Math.floor(scienceLevels[mapped.scienceId] ?? 0));
    states.push({
      kind: 'science',
      label: mapped.label,
      source,
      scienceId: mapped.scienceId,
      requiredLevel,
      currentLevel,
      met: currentLevel >= requiredLevel,
    });
  }

  for (const requirement of explicit) {
    if (states.some((state) => state.kind === 'science' && state.scienceId === requirement.scienceId)) continue;
    const science = SCIENCE_CATALOG.find((candidate) => candidate.id === requirement.scienceId);
    if (!science) continue;
    const currentLevel = Math.max(0, Math.floor(scienceLevels[requirement.scienceId] ?? 0));
    states.push({
      kind: 'science',
      label: science.name,
      source: `${science.name} · уровень ${requirement.level}`,
      scienceId: requirement.scienceId,
      requiredLevel: requirement.level,
      currentLevel,
      met: currentLevel >= requirement.level,
    });
  }

  return states;
}

function reasonFor(requirement: ProductionRequirementState): string {
  if (requirement.kind === 'science') return `Требуется ${requirement.label} уровня ${requirement.requiredLevel}.`;
  if (requirement.kind === 'shipyard') return `Требуется верфь уровня ${requirement.requiredLevel}.`;
  return `Требование каталога не поддержано: ${requirement.source}.`;
}

/**
 * The single production gate shared by domain enqueue and all production UI.
 * Text requirements remain the source snapshot; known science names are
 * converted into typed science IDs, while unknown legacy requirements stay
 * explicitly blocked instead of being treated as level zero or silently
 * ignored.
 */
export function evaluateProductionRequirements(
  entity: CatalogEntity,
  context: ProductionRequirementContext,
): ProductionRequirementsEvaluation {
  const shipyard: ProductionRequirementState = {
    kind: 'shipyard',
    label: 'Верфь',
    source: `Верфь · уровень ${entity.construction.requiredShipyardLevel}`,
    requiredLevel: entity.construction.requiredShipyardLevel,
    currentLevel: Math.max(0, Math.floor(context.shipyardLevel)),
    met: context.shipyardLevel >= entity.construction.requiredShipyardLevel,
  };
  const requirements = [shipyard, ...scienceRequirementStates(entity, context.scienceLevels)];
  const missing = requirements.filter((requirement) => !requirement.met);
  return {
    met: missing.length === 0,
    requirements,
    missing,
    reason: missing[0] ? reasonFor(missing[0]) : null,
  };
}
