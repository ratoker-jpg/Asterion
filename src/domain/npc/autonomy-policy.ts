import { createSeededRandom } from '../world/random.ts';
import type { NpcLongTermGoal, NpcProfile } from './types.ts';

export type NpcAutonomyCandidate = Readonly<{
  id: string;
  kind: string;
  weight: number;
  payload?: Readonly<Record<string, string | number | boolean | null>>;
}>;

/** Draw weight of waiting regardless of the options: about one middling estimate (U ≈ 0). */
export const NPC_WAIT_FLOOR_WEIGHT = 1;
const MEMORY_LIMIT = 64;
const MEMORY_FACT_LIMIT = 16;
const GOAL_LIMIT = 8;
const MIN_REPLAN_HORIZON_MS = 6 * 60 * 60 * 1000;
const MAX_REPLAN_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
const REPLAN_OUTCOME_KINDS = new Set([
  'battle-loss', 'observed-battle-loss', 'recon', 'reconnaissance', 'recon-outcome', 'recon-loss', 'recon-success',
  'diplomacy', 'diplomacy-outcome', 'diplomatic-outcome', 'alliance-outcome', 'war-outcome', 'truce-outcome',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizedTrait(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;
}

function actionTrait(profile: NpcProfile, kind: string): number {
  const trait = profile.traits;
  switch (kind) {
    case 'economy': return normalizedTrait(trait.economyFocus);
    case 'science': return normalizedTrait(trait.scienceFocus);
    case 'production': return (normalizedTrait(trait.economyFocus) + normalizedTrait(trait.militaryFocus)) / 2;
    case 'attack': return normalizedTrait(trait.aggression) * 0.45
      + normalizedTrait(trait.militaryFocus) * 0.35 + normalizedTrait(trait.riskTolerance) * 0.20;
    case 'colonize': return normalizedTrait(trait.expansionFocus) * 0.65
      + normalizedTrait(trait.planningHorizon) * 0.35;
    case 'recon': return normalizedTrait(trait.operationsInterest) * 0.50
      + normalizedTrait(trait.attention) * 0.30 + normalizedTrait(trait.mechanicsKnowledge) * 0.20;
    case 'pve': return normalizedTrait(trait.operationsInterest) * 0.35
      + normalizedTrait(trait.aggression) * 0.25 + normalizedTrait(trait.riskTolerance) * 0.40;
    case 'diplomacy': return normalizedTrait(trait.cooperation) * 0.55
      + normalizedTrait(trait.socialStyle) * 0.45;
    case 'aid': return normalizedTrait(trait.cooperation) * 0.70
      + normalizedTrait(trait.socialStyle) * 0.30;
    default: return 0.5;
  }
}

function relatedMemoryKinds(kind: string): ReadonlySet<string> {
  if (kind === 'attack') return new Set(['attack', 'battle-loss', 'battle-win', 'observed-battle-loss', 'observed-battle-win']);
  if (kind === 'recon') return new Set(['recon', 'reconnaissance', 'recon-loss', 'recon-success']);
  if (kind === 'diplomacy' || kind === 'aid') return new Set([
    'diplomacy', 'diplomatic-outcome', 'alliance-outcome', 'war-outcome', 'truce-outcome',
  ]);
  return new Set([kind]);
}

function rememberedOutcomeDelta(profile: NpcProfile, kind: string): number {
  const kinds = relatedMemoryKinds(kind);
  let weightedValence = 0;
  let totalSalience = 0;
  for (const memory of profile.memory) {
    if (!kinds.has(memory.kind) || memory.factIds.length === 0) continue;
    const salience = normalizedTrait(memory.salience);
    if (salience <= 0) continue;
    weightedValence += (normalizedTrait(memory.valence) - 0.5) * salience;
    totalSalience += salience;
  }
  return totalSalience > 0 ? clamp(weightedValence / totalSalience, -0.5, 0.5) : 0;
}

/** Trait multiplier for internal strategy weights; it never changes candidate legality. */
export function weightNpcAction(profile: NpcProfile, kind: string): number {
  const base = 0.55 + actionTrait(profile, kind);
  const outcomeDelta = rememberedOutcomeDelta(profile, kind);
  const adaptability = normalizedTrait(profile.traits.adaptability);
  const persistence = normalizedTrait(profile.traits.persistence);
  const riskTolerance = normalizedTrait(profile.traits.riskTolerance);
  const learningRate = (0.3 + adaptability * 0.8) * (1 - persistence * 0.45);
  const riskAdjustment = outcomeDelta < 0 ? 1.25 - riskTolerance * 0.5 : 0.75 + riskTolerance * 0.5;
  const experienceFactor = clamp(1 + outcomeDelta * learningRate * riskAdjustment, 0.45, 1.65);
  const activeGoal = profile.longTermGoals.find((goal) => goal.status === 'active');
  const commitment = normalizedTrait(profile.planning.commitment);
  const goalFactor = activeGoal?.kind === kind ? 1 + commitment * 0.35 : 1;
  return clamp(base * experienceFactor * goalFactor, 0.35, 1.9);
}

function validCandidate(candidate: NpcAutonomyCandidate): boolean {
  return !!candidate && typeof candidate === 'object'
    && typeof candidate.id === 'string' && candidate.id.length > 0
    && typeof candidate.kind === 'string' && candidate.kind.length > 0
    && typeof candidate.weight === 'number' && Number.isFinite(candidate.weight) && candidate.weight > 0;
}

/**
 * Chooses only among caller-supplied candidates. Candidate ordering does not
 * affect the result, and wait shares the same seeded weighted draw.
 */
export function chooseNpcAutonomyAction(
  profile: NpcProfile,
  candidates: readonly NpcAutonomyCandidate[],
  eventId: string,
): NpcAutonomyCandidate | null {
  if (typeof eventId !== 'string' || eventId.length === 0) throw new TypeError('eventId must be a non-empty string');
  const legal = candidates.filter(validCandidate).slice().sort((left, right) =>
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    || (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0));
  if (legal.length === 0) return null;

  const kindWeights = new Map<string, number>();
  const kindWeight = (kind: string) => {
    let weight = kindWeights.get(kind);
    if (weight === undefined) kindWeights.set(kind, weight = weightNpcAction(profile, kind));
    return weight;
  };
  const weighted = legal.map((candidate) => ({
    candidate,
    weight: Math.min(candidate.weight, 1_000_000_000) * kindWeight(candidate.kind),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0) || !Number.isFinite(totalWeight)) return null;

  const activeGoal = profile.longTermGoals.some((goal) => goal.status === 'active');
  const attention = normalizedTrait(profile.traits.attention);
  const persistence = normalizedTrait(profile.traits.persistence);
  const waitProbability = clamp(0.04 + (1 - attention) * 0.15 + (1 - persistence) * 0.05
    - (activeGoal ? persistence * 0.04 : 0), 0.02, 0.24);
  // A fixed floor too: when every option is poor (all estimates negative) a
  // player leaves the game for a while rather than doing something pointless.
  const waitWeight = totalWeight * waitProbability / (1 - waitProbability) + NPC_WAIT_FLOOR_WEIGHT;
  const random = createSeededRandom(JSON.stringify([
    'npc-autonomy-choice:v1', profile.privateSeed, profile.ownerId, eventId,
  ]));
  let roll = random() * (totalWeight + waitWeight);
  for (const item of weighted) {
    roll -= item.weight;
    if (roll < 0) return item.candidate;
  }
  return null;
}

function boundedFactIds(factIds: readonly string[]): readonly string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const factId of factIds) {
    if (typeof factId !== 'string' || factId.trim().length === 0 || seen.has(factId)) continue;
    seen.add(factId);
    unique.push(factId);
    if (unique.length >= MEMORY_FACT_LIMIT) break;
  }
  return Object.freeze(unique);
}

function reconsiderationHorizon(profile: NpcProfile): number {
  return Math.round(MIN_REPLAN_HORIZON_MS + (MAX_REPLAN_HORIZON_MS - MIN_REPLAN_HORIZON_MS)
    * normalizedTrait(profile.planning.horizon));
}

function updateGoalAtReconsideration(
  profile: NpcProfile,
  eventId: string,
  at: number,
  outcomeKind: string,
  forceReconsideration = false,
  goalKind = outcomeKind,
) {
  const dueAt = profile.planning.reconsiderAt;
  if (!forceReconsideration && dueAt !== null && at < dueAt) return {
    planning: profile.planning,
    longTermGoals: profile.longTermGoals,
  };

  const goals: NpcLongTermGoal[] = profile.longTermGoals.map((goal) => goal.status === 'active'
    ? { ...goal, status: 'paused' as const }
    : { ...goal });
  if (goalKind !== 'wait') {
    goals.push({
      id: `npc-goal:${profile.ownerId}:${eventId}`,
      kind: goalKind,
      createdAt: at,
      priority: clamp(weightNpcAction(profile, goalKind) / 1.9, 0, 1),
      status: 'active',
      progress: 0,
    });
  }
  return {
    planning: Object.freeze({
      ...profile.planning,
      reconsiderAt: Math.min(Number.MAX_SAFE_INTEGER, at + reconsiderationHorizon(profile)),
    }),
    longTermGoals: Object.freeze(goals.slice(-GOAL_LIMIT)),
  };
}

/**
 * A strategic goal the caller assessed. When given, a reconsideration commits
 * to it instead of echoing the outcome kind, and an active goal outside
 * `goalKinds` (e.g. one left by a battle outcome) is reconsidered at once.
 */
export type NpcStrategicGoalOption = Readonly<{ goalKind: string; goalKinds: ReadonlySet<string> }>;

/** Stores only explicit fact references supplied by the caller and bounds saved history. */
export function updateNpcAutonomyMemory(
  profile: NpcProfile,
  eventId: string,
  at: number,
  outcomeKind: string,
  succeeded: boolean,
  factIds: readonly string[],
  strategic?: NpcStrategicGoalOption,
): NpcProfile {
  if (typeof eventId !== 'string' || eventId.length === 0) throw new TypeError('eventId must be a non-empty string');
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('at must be a non-negative safe integer timestamp');
  if (typeof outcomeKind !== 'string' || outcomeKind.length === 0) throw new TypeError('outcomeKind must be a non-empty string');
  const explicitFactIds = boundedFactIds(factIds);
  if (explicitFactIds.length === 0) return profile;

  const id = `npc-memory:${profile.ownerId}:${eventId}`;
  if (profile.memory.some((entry) => entry.id === id)) return profile;
  const activeGoal = profile.longTermGoals.find((goal) => goal.status === 'active');
  const offStrategy = strategic !== undefined && (!activeGoal || !strategic.goalKinds.has(activeGoal.kind));
  const plan = updateGoalAtReconsideration(
    profile,
    eventId,
    at,
    outcomeKind,
    REPLAN_OUTCOME_KINDS.has(outcomeKind) || offStrategy,
    strategic?.goalKind ?? outcomeKind,
  );
  const memory = Object.freeze([...profile.memory, Object.freeze({
    id,
    kind: outcomeKind,
    at,
    valence: succeeded ? 0.75 : 0.25,
    salience: clamp(0.35 + normalizedTrait(profile.traits.attention) * 0.65, 0, 1),
    factIds: explicitFactIds,
  })].slice(-MEMORY_LIMIT));
  return Object.freeze({
    ...profile,
    planning: plan.planning,
    memory,
    longTermGoals: plan.longTermGoals,
  });
}
