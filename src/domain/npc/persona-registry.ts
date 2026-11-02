import { createSeededRandom, hashSeed } from '../world/random.ts';
import { NPC_TRAIT_NAMES } from './state.ts';
import type { NpcInheritedExperience, NpcInheritedRelation, NpcTraitName, NpcTraits } from './types.ts';

/**
 * Personas above campaigns (NPC intelligence ADR §6.4, stage G). A series of
 * campaigns keeps up to 100 personas: character, compact lessons, directed
 * relations and past results. Fleet, resources, planets, coordinates and
 * intelligence never enter this file.
 *
 * The registry lives outside the save, on this computer, and is touched only
 * at the boundaries of a campaign: a running world never reads it, so the
 * server and the client play a campaign alike. A `personaId` never leaves the
 * registry: what a campaign needs is copied into its profiles keyed by `ownerId`.
 */

export const PERSONA_REGISTRY_VERSION = 1 as const;
/** Bump when a campaign's outcome should be folded again under new rules. */
export const PERSONA_OUTCOME_VERSION = 1;
export const PERSONA_POLICY_VERSION = 'npc-policy-1';

export const PERSONA_LIMITS = Object.freeze({
  personas: 100, lessons: 16, relations: 16, results: 8, series: 6, openCampaigns: 8, applied: 64,
});

/** The player has one stable identity in a series, whatever nickname they take. */
export const PLAYER_PERSONA_ID = 'p-player';

/** A trait moves at most this far in one campaign. */
export const PERSONA_TRAIT_DRIFT_MAX = 0.05;
/** Episodes before a pattern counts as a lesson (ADR §8.1). */
export const PERSONA_LESSON_MIN_EVIDENCE = 3;
const RELATION_CARRY = 0.8;
/** What a new campaign keeps of old relations: remembered, but less sure. */
const RELATION_CONFIDENCE = 0.6;
/** Selection when a world holds fewer NPC than the series (owner decision 3). */
const CONNECTED_SHARE = 0.7;

export type PersonaLesson = Readonly<{
  id: string;
  family: 'attack';
  when: Readonly<{ enemyRace: string }>;
  /** -1..1: how it went for this persona under these conditions. */
  effect: number;
  evidence: number;
  confidence: number;
  combatVersion: string;
  policyVersion: string;
}>;

export type PersonaRelation = Readonly<{
  other: string;
  trust: number;
  affinity: number;
  resentment: number;
  helpReceived: number;
  helpGiven: number;
  jointOps: number;
  lastRound: number;
  /** Absent in files written before relations were tracked inside a campaign. */
  fear?: number;
  reliability?: number;
}>;

export type PersonaCampaignResult = Readonly<{
  round: number;
  kind: 'gate' | 'left';
  won: boolean;
  attackWins: number;
  attackLosses: number;
  defenseWins: number;
  defenseLosses: number;
  aidGiven: number;
  aidReceived: number;
  jointOps: number;
  at: number;
}>;

export type PersonaRecord = Readonly<{
  personaId: string;
  version: 1;
  createdAt: number;
  campaigns: number;
  traits: NpcTraits;
  /** How much this persona plays and when: the player behind the nickname. */
  propensity: number;
  timezoneOffsetMinutes: number;
  /** Learned leanings by action family or plan template, -1..1. */
  prefs: Readonly<Record<string, number>>;
  lessons: readonly PersonaLesson[];
  relations: readonly PersonaRelation[];
  results: readonly PersonaCampaignResult[];
  lastPolicyVersion: string;
  lastCombatVersion: string;
}>;

export type PersonaOpenCampaign = Readonly<{
  campaignId: string;
  round: number;
  startedAt: number;
  /** `ownerId → personaId`. Kept here, never in the save. */
  bindings: Readonly<Record<string, string>>;
}>;

export type PersonaSeries = Readonly<{
  seriesId: string;
  createdAt: number;
  updatedAt: number;
  /** Campaigns folded so far; the next one plays round `rounds + 1`. */
  rounds: number;
  personas: readonly PersonaRecord[];
  /** `campaignId:outcomeVersion` already folded: a repeat changes nothing. */
  applied: readonly string[];
  open: readonly PersonaOpenCampaign[];
}>;

export type PersonaRegistry = Readonly<{
  version: typeof PERSONA_REGISTRY_VERSION;
  series: readonly PersonaSeries[];
}>;

export function createPersonaRegistry(): PersonaRegistry {
  return { version: PERSONA_REGISTRY_VERSION, series: [] };
}

/* ------------------------------------------------------------- validation */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isTime = (value: unknown): value is number => Number.isSafeInteger(value);
const isUnit = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;
const isSigned = (value: unknown): value is number => typeof value === 'number' && value >= -1 && value <= 1;

function isLesson(value: unknown): value is PersonaLesson {
  return isRecord(value) && isId(value.id) && value.family === 'attack' && isRecord(value.when) && isId(value.when.enemyRace)
    && isSigned(value.effect) && isCount(value.evidence) && isUnit(value.confidence)
    && isId(value.combatVersion) && isId(value.policyVersion);
}

function isRelation(value: unknown): value is PersonaRelation {
  return isRecord(value) && isId(value.other) && isUnit(value.trust) && isUnit(value.affinity) && isUnit(value.resentment)
    && isCount(value.helpReceived) && isCount(value.helpGiven) && isCount(value.jointOps) && isCount(value.lastRound)
    && (value.fear === undefined || isUnit(value.fear)) && (value.reliability === undefined || isUnit(value.reliability));
}

function isResult(value: unknown): value is PersonaCampaignResult {
  return isRecord(value) && isCount(value.round) && (value.kind === 'gate' || value.kind === 'left') && typeof value.won === 'boolean'
    && ['attackWins', 'attackLosses', 'defenseWins', 'defenseLosses', 'aidGiven', 'aidReceived', 'jointOps'].every((key) => isCount(value[key]))
    && isTime(value.at);
}

function isPersona(value: unknown): value is PersonaRecord {
  if (!isRecord(value) || !isId(value.personaId) || value.version !== 1 || !isTime(value.createdAt) || !isCount(value.campaigns)) return false;
  const traits = value.traits;
  return isRecord(traits) && NPC_TRAIT_NAMES.every((name) => isUnit(traits[name]))
    && isUnit(value.propensity) && Number.isSafeInteger(value.timezoneOffsetMinutes)
    && isRecord(value.prefs) && Object.values(value.prefs).every(isSigned)
    && Array.isArray(value.lessons) && value.lessons.every(isLesson)
    && Array.isArray(value.relations) && value.relations.every(isRelation)
    && Array.isArray(value.results) && value.results.every(isResult)
    && isId(value.lastPolicyVersion) && isId(value.lastCombatVersion);
}

function isOpenCampaign(value: unknown): value is PersonaOpenCampaign {
  return isRecord(value) && isId(value.campaignId) && isCount(value.round) && isTime(value.startedAt)
    && isRecord(value.bindings) && Object.values(value.bindings).every(isId);
}

function isSeries(value: unknown): value is PersonaSeries {
  return isRecord(value) && isId(value.seriesId) && isTime(value.createdAt) && isTime(value.updatedAt) && isCount(value.rounds)
    && Array.isArray(value.personas) && value.personas.every(isPersona)
    && new Set(value.personas.map((persona) => (persona as PersonaRecord).personaId)).size === value.personas.length
    && Array.isArray(value.applied) && value.applied.every(isId)
    && Array.isArray(value.open) && value.open.every(isOpenCampaign);
}

export type PersonaRegistryParse =
  | { ok: true; registry: PersonaRegistry }
  | { ok: false; reason: 'corrupt' | 'newer' };

export function parsePersonaRegistry(text: string): PersonaRegistryParse {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: 'corrupt' }; }
  if (!isRecord(value)) return { ok: false, reason: 'corrupt' };
  if (typeof value.version === 'number' && value.version > PERSONA_REGISTRY_VERSION) return { ok: false, reason: 'newer' };
  if (value.version !== PERSONA_REGISTRY_VERSION || !Array.isArray(value.series) || !value.series.every(isSeries)) return { ok: false, reason: 'corrupt' };
  return { ok: true, registry: value as unknown as PersonaRegistry };
}

/* ------------------------------------------------------------ small helpers */

const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min);
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const compareIds = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function hex16(seed: string): string {
  const part = (index: number) => hashSeed(`${seed}:${index}`).toString(16).padStart(8, '0');
  return `${part(0)}${part(1)}`;
}

/** A campaign's identity: stable across reloads and copies of the save, says nothing about its salt. */
export function campaignIdFromSalt(personaSalt: string): string {
  return `c-${hex16(`persona-campaign:v1:${personaSalt}`)}`;
}

function appliedKey(campaignId: string): string {
  return `${campaignId}:${PERSONA_OUTCOME_VERSION}`;
}

export function isCampaignApplied(registry: PersonaRegistry, campaignId: string): boolean {
  return registry.series.some((series) => series.applied.includes(appliedKey(campaignId)));
}

export function findSeries(registry: PersonaRegistry, seriesId: string): PersonaSeries | null {
  return registry.series.find((series) => series.seriesId === seriesId) ?? null;
}

export function latestSeries(registry: PersonaRegistry): PersonaSeries | null {
  return [...registry.series].sort((left, right) => right.updatedAt - left.updatedAt || compareIds(left.seriesId, right.seriesId))[0] ?? null;
}

function replaceSeries(registry: PersonaRegistry, next: PersonaSeries): PersonaRegistry {
  const others = registry.series.filter((series) => series.seriesId !== next.seriesId);
  const kept = [next, ...others].sort((left, right) => right.updatedAt - left.updatedAt || compareIds(left.seriesId, right.seriesId))
    .slice(0, PERSONA_LIMITS.series);
  return { version: PERSONA_REGISTRY_VERSION, series: kept };
}

/* ---------------------------------------------------- start of a campaign */

/** How strongly two personas are tied: what each remembers of the other. */
function ties(series: PersonaSeries): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  const add = (from: string, to: string, weight: number) => {
    const row = map.get(from) ?? new Map<string, number>();
    row.set(to, (row.get(to) ?? 0) + weight);
    map.set(from, row);
  };
  for (const persona of series.personas) {
    for (const relation of persona.relations) {
      if (relation.other === PLAYER_PERSONA_ID) continue;
      const weight = relation.trust + relation.affinity + relation.resentment;
      add(persona.personaId, relation.other, weight);
      add(relation.other, persona.personaId, weight);
    }
  }
  return map;
}

/**
 * Who plays a world of `count` NPC (owner decision 3). All of them when they
 * fit; otherwise the ones most tied to those already chosen, plus a share of
 * random ones so that a persona without ties still gets to play. Deterministic
 * from the new campaign's salt.
 */
export function selectPersonas(series: PersonaSeries, count: number, salt: string): string[] {
  const key = (id: string) => createSeededRandom(`persona-pick:v1:${salt}:${id}`)();
  const shuffled = series.personas.map((persona) => persona.personaId)
    .sort((left, right) => key(left) - key(right) || compareIds(left, right));
  if (count >= shuffled.length) return shuffled;
  const connected = Math.round(count * CONNECTED_SHARE);
  const graph = ties(series);
  const chosen: string[] = [];
  const left = new Set(shuffled);
  const degree = new Map(shuffled.map((id) => [id, [...(graph.get(id)?.values() ?? [])].reduce((sum, weight) => sum + weight, 0)]));
  while (chosen.length < connected) {
    let best: string | null = null;
    let bestScore = -1;
    for (const id of left) {
      // Ties to those chosen come first; overall connectedness picks the first one and breaks ties.
      const row = graph.get(id);
      const score = chosen.reduce((sum, other) => sum + (row?.get(other) ?? 0), 0) + degree.get(id)! * 0.001;
      if (score > bestScore) { best = id; bestScore = score; }
    }
    chosen.push(best!);
    left.delete(best!);
  }
  for (const id of shuffled) {
    if (chosen.length >= count) break;
    if (left.has(id)) chosen.push(id);
  }
  return chosen;
}

/** Older knowledge counts for less once the balance or the policy has changed. */
function versionWeight(combatVersion: string, policyVersion: string, currentCombat: string): number {
  return (combatVersion === currentCombat ? 1 : 0.5) * (policyVersion === PERSONA_POLICY_VERSION ? 1 : 0.75);
}

export type SeriesCampaignStart = Readonly<{
  registry: PersonaRegistry;
  round: number;
  /** Personas for the owners that got one; the others play new characters. */
  personas: Readonly<Record<string, PersonaRecord>>;
  inherited: Readonly<Record<string, NpcInheritedExperience>>;
}>;

/**
 * Binds the NPC of a new world to personas of the series. Which persona lands
 * on which `ownerId` comes from the new salt alone, so neither the owner number
 * nor the public nickname (a separate stream) says who is who.
 */
export function beginSeriesCampaign(registry: PersonaRegistry, seriesId: string, input: Readonly<{
  campaignId: string; ownerIds: readonly string[]; playerId: string; salt: string; at: number; combatVersion: string;
}>): SeriesCampaignStart | null {
  const series = findSeries(registry, seriesId);
  if (!series) return null;
  const ownerKey = (id: string) => createSeededRandom(`persona-owner:v1:${input.salt}:${id}`)();
  const seats = [...input.ownerIds].sort((left, right) => ownerKey(left) - ownerKey(right) || compareIds(left, right));
  const picked = selectPersonas(series, seats.length, input.salt);
  const byId = new Map(series.personas.map((persona) => [persona.personaId, persona]));
  const bindings: Record<string, string> = {};
  const ownerOf = new Map<string, string>([[PLAYER_PERSONA_ID, input.playerId]]);
  picked.forEach((personaId, index) => {
    bindings[seats[index]!] = personaId;
    ownerOf.set(personaId, seats[index]!);
  });
  const round = series.rounds + 1;
  const personas: Record<string, PersonaRecord> = {};
  const inherited: Record<string, NpcInheritedExperience> = {};
  for (const [ownerId, personaId] of Object.entries(bindings)) {
    const persona = byId.get(personaId)!;
    personas[ownerId] = persona;
    const prefWeight = versionWeight(persona.lastCombatVersion, persona.lastPolicyVersion, input.combatVersion);
    const relations: Record<string, NpcInheritedRelation> = {};
    for (const relation of persona.relations) {
      const other = ownerOf.get(relation.other);
      if (!other) continue;
      relations[other] = {
        trust: round4(relation.trust * RELATION_CONFIDENCE),
        affinity: round4(relation.affinity * RELATION_CONFIDENCE),
        resentment: round4(relation.resentment * RELATION_CONFIDENCE),
        ...(relation.fear !== undefined ? { fear: round4(relation.fear * RELATION_CONFIDENCE) } : {}),
        ...(relation.reliability !== undefined ? { reliability: relation.reliability } : {}),
      };
    }
    inherited[ownerId] = {
      round,
      prefs: Object.fromEntries(Object.entries(persona.prefs).map(([kind, value]) => [kind, round4(value * prefWeight)])),
      lessons: persona.lessons.map((lesson) => ({
        family: lesson.family,
        enemyRace: lesson.when.enemyRace,
        effect: round4(lesson.effect * lesson.confidence * versionWeight(lesson.combatVersion, lesson.policyVersion, input.combatVersion)),
      })),
      relations,
    };
  }
  const open: PersonaOpenCampaign = { campaignId: input.campaignId, round, startedAt: input.at, bindings };
  const next: PersonaSeries = {
    ...series,
    updatedAt: input.at,
    open: [open, ...series.open.filter((item) => item.campaignId !== input.campaignId)].slice(0, PERSONA_LIMITS.openCampaigns),
  };
  return { registry: replaceSeries(registry, next), round, personas, inherited };
}

/* ------------------------------------------------------ end of a campaign */

export type PersonaOwnerFacts = Readonly<{
  traits: NpcTraits;
  propensity: number;
  timezoneOffsetMinutes: number;
  won: boolean;
  attackWins: number;
  attackLosses: number;
  defenseWins: number;
  defenseLosses: number;
  /** Attacks this owner made, by the defender's race. */
  attacksByRace: Readonly<Record<string, Readonly<{ wins: number; losses: number }>>>;
  /** Closed plans by template (empty until the campaign has plans). */
  plans: Readonly<Record<string, Readonly<{ n: number; wins: number; cancelled: number }>>>;
}>;

/** What one owner did to another, from what the save confirms. */
export type PersonaEdgeFacts = Readonly<{
  from: string;
  to: string;
  /** `from` suffered these attacks from `to`. */
  attacks: number;
  damage: number;
  /** `from` received these aid deliveries from `to`. */
  helpReceived: number;
  /** `from` delivered this much aid to `to`. */
  helpGiven: number;
  jointOps: number;
  /** How the campaign left what `from` thinks of `to` (domain/npc/relations.ts), where it kept an edge. */
  final?: Readonly<{ trust: number; affinity: number; fear: number; resentment: number; reliability?: number }>;
}>;

export type CampaignFacts = Readonly<{
  campaignId: string;
  kind: 'gate' | 'left';
  at: number;
  playerId: string;
  combatVersion: string;
  owners: Readonly<Record<string, PersonaOwnerFacts>>;
  edges: readonly PersonaEdgeFacts[];
}>;

function foundPersona(campaignId: string, ownerId: string, facts: PersonaOwnerFacts, at: number, combatVersion: string): PersonaRecord {
  return {
    personaId: `p-${hex16(`persona:v1:${campaignId}:${ownerId}`)}`,
    version: 1,
    createdAt: at,
    campaigns: 0,
    traits: facts.traits,
    propensity: facts.propensity,
    timezoneOffsetMinutes: facts.timezoneOffsetMinutes,
    prefs: {},
    lessons: [],
    relations: [],
    results: [],
    lastPolicyVersion: PERSONA_POLICY_VERSION,
    lastCombatVersion: combatVersion,
  };
}

function balance(wins: number, losses: number): number {
  const n = wins + losses;
  return n > 0 ? (wins - losses) / n : 0;
}

/** The character shifts slowly and only on what happened; the persona's adaptability sets the pace. */
function driftTraits(traits: NpcTraits, facts: PersonaOwnerFacts, cooperated: number, raids: number): NpcTraits {
  const attacks = facts.attackWins + facts.attackLosses;
  const attackSignal = attacks >= PERSONA_LESSON_MIN_EVIDENCE ? balance(facts.attackWins, facts.attackLosses) : 0;
  const defenses = facts.defenseWins + facts.defenseLosses;
  const defenseSignal = defenses >= PERSONA_LESSON_MIN_EVIDENCE ? balance(facts.defenseWins, facts.defenseLosses) : 0;
  const social = Math.min(1, cooperated / 5);
  const signals: Partial<Record<NpcTraitName, number>> = {
    aggression: attackSignal,
    riskTolerance: attackSignal * 0.5,
    militaryFocus: (attackSignal + defenseSignal) * 0.5,
    cooperation: social,
    socialStyle: social * 0.5,
    operationsInterest: Math.min(1, raids / 3),
    mechanicsKnowledge: attacks + defenses > 0 ? 0.5 : 0,
    planningHorizon: facts.won ? 0.5 : 0,
  };
  const rate = PERSONA_TRAIT_DRIFT_MAX * (0.4 + 0.6 * clamp(traits.adaptability, 0, 1));
  const next: Record<NpcTraitName, number> = { ...traits };
  for (const name of NPC_TRAIT_NAMES) {
    const signal = signals[name];
    if (signal) next[name] = round4(clamp(traits[name] + rate * clamp(signal, -1, 1), 0, 1));
  }
  return next;
}

/** ADR §8.1: `pref ← pref + η(score − pref)`, with a rate that slows as a persona settles. */
function adapt(previous: number, score: number, evidence: number, adaptability: number, campaigns: number): number {
  const confidence = Math.min(1, evidence / 10);
  const rate = 0.15 * (0.3 + 0.7 * clamp(adaptability, 0, 1)) * confidence / (1 + campaigns / 8);
  return round4(clamp(previous + rate * (clamp(score, -1, 1) - previous), -1, 1));
}

function foldPrefs(persona: PersonaRecord, facts: PersonaOwnerFacts, cooperated: number, raids: number): Readonly<Record<string, number>> {
  const prefs: Record<string, number> = { ...persona.prefs };
  const learn = (kind: string, score: number, evidence: number) => {
    if (evidence < PERSONA_LESSON_MIN_EVIDENCE) return;
    prefs[kind] = adapt(prefs[kind] ?? 0, score, evidence, persona.traits.adaptability, persona.campaigns);
  };
  learn('attack', balance(facts.attackWins, facts.attackLosses), facts.attackWins + facts.attackLosses);
  // Help that really arrived and raids flown together are the only evidence here: nothing says they were wasted.
  learn('aid', 1, cooperated);
  learn('diplomacy', 1, raids);
  for (const [template, stat] of Object.entries(facts.plans)) {
    learn(template, (2 * stat.wins - stat.n) / Math.max(1, stat.n) - 0.25 * stat.cancelled / Math.max(1, stat.n), stat.n);
  }
  return prefs;
}

function foldLessons(persona: PersonaRecord, facts: PersonaOwnerFacts, combatVersion: string): readonly PersonaLesson[] {
  const lessons = new Map(persona.lessons.map((lesson) => [lesson.id, lesson]));
  for (const enemyRace of Object.keys(facts.attacksByRace).sort(compareIds)) {
    const { wins, losses } = facts.attacksByRace[enemyRace]!;
    const fresh = wins + losses;
    const id = `attack:${enemyRace}`;
    const old = lessons.get(id);
    if (fresh < PERSONA_LESSON_MIN_EVIDENCE && !old) continue;
    const oldWeight = old ? old.evidence * versionWeight(old.combatVersion, old.policyVersion, combatVersion) : 0;
    const total = oldWeight + fresh;
    if (total <= 0) continue;
    const effect = ((old?.effect ?? 0) * oldWeight + balance(wins, losses) * fresh) / total;
    const evidence = Math.round(total);
    lessons.set(id, {
      id, family: 'attack', when: { enemyRace }, effect: round4(clamp(effect, -1, 1)), evidence,
      confidence: round4(Math.min(1, evidence / 10)), combatVersion, policyVersion: PERSONA_POLICY_VERSION,
    });
  }
  return [...lessons.values()]
    .sort((left, right) => right.confidence * Math.abs(right.effect) - left.confidence * Math.abs(left.effect) || compareIds(left.id, right.id))
    .slice(0, PERSONA_LIMITS.lessons);
}

/** Saturating gain: each event closes a share of what is left to 1. */
function gain(value: number, share: number, events: number): number {
  return 1 - (1 - value) * (1 - share) ** Math.min(8, events);
}

function foldRelations(persona: PersonaRecord, edges: readonly PersonaEdgeFacts[], personaOf: ReadonlyMap<string, string>, round: number): readonly PersonaRelation[] {
  const relations = new Map<string, PersonaRelation>(persona.relations.map((relation) => [relation.other, {
    ...relation,
    trust: relation.trust * RELATION_CARRY,
    affinity: relation.affinity * RELATION_CARRY,
    resentment: relation.resentment * RELATION_CARRY,
    ...(relation.fear !== undefined ? { fear: relation.fear * RELATION_CARRY } : {}),
  }]));
  for (const edge of edges) {
    const other = personaOf.get(edge.to);
    if (!other || other === persona.personaId) continue;
    const old = relations.get(other) ?? { other, trust: 0, affinity: 0, resentment: 0, helpReceived: 0, helpGiven: 0, jointOps: 0, lastRound: round };
    const hurt = edge.attacks > 0 ? 0.2 * edge.attacks + 0.08 * Math.log10(1 + edge.damage) : 0;
    const trust = gain(gain(old.trust, 0.15, edge.helpReceived), 0.08, edge.jointOps) * 0.8 ** Math.min(4, edge.attacks);
    const affinity = gain(gain(gain(old.affinity, 0.1, edge.helpReceived), 0.1, edge.jointOps), 0.03, edge.helpGiven);
    const final = edge.final;
    // Where the campaign kept an opinion it speaks too: a warm one lifts, a betrayal cuts what the counts alone would keep.
    const settled = (counted: number, felt: number) => (felt >= 0 ? Math.max(counted, felt) : counted * (1 + felt));
    relations.set(other, {
      other,
      trust: final ? settled(trust, final.trust) : trust,
      // Helping someone leaves a little warmth too, though it says nothing about trusting them.
      affinity: final ? settled(affinity, final.affinity) : affinity,
      resentment: Math.max(clamp(old.resentment + hurt, 0, 1), final?.resentment ?? 0),
      ...(final ? { fear: round4(Math.max(old.fear ?? 0, final.fear)) } : old.fear !== undefined ? { fear: round4(old.fear) } : {}),
      ...(final?.reliability !== undefined ? { reliability: round4(final.reliability) } : old.reliability !== undefined ? { reliability: old.reliability } : {}),
      helpReceived: old.helpReceived + edge.helpReceived,
      helpGiven: old.helpGiven + edge.helpGiven,
      jointOps: old.jointOps + edge.jointOps,
      lastRound: round,
    });
  }
  const weight = (relation: PersonaRelation) => Math.max(relation.trust, relation.affinity, relation.resentment);
  return [...relations.values()]
    .map((relation) => ({ ...relation, trust: round4(relation.trust), affinity: round4(relation.affinity), resentment: round4(relation.resentment), ...(relation.fear !== undefined ? { fear: round4(relation.fear) } : {}) }))
    .filter((relation) => weight(relation) >= 0.01)
    .sort((left, right) => weight(right) - weight(left) || right.lastRound - left.lastRound || compareIds(left.other, right.other))
    .slice(0, PERSONA_LIMITS.relations);
}

export type CampaignFold = Readonly<{ registry: PersonaRegistry; seriesId: string; changed: boolean }>;

/**
 * Folds a finished campaign into its series, once: a repeat for the same
 * `campaignId + outcomeVersion` returns the registry untouched. A campaign
 * bound to nothing founds a new series out of its own NPC, so the very first
 * finished campaign can be continued; a clean world never joins another's.
 */
export function foldCampaign(registry: PersonaRegistry, facts: CampaignFacts): CampaignFold {
  const applied = appliedKey(facts.campaignId);
  const done = registry.series.find((series) => series.applied.includes(applied));
  if (done) return { registry, seriesId: done.seriesId, changed: false };
  const bound = registry.series.find((series) => series.open.some((open) => open.campaignId === facts.campaignId));
  const series: PersonaSeries = bound ?? {
    seriesId: `s-${hex16(`persona-series:v1:${facts.campaignId}`)}`,
    createdAt: facts.at, updatedAt: facts.at, rounds: 0, personas: [], applied: [], open: [],
  };
  const open = series.open.find((item) => item.campaignId === facts.campaignId);
  const round = open?.round ?? series.rounds + 1;
  const personas = new Map(series.personas.map((persona) => [persona.personaId, persona]));
  const personaOf = new Map<string, string>([[facts.playerId, PLAYER_PERSONA_ID]]);
  const owners = Object.keys(facts.owners).sort(compareIds);
  for (const ownerId of owners) {
    const known = open?.bindings[ownerId];
    if (known && personas.has(known)) { personaOf.set(ownerId, known); continue; }
    if (personas.size >= PERSONA_LIMITS.personas) continue;
    const founded = foundPersona(facts.campaignId, ownerId, facts.owners[ownerId]!, facts.at, facts.combatVersion);
    personas.set(founded.personaId, founded);
    personaOf.set(ownerId, founded.personaId);
  }
  const edgesOf = new Map<string, PersonaEdgeFacts[]>();
  for (const edge of facts.edges) {
    const list = edgesOf.get(edge.from);
    if (list) list.push(edge);
    else edgesOf.set(edge.from, [edge]);
  }
  for (const ownerId of owners) {
    const personaId = personaOf.get(ownerId);
    if (!personaId) continue;
    const persona = personas.get(personaId)!;
    const owner = facts.owners[ownerId]!;
    const edges = edgesOf.get(ownerId) ?? [];
    const aidGiven = edges.reduce((sum, edge) => sum + edge.helpGiven, 0);
    const aidReceived = edges.reduce((sum, edge) => sum + edge.helpReceived, 0);
    const jointOps = edges.reduce((sum, edge) => sum + edge.jointOps, 0);
    const cooperated = aidGiven + aidReceived;
    personas.set(personaId, {
      ...persona,
      campaigns: persona.campaigns + 1,
      traits: driftTraits(persona.traits, owner, cooperated + jointOps, jointOps),
      prefs: foldPrefs(persona, owner, cooperated, jointOps),
      lessons: foldLessons(persona, owner, facts.combatVersion),
      relations: foldRelations(persona, edges, personaOf, round),
      results: [...persona.results, {
        round, kind: facts.kind, won: owner.won,
        attackWins: owner.attackWins, attackLosses: owner.attackLosses,
        defenseWins: owner.defenseWins, defenseLosses: owner.defenseLosses,
        aidGiven, aidReceived, jointOps, at: facts.at,
      }].slice(-PERSONA_LIMITS.results),
      lastPolicyVersion: PERSONA_POLICY_VERSION,
      lastCombatVersion: facts.combatVersion,
    });
  }
  const next: PersonaSeries = {
    ...series,
    updatedAt: facts.at,
    rounds: Math.max(series.rounds, round),
    personas: [...personas.values()],
    applied: [...series.applied, applied].slice(-PERSONA_LIMITS.applied),
    open: series.open.filter((item) => item.campaignId !== facts.campaignId),
  };
  return { registry: replaceSeries(registry, next), seriesId: next.seriesId, changed: true };
}
