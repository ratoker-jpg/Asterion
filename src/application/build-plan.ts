/**
 * The build planner's reading of a planet and its one command: start the next
 * upgrade towards the targets the player set.
 *
 * No rule lives here. Costs, requirements, the queue limit and the energy
 * stock are the game's own (`previewBuilding`, `getPlanetEnergyLedger`), and
 * every start goes through `startBuilding`, the same command as the «Построить»
 * button, which has the last word. The decision depends only on the saved
 * state, so it is the same after a reload and however the clock is sliced.
 */
import {
  BUILDING_ROLES,
  SCIENCE_ID_PHYSICS,
  type BuildingFaction,
  type BuildingRole,
  type ResourceCost,
} from '../domain/buildings/balance-v1.ts';
import { emptyBuildPlan, isBuildPlanEmpty, type BuildPlan } from '../domain/buildings/build-plan.ts';
import { BUILDING_QUEUE_CAPACITY, getBuildingDefinition } from '../domain/buildings/resource-zone.ts';
import { calculateNuclearReactorContribution, calculateSolarStationContribution } from '../domain/energy/runtime.ts';
import { findScience } from '../domain/science/catalog.ts';
import { previewBuilding, startBuilding, type BuildingApplicationContext } from './buildings.ts';
import { getPlanetResources, getPlanetState, type PlanetId, type SaveState } from './contracts.ts';
import { getPlanetEnergyCoordinates, getPlanetEnergyLedger } from './energy.ts';
import { isPlanetBlocked } from './overpopulation.ts';

export type BuildRuntime = Pick<BuildingApplicationContext, 'now' | 'mode' | 'testTimeScale'>;

export type BuildWaitKind = 'resources' | 'energy' | 'queue' | 'requirement' | 'science' | 'blocked' | 'order';

export type BuildPlanLine = {
  role: BuildingRole;
  name: string;
  art: string;
  current: number;
  /** Levels already in the build queue. */
  queued: number;
  target: number;
  /** The player did not plan it: it is a requirement of a planned building. */
  implied: boolean;
  levelsLeft: number;
  status: 'done' | 'building' | 'next' | 'waiting';
  /** Cost of the next level; null when nothing is left to build. */
  cost: ResourceCost | null;
  timeMs: number | null;
  wait: { kind: BuildWaitKind; text: string } | null;
};

/** The one upgrade the planner would start now. */
export type BuildDecision = {
  role: BuildingRole;
  name: string;
  /** The level this start builds. */
  level: number;
  /** Set when an energy source is built ahead for this other building. */
  startedFor: BuildingRole | null;
};

export type BuildPlanView = {
  planetId: string;
  plan: BuildPlan;
  empty: boolean;
  paused: boolean;
  lines: BuildPlanLine[];
  queueUsed: number;
  queueCapacity: number;
  energy: number;
  next: BuildDecision | null;
  /** One sentence for the whole planet: what happens next or what it waits for. */
  headline: string;
};

const ROLE_ORDER = new Map(BUILDING_ROLES.map((role, index) => [role, index]));
const RESOURCE_KEYS = ['metal', 'minerals', 'gas'] as const;
const GENITIVE = { metal: 'металла', minerals: 'минералов', gas: 'газа' } as const;
const ENERGY_ROLES: readonly BuildingRole[] = ['basic-energy', 'advanced-energy'];

const compact = (value: number) => {
  const rounded = Math.ceil(value);
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (rounded >= 10_000) return `${Math.round(rounded / 1_000).toLocaleString('ru-RU')} тыс`;
  return rounded.toLocaleString('ru-RU');
};

export function getBuildPlan(state: SaveState, planetId: string): BuildPlan {
  return state.fleetUi?.buildPlans?.[planetId] ?? emptyBuildPlan();
}

type Evaluation = { lines: BuildPlanLine[]; decision: BuildDecision | null; queueUsed: number; energy: number };

/**
 * The energy source that pays off best: energy gained by its next level per
 * resource spent on it (what the game itself will credit: Physics, the Sun and
 * the planet's orbit included). `affordable` is the best one that can start now.
 */
function energyChoice(state: SaveState, context: BuildingApplicationContext, wallet: ResourceCost, queueFull: boolean) {
  const planet = getPlanetState(state, context.planetId);
  const where = getPlanetEnergyCoordinates(planet);
  const physics = state.science.levels[SCIENCE_ID_PHYSICS] ?? 0;
  const options = ENERGY_ROLES.flatMap((role) => {
    const availability = previewBuilding(state, context, role).availability;
    const cost = availability.cost;
    if (availability.nextLevel == null || !cost || availability.requirements.some((item) => !item.met)) return [];
    const at = (level: number) => (role === 'basic-energy'
      ? calculateSolarStationContribution(level, physics, where.system, where.position, where.galaxy)
      : calculateNuclearReactorContribution(level, physics));
    const gain = at(availability.nextLevel) - at(availability.projectedLevel);
    const price = cost.metal + cost.minerals + cost.gas;
    if (gain <= 0 || price <= 0) return [];
    const affordable = !queueFull && RESOURCE_KEYS.every((key) => cost[key] <= wallet[key]);
    return [{ role, level: availability.nextLevel, efficiency: gain / price, affordable }];
  });
  options.sort((a, b) => b.efficiency - a.efficiency || ROLE_ORDER.get(a.role)! - ROLE_ORDER.get(b.role)!);
  return { best: options[0] ?? null, affordable: options.find((option) => option.affordable) ?? null };
}

function evaluate(state: SaveState, planetId: PlanetId, runtime: BuildRuntime): Evaluation {
  const factionId = state.profile.factionId as BuildingFaction;
  const context: BuildingApplicationContext = { planetId, ...runtime };
  const plan = getBuildPlan(state, planetId);
  const planet = getPlanetState(state, planetId);
  const queue = state.queues[planetId] ?? [];
  const queueFull = queue.length >= BUILDING_QUEUE_CAPACITY;
  const stored = getPlanetResources(state, planetId);
  const energy = getPlanetEnergyLedger(planet, state.science.levels).availableEnergy;
  const wallet: ResourceCost = { metal: stored.metal, minerals: stored.minerals, gas: stored.gas, energy };
  const levelOf = (role: BuildingRole) => planet.buildings[role] ?? 0;
  const queuedOf = (role: BuildingRole) => queue.filter((item) => item.assetRole === role).length;
  const projectedOf = (role: BuildingRole) => Math.min(getBuildingDefinition(role).maxLevel, levelOf(role) + queuedOf(role));

  // Planned buildings, then whatever they need first (building requirements only).
  const wanted = new Map<BuildingRole, { level: number; implied: boolean }>();
  for (const role of BUILDING_ROLES) {
    const target = plan.targets[role];
    if (target) wanted.set(role, { level: target, implied: false });
  }
  for (let changed = true, guard = 0; changed && guard < BUILDING_ROLES.length; guard += 1) {
    changed = false;
    for (const [role, entry] of [...wanted]) {
      if (entry.level <= projectedOf(role)) continue;
      for (const requirement of getBuildingDefinition(role).requirements) {
        if (requirement.kind !== 'building-level') continue;
        const have = wanted.get(requirement.assetRole);
        if (have && have.level >= requirement.level) continue;
        wanted.set(requirement.assetRole, { level: requirement.level, implied: have ? have.implied : true });
        changed = true;
      }
    }
  }

  const blocked = isPlanetBlocked(state, planetId);
  const lines: BuildPlanLine[] = [...wanted.entries()]
    .sort((a, b) => ROLE_ORDER.get(a[0])! - ROLE_ORDER.get(b[0])!)
    .map(([role, entry]) => {
      const definition = getBuildingDefinition(role, factionId);
      const availability = previewBuilding(state, context, role).availability;
      const queued = queuedOf(role);
      const levelsLeft = Math.max(0, entry.level - projectedOf(role));
      return {
        role, name: definition.name, art: definition.art, current: levelOf(role), queued, target: entry.level, implied: entry.implied, levelsLeft,
        status: levelsLeft > 0 ? 'waiting' : queued > 0 ? 'building' : 'done',
        cost: levelsLeft > 0 ? availability.cost : null,
        timeMs: levelsLeft > 0 ? availability.timeMs : null,
        wait: null,
      } satisfies BuildPlanLine;
    });
  const setWait = (line: BuildPlanLine, kind: BuildWaitKind, text: string) => { line.wait = { kind, text }; };

  // Only buildings whose requirements are met can be started; the others say what they need.
  const open: BuildPlanLine[] = [];
  for (const line of lines.filter((item) => item.levelsLeft > 0)) {
    const unmet = previewBuilding(state, context, line.role).availability.requirements.filter((item) => !item.met);
    const science = unmet.find((item) => item.kind === 'science-level');
    const building = unmet.find((item) => item.kind === 'building-level');
    if (blocked) setWait(line, 'blocked', 'Планета заблокирована из-за перенаселения.');
    else if (science) setWait(line, 'science', `Нужна наука «${findScience(science.scienceId!)?.name ?? science.label}» ур. ${science.requiredLevel}, сейчас ${science.currentLevel}.`);
    else if (building) {
      const name = getBuildingDefinition(building.assetRole!, factionId).name;
      setWait(line, 'requirement', `Сначала ${name} ур. ${building.requiredLevel}, сейчас ${building.currentLevel}${queuedOf(building.assetRole!) > 0 ? ', достраивается' : ''}.`);
    } else open.push(line);
  }
  // Cheapest upgrade first: it finishes soonest and frees the queue; the building order breaks a tie.
  const price = (line: BuildPlanLine) => (line.cost ? line.cost.metal + line.cost.minerals + line.cost.gas : Infinity);
  open.sort((a, b) => price(a) - price(b) || ROLE_ORDER.get(a.role)! - ROLE_ORDER.get(b.role)!);

  let decision: BuildDecision | null = null;
  const behind = (index: number, text: string) => {
    for (const rest of open.slice(index + 1)) setWait(rest, 'order', text);
  };
  const energyOnTheWay = queue.some((item) => ENERGY_ROLES.includes(item.assetRole));
  for (const [index, line] of open.entries()) {
    const cost = line.cost;
    if (!cost) continue;
    if (cost.energy > energy) {
      // Energy is short: the best energy source comes first, and nothing else starts meanwhile.
      const sentence = `Не хватает энергии: нужно ${compact(cost.energy)}, есть ${compact(energy)}.`;
      if (energyOnTheWay) {
        setWait(line, 'energy', `${sentence} Источник энергии уже строится.`);
        behind(index, 'Ждёт, пока появится энергия.');
        break;
      }
      const choice = energyChoice(state, context, wallet, queueFull);
      if (!choice.best) {
        setWait(line, 'energy', `${sentence} Построить источник энергии сейчас нельзя.`);
        continue;
      }
      const source = getBuildingDefinition((choice.affordable ?? choice.best).role, factionId).name;
      if (queueFull) setWait(line, 'energy', `${sentence} Нужна ${source}, но очередь стройки занята.`);
      else if (choice.affordable) {
        setWait(line, 'energy', `${sentence} Сначала строим ${source}: у неё лучшая отдача.`);
        decision = { role: choice.affordable.role, name: source, level: choice.affordable.level, startedFor: line.role };
      } else setWait(line, 'energy', `${sentence} Копим на ${source}: у неё лучшая отдача.`);
      behind(index, 'Ждёт, пока появится энергия.');
      break;
    }
    const lacking = RESOURCE_KEYS.filter((key) => cost[key] > wallet[key]);
    if (lacking.length) {
      setWait(line, 'resources', `Не хватает ${lacking.map((key) => `${GENITIVE[key]} ${compact(cost[key] - wallet[key])}`).join(', ')}.`);
      continue;
    }
    if (queueFull) {
      setWait(line, 'queue', 'Очередь стройки занята.');
      continue;
    }
    decision = { role: line.role, name: line.name, level: line.current + line.queued + 1, startedFor: null };
    behind(index, 'Ждёт своей очереди.');
    break;
  }
  const chosen = decision ? lines.find((line) => line.role === decision!.role) : undefined;
  if (chosen) { chosen.status = 'next'; chosen.wait = null; }
  return { lines, decision, queueUsed: queue.length, energy };
}

/** The whole planner screen for one planet. */
export function buildBuildPlanView(state: SaveState, planetId: string, runtime: BuildRuntime): BuildPlanView {
  const plan = getBuildPlan(state, planetId);
  const result = evaluate(state, planetId as PlanetId, runtime);
  const paused = plan.paused === true;
  const open = result.lines.filter((line) => line.levelsLeft > 0);
  const next = result.decision;
  let headline: string;
  if (isBuildPlanEmpty(plan)) headline = 'Выберите здания и уровни, до которых их нужно довести.';
  else if (!open.length) headline = result.queueUsed ? 'Остаётся достроить то, что уже в очереди.' : 'Всё построено до нужных уровней.';
  else if (paused) headline = 'Автостарт выключен: цели сохранены, само ничего не строится.';
  else if (next) headline = next.startedFor ? `Дальше: ${next.name} до ур. ${next.level}, чтобы хватило энергии.` : `Дальше: ${next.name} до ур. ${next.level}.`;
  else {
    const pick = (kind: BuildWaitKind) => open.find((line) => line.wait?.kind === kind)?.wait?.text;
    headline = pick('energy') ?? pick('queue') ?? pick('resources') ?? open.find((line) => line.wait)?.wait?.text ?? '';
  }
  return { planetId, plan, empty: isBuildPlanEmpty(plan), paused, lines: result.lines, queueUsed: result.queueUsed, queueCapacity: BUILDING_QUEUE_CAPACITY, energy: result.energy, next, headline };
}

export type BuildPlanStart = { planetId: string; role: BuildingRole; name: string; level: number; startedFor: BuildingRole | null };
export type BuildPlanRun = { state: SaveState; started: BuildPlanStart[] };

/**
 * Starts every upgrade the plans allow right now, planet by planet, as
 * ordinary build orders: each next one sees what the previous one spent.
 * The caller decides when it may run (only while the player is in the game).
 */
export function runBuildPlans(state: SaveState, runtime: BuildRuntime, onlyPlanetId?: string): BuildPlanRun {
  let current = state;
  const started: BuildPlanStart[] = [];
  const planetIds = Object.keys(state.fleetUi?.buildPlans ?? {}).filter((id) => state.planets[id] && (!onlyPlanetId || id === onlyPlanetId)).sort();
  for (const planetId of planetIds) {
    if (getBuildPlan(current, planetId).paused && !onlyPlanetId) continue;
    for (let guard = 0; guard <= BUILDING_QUEUE_CAPACITY; guard += 1) {
      const { decision } = evaluate(current, planetId as PlanetId, runtime);
      if (!decision) break;
      const action = startBuilding(current, { planetId: planetId as PlanetId, ...runtime }, decision.role);
      if (!action.ok) break;
      current = action.state;
      started.push({ planetId, role: decision.role, name: decision.name, level: decision.level, startedFor: decision.startedFor });
    }
  }
  return { state: current, started };
}

/** «Империя»: a planet's glance at its build plan. */
export function buildPlanGlance(state: SaveState, planetId: string, runtime: BuildRuntime): { planned: boolean; left: number; paused: boolean } {
  const view = buildBuildPlanView(state, planetId, runtime);
  return { planned: !view.empty, left: view.lines.reduce((total, line) => total + line.levelsLeft, 0), paused: view.paused };
}
