import { BUILDING_ROLES, type BuildingRole } from './balance-v1.ts';
import { getBuildingDefinition } from './resource-zone.ts';

/**
 * «Планировщик стройки»: the levels a player wants a planet's buildings to
 * reach. Player data only: nothing in the simulation reads it. The game
 * starts upgrades towards these targets with ordinary build commands, and only
 * while the player is in the game (see `application/build-plan.ts`).
 */
export type BuildPlan = {
  /** Wanted level per building; a building without an entry is not planned. */
  targets: Partial<Record<BuildingRole, number>>;
  /** The player switched the automatic start off; the targets stay. */
  paused?: boolean;
  /**
   * The player's own priority, first is most important. Planned buildings
   * missing from it follow in the default order (see `buildPriority`).
   */
  order?: BuildingRole[];
};

export type BuildPlans = Record<string, BuildPlan>;

export function emptyBuildPlan(): BuildPlan {
  return { targets: {} };
}

export function isBuildPlanEmpty(plan: BuildPlan): boolean {
  return Object.keys(plan.targets).length === 0;
}

const roleMax = (role: BuildingRole) => getBuildingDefinition(role).maxLevel;

/** Sets one target, kept between 1 and the building's last level. */
export function setBuildTarget(plan: BuildPlan, role: BuildingRole, level: number): BuildPlan {
  const clean = Math.min(roleMax(role), Math.max(1, Math.floor(level)));
  return { ...plan, targets: { ...plan.targets, [role]: clean } };
}

export function removeBuildTarget(plan: BuildPlan, role: BuildingRole): BuildPlan {
  const { [role]: _removed, ...targets } = plan.targets;
  const { order, ...rest } = plan;
  const kept = order?.filter((item) => item !== role);
  return { ...rest, targets, ...(kept?.length ? { order: kept } : {}) };
}

/** Buildings that make every other construction faster go first unless the player says otherwise. */
const SPEEDS_UP_CONSTRUCTION: readonly BuildingRole[] = ['construction'];
const ROLE_INDEX = new Map(BUILDING_ROLES.map((role, index) => [role, index]));

/**
 * The planned buildings, most important first: the player's own order, then
 * the rest by default (construction speed first, then the usual building
 * order). Energy jumps ahead by itself only when it is short.
 */
export function buildPriority(plan: BuildPlan): BuildingRole[] {
  const planned = BUILDING_ROLES.filter((role) => plan.targets[role]);
  const own = (plan.order ?? []).filter((role, index, list) => plan.targets[role] && list.indexOf(role) === index);
  const rest = planned.filter((role) => !own.includes(role)).sort((a, b) =>
    Number(SPEEDS_UP_CONSTRUCTION.includes(b)) - Number(SPEEDS_UP_CONSTRUCTION.includes(a)) || ROLE_INDEX.get(a)! - ROLE_INDEX.get(b)!);
  return [...own, ...rest];
}

/** Moves one planned building up (−1) or down (+1) in the priority; the whole order is saved from then on. */
export function moveBuildPriority(plan: BuildPlan, role: BuildingRole, delta: -1 | 1): BuildPlan {
  const order = buildPriority(plan);
  const to = order.indexOf(role) + delta;
  return to < 0 || to >= order.length || !order.includes(role) ? plan : swapBuildPriority(plan, role, order[to]!);
}

/** Two planned buildings trade places in the priority (the planner moves a building past its neighbour in the same zone). */
export function swapBuildPriority(plan: BuildPlan, role: BuildingRole, other: BuildingRole): BuildPlan {
  const order = buildPriority(plan);
  const a = order.indexOf(role);
  const b = order.indexOf(other);
  if (a < 0 || b < 0 || a === b) return plan;
  [order[a], order[b]] = [order[b]!, order[a]!];
  return { ...plan, order };
}

/** «Важно»: the building goes to the head of the priority, the rest keep their order. */
export function putBuildPriorityFirst(plan: BuildPlan, role: BuildingRole): BuildPlan {
  const order = buildPriority(plan);
  if (!order.includes(role) || order[0] === role) return plan;
  return { ...plan, order: [role, ...order.filter((item) => item !== role)] };
}

export function setBuildPlanPaused(plan: BuildPlan, paused: boolean): BuildPlan {
  const { paused: _was, ...rest } = plan;
  return paused ? { ...rest, paused: true } : rest;
}

function migrateBuildPlan(value: unknown): BuildPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as { targets?: unknown; paused?: unknown; order?: unknown };
  const targets: BuildPlan['targets'] = {};
  if (source.targets && typeof source.targets === 'object') {
    for (const role of BUILDING_ROLES) {
      const raw = (source.targets as Record<string, unknown>)[role];
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) targets[role] = Math.min(roleMax(role), Math.floor(raw));
    }
  }
  if (Object.keys(targets).length === 0) return undefined;
  const order = Array.isArray(source.order)
    ? source.order.filter((role, index, list): role is BuildingRole => typeof role === 'string' && ROLE_INDEX.has(role as BuildingRole) && Boolean(targets[role as BuildingRole]) && list.indexOf(role) === index)
    : [];
  return { targets, ...(source.paused === true ? { paused: true } : {}), ...(order.length ? { order } : {}) };
}

export function migrateBuildPlans(value: unknown): BuildPlans | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const plans: BuildPlans = {};
  for (const [planetId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!planetId || planetId.length > 120) continue;
    const plan = migrateBuildPlan(raw);
    if (plan) plans[planetId] = plan;
  }
  return Object.keys(plans).length ? plans : undefined;
}
