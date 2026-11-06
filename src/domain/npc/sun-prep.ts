/**
 * The alliance plan «sun-raid-prep» (NPC intelligence ADR, stage F, scenario
 * 7.в) as save data: a leader picks a Sun and a time ahead, members answer in
 * their own visits, ready their fleets and come. It grants nothing: the raid
 * itself still runs through the player's commands and rules.
 */
import type { NpcPlanForecast, NpcPlanStatus } from './strategy.ts';

export type NpcSunPrepPhase = 'invite' | 'ready' | 'gathering' | 'flying';

/** приду / дам не более N / не смогу */
export type NpcSunRsvpAnswer = 'yes' | 'limit' | 'no';

export type NpcSunRsvp = Readonly<{
  answer: NpcSunRsvpAnswer;
  /** Population promised to the gathering (0 for «no»). */
  population: number;
  at: number;
  /** Why not everything: away, threat, no-fleet, force (it has no more), caution. */
  reason?: string;
  /** «Не смогу», but it says when it could: its own next visit, a thing it tells the leader. */
  freeFrom?: number;
  freeTo?: number;
  /** The planet this member's share gathers at. */
  rallyPlanetId?: string;
  /** Orders placed for this promise (each spends a share of the stores: they are counted). */
  orders?: number;
  /** What it really put into the gathering. */
  pledged?: number;
  /** Strength per population of the force it would bring (its own answer, for the leader's split of the roles). */
  quality?: number;
  /** What the leader asked of it at the declaration: the strongest forces fill the side, the rest keep their fleets home. */
  allotment?: number;
}>;

export type NpcSunRaidPrepPlan = Readonly<{
  planId: string;
  template: 'sun-raid-prep';
  /** The leader or deputy who called it. */
  ownerId: string;
  allianceId: string;
  status: NpcPlanStatus;
  phase: NpcSunPrepPhase;
  createdAt: number;
  deadlineAt: number;
  galaxy: number;
  system: number;
  /** T: when the leader declares the gathering. */
  gatherAt: number;
  /** Times T was moved (at most NPC_SUN_PREP_BALANCE.maxPostpones). */
  postponed: number;
  /** Member → answer for the current T; moving T asks again. */
  rsvps: Readonly<Record<string, NpcSunRsvp>>;
  forecast: NpcPlanForecast;
  /** Time of the newest own report the Sun was chosen from: what the leader knew. */
  knowledgeAt: number;
  raidId?: string;
  closedAt?: number;
  /** Why it ended other than by its raid. */
  reason?: string;
  result?: Readonly<{ won: boolean; gain: number; loss: number }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isRsvp(value: unknown): value is NpcSunRsvp {
  return isRecord(value) && ['yes', 'limit', 'no'].includes(String(value.answer)) && isCount(value.population) && isTime(value.at)
    && (value.reason === undefined || typeof value.reason === 'string')
    && (value.freeFrom === undefined || isTime(value.freeFrom))
    && (value.freeTo === undefined || isTime(value.freeTo))
    && (value.rallyPlanetId === undefined || isId(value.rallyPlanetId))
    && (value.orders === undefined || isCount(value.orders))
    && (value.pledged === undefined || isCount(value.pledged))
    && (value.quality === undefined || isCount(value.quality))
    && (value.allotment === undefined || isCount(value.allotment));
}

export function isNpcSunRaidPrepPlan(value: unknown): value is NpcSunRaidPrepPlan {
  if (!isRecord(value) || value.template !== 'sun-raid-prep') return false;
  const forecast = value.forecast;
  return isId(value.planId) && isId(value.ownerId) && isId(value.allianceId)
    && ['active', 'done', 'failed', 'cancelled'].includes(String(value.status))
    && ['invite', 'ready', 'gathering', 'flying'].includes(String(value.phase))
    && isTime(value.createdAt) && isTime(value.deadlineAt) && isTime(value.gatherAt) && isTime(value.knowledgeAt)
    && Number.isSafeInteger(value.galaxy) && Number.isSafeInteger(value.system)
    && Number.isSafeInteger(value.postponed) && Number(value.postponed) >= 0
    && isRecord(value.rsvps) && Object.values(value.rsvps).every(isRsvp)
    && isRecord(forecast) && Number.isFinite(forecast.win) && Number.isFinite(forecast.gain) && Number.isFinite(forecast.loss) && isTime(forecast.readyAt)
    && (value.raidId === undefined || isId(value.raidId))
    && (value.closedAt === undefined || isTime(value.closedAt))
    && (value.reason === undefined || typeof value.reason === 'string')
    && (value.result === undefined || (isRecord(value.result) && typeof value.result.won === 'boolean'
      && Number.isFinite(value.result.gain) && Number.isFinite(value.result.loss)));
}

/** Population promised so far for the current T. */
export function npcSunPromised(plan: NpcSunRaidPrepPlan): number {
  let total = 0;
  for (const rsvp of Object.values(plan.rsvps)) total += rsvp.population;
  return total;
}
