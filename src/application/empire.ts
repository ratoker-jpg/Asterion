/**
 * «Империя»: every own planet on one screen.
 *
 * Read-only view model plus the transfer arithmetic the console uses to fill
 * transport legs. Nothing here is a game rule: income, storage, queues and
 * fleets are read from the same functions the planet screen uses, and every
 * flight still goes through `previewFlight` / `dispatchFlight` (see
 * `quick-actions.ts`).
 */
import type { ShipId } from '../domain/combat/ids.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { getBuildingResourceIncomePerHour, getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import { getProductionBotIncomePerHour } from '../domain/buildings/production-bots.ts';
import { BUILDING_QUEUE_CAPACITY, type BuildingQueueItem } from '../domain/buildings/resource-zone.ts';
import type { TransportCargo } from '../domain/flights/cargo.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { FleetProductionOrder } from '../domain/fleet/production.ts';
import type { ScienceQueueTask } from '../domain/science/runtime.ts';
import type { RuntimeMode, TestTimeScale } from '../domain/runtime/mode.ts';
import { getPlanetResources, type PlanetResources, type SaveState } from './contracts.ts';
import { getAvailableFleetForPlanet } from './flights.ts';
import { buildQuickCommand, previewQuickCommand, type QuickRuntime, type QuickTarget } from './quick-actions.ts';
import { getEffectiveResourceIncomePerHour } from './resource-clock.ts';

export const EMPIRE_RESOURCES = ['metal', 'minerals', 'gas'] as const;
export type EmpireResource = (typeof EMPIRE_RESOURCES)[number];

export type EmpireResourceCell = {
  amount: number;
  capacity: number;
  perHour: number;
  /** 0..1 storage fill. */
  fill: number;
  full: boolean;
};

export type EmpireFlight = Pick<FlightRecord, 'id' | 'missionId' | 'phase' | 'arrivalAt' | 'returnAt' | 'selectedShips'> & { direction: 'out' | 'in' };

export type EmpirePlanetRow = {
  id: string;
  name: string;
  coordinate: { galaxy: number; system: number; position: number };
  isHome: boolean;
  isCurrent: boolean;
  resources: Record<EmpireResource, EmpireResourceCell>;
  queue: BuildingQueueItem[];
  queueCapacity: number;
  research: ScienceQueueTask[];
  shipyard: FleetProductionOrder[];
  /** Ships on orbit and free to fly (flights already subtracted). */
  ships: Partial<Record<ShipId, number>>;
  shipCount: number;
  /** Own flights from this planet and own flights heading to it. */
  flights: EmpireFlight[];
  /** Nothing in the build queue. */
  idle: boolean;
  blocked: boolean;
};

export type EmpireOverview = {
  rows: EmpirePlanetRow[];
  totals: Record<EmpireResource, { amount: number; perHour: number }>;
  idleCount: number;
  queueUsed: number;
  queueCapacity: number;
  flightsInAir: number;
  researchCount: number;
};

export type EmpireRuntime = { now: number; mode: RuntimeMode; testTimeScale: TestTimeScale };

const ACTIVE = new Set<FlightRecord['phase']>(['outbound', 'returning', 'arrived']);

function positiveShips(ships: Partial<Record<ShipId, number>>): Partial<Record<ShipId, number>> {
  return Object.fromEntries(Object.entries(ships).filter(([, count]) => Math.floor(count ?? 0) > 0)) as Partial<Record<ShipId, number>>;
}

/** All own planets, homeworld first, then in the save's order (the order the header lists them). */
export function buildEmpireOverview(state: SaveState, runtime: EmpireRuntime): EmpireOverview {
  const ownerId = state.profile.playerId;
  const records = (state.flights?.records ?? []).filter((flight) => ACTIVE.has(flight.phase)
    && (flight.ownerSide === undefined || flight.ownerSide === 'player') && (flight.ownerId === undefined || flight.ownerId === ownerId));
  const ids = Object.keys(state.planets).sort((a, b) => Number(b === 'helion-01') - Number(a === 'helion-01'));
  const rows = ids.map((id): EmpirePlanetRow => {
    const planet = state.planets[id]!;
    const wallet = getPlanetResources(state, id);
    const capacity = getStorageCapacities(planet.buildings);
    const income = getEffectiveResourceIncomePerHour(
      getProductionBotIncomePerHour(getBuildingResourceIncomePerHour(planet.buildings, state.science.levels), planet.productionBots),
      runtime.mode,
      runtime.testTimeScale,
    );
    const resources = Object.fromEntries(EMPIRE_RESOURCES.map((key) => {
      const amount = Math.max(0, Math.floor(wallet[key] ?? 0));
      const cap = capacity[key];
      return [key, { amount, capacity: cap, perHour: income[key], fill: cap > 0 ? Math.min(1, amount / cap) : 0, full: amount >= cap }];
    })) as Record<EmpireResource, EmpireResourceCell>;
    const queue = state.queues[id] ?? [];
    const ships = positiveShips(getAvailableFleetForPlanet(state, id).ships);
    const flights = records.flatMap((flight): EmpireFlight[] => {
      const base = { id: flight.id, missionId: flight.missionId, phase: flight.phase, arrivalAt: flight.arrivalAt, returnAt: flight.returnAt, selectedShips: flight.selectedShips };
      if (flight.originPlanetId === id) return [{ ...base, direction: 'out' }];
      if (flight.destinationPlanetId === id && flight.phase === 'outbound') return [{ ...base, direction: 'in' }];
      return [];
    });
    return {
      id,
      name: planet.name,
      coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
      isHome: id === 'helion-01',
      isCurrent: id === state.currentPlanetId,
      resources,
      queue,
      queueCapacity: BUILDING_QUEUE_CAPACITY,
      research: state.science.queue.filter((task) => task.planetId === id),
      shipyard: planet.fleetProduction?.shipQueue ?? [],
      ships,
      shipCount: Object.values(ships).reduce((total, count) => total + (count ?? 0), 0),
      flights,
      idle: queue.length === 0,
      blocked: Boolean(planet.overpopulation),
    };
  });
  const totals = Object.fromEntries(EMPIRE_RESOURCES.map((key) => [key, {
    amount: rows.reduce((total, row) => total + row.resources[key].amount, 0),
    perHour: rows.reduce((total, row) => total + row.resources[key].perHour, 0),
  }])) as EmpireOverview['totals'];
  return {
    rows,
    totals,
    idleCount: rows.filter((row) => row.idle).length,
    queueUsed: rows.reduce((total, row) => total + row.queue.length, 0),
    queueCapacity: rows.length * BUILDING_QUEUE_CAPACITY,
    flightsInAir: records.length,
    researchCount: state.science.queue.length,
  };
}

/* ---------- Transfer arithmetic (transport legs) ---------- */

export type CargoHull = { shipId: ShipId; capacity: number; free: number };

/** Transport hulls of the race that are free on the planet, largest hold first. */
export function cargoHullsOnPlanet(state: SaveState, planetId: string): CargoHull[] {
  const factionId = state.profile.factionId as CombatFactionId;
  const free = getAvailableFleetForPlanet(state, planetId).ships;
  return getFactionShipCatalog(factionId)
    .filter((entity) => entity.id === 'transporter' || entity.id === 'mega-transporter')
    .map((entity) => ({ shipId: entity.id as ShipId, capacity: entity.ship?.cargo ?? 0, free: Math.max(0, Math.floor(free[entity.id as ShipId] ?? 0)) }))
    .filter((hull) => hull.capacity > 0 && hull.free > 0)
    .sort((a, b) => b.capacity - a.capacity);
}

/**
 * The fewest ships that carry `amount` (ties → the smaller total hold). Large
 * holds first; the remainder goes into the smallest single hull that still
 * fits it. When the hangar cannot carry it all, every hull goes.
 */
export function pickCargoShips(hulls: readonly CargoHull[], amount: number): Partial<Record<ShipId, number>> {
  const sorted = [...hulls].filter((hull) => hull.capacity > 0 && hull.free > 0).sort((a, b) => b.capacity - a.capacity);
  const total = sorted.reduce((sum, hull) => sum + hull.capacity * hull.free, 0);
  if (amount <= 0 || sorted.length === 0) return {};
  if (amount >= total) return Object.fromEntries(sorted.map((hull) => [hull.shipId, hull.free]));
  const ships: Partial<Record<ShipId, number>> = {};
  let left = amount;
  for (const hull of sorted) {
    const count = Math.min(hull.free, Math.floor(left / hull.capacity));
    if (count > 0) { ships[hull.shipId] = count; left -= count * hull.capacity; }
  }
  if (left > 0) {
    // One more hull: the smallest that holds the rest, else the largest still free.
    const fits = [...sorted].reverse().find((hull) => hull.capacity >= left && (ships[hull.shipId] ?? 0) < hull.free);
    const extra = fits ?? sorted.find((hull) => (ships[hull.shipId] ?? 0) < hull.free);
    if (extra) ships[extra.shipId] = (ships[extra.shipId] ?? 0) + 1;
  }
  return ships;
}

export function holdOf(hulls: readonly CargoHull[], ships: Partial<Record<ShipId, number>>): number {
  return hulls.reduce((sum, hull) => sum + hull.capacity * Math.max(0, Math.floor(ships[hull.shipId] ?? 0)), 0);
}

/**
 * Fits the wanted cargo into `hold`. Each resource keeps its share of the
 * load, so a small fleet brings some of everything; the rounding remainder
 * goes to the resources that still have more to send.
 */
export function fitCargo(wanted: PlanetResources, hold: number): TransportCargo {
  const want = Object.fromEntries(EMPIRE_RESOURCES.map((key) => [key, Math.max(0, Math.floor(wanted[key] ?? 0))])) as PlanetResources;
  const sum = want.metal + want.minerals + want.gas;
  const room = Math.max(0, Math.floor(hold));
  if (sum <= room) return { ...want, debris: 0 };
  const cargo = Object.fromEntries(EMPIRE_RESOURCES.map((key) => [key, Math.floor(want[key] * room / sum)])) as PlanetResources;
  let spare = room - (cargo.metal + cargo.minerals + cargo.gas);
  for (const key of EMPIRE_RESOURCES) {
    const add = Math.min(spare, want[key] - cargo[key]);
    cargo[key] += add;
    spare -= add;
  }
  return { ...cargo, debris: 0 };
}

export type TransportLoad = {
  ships: Partial<Record<ShipId, number>>;
  cargo: TransportCargo;
  /** Resources that stay behind because the hangar has too few transports. */
  leftBehind: number;
};

/**
 * «Загрузить всё, оставить N»: what one source planet sends.
 *
 * - `stock`: the planet's wallet now.
 * - `keep`: what must stay on the planet after departure.
 * - `fuel`: the flight's gas fee (from a preview). It is paid from the gas
 *   above `keep`, as the runtime takes cargo gas and fuel from one wallet.
 * - `cap`: optional per-resource upper bound (e.g. the room left in the
 *   target's storage).
 */
export function planTransportLoad(stock: PlanetResources, keep: PlanetResources, hulls: readonly CargoHull[], fuel = 0, cap?: Partial<PlanetResources>): TransportLoad {
  const wanted = Object.fromEntries(EMPIRE_RESOURCES.map((key) => {
    const spare = Math.max(0, Math.floor(stock[key] ?? 0) - Math.max(0, Math.floor(keep[key] ?? 0)) - (key === 'gas' ? Math.max(0, Math.ceil(fuel)) : 0));
    const limit = cap?.[key];
    return [key, limit === undefined ? spare : Math.min(spare, Math.max(0, Math.floor(limit)))];
  })) as PlanetResources;
  const amount = wanted.metal + wanted.minerals + wanted.gas;
  const ships = pickCargoShips(hulls, amount);
  const cargo = fitCargo(wanted, holdOf(hulls, ships));
  return { ships, cargo, leftBehind: amount - (cargo.metal + cargo.minerals + cargo.gas) };
}

/**
 * «Собрать сюда · ресурсы»: one transport load per source planet, in the
 * given order. The target's free storage is shared out leg by leg, so the
 * legs together never bring more than fits (what does not fit would burn on
 * arrival). Each leg is sized twice: once to learn the fuel fee of its fleet,
 * once with that fee taken out of the spare gas.
 */
export function planGatherLoads(
  state: SaveState,
  target: QuickTarget,
  originPlanetIds: readonly string[],
  keep: PlanetResources,
  runtime: QuickRuntime,
): Record<string, TransportLoad> {
  const targetId = target.node.id;
  const room: PlanetResources = { metal: Infinity, minerals: Infinity, gas: Infinity };
  const targetPlanet = state.planets[targetId];
  if (targetPlanet) {
    const capacity = getStorageCapacities(targetPlanet.buildings);
    const stock = getPlanetResources(state, targetId);
    const incoming = (state.flights?.records ?? []).filter((flight) => flight.phase === 'outbound' && flight.destinationPlanetId === targetId && flight.cargo);
    for (const key of EMPIRE_RESOURCES) {
      room[key] = Math.max(0, capacity[key] - Math.floor(stock[key] ?? 0) - incoming.reduce((sum, flight) => sum + (flight.cargo?.[key] ?? 0), 0));
    }
  }
  const loads: Record<string, TransportLoad> = {};
  for (const originPlanetId of originPlanetIds) {
    const stock = getPlanetResources(state, originPlanetId);
    const hulls = cargoHullsOnPlanet(state, originPlanetId);
    const draft = planTransportLoad(stock, keep, hulls, 0, room);
    const command = buildQuickCommand(state, 'transport', target, originPlanetId, { ships: draft.ships }, runtime, draft.cargo);
    const preview = command && Object.keys(draft.ships).length ? previewQuickCommand(state, { ...command, cargo: { metal: 0, minerals: 0, gas: 0, debris: 0 } }, runtime) : null;
    const fuel = preview?.ok ? preview.flight.gasCost : 0;
    const load = planTransportLoad(stock, keep, hulls, fuel, room);
    loads[originPlanetId] = load;
    for (const key of EMPIRE_RESOURCES) room[key] = Math.max(0, room[key] - load.cargo[key]);
  }
  return loads;
}
