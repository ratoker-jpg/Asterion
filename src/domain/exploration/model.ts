import type { TransportCargo, TransportCargoKey } from '../flights/cargo.ts';
import type { UniverseCoordinate, UniversePlanetNode } from '../universe/types.ts';

export type ExplorationKind = 'unique' | 'anomaly';
export type ExplorationResource = TransportCargoKey;
export type ExplorationRisk = 1 | 2 | 3 | 4 | 5;
export type ExplorationWeights = Readonly<Partial<Record<ExplorationResource, number>>>;
export type ExplorationProfile = Readonly<{
  variant: number;
  name: string;
  weights: ExplorationWeights;
  q: number;
  risk: ExplorationRisk;
  tokenP12: number;
}>;

const uniqueProfiles: readonly ExplorationProfile[] = [
  { variant: 1, name: 'Железные кратеры', weights: { metal: 100 }, q: .35, risk: 1, tokenP12: .002 },
  { variant: 2, name: 'Рудные пустоши', weights: { metal: 100 }, q: .55, risk: 2, tokenP12: .005 },
  { variant: 3, name: 'Осколки мегаструктуры', weights: { metal: 70, debris: 30 }, q: .70, risk: 3, tokenP12: .01 },
  { variant: 4, name: 'Ядро мёртвой кузницы', weights: { metal: 100 }, q: 1.25, risk: 4, tokenP12: .02 },
  { variant: 5, name: 'Кристальная пустыня', weights: { minerals: 100 }, q: .35, risk: 1, tokenP12: .002 },
  { variant: 6, name: 'Геодные хребты', weights: { minerals: 100 }, q: .55, risk: 2, tokenP12: .005 },
  { variant: 7, name: 'Пещеры синтеза', weights: { minerals: 100 }, q: .85, risk: 3, tokenP12: .01 },
  { variant: 8, name: 'Сердце кристаллов', weights: { minerals: 100 }, q: 1.25, risk: 4, tokenP12: .02 },
  { variant: 9, name: 'Газовые лагуны', weights: { gas: 100 }, q: .35, risk: 1, tokenP12: .002 },
  { variant: 10, name: 'Плазменные гейзеры', weights: { gas: 100 }, q: .60, risk: 2, tokenP12: .006 },
  { variant: 11, name: 'Древние резервуары', weights: { gas: 100 }, q: .90, risk: 3, tokenP12: .01 },
  { variant: 12, name: 'Атмосферный разлом', weights: { gas: 100 }, q: 1.35, risk: 4, tokenP12: .02 },
  { variant: 13, name: 'Кладбище станций', weights: { debris: 100 }, q: .45, risk: 2, tokenP12: .005 },
  { variant: 14, name: 'Обломки дредноутов', weights: { debris: 100 }, q: .90, risk: 3, tokenP12: .015 },
  { variant: 15, name: 'Архив забытых машин', weights: { metal: 60, minerals: 40 }, q: 1.10, risk: 4, tokenP12: .03 },
  { variant: 16, name: 'Колыбель титанов', weights: { metal: 40, minerals: 30, gas: 30 }, q: 1.50, risk: 5, tokenP12: .05 },
];

const anomalyProfiles: readonly ExplorationProfile[] = [
  { variant: 1, name: 'Ионная рябь', weights: { gas: 100 }, q: .35, risk: 2, tokenP12: .02 },
  { variant: 2, name: 'Сдвиг частот', weights: { gas: 100 }, q: .60, risk: 3, tokenP12: .03 },
  { variant: 3, name: 'Кристальный резонанс', weights: { minerals: 100 }, q: .45, risk: 2, tokenP12: .02 },
  { variant: 4, name: 'Гравитационная линза', weights: { minerals: 100 }, q: .75, risk: 3, tokenP12: .04 },
  { variant: 5, name: 'Плазменный разлом', weights: { gas: 60, metal: 40 }, q: 1.00, risk: 4, tokenP12: .07 },
  { variant: 6, name: 'Пространственный шов', weights: { metal: 50, minerals: 50 }, q: 1.00, risk: 4, tokenP12: .07 },
  { variant: 7, name: 'Пояс фрагментов', weights: { debris: 100 }, q: .60, risk: 3, tokenP12: .04 },
  { variant: 8, name: 'Разрыв континуума', weights: { debris: 50, gas: 50 }, q: 1.20, risk: 4, tokenP12: .10 },
  { variant: 9, name: 'Узел Люмена', weights: { metal: 30, minerals: 30, gas: 40 }, q: 1.10, risk: 4, tokenP12: .12 },
  { variant: 10, name: 'Сердце сингулярности', weights: { metal: 30, minerals: 35, gas: 35 }, q: 1.60, risk: 5, tokenP12: .18 },
];

export const EXPLORATION_PROFILES: Readonly<Record<ExplorationKind, readonly ExplorationProfile[]>> = {
  unique: uniqueProfiles,
  anomaly: anomalyProfiles,
};

export const EXPLORATION_RULES = {
  reconSuccess: .70,
  reconCooldownMs: 120_000,
  recallPreparationMs: 30_000,
  defenseBoost: 1.10,
  defenseBoostMs: 120_000,
  capturedCargoFraction: .30,
  resourcePointsBase: 100_000,
  baseResourcesPerMinute: 100_000,
  catchupMinPopulation: 5,
  riskSlotMs: 180_000,
  npcAttemptChance: [0, .03, .05, .08, .12, .16] as const,
  anomalyHazardChance: [0, 0, .03, .05, .08, .12] as const,
} as const;

const keys: readonly ExplorationResource[] = ['metal', 'minerals', 'gas', 'debris'];

export function emptyExplorationCargo(): TransportCargo {
  return { metal: 0, minerals: 0, gas: 0, debris: 0 };
}

export function explorationProfile(kind: ExplorationKind, variant: number): ExplorationProfile {
  const profiles = EXPLORATION_PROFILES[kind];
  if (!Number.isInteger(variant) || variant < 1 || variant > profiles.length) throw new RangeError('Unknown exploration variant');
  return profiles[variant - 1]!;
}

/** UniverseView puts three original unique arts before the 16 generated arts. */
export function profileVariantForArt(kind: ExplorationKind, artIndex: number): number {
  if (!Number.isInteger(artIndex) || artIndex < 0) throw new RangeError('Bad art index');
  if (kind === 'anomaly') return artIndex % 10 + 1;
  const position = artIndex % 19;
  // Original island / vortex / crystal art stays valid and maps to matching economic archetypes.
  return position < 3 ? [5, 12, 8][position]! : position - 2;
}

export type ExplorationIdentity = Readonly<{
  kind: ExplorationKind;
  coordinate: UniverseCoordinate;
  cycleIndex: number;
  startAt: number;
}>;

/** Cycle identity does not recycle when a new object appears in the same system. */
export function explorationContactId(value: ExplorationIdentity): string {
  const c = value.coordinate;
  if (!Number.isSafeInteger(c.galaxy) || c.galaxy < 1
    || !Number.isSafeInteger(c.system) || c.system < 1 || c.system > 40
    || !Number.isSafeInteger(value.cycleIndex) || value.cycleIndex < 0
    || !Number.isSafeInteger(value.startAt) || value.startAt < 0) throw new RangeError('Invalid exploration identity');
  return [value.kind, c.galaxy, c.system, value.cycleIndex, value.startAt].join(':');
}

export function isExplorationContactId(id: unknown): id is string {
  return typeof id === 'string' && /^(unique|anomaly):[1-9]\d*:(?:[1-9]|[1-3]\d|40):(?:0|[1-9]\d*):(?:0|[1-9]\d*)$/.test(id);
}

export function explorationNodeId(node: UniversePlanetNode): string | null {
  if ((node.kind !== 'unique' && node.kind !== 'anomaly') || !node.special) return null;
  const startAt = node.special.startAt;
  if (!Number.isSafeInteger(startAt)) return null;
  return explorationContactId({
    kind: node.kind,
    coordinate: node.coordinate,
    cycleIndex: node.special.cycleIndex,
    startAt,
  });
}

/** Multi-colony visibility in the same galaxy, without contact duplication. */
export function visibleExplorationContacts(
  nodes: readonly UniversePlanetNode[],
  ownedColonies: readonly UniverseCoordinate[],
  nowMs: number,
  limit = 5,
): UniversePlanetNode[] {
  const unique = new Map<string, UniversePlanetNode>();
  for (const node of nodes) {
    const id = explorationNodeId(node);
    if (!id || !node.special || nowMs < node.special.startAt! || nowMs >= node.special.expiresAt) continue;
    if (!ownedColonies.some(c => c.galaxy === node.coordinate.galaxy && Math.abs(c.system - node.coordinate.system) <= 5)) continue;
    unique.set(id, node);
  }
  const distance = (node: UniversePlanetNode) => Math.min(...ownedColonies
    .filter(c => c.galaxy === node.coordinate.galaxy)
    .map(c => Math.abs(c.system - node.coordinate.system)));
  return [...unique.values()]
    .sort((a, b) => distance(a) - distance(b)
      || a.special!.expiresAt - b.special!.expiresAt
      || explorationNodeId(a)!.localeCompare(explorationNodeId(b)!))
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function explorationStage(resourcePoints: number): number {
  const p = Number.isFinite(resourcePoints) ? Math.max(1000, resourcePoints) : 1000;
  return Math.max(.15, Math.min(15, Math.pow(p / EXPLORATION_RULES.resourcePointsBase, .65)));
}

export function explorationBaseRate(resourcePoints: number, profile: ExplorationProfile): number {
  return Math.round(EXPLORATION_RULES.baseResourcesPerMinute * explorationStage(resourcePoints) * profile.q);
}

/** Undefined median is deliberate when fewer than five genuine owners exist. */
export function explorationCatchup(resourcePoints: number, realGalaxyResourceScores: readonly number[]): { median?: number; multiplier: number } {
  const points = realGalaxyResourceScores.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (points.length < EXPLORATION_RULES.catchupMinPopulation) return { multiplier: 1 };
  const middle = points.length >>> 1;
  const median = points.length % 2 ? points[middle]! : (points[middle - 1]! + points[middle]!) / 2;
  const p = Math.max(1, resourcePoints);
  return { median, multiplier: Math.max(1, Math.min(1.5, 1 + .25 * Math.log2(Math.max(1, median / p)))) };
}

export type MiningCapacity = Readonly<{
  all: number;
  transporters: number;
  recyclers: number;
}>;

export function explorationMiningRates(
  resourcePoints: number,
  profile: ExplorationProfile,
  capacity: MiningCapacity,
  catchupMultiplier = 1,
  defenseBoost = false,
): Readonly<TransportCargo> {
  const base = explorationBaseRate(resourcePoints, profile) * Math.max(1, Math.min(1.5, catchupMultiplier));
  const materialMining = Math.max(0, capacity.transporters);
  const debrisMining = Math.max(0, capacity.recyclers);
  const all = Math.max(0, capacity.all);
  const materialRate = Math.min(base, .1 * materialMining + .005 * Math.max(0, all - materialMining));
  const limitedMaterial = materialMining > 0 ? materialRate : Math.min(materialRate, .05 * base);
  const debrisRate = debrisMining > 0 ? Math.min(base, .1 * debrisMining + .005 * Math.max(0, all - debrisMining)) : 0;
  const boost = defenseBoost ? EXPLORATION_RULES.defenseBoost : 1;
  const result = emptyExplorationCargo();
  for (const key of keys) {
    const weight = profile.weights[key] || 0;
    result[key] = Math.max(0, Math.floor((key === 'debris' ? debrisRate : limitedMaterial) * weight * boost / 100));
  }
  return result;
}

/** Rate-independent cumulative integer accrual: remainder is counted in resource*ms. */
export function accumulateExplorationCargo(
  cargo: TransportCargo,
  reserve: TransportCargo,
  ratesPerMinute: TransportCargo,
  elapsedMs: number,
  remainder: TransportCargo,
  totalCargoCapacity: number,
): { cargo: TransportCargo; reserve: TransportCargo; remainder: TransportCargo } {
  const next = { ...cargo }, left = { ...reserve }, carry = { ...remainder };
  let free = Math.max(0, Math.floor(totalCargoCapacity) - keys.reduce((sum, key) => sum + Math.max(0, cargo[key]), 0));
  const duration = Math.max(0, Math.floor(elapsedMs));
  for (const key of keys) {
    const wholeRate = Math.max(0, Math.floor(ratesPerMinute[key]));
    const dividend = wholeRate * duration + Math.max(0, carry[key]);
    const amount = Math.min(free, Math.max(0, Math.floor(left[key])), Math.floor(dividend / 60_000));
    next[key] += amount;
    left[key] -= amount;
    free -= amount;
    carry[key] = amount < Math.floor(dividend / 60_000) ? 0 : dividend % 60_000;
  }
  return { cargo: next, reserve: left, remainder: carry };
}

export function explorationRareProbability(profile: ExplorationProfile, heldMs: number): number {
  if (!Number.isFinite(heldMs) || heldMs < 60_000) return 0;
  return profile.tokenP12 * Math.pow(Math.min(1, heldMs / 720_000), 1.5);
}

export function explorationSeedRoll(...parts: (string | number)[]): number {
  let hash = 2166136261;
  for (const part of parts.join('|')) hash = Math.imul(hash ^ part.charCodeAt(0), 16777619);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 4294967296;
}

export function explorationRareWon(profile: ExplorationProfile, heldMs: number, contactId: string, ownerId: string, claimId: string): boolean {
  return explorationSeedRoll(contactId, ownerId, claimId, 'rare') < explorationRareProbability(profile, heldMs);
}

/** 30% of actual material cargo only; no bonus rolls or negative/overflow quantities. */
export function captureExplorationCargo(loser: TransportCargo, freeCapacity: number): { captured: TransportCargo; destroyed: TransportCargo } {
  const captured = emptyExplorationCargo(), destroyed = emptyExplorationCargo();
  const total = keys.reduce((sum, key) => sum + Math.max(0, Math.floor(loser[key])), 0);
  const limit = Math.min(Math.floor(total * EXPLORATION_RULES.capturedCargoFraction), Math.max(0, Math.floor(freeCapacity)));
  let free = limit;
  for (const key of keys) {
    const available = Math.max(0, Math.floor(loser[key]));
    const target = Math.floor(available * EXPLORATION_RULES.capturedCargoFraction);
    captured[key] = Math.min(free, target);
    destroyed[key] = available - captured[key];
    free -= captured[key];
  }
  // Deterministic remaining fractional portions; never exceed per-resource 30% or total 30%.
  for (const key of keys) {
    const available = Math.max(0, Math.floor(loser[key]));
    if (!free || captured[key] >= Math.ceil(available * .30)) continue;
    captured[key] += 1;
    destroyed[key] -= 1;
    free -= 1;
  }
  return { captured, destroyed };
}

export function explorationDefenderBonusEligible(
  attackerCombatPopulation: number,
  attackerFleetCost: number,
  defenderCombatPopulation: number,
  defenderFleetCost: number,
): boolean {
  return attackerCombatPopulation >= Math.max(50, .1 * defenderCombatPopulation)
    && attackerFleetCost >= Math.max(1, .05 * defenderFleetCost);
}

export function explorationNpcAttempt(risk: ExplorationRisk, contactId: string, slot: number): boolean {
  return explorationSeedRoll(contactId, slot, 'npc-attempt') < EXPLORATION_RULES.npcAttemptChance[risk];
}

export function explorationRookieProtected(defenderHistoricalScore: number, attackerHistoricalScore: number): boolean {
  return defenderHistoricalScore < 100_000 && attackerHistoricalScore > 3 * Math.max(1, defenderHistoricalScore);
}
