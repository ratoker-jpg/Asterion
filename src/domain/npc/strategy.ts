/**
 * NPC strategic plans (NPC intelligence ADR): a plan is data in the save, so it
 * survives the owner leaving the game and the server and this computer play it
 * the same. It never grants anything: every step runs through the canonical
 * command a player would use, which still checks what is legal.
 */
import { isNpcSunRaidPrepPlan, type NpcSunRaidPrepPlan } from './sun-prep.ts';

export const NPC_STRATEGY_VERSION = 1 as const;

export type NpcPlanStatus = 'active' | 'done' | 'failed' | 'cancelled';

export type NpcPlanForecast = Readonly<{
  /** The owner's belief it wins, at creation, from its own report. */
  win: number;
  /** Expected haul and loss in resources. */
  gain: number;
  loss: number;
  /** When the force is expected to stand ready. */
  readyAt: number;
}>;

export type NpcPlan = NpcSunRaidPrepPlan;

/** What came of an owner's plans of one template (small running sums). */
export type NpcOutcomeStat = Readonly<{
  n: number;
  done: number;
  wins: number;
  cancelled: number;
  /** Sum of (actual − forecast) win, and of its absolute value: forecast error. */
  sumError: number;
  sumAbsError: number;
  lastAt: number;
}>;

export type NpcStrategyState = Readonly<{
  version: typeof NPC_STRATEGY_VERSION;
  /** Per owner: active plans first, then the last few closed ones. */
  plans: Readonly<Record<string, readonly NpcPlan[]>>;
  outcomes: Readonly<Record<string, Readonly<Record<string, NpcOutcomeStat>>>>;
  /** Per owner: the next time it considers a new plan. */
  nextCheckAt: Readonly<Record<string, number>>;
}>;

/** Closed plans kept per owner, for the owner's own judgement and the journal. */
export const NPC_CLOSED_PLANS_KEPT = 4;

export function createNpcStrategyState(): NpcStrategyState {
  return { version: NPC_STRATEGY_VERSION, plans: {}, outcomes: {}, nextCheckAt: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isPlan(value: unknown): value is NpcPlan {
  return isNpcSunRaidPrepPlan(value);
}

function isStat(value: unknown): value is NpcOutcomeStat {
  return isRecord(value) && ['n', 'done', 'wins', 'cancelled'].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    && isFiniteNumber(value.sumError) && isFiniteNumber(value.sumAbsError) && isTime(value.lastAt);
}

export function isNpcStrategyState(value: unknown): value is NpcStrategyState {
  return isRecord(value) && value.version === NPC_STRATEGY_VERSION
    && isRecord(value.plans) && Object.values(value.plans).every((plans) => Array.isArray(plans) && plans.every(isPlan))
    && isRecord(value.outcomes) && Object.values(value.outcomes).every((stats) => isRecord(stats) && Object.values(stats).every(isStat))
    && isRecord(value.nextCheckAt) && Object.values(value.nextCheckAt).every(isTime);
}

/**
 * Saves without the section (every save before it) stay without it: it appears
 * with an owner's first plan check. An unreadable section is dropped rather
 * than half-trusted; plans are intentions, not assets.
 */
export function migrateNpcStrategyState(value: unknown): NpcStrategyState | undefined {
  return isNpcStrategyState(value) ? value : undefined;
}
