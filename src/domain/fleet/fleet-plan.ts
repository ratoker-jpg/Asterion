import { SHIP_IDS, type ShipId } from '../combat/ids.ts';

/**
 * «Эталонный флот»: the fleet the player wants a planet to hold. Player data
 * only: nothing in the simulation reads it, and it never orders anything by
 * itself. Orders go through the ordinary shipyard command when the player
 * starts a line.
 */
export type FleetPlan = {
  /** Wanted number per ship type. A type with no entry is not in the plan. */
  targets: Partial<Record<ShipId, number>>;
  /** The one type that fills whatever hangar room the other targets leave («на остаток»). */
  fillShipId?: ShipId;
};

export type FleetPlans = Record<string, FleetPlan>;

/** What a planet holds of one ship type, the way the plan counts it. */
export type FleetPlanCount = {
  /** On this planet and free to fly. */
  onPlanet: number;
  /** Ordered on this planet and not finished yet. */
  queued: number;
  /** This planet's ships on a mission that will come back. */
  away: number;
};

export type FleetPlanUnit = FleetPlanCount & { id: ShipId; population: number };

export type FleetPlanHangar = {
  /** The game's own hangar numbers (`getFleetSummaryForState`). */
  used: number;
  capacity: number;
};

export type FleetPlanLineCount = FleetPlanCount & {
  id: ShipId;
  isFill: boolean;
  target: number;
  current: number;
  missing: number;
  /** Ships above the target; they stay, the plan only ever adds. */
  surplus: number;
  population: number;
};

export type FleetPlanCalculation = {
  lines: FleetPlanLineCount[];
  /** Hangar population with every fixed target reached. */
  withTargets: number;
  /** How much the fixed targets overflow the hangar; 0 when they fit. */
  overBy: number;
  /** Hangar population with the whole plan built, the fill line included. */
  withPlan: number;
};

export function emptyFleetPlan(): FleetPlan {
  return { targets: {} };
}

const safeCount = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
};

export function fleetPlanCurrent(count: FleetPlanCount): number {
  return count.onPlanet + count.queued + count.away;
}

export function isFleetPlanEmpty(plan: FleetPlan | undefined): boolean {
  return !plan || (!plan.fillShipId && Object.keys(plan.targets).length === 0);
}

/**
 * Lines in catalogue order, the fill line last: it is what remains after the
 * others. The fill target holds still while lines are started: an ordered ship
 * moves from «missing» to «used» and the room left over does not change.
 */
export function calculateFleetPlan(
  plan: FleetPlan | undefined,
  units: readonly FleetPlanUnit[],
  hangar: FleetPlanHangar,
): FleetPlanCalculation {
  const fillShipId = plan?.fillShipId;
  const fixed = units.filter((unit) => unit.id !== fillShipId && safeCount(plan?.targets[unit.id]) > 0);
  const line = (unit: FleetPlanUnit, target: number, isFill: boolean): FleetPlanLineCount => {
    const current = fleetPlanCurrent(unit);
    return {
      id: unit.id,
      isFill,
      onPlanet: unit.onPlanet,
      queued: unit.queued,
      away: unit.away,
      population: unit.population,
      target,
      current,
      missing: Math.max(0, target - current),
      surplus: Math.max(0, current - target),
    };
  };
  const lines = fixed.map((unit) => line(unit, safeCount(plan?.targets[unit.id]), false));
  const withTargets = hangar.used + lines.reduce((total, item) => total + item.missing * item.population, 0);
  const fill = fillShipId ? units.find((unit) => unit.id === fillShipId) : undefined;
  let withPlan = withTargets;
  if (fill) {
    const room = Math.max(0, hangar.capacity - withTargets);
    const extra = fill.population > 0 ? Math.floor(room / fill.population) : 0;
    lines.push(line(fill, fleetPlanCurrent(fill) + extra, true));
    withPlan += extra * fill.population;
  }
  return { lines, withTargets, overBy: Math.max(0, withTargets - hangar.capacity), withPlan };
}

/** Sets one target. 0 takes the type out of the plan. A line given its own number stops being the fill line. */
export function setFleetPlanTarget(plan: FleetPlan | undefined, shipId: ShipId, target: number): FleetPlan {
  const current = plan ?? emptyFleetPlan();
  const targets = { ...current.targets };
  const count = safeCount(target);
  if (count > 0) targets[shipId] = count;
  else delete targets[shipId];
  const keepFill = current.fillShipId && current.fillShipId !== shipId;
  return { targets, ...(keepFill ? { fillShipId: current.fillShipId } : {}) };
}

/**
 * Marks a type «на остаток», or unmarks it. There is one fill line at most. The
 * line that stops being the fill line stays in the plan at `previousFillTarget`,
 * the number it showed.
 */
export function toggleFleetPlanFill(plan: FleetPlan | undefined, shipId: ShipId, previousFillTarget = 0): FleetPlan {
  const current = plan ?? emptyFleetPlan();
  const targets = { ...current.targets };
  delete targets[shipId];
  const previous = current.fillShipId;
  const kept = safeCount(previousFillTarget);
  if (previous && kept > 0) targets[previous] = kept;
  return previous === shipId ? { targets } : { targets, fillShipId: shipId };
}

export function removeFleetPlanLine(plan: FleetPlan | undefined, shipId: ShipId): FleetPlan {
  return setFleetPlanTarget(plan, shipId, 0);
}

/** Save migration: anything malformed is dropped; a plan with nothing left is no plan. */
export function migrateFleetPlan(value: unknown): FleetPlan | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { targets?: unknown; fillShipId?: unknown };
  const rawTargets = source.targets && typeof source.targets === 'object' ? source.targets as Record<string, unknown> : {};
  const fillShipId = (SHIP_IDS as readonly unknown[]).includes(source.fillShipId) ? source.fillShipId as ShipId : undefined;
  const targets: FleetPlan['targets'] = {};
  for (const id of SHIP_IDS) {
    const count = safeCount(rawTargets[id]);
    if (count > 0 && id !== fillShipId) targets[id] = count;
  }
  const plan: FleetPlan = { targets, ...(fillShipId ? { fillShipId } : {}) };
  return isFleetPlanEmpty(plan) ? null : plan;
}

export function migrateFleetPlans(value: unknown): FleetPlans | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const plans: FleetPlans = {};
  for (const [planetId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!planetId || planetId.length > 120) continue;
    const plan = migrateFleetPlan(raw);
    if (plan) plans[planetId] = plan;
  }
  return Object.keys(plans).length ? plans : undefined;
}
