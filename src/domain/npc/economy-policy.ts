import { getStorageCapacities } from '../buildings/resource-zone.ts';
import { createSeededRandom } from '../world/random.ts';
import type { SpyTargetState } from '../espionage/types.ts';
import type { BuildingRole, BuildAvailability } from '../buildings/resource-zone.ts';
import type { SciencePreview } from '../science/runtime.ts';
import type { ScienceId } from '../science/types.ts';
import type { NpcProfile } from './types.ts';

const NPC_LEGACY_ECONOMY_ROLES: readonly BuildingRole[] = Object.freeze([
  'metal-production-1', 'metal-production-2', 'metal-production-3',
  'mineral-production-1', 'mineral-production-2',
  'gas-production-1', 'gas-production-2',
  'basic-energy', 'advanced-energy',
  'metal-storage', 'mineral-storage', 'gas-storage',
  'construction', 'advanced-factory',
]);

/** The development policy adds laboratories while the legacy API stays economy-only. */
export const NPC_ECONOMY_ROLES: readonly BuildingRole[] = Object.freeze([
  ...NPC_LEGACY_ECONOMY_ROLES,
  'research',
]);

export type NpcEconomyCandidate = Readonly<{ role: BuildingRole; availability: BuildAvailability }>;

export type NpcEconomyChoice = Readonly<{
  role: BuildingRole | null;
  wait: boolean;
  idempotencyKey: string;
}>;

export type NpcDevelopmentChoice = Readonly<{
  role: BuildingRole | null;
  scienceId: ScienceId | null;
  wait: boolean;
  idempotencyKey: string;
}>;

type WeightedDevelopmentAction = Readonly<{
  role: BuildingRole | null;
  scienceId: ScienceId | null;
  weight: number;
}>;

/**
 * Deterministic prototype policy. Base weights are: mines 1.00, basic/advanced
 * energy 0.85, storage 0.45, construction 0.65, and advanced factory 0.55.
 * Mining weights also scale from 0.60 to 1.60 with the owner's own wallet
 * shortage. Economy focus scales all weights by 0.65..1.45. A 0.08..0.28
 * profile-shaped chance to wait preserves inaction; mechanics knowledge adds
 * bounded deterministic noise (up to ±20%) instead of granting hidden facts.
 * These are prototype decision weights, not measured behavior or balance data.
 */
export function chooseNpcEconomyAction(
  profile: NpcProfile,
  target: SpyTargetState,
  candidates: readonly NpcEconomyCandidate[],
  eventId: string,
): NpcEconomyChoice {
  const legal = candidates.filter(({ role, availability }) =>
    (NPC_LEGACY_ECONOMY_ROLES as readonly string[]).includes(role) && availability.canBuild);
  const idempotencyKey = 'npc-economy:v1:' + JSON.stringify([profile.ownerId, eventId]);
  if (legal.length === 0) return Object.freeze({ role: null, wait: true, idempotencyKey });

  const random = createSeededRandom(JSON.stringify([
    'npc-economy-policy:v1', profile.privateSeed, profile.ownerId, eventId,
  ]));
  const waitProbability = 0.08 + (1 - profile.traits.economyFocus) * 0.20;
  if (random() < waitProbability) return Object.freeze({ role: null, wait: true, idempotencyKey });

  const capacities = getStorageCapacities(target.buildings);
  const resourceFraction = {
    metal: safeFraction(target.resources.metal, capacities.metal),
    minerals: safeFraction(target.resources.minerals, capacities.minerals),
    gas: safeFraction(target.resources.gas, capacities.gas),
  };
  const base = new Map<BuildingRole, number>([
    ['metal-production-1', 1], ['metal-production-2', 1], ['metal-production-3', 1],
    ['mineral-production-1', 1], ['mineral-production-2', 1],
    ['gas-production-1', 1], ['gas-production-2', 1],
    ['basic-energy', 0.85], ['advanced-energy', 0.85],
    ['metal-storage', 0.45], ['mineral-storage', 0.45], ['gas-storage', 0.45],
    ['construction', 0.65], ['advanced-factory', 0.55],
  ]);
  const weights = legal.map(({ role }) => {
    const resource = role.startsWith('metal-') && role.includes('production') ? 'metal'
      : role.startsWith('mineral-') && role.includes('production') ? 'minerals'
        : role.startsWith('gas-') && role.includes('production') ? 'gas' : null;
    const shortageFactor = resource ? 0.60 + (1 - resourceFraction[resource]) : 1;
    const economyFactor = 0.65 + 0.80 * profile.traits.economyFocus;
    const horizonFactor = role === 'construction' || role === 'advanced-factory'
      ? 0.75 + 0.50 * profile.traits.planningHorizon : 1;
    // Imperfect but private knowledge changes estimates, never legal availability.
    const uncertainty = (1 - profile.traits.mechanicsKnowledge) * 0.40;
    const noiseFactor = 1 - uncertainty / 2 + random() * uncertainty;
    return { role, weight: (base.get(role) ?? 0) * shortageFactor * economyFactor * horizonFactor * noiseFactor };
  });
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of weights) {
    roll -= item.weight;
    if (roll < 0) return Object.freeze({ role: item.role, wait: false, idempotencyKey });
  }
  return Object.freeze({ role: weights.at(-1)!.role, wait: false, idempotencyKey });
}

/**
 * Selects one development action from the candidates supplied by the caller.
 * Science and building availability remain authoritative outside this policy;
 * this function only weights legal candidates and never creates another attempt.
 */
export function chooseNpcDevelopmentAction(
  profile: NpcProfile,
  target: SpyTargetState,
  buildingCandidates: readonly NpcEconomyCandidate[],
  scienceCandidates: readonly SciencePreview[],
  eventId: string,
): NpcDevelopmentChoice {
  const legalBuildings = buildingCandidates.filter(({ role, availability }) =>
    (NPC_ECONOMY_ROLES as readonly string[]).includes(role) && availability.canBuild);
  const legalSciences = scienceCandidates.filter(({ canStart }) => canStart);
  const idempotencyKey = 'npc-development:v1:' + JSON.stringify([profile.ownerId, eventId]);
  if (legalBuildings.length === 0 && legalSciences.length === 0) {
    return Object.freeze({ role: null, scienceId: null, wait: true, idempotencyKey });
  }

  const random = createSeededRandom(JSON.stringify([
    'npc-development-policy:v1', profile.privateSeed, profile.ownerId, eventId,
  ]));
  const capacities = getStorageCapacities(target.buildings);
  const resourceFraction = {
    metal: safeFraction(target.resources.metal, capacities.metal),
    minerals: safeFraction(target.resources.minerals, capacities.minerals),
    gas: safeFraction(target.resources.gas, capacities.gas),
  };
  const scienceFactor = 0.65 + 0.80 * profile.traits.scienceFocus;
  const laboratoryLevel = Number.isFinite(target.buildings.research)
    ? Math.max(0, target.buildings.research!)
    : 0;
  const laboratoryLevelFactor = 1 / (1 + laboratoryLevel);
  const researchQueueFull = scienceCandidates.some(({ status }) => status === 'queue-full');
  const actions: WeightedDevelopmentAction[] = [];

  for (const { role } of legalBuildings) {
    const resource = role.startsWith('metal-') && role.includes('production') ? 'metal'
      : role.startsWith('mineral-') && role.includes('production') ? 'minerals'
        : role.startsWith('gas-') && role.includes('production') ? 'gas' : null;
    const shortageFactor = resource ? 0.60 + (1 - resourceFraction[resource]) : 1;
    const economyFactor = 0.65 + 0.80 * profile.traits.economyFocus;
    const horizonFactor = role === 'construction' || role === 'advanced-factory'
      ? 0.75 + 0.50 * profile.traits.planningHorizon : 1;
    const uncertainty = (1 - profile.traits.mechanicsKnowledge) * 0.40;
    const noiseFactor = 1 - uncertainty / 2 + random() * uncertainty;
    const baseWeight = ECONOMY_BASE_WEIGHT.get(role) ?? 0;
    // A ready research option is more useful than buying another laboratory.
    // Keep a small laboratory chance for variation, but suppress repeat lab focus.
    const isLaboratory = role === 'research';
    const laboratoryNeedFactor = isLaboratory
      ? (researchQueueFull ? 0 : laboratoryLevelFactor * (legalSciences.length > 0 ? 0.12 : 1))
      : 1;
    actions.push({
      role,
      scienceId: null,
      weight: baseWeight * shortageFactor * (isLaboratory ? scienceFactor : economyFactor)
        * horizonFactor * noiseFactor * laboratoryNeedFactor,
    });
  }

  for (const preview of legalSciences) {
    actions.push({
      role: null,
      scienceId: preview.scienceId,
      weight: 0.85 * scienceFactor,
    });
  }

  const totalActionWeight = actions.reduce((sum, action) => sum + action.weight, 0);
  const effectiveFocus = Math.max(profile.traits.economyFocus, profile.traits.scienceFocus);
  const waitProbability = 0.08 + (1 - effectiveFocus) * 0.20;
  const waitWeight = totalActionWeight * waitProbability / (1 - waitProbability);
  // Wait is part of the same weighted draw as buildings and science.
  let roll = random() * (totalActionWeight + waitWeight);
  for (const action of actions) {
    roll -= action.weight;
    if (roll < 0) return Object.freeze({
      role: action.role,
      scienceId: action.scienceId,
      wait: false,
      idempotencyKey,
    });
  }
  return Object.freeze({ role: null, scienceId: null, wait: true, idempotencyKey });
}

const ECONOMY_BASE_WEIGHT = new Map<BuildingRole, number>([
  ['metal-production-1', 1], ['metal-production-2', 1], ['metal-production-3', 1],
  ['mineral-production-1', 1], ['mineral-production-2', 1],
  ['gas-production-1', 1], ['gas-production-2', 1],
  ['basic-energy', 0.85], ['advanced-energy', 0.85],
  ['metal-storage', 0.45], ['mineral-storage', 0.45], ['gas-storage', 0.45],
  ['construction', 0.65], ['advanced-factory', 0.55], ['research', 0.55],
]);

function safeFraction(value: number, capacity: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(capacity) || capacity <= 0) return 1;
  return Math.max(0, Math.min(1, value / capacity));
}
