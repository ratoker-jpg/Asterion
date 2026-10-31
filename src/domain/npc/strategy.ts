/**
 * NPC strategic plans (NPC intelligence ADR, slice 1): a plan is data in the
 * save, so it survives the owner leaving the game and the server and this
 * computer play it the same. It never grants anything: every step runs through
 * the canonical command a player would use, which still checks what is legal.
 *
 * One template for now, `strike`: ships produced on several of the owner's
 * planets, brought together by deployments at one rally planet, the target
 * re-scouted, then one attack — or a cancellation with its reason.
 */

export const NPC_STRATEGY_VERSION = 1 as const;

export type NpcPlanStatus = 'active' | 'done' | 'failed' | 'cancelled';
export type NpcStrikePhase = 'produce' | 'rally' | 'recheck' | 'launch' | 'flying';

export type NpcShipCounts = Readonly<Record<string, number>>;

/** One production order a plan placed (or still has to place) on one planet. */
export type NpcPlanOrder = Readonly<{
  planetId: string;
  itemId: string;
  quantity: number;
  /** Set once the order is in the planet's queue. */
  orderId?: string;
}>;

export type NpcPlanForecast = Readonly<{
  /** The owner's belief it wins, at creation, from its own report. */
  win: number;
  /** Expected haul and loss in resources. */
  gain: number;
  loss: number;
  /** When the force is expected to stand at the rally planet. */
  readyAt: number;
}>;

export type NpcStrikePlan = Readonly<{
  planId: string;
  template: 'strike';
  ownerId: string;
  status: NpcPlanStatus;
  phase: NpcStrikePhase;
  createdAt: number;
  deadlineAt: number;
  targetPlanetId: string;
  targetOwnerId: string;
  rallyPlanetId: string;
  /** Ships each planet contributes (its own and those it builds): the plan's reservation. */
  reserve: Readonly<Record<string, NpcShipCounts>>;
  orders: readonly NpcPlanOrder[];
  forecast: NpcPlanForecast;
  /** Time of the newest own report the plan was made from: what the owner knew. */
  knowledgeAt: number;
  /** Planets whose share already left for the rally planet. */
  sent: readonly string[];
  launchFlightId?: string;
  closedAt?: number;
  /** Why it ended other than by its attack: intel-stale, target-stronger, target-gone, deadline… */
  reason?: string;
  result?: Readonly<{ won: boolean; gain: number; loss: number }>;
}>;

export type NpcPlan = NpcStrikePlan;

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
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isCounts(value: unknown): value is NpcShipCounts {
  return isRecord(value) && Object.values(value).every((count) => Number.isSafeInteger(count) && Number(count) > 0);
}

function isOrder(value: unknown): value is NpcPlanOrder {
  return isRecord(value) && isId(value.planetId) && isId(value.itemId)
    && Number.isSafeInteger(value.quantity) && Number(value.quantity) > 0
    && (value.orderId === undefined || isId(value.orderId));
}

function isPlan(value: unknown): value is NpcPlan {
  if (!isRecord(value) || value.template !== 'strike') return false;
  const forecast = value.forecast;
  return isId(value.planId) && isId(value.ownerId) && isId(value.targetPlanetId) && isId(value.targetOwnerId) && isId(value.rallyPlanetId)
    && ['active', 'done', 'failed', 'cancelled'].includes(String(value.status))
    && ['produce', 'rally', 'recheck', 'launch', 'flying'].includes(String(value.phase))
    && isTime(value.createdAt) && isTime(value.deadlineAt) && isTime(value.knowledgeAt)
    && isRecord(value.reserve) && Object.values(value.reserve).every(isCounts)
    && Array.isArray(value.orders) && value.orders.every(isOrder)
    && Array.isArray(value.sent) && value.sent.every(isId)
    && isRecord(forecast) && isFiniteNumber(forecast.win) && isFiniteNumber(forecast.gain) && isFiniteNumber(forecast.loss) && isTime(forecast.readyAt)
    && (value.launchFlightId === undefined || isId(value.launchFlightId))
    && (value.closedAt === undefined || isTime(value.closedAt))
    && (value.reason === undefined || typeof value.reason === 'string')
    && (value.result === undefined || (isRecord(value.result) && typeof value.result.won === 'boolean'
      && isFiniteNumber(value.result.gain) && isFiniteNumber(value.result.loss)));
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
 * Saves without the section (every save before this slice) stay without it:
 * it appears with an owner's first plan check. An unreadable section is
 * dropped rather than half-trusted; plans are intentions, not assets.
 */
export function migrateNpcStrategyState(value: unknown): NpcStrategyState | undefined {
  return isNpcStrategyState(value) ? value : undefined;
}
