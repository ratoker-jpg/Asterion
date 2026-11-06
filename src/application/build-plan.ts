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
  getBuildingResourceIncomePerHour,
  getStorageCapacities,
  type BuildingFaction,
  type BuildingRole,
  type ResourceCost,
} from '../domain/buildings/balance-v1.ts';
import { buildPriority, emptyBuildPlan, isBuildPlanEmpty, type BuildPlan } from '../domain/buildings/build-plan.ts';
import { BUILDING_QUEUE_CAPACITY, getBuildingDefinition } from '../domain/buildings/resource-zone.ts';
import { getAvailableProductionBots, getProductionBotIncomePerHour, BOT_RESOURCES, MAX_PRODUCTION_BOTS_PER_RESOURCE, type BotAssignment } from '../domain/buildings/production-bots.ts';
import { getTradeAmountLimit, getTradeRefillInfo } from '../domain/buildings/trade.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { calculateNuclearReactorContribution, calculateSolarStationContribution } from '../domain/energy/runtime.ts';
import { findScience } from '../domain/science/catalog.ts';
import { applyProductionBots, executeTradeAction, previewBuilding, startBuilding, type BuildingApplicationContext } from './buildings.ts';
import { getPlanetResources, getPlanetState, type PlanetId, type SaveState } from './contracts.ts';
import { getPlanetEnergyCoordinates, getPlanetEnergyLedger } from './energy.ts';
import { isPlanetBlocked } from './overpopulation.ts';
import { getEffectiveResourceIncomePerHour } from './resource-clock.ts';

export type BuildRuntime = Pick<BuildingApplicationContext, 'now' | 'mode' | 'testTimeScale'>;

export type BuildWaitKind = 'resources' | 'energy' | 'queue' | 'requirement' | 'science' | 'blocked' | 'order' | 'saving';

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
  /** Place in the priority, 1 is first; an implied line shares the place of the building that needs it. */
  priority: number;
  levelsLeft: number;
  status: 'done' | 'building' | 'next' | 'waiting';
  /** Cost of the next level; null when nothing is left to build. */
  cost: ResourceCost | null;
  timeMs: number | null;
  /** `title` replaces the usual two-word title («Копит на …»). */
  wait: { kind: BuildWaitKind; text: string; title?: string } | null;
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
  /** The planner is saving up for a construction-speed building instead of spending on cheap levels. */
  saving: { name: string; level: number; text: string } | null;
  /** The two helpers: robots and trade-centre exchanges (on unless switched off for this planet). */
  helpers: { robots: boolean; exchange: boolean };
};

const ROLE_ORDER = new Map(BUILDING_ROLES.map((role, index) => [role, index]));
const RESOURCE_KEYS = ['metal', 'minerals', 'gas'] as const;
const GENITIVE = { metal: 'металла', minerals: 'минералов', gas: 'газа' } as const;
const ENERGY_ROLES: readonly BuildingRole[] = ['basic-energy', 'advanced-energy'];
/** Buildings that make all later construction faster (and give production robots): worth saving for. */
const FACTORY_ROLES: readonly BuildingRole[] = ['construction', 'advanced-factory'];
const STORAGE_OF = { metal: 'metal-storage', minerals: 'mineral-storage', gas: 'gas-storage' } as const;
const PRODUCTION_ROLES: readonly BuildingRole[] = [
  'metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2',
];

const compact = (value: number) => {
  const rounded = Math.ceil(value);
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`;
  if (rounded >= 10_000) return `${Math.round(rounded / 1_000).toLocaleString('ru-RU')} тыс`;
  return rounded.toLocaleString('ru-RU');
};

export function getBuildPlan(state: SaveState, planetId: string): BuildPlan {
  return state.fleetUi?.buildPlans?.[planetId] ?? emptyBuildPlan();
}

/** The first planned building that only lacks resources (and fits in the storage): what an exchange would serve. */
type Want = { role: BuildingRole; lack: ResourceCost; reserve: ResourceCost };
type Saving = { name: string; level: number; text: string };
type Evaluation = { lines: BuildPlanLine[]; decision: BuildDecision | null; queueUsed: number; energy: number; want: Want | null; saving: Saving | null };

const hoursText = (hours: number) => (hours < 1 ? 'меньше часа' : hours < 48 ? `около ${Math.ceil(hours)} ч` : `около ${Math.ceil(hours / 24)} дн`);

/** Resources per hour the planet really makes now (buildings, science, robots, the game's clock). */
function incomePerHour(state: SaveState, planetId: string, runtime: BuildRuntime, levels?: Partial<Record<BuildingRole, number>>) {
  const planet = getPlanetState(state, planetId as PlanetId);
  const base = getBuildingResourceIncomePerHour(levels ?? planet.buildings, state.science.levels);
  return getEffectiveResourceIncomePerHour(getProductionBotIncomePerHour(base, planet.productionBots), runtime.mode, runtime.testTimeScale);
}

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

  // Planned buildings in the player's priority, then whatever they need first (building requirements only).
  // An implied building takes the place of the most important building that needs it, just ahead of it.
  const priority = buildPriority(plan);
  const wanted = new Map<BuildingRole, { level: number; implied: boolean; rank: number }>();
  for (const [index, role] of priority.entries()) wanted.set(role, { level: plan.targets[role]!, implied: false, rank: index + 1 });
  for (let changed = true, guard = 0; changed && guard < BUILDING_ROLES.length; guard += 1) {
    changed = false;
    for (const [role, entry] of [...wanted]) {
      if (entry.level <= projectedOf(role)) continue;
      for (const requirement of getBuildingDefinition(role).requirements) {
        if (requirement.kind !== 'building-level') continue;
        const have = wanted.get(requirement.assetRole);
        if (have && have.level >= requirement.level) continue;
        wanted.set(requirement.assetRole, { level: requirement.level, implied: have ? have.implied : true, rank: have && !have.implied ? have.rank : Math.min(have?.rank ?? Infinity, entry.rank - 0.001) });
        changed = true;
      }
    }
  }

  const blocked = isPlanetBlocked(state, planetId);
  const lines: BuildPlanLine[] = [...wanted.entries()]
    .sort((a, b) => a[1].rank - b[1].rank || ROLE_ORDER.get(a[0])! - ROLE_ORDER.get(b[0])!)
    .map(([role, entry]) => {
      const definition = getBuildingDefinition(role, factionId);
      const availability = previewBuilding(state, context, role).availability;
      const queued = queuedOf(role);
      const levelsLeft = Math.max(0, entry.level - projectedOf(role));
      return {
        role, name: definition.name, art: definition.art, current: levelOf(role), queued, target: entry.level, implied: entry.implied, priority: Math.ceil(entry.rank), levelsLeft,
        status: levelsLeft > 0 ? 'waiting' : queued > 0 ? 'building' : 'done',
        cost: levelsLeft > 0 ? availability.cost : null,
        timeMs: levelsLeft > 0 ? availability.timeMs : null,
        wait: null,
      } satisfies BuildPlanLine;
    });
  const setWait = (line: BuildPlanLine, kind: BuildWaitKind, text: string, title?: string) => { line.wait = { kind, text, ...(title ? { title } : {}) }; };
  const queueOf = queuedOf;

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
  // `open` keeps the lines' priority order. One level per building at a time: buildings with no level in
  // the queue get the free slots first; only when none of them can start does a queued building get its next level.
  const fresh = open.filter((line) => queuedOf(line.role) === 0);
  const passes = fresh.length && fresh.length < open.length ? [fresh, open.filter((line) => queuedOf(line.role) > 0)] : [open];
  for (const line of passes.length > 1 ? passes[1]! : []) setWait(line, 'order', 'Один уровень уже строится, свободные места в очереди отданы другим зданиям.');

  let decision: BuildDecision | null = null;
  const capacities = getStorageCapacities(planet.buildings);
  const income = incomePerHour(state, planetId, runtime);
  const incomeSum = (levels: Partial<Record<BuildingRole, number>>) => {
    const value = incomePerHour(state, planetId, runtime, levels);
    return value.metal + value.minerals + value.gas;
  };
  // Saving up: set by a factory-type line that only lacks resources.
  let saver: { line: BuildPlanLine; hours: number } | null = null;
  let saving: Saving | null = null;
  let want: Want | null = null;
  // Spending now on a producing building is fine while saving only if it pays itself back before the factory is affordable.
  const paysBackFirst = (line: BuildPlanLine, hours: number) => {
    if (!PRODUCTION_ROLES.includes(line.role) || !line.cost) return false;
    const gain = incomeSum({ ...planet.buildings, [line.role]: line.current + line.queued + 1 }) - incomeSum(planet.buildings);
    return gain > 0 && (line.cost.metal + line.cost.minerals + line.cost.gas) / gain < hours;
  };
  // An energy shortage holds the whole planet: no later pass may start something else meanwhile.
  let holdForEnergy = false;
  const energyOnTheWay = queue.some((item) => ENERGY_ROLES.includes(item.assetRole));
  for (const pass of passes) {
    if (decision || holdForEnergy) break;
  const behind = (index: number, text: string) => {
    for (const rest of pass.slice(index + 1)) setWait(rest, 'order', text);
  };
  for (const [index, line] of pass.entries()) {
    const cost = line.cost;
    if (!cost) continue;
    if (cost.energy > energy) {
      holdForEnergy = true;
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
    const lackText = `Не хватает ${lacking.map((key) => `${GENITIVE[key]} ${compact(cost[key] - wallet[key])}`).join(', ')}.`;
    // The next level costs more than the storage holds: it can never be afforded until the storage grows.
    const tooBig = lacking.find((key) => cost[key] > capacities[key]);
    if (tooBig) {
      holdForEnergy = true;
      const storageRole = STORAGE_OF[tooBig];
      const storageName = getBuildingDefinition(storageRole, factionId).name;
      const storage = previewBuilding(state, context, storageRole).availability;
      const sentence = `${line.name} ур. ${line.current + line.queued + 1} не помещается на склад (${GENITIVE[tooBig]} нужно ${compact(cost[tooBig])}, вмещает ${compact(capacities[tooBig])}).`;
      const title = `Сначала ${storageName}`;
      if (queueOf(storageRole) > 0) {
        setWait(line, 'saving', `${sentence} ${storageName} уже строится.`, title);
      } else if (storage.nextLevel == null || !storage.cost || storage.requirements.some((item) => !item.met) || storage.cost[tooBig] > capacities[tooBig]) {
        setWait(line, 'resources', `${sentence} Увеличить склад не получается.`);
        holdForEnergy = false;
        continue;
      } else if (queueFull) {
        setWait(line, 'saving', `${sentence} Нужен ${storageName}, но очередь стройки занята.`, title);
      } else if (RESOURCE_KEYS.every((key) => storage.cost![key] <= wallet[key]) && storage.cost.energy <= energy) {
        setWait(line, 'saving', `${sentence} Сначала строим ${storageName}.`, title);
        decision = { role: storageRole, name: storageName, level: storage.nextLevel, startedFor: line.role };
      } else {
        setWait(line, 'saving', `${sentence} Копим на ${storageName}.`, title);
      }
      behind(index, 'Ждёт, пока вырастет склад.');
      break;
    }
    if (lacking.length) {
      if (!want && !queueFull) {
        const lack = { metal: 0, minerals: 0, gas: 0, energy: 0 } as ResourceCost;
        for (const key of lacking) lack[key] = cost[key] - wallet[key];
        want = { role: line.role, lack, reserve: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
      }
      const hours = Math.max(...lacking.map((key) => (income[key as 'metal' | 'minerals' | 'gas'] > 0 ? (cost[key] - wallet[key]) / income[key as 'metal' | 'minerals' | 'gas'] : Infinity)));
      if (!saver && FACTORY_ROLES.includes(line.role) && Number.isFinite(hours)) {
        saver = { line, hours };
        saving = { name: line.name, level: line.current + line.queued + 1, text: `${lackText} При нынешнем доходе накопится ${hoursText(hours)}.` };
        setWait(line, 'resources', saving.text);
      } else setWait(line, 'resources', lackText);
      continue;
    }
    if (queueFull) {
      setWait(line, 'queue', 'Очередь стройки занята.');
      continue;
    }
    if (saver && !paysBackFirst(line, saver.hours)) {
      setWait(line, 'saving', `Копим на ${saver.line.name} ур. ${saver.line.current + saver.line.queued + 1}: это улучшение не окупится раньше, чем накопится нужное.`, `Копит на ${saver.line.name}`);
      continue;
    }
    decision = { role: line.role, name: line.name, level: line.current + line.queued + 1, startedFor: null };
    behind(index, 'Ждёт своей очереди.');
    break;
  }
  }
  const chosen = decision ? lines.find((line) => line.role === decision!.role) : undefined;
  if (chosen) { chosen.status = 'next'; chosen.wait = null; }
  if (want) {
    // What the plan's other open steps still need of each resource: an exchange never takes that away.
    const reserve = { metal: 0, minerals: 0, gas: 0, energy: 0 } as ResourceCost;
    for (const line of lines) {
      if (line.levelsLeft === 0 || !line.cost || (line.wait && ['requirement', 'science', 'blocked'].includes(line.wait.kind))) continue;
      for (const key of RESOURCE_KEYS) reserve[key] += line.cost[key];
    }
    want.reserve = reserve;
  }
  return { lines, decision, queueUsed: queue.length, energy, want: decision ? null : want, saving };
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
  else if (next) headline = next.startedFor
    ? `Дальше: ${next.name} до ур. ${next.level}, чтобы ${ENERGY_ROLES.includes(next.role) ? 'хватило энергии' : 'поместилось в склад'}.`
    : `Дальше: ${next.name} до ур. ${next.level}.`;
  else {
    const pick = (kind: BuildWaitKind) => open.find((line) => line.wait?.kind === kind)?.wait?.text;
    headline = pick('saving') ?? (result.saving ? `Копим на ${result.saving.name} ур. ${result.saving.level}.` : undefined) ?? pick('energy') ?? pick('queue') ?? pick('resources') ?? open.find((line) => line.wait)?.wait?.text ?? '';
  }
  return { planetId, plan, empty: isBuildPlanEmpty(plan), paused, lines: result.lines, queueUsed: result.queueUsed, queueCapacity: BUILDING_QUEUE_CAPACITY, energy: result.energy, next, headline, saving: paused ? null : result.saving, helpers: { robots: plan.noRobots !== true, exchange: plan.noExchange !== true } };
}

export type BuildPlanStart = { planetId: string; role: BuildingRole; name: string; level: number; startedFor: BuildingRole | null };
export type BuildPlanRobots = { planetId: string; assignment: BotAssignment };
export type BuildPlanExchange = { planetId: string; from: 'metal' | 'minerals' | 'gas'; to: 'metal' | 'minerals' | 'gas'; amount: number; received: number };
export type BuildPlanRun = { state: SaveState; started: BuildPlanStart[]; robots: BuildPlanRobots[]; exchanges: BuildPlanExchange[] };

/**
 * The owner's robot pattern: the factory's robots go 10 on metal, 10 on minerals,
 * and what the Industrial complex adds goes to gas. Only free robots are placed:
 * what the player assigned himself is never taken away.
 */
export function plannedRobotAssignment(current: BotAssignment, availableBots: number): BotAssignment {
  const next = { ...current };
  let free = Math.max(0, Math.floor(availableBots) - BOT_RESOURCES.reduce((total, key) => total + current[key], 0));
  for (const key of BOT_RESOURCES) {
    const add = Math.min(free, Math.max(0, MAX_PRODUCTION_BOTS_PER_RESOURCE - next[key]));
    next[key] += add;
    free -= add;
  }
  return next;
}

/**
 * Covers what the next planned step lacks from a surplus of another resource
 * through the trade centre, one exchange charge per `amountLimit`. Resources
 * trade 1 to 1 (debris pays only 60% and is left for the recycler), so the
 * best source is simply the biggest surplus; it never goes below what the
 * plan's open steps still need of it. Nothing is exchanged unless the whole gap is covered.
 */
function exchangeFor(state: SaveState, planetId: string, runtime: BuildRuntime, want: Want): { state: SaveState; done: BuildPlanExchange[] } | null {
  const planet = getPlanetState(state, planetId as PlanetId);
  const level = planet.buildings['trade-center'] ?? 0;
  if (level < 1) return null;
  const refill = getTradeRefillInfo(planet.trade, level, runtime.now);
  if (refill.availableSlots <= 0) return null;
  const points = selectOwnerScores(state)[state.profile.playerId]?.resourcePoints ?? 0;
  const limit = getTradeAmountLimit(points);
  if (limit <= 0) return null;
  const wallet = getPlanetResources(state, planetId as PlanetId);
  const surplus = { metal: 0, minerals: 0, gas: 0 };
  for (const key of RESOURCE_KEYS) surplus[key] = want.lack[key] > 0 ? 0 : Math.max(0, wallet[key] - want.reserve[key]);
  const trades: Array<{ from: typeof RESOURCE_KEYS[number]; to: typeof RESOURCE_KEYS[number]; amount: number }> = [];
  let slots = refill.availableSlots;
  for (const to of RESOURCE_KEYS) {
    let lack = want.lack[to];
    if (lack <= 0) continue;
    const from = RESOURCE_KEYS.filter((key) => key !== to).sort((a, b) => surplus[b] - surplus[a] || RESOURCE_KEYS.indexOf(a) - RESOURCE_KEYS.indexOf(b))[0]!;
    if (surplus[from] < lack || Math.ceil(lack / limit) > slots) return null;
    surplus[from] -= lack;
    while (lack > 0) {
      const amount = Math.min(lack, limit);
      trades.push({ from, to, amount });
      lack -= amount;
      slots -= 1;
    }
  }
  if (!trades.length) return null;
  let current = state;
  const done: BuildPlanExchange[] = [];
  for (const trade of trades) {
    const result = executeTradeAction(current, { planetId: planetId as PlanetId, ...runtime }, points, { source: trade.from, target: trade.to, amount: trade.amount });
    if (!result.execution.ok) break;
    current = result.state;
    done.push({ planetId, ...trade, received: result.execution.received });
  }
  return done.length ? { state: current, done } : null;
}

/**
 * Starts every upgrade the plans allow right now, planet by planet, as
 * ordinary build orders: each next one sees what the previous one spent.
 * Around them the planner does the owner's routine with ordinary commands too:
 * it places free robots and exchanges a surplus for a missing resource.
 * The caller decides when it may run (only while the player is in the game).
 */
export function runBuildPlans(state: SaveState, runtime: BuildRuntime, onlyPlanetId?: string): BuildPlanRun {
  let current = state;
  const started: BuildPlanStart[] = [];
  const robots: BuildPlanRobots[] = [];
  const exchanges: BuildPlanExchange[] = [];
  const planetIds = Object.keys(state.fleetUi?.buildPlans ?? {}).filter((id) => state.planets[id] && (!onlyPlanetId || id === onlyPlanetId)).sort();
  for (const planetId of planetIds) {
    const plan = getBuildPlan(current, planetId);
    if (plan.paused && !onlyPlanetId) continue;
    for (let guard = 0; guard <= BUILDING_QUEUE_CAPACITY * 2 + 2; guard += 1) {
      const evaluation = evaluate(current, planetId as PlanetId, runtime);
      const { decision } = evaluation;
      if (!decision) {
        if (plan.noExchange || !evaluation.want) break;
        const traded = exchangeFor(current, planetId, runtime, evaluation.want);
        if (!traded) break;
        current = traded.state;
        exchanges.push(...traded.done);
        continue;
      }
      const action = startBuilding(current, { planetId: planetId as PlanetId, ...runtime }, decision.role);
      if (!action.ok) break;
      current = action.state;
      started.push({ planetId, role: decision.role, name: decision.name, level: decision.level, startedFor: decision.startedFor });
    }
    if (!plan.noRobots && !isPlanetBlocked(current, planetId as PlanetId)) {
      const planet = getPlanetState(current, planetId as PlanetId);
      const assignment = plannedRobotAssignment(planet.productionBots, getAvailableProductionBots(planet.buildings));
      if (BOT_RESOURCES.some((key) => assignment[key] !== planet.productionBots[key])) {
        current = applyProductionBots(current, { planetId: planetId as PlanetId, ...runtime }, assignment);
        robots.push({ planetId, assignment });
      }
    }
  }
  return { state: current, started, robots, exchanges };
}

/** «Империя»: a planet's glance at its build plan. */
export function buildPlanGlance(state: SaveState, planetId: string, runtime: BuildRuntime): { planned: boolean; left: number; paused: boolean } {
  const view = buildBuildPlanView(state, planetId, runtime);
  return { planned: !view.empty, left: view.lines.reduce((total, line) => total + line.levelsLeft, 0), paused: view.paused };
}
