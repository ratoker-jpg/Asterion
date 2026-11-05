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
  return { ...plan, targets };
}

export function setBuildPlanPaused(plan: BuildPlan, paused: boolean): BuildPlan {
  const { paused: _was, ...rest } = plan;
  return paused ? { ...rest, paused: true } : rest;
}

function migrateBuildPlan(value: unknown): BuildPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as { targets?: unknown; paused?: unknown };
  const targets: BuildPlan['targets'] = {};
  if (source.targets && typeof source.targets === 'object') {
    for (const role of BUILDING_ROLES) {
      const raw = (source.targets as Record<string, unknown>)[role];
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) targets[role] = Math.min(roleMax(role), Math.floor(raw));
    }
  }
  if (Object.keys(targets).length === 0) return undefined;
  return { targets, ...(source.paused === true ? { paused: true } : {}) };
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
