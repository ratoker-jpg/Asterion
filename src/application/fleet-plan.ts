/**
 * The planner's reading of a planet and its one command: start missing ships.
 *
 * No rule lives here. Hangar numbers are the game's own (`getFleetSummaryForState`),
 * requirements and limits come from `buildProductionItems`, and every order goes
 * through `startFleetProduction`, which has the last word.
 */
import type { ShipId } from '../domain/combat/ids.ts';
import { flightComesBackToPlanet } from '../domain/espionage/population.ts';
import {
  calculateFleetPlan,
  emptyFleetPlan,
  isFleetPlanEmpty,
  type FleetPlan,
  type FleetPlanLineCount,
} from '../domain/fleet/fleet-plan.ts';
import type { BuildingApplicationContext } from './buildings.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { buildProductionItems, type EmpireProductionItem, type EmpireRuntime } from './empire.ts';
import { getFleetSummaryForState } from './fleet.ts';
import { startFleetProduction } from './fleet-production.ts';

export const FLEET_PLAN_RESOURCES = ['metal', 'minerals', 'gas'] as const;
export type FleetPlanResource = (typeof FLEET_PLAN_RESOURCES)[number];
type ResourceAmounts = Record<FleetPlanResource, number>;

/** What stops a line from starting in full right now. */
export type FleetPlanLimit = FleetPlanResource | 'hangar';

export type FleetPlanLine = FleetPlanLineCount & {
  item: EmpireProductionItem;
  /** How many one click starts: the missing amount, or as many as can be afforded. */
  startable: number;
  /** The tightest limit below the missing amount; null when the whole line starts. */
  limitedBy: FleetPlanLimit | null;
  /** Resources the whole missing amount still lacks. */
  short: Partial<ResourceAmounts>;
  /** All of the missing amount at once. */
  cost: ResourceAmounts;
  /** Shipyard time of the whole missing amount. */
  buildMs: number;
};

export type FleetPlanView = {
  planetId: string;
  plan: FleetPlan;
  empty: boolean;
  lines: FleetPlanLine[];
  /** Every ship type of the race's shipyard, for the shelf of types not in the plan. */
  items: EmpireProductionItem[];
  hangar: {
    used: number;
    capacity: number;
    /** With the whole plan built. */
    withPlan: number;
    /** Population by which the fixed targets overflow the hangar. */
    overBy: number;
  };
  wallet: ResourceAmounts;
  /** The sum of every line's missing ships. */
  missing: number;
  missingLines: number;
  /** Lines one click can start, and how many ships that is. */
  startableLines: number;
  startable: number;
  /** All the missing ships of the lines that can be built. */
  cost: ResourceAmounts;
  short: Partial<ResourceAmounts>;
  /** When the ship queue already running here ends (0 when it is empty). */
  queueEndsAt: number;
};

export type FleetPlanGlance = {
  planned: boolean;
  missing: number;
  missingLines: number;
  startable: number;
  overBy: number;
};

function comingBackShips(state: SaveState, planetId: string): Partial<Record<ShipId, number>> {
  const away: Partial<Record<ShipId, number>> = {};
  for (const flight of state.flights?.records ?? []) {
    if (flight.ownerSide === 'bot01' || flight.ownerSide === 'npc' || flight.ownerSide === 'pirate') continue;
    if (!flightComesBackToPlanet(flight, planetId)) continue;
    for (const [shipId, quantity] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      away[shipId] = (away[shipId] ?? 0) + Math.floor(quantity);
    }
  }
  return away;
}

const amounts = (pick: (key: FleetPlanResource) => number) =>
  Object.fromEntries(FLEET_PLAN_RESOURCES.map((key) => [key, pick(key)])) as ResourceAmounts;

function shortOf(cost: ResourceAmounts, wallet: ResourceAmounts): Partial<ResourceAmounts> {
  const short: Partial<ResourceAmounts> = {};
  for (const key of FLEET_PLAN_RESOURCES) if (cost[key] > wallet[key]) short[key] = cost[key] - wallet[key];
  return short;
}

export function getFleetPlan(state: SaveState, planetId: string): FleetPlan {
  return state.fleetUi?.plans?.[planetId] ?? emptyFleetPlan();
}

/** The whole planner screen for one planet. */
export function buildFleetPlanView(state: SaveState, planetId: string, runtime: EmpireRuntime): FleetPlanView {
  const plan = getFleetPlan(state, planetId);
  const items = buildProductionItems(state, planetId, 'ships', runtime);
  const summary = getFleetSummaryForState(state, planetId);
  const away = comingBackShips(state, planetId);
  const stored = getPlanetResources(state, planetId);
  const wallet = amounts((key) => Math.max(0, Math.floor(stored[key] ?? 0)));
  const calculation = calculateFleetPlan(plan, items.map((item) => ({
    id: item.id as ShipId,
    population: item.population,
    onPlanet: item.owned,
    queued: item.pending,
    away: away[item.id as ShipId] ?? 0,
  })), { used: summary.population, capacity: summary.capacity });
  const byId = new Map(items.map((item) => [item.id, item]));
  const room = Math.max(0, summary.capacity - summary.population);
  const lines = calculation.lines.map((line): FleetPlanLine => {
    const item = byId.get(line.id)!;
    const cost = amounts((key) => item.unitCost[key] * line.missing);
    const startable = Math.min(line.missing, item.max);
    let limitedBy: FleetPlanLimit | null = null;
    if (item.unlocked && startable < line.missing) {
      const bySpace = item.population > 0 ? Math.floor(room / item.population) : Infinity;
      const tightest = FLEET_PLAN_RESOURCES
        .filter((key) => item.unitCost[key] > 0)
        .map((key) => ({ key, count: Math.floor(wallet[key] / item.unitCost[key]) }))
        .sort((a, b) => a.count - b.count)[0];
      limitedBy = tightest && tightest.count <= bySpace ? tightest.key : 'hangar';
    }
    return { ...line, item, startable, limitedBy, short: shortOf(cost, wallet), cost, buildMs: item.unitMs * line.missing };
  });
  const buildable = lines.filter((line) => line.missing > 0 && line.item.unlocked);
  const cost = amounts((key) => buildable.reduce((total, line) => total + line.cost[key], 0));
  const queue = state.planets[planetId]?.fleetProduction?.shipQueue ?? [];
  return {
    planetId,
    plan,
    empty: isFleetPlanEmpty(plan),
    lines,
    items,
    hangar: { used: summary.population, capacity: summary.capacity, withPlan: calculation.withPlan, overBy: calculation.overBy },
    wallet,
    missing: lines.reduce((total, line) => total + line.missing, 0),
    missingLines: lines.filter((line) => line.missing > 0).length,
    startableLines: lines.filter((line) => line.startable > 0).length,
    startable: lines.reduce((total, line) => total + line.startable, 0),
    cost,
    short: shortOf(cost, wallet),
    queueEndsAt: queue.at(-1)?.finishAt ?? 0,
  };
}

/** The «Империя» line: only what is missing. */
export function fleetPlanGlance(state: SaveState, planetId: string, runtime: EmpireRuntime): FleetPlanGlance {
  const view = buildFleetPlanView(state, planetId, runtime);
  return { planned: !view.empty, missing: view.missing, missingLines: view.missingLines, startable: view.startable, overBy: view.hangar.overBy };
}

export type FleetPlanStartOutcome = {
  shipId: ShipId;
  name: string;
  /** The missing amount when the order was placed. */
  wanted: number;
  started: number;
  limitedBy: FleetPlanLimit | null;
  /** The game's words when nothing could start because of a requirement or a refusal. */
  reason: string | null;
  short: Partial<ResourceAmounts>;
};

export type FleetPlanStartResult = {
  state: SaveState;
  outcomes: FleetPlanStartOutcome[];
  started: number;
};

/**
 * Starts the missing ships of the given lines, or of every line, as one
 * transition: all orders land in the same world, one after another, and each
 * next line sees what the previous one spent. Lines run in the plan's order,
 * the fill line last. Nothing is built that the player did not start.
 */
export function startFleetPlanLines(
  state: SaveState,
  context: BuildingApplicationContext,
  runtime: EmpireRuntime,
  shipIds?: readonly ShipId[],
): FleetPlanStartResult {
  const wanted = shipIds ? new Set<ShipId>(shipIds) : null;
  const ids = buildFleetPlanView(state, context.planetId, runtime).lines
    .filter((line) => !wanted || wanted.has(line.id))
    .map((line) => line.id);
  let current = state;
  const outcomes: FleetPlanStartOutcome[] = [];
  for (const shipId of ids) {
    // Read again every time: the previous order spent resources and took hangar room.
    const line = buildFleetPlanView(current, context.planetId, runtime).lines.find((item) => item.id === shipId);
    if (!line || line.missing <= 0) continue;
    const base = { shipId, name: line.item.name, wanted: line.missing, limitedBy: line.limitedBy, short: line.short };
    if (!line.item.unlocked) {
      outcomes.push({ ...base, started: 0, reason: line.item.reason });
      continue;
    }
    if (line.startable <= 0) {
      outcomes.push({ ...base, started: 0, reason: null });
      continue;
    }
    const action = startFleetProduction(current, context, 'ships', shipId, line.startable);
    if (!action.transition.ok) {
      outcomes.push({ ...base, started: 0, reason: action.transition.reason ?? null });
      continue;
    }
    current = action.state;
    outcomes.push({ ...base, started: line.startable, reason: null });
  }
  return { state: current, outcomes, started: outcomes.reduce((total, outcome) => total + outcome.started, 0) };
}
