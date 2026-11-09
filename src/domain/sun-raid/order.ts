import { COMBAT_SHIP_LEVEL_COEFFICIENTS } from '../combat/config.ts';
import { COMMANDER_IDS, type CommanderId } from '../combat/commanders.ts';
import { getFactionCombatEntity, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { COMBAT_FACTION_IDS, isCombatFactionId, type CombatFactionId } from '../combat/factions.ts';
import { SHIP_IDS, type ShipId } from '../combat/ids.ts';
import { SUN_RAID_CONFIG } from './config.ts';

/**
 * Raid order (owner rule 09.11.2026): whoever launches a Sun raid says which
 * fleet it needs. The order is a list of slots «race + ship type + count» within
 * the side cap T, races only from the alliance's members. Participants fill open
 * slots with matching ships; anything else is refused unless the launcher left
 * an explicit «любые» slot (a population room for any combat hull). A slot may
 * ask for a minimum ship level: level-0 filler stays home.
 *
 * Pure and deterministic: fills are recomputed from the raid's flights in their
 * stored order, so a reload, a time slice or the server see the same numbers.
 */

export type SunOrderEntityId = ShipId | CommanderId;

export type SunRaidOrderShipSlot = {
  kind: 'ship';
  factionId: CombatFactionId;
  entityId: SunOrderEntityId;
  /** Hulls wanted. */
  count: number;
  /** The owner's upgrade level of this hull must be at least this (0 or absent: any level). */
  minLevel?: number;
};

export type SunRaidOrderAnySlot = {
  kind: 'any';
  /** Population room for any combat hull of any member race. */
  population: number;
  minLevel?: number;
};

export type SunRaidOrderSlot = SunRaidOrderShipSlot | SunRaidOrderAnySlot;

export type SunOrderPreset = 'last-defence' | 'balanced' | 'custom' | 'npc';

export type SunRaidOrder = {
  version: 1;
  preset: SunOrderPreset;
  slots: SunRaidOrderSlot[];
};

/** At most this many slots in one order (the editor shows them all at once). */
export const SUN_ORDER_MAX_SLOTS = 16;

const CIVIL: ReadonlySet<string> = new Set(['spy-probe', 'colonizer', 'recycler', 'transporter', 'mega-transporter', 'solar-satellite']);

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function isCommanderEntity(id: string): id is CommanderId {
  return (COMMANDER_IDS as readonly string[]).includes(id);
}

/** Combat hulls and commander ships of a race that may stand in an order. */
export function isOrderEntity(id: string): id is SunOrderEntityId {
  return isCommanderEntity(id) || ((SHIP_IDS as readonly string[]).includes(id) && !CIVIL.has(id));
}

export function slotKey(slot: SunRaidOrderSlot): string {
  return slot.kind === 'any' ? 'any' : `${slot.factionId}:${slot.entityId}`;
}

export function entityPopulation(factionId: CombatFactionId, entityId: SunOrderEntityId): number {
  return Math.max(1, Math.floor(getFactionCombatEntity(factionId, entityId).population ?? 1));
}

export function slotPopulation(slot: SunRaidOrderSlot): number {
  return slot.kind === 'any' ? whole(slot.population) : whole(slot.count) * entityPopulation(slot.factionId, slot.entityId);
}

export function orderPopulation(order: SunRaidOrder | undefined): number {
  return (order?.slots ?? []).reduce((sum, slot) => sum + slotPopulation(slot), 0);
}

/** The races an order asks for (the «любые» slot adds none). */
export function orderRaces(order: SunRaidOrder): CombatFactionId[] {
  return COMBAT_FACTION_IDS.filter((race) => order.slots.some((slot) => slot.kind === 'ship' && slot.factionId === race));
}

/** Combat hulls of a race an order may name, catalog order. */
export function orderCatalog(factionId: CombatFactionId): SunOrderEntityId[] {
  return getFactionShipCatalog(factionId).map((entity) => entity.id as ShipId).filter((id) => isOrderEntity(id));
}

/** Validating copy of a stored order (old saves have none; anything malformed is dropped). */
export function migrateSunRaidOrder(value: unknown): SunRaidOrder | undefined {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!source || !Array.isArray(source.slots)) return undefined;
  const preset: SunOrderPreset = source.preset === 'last-defence' || source.preset === 'balanced' || source.preset === 'npc' ? source.preset : 'custom';
  const seen = new Set<string>();
  const slots: SunRaidOrderSlot[] = [];
  for (const raw of source.slots) {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!item) continue;
    const minLevel = whole(item.minLevel);
    let slot: SunRaidOrderSlot | null = null;
    if (item.kind === 'any' && whole(item.population) > 0) slot = { kind: 'any', population: whole(item.population), ...(minLevel ? { minLevel } : {}) };
    else if (item.kind === 'ship' && typeof item.factionId === 'string' && isCombatFactionId(item.factionId)
      && typeof item.entityId === 'string' && isOrderEntity(item.entityId) && whole(item.count) > 0) {
      slot = { kind: 'ship', factionId: item.factionId, entityId: item.entityId, count: whole(item.count), ...(minLevel ? { minLevel } : {}) };
    }
    if (!slot || seen.has(slotKey(slot))) continue;
    seen.add(slotKey(slot));
    slots.push(slot);
    if (slots.length >= SUN_ORDER_MAX_SLOTS) break;
  }
  return slots.length ? { version: 1, preset, slots } : undefined;
}

/**
 * Why an order cannot be launched, or null. It must fit the side cap and fill it
 * (the raid flies only with the full cap, within the launch tolerance), name only
 * races of the alliance, and each slot once.
 */
export function validateSunRaidOrder(order: SunRaidOrder, input: { perSide: number; races: readonly CombatFactionId[] }): string | null {
  if (!order.slots.length) return 'Добавьте в заказ хотя бы одну позицию.';
  if (order.slots.length > SUN_ORDER_MAX_SLOTS) return `В заказе не больше ${SUN_ORDER_MAX_SLOTS} позиций.`;
  const seen = new Set<string>();
  for (const slot of order.slots) {
    if (seen.has(slotKey(slot))) return 'Каждая позиция заказа — один раз.';
    seen.add(slotKey(slot));
    if (slot.kind === 'any') { if (whole(slot.population) <= 0) return 'Позиция «любые» пуста.'; continue; }
    if (!input.races.includes(slot.factionId)) return 'В заказе раса, которой нет в союзе.';
    if (!isOrderEntity(slot.entityId) || !orderCatalog(slot.factionId).includes(slot.entityId) && !isCommanderEntity(slot.entityId)) return 'Этот корабль не летит к Солнцу.';
    if (whole(slot.count) <= 0) return 'Пустая позиция заказа.';
  }
  const total = orderPopulation(order);
  if (total > input.perSide) return `Заказ ${total.toLocaleString('ru-RU')} больше лимита стороны ${input.perSide.toLocaleString('ru-RU')}.`;
  if (total < input.perSide - SUN_RAID_CONFIG.raidLaunchTolerance) {
    return `Заказ ${total.toLocaleString('ru-RU')} из ${input.perSide.toLocaleString('ru-RU')}: рейд вылетает только с полным лимитом — добавьте ещё ${(input.perSide - total).toLocaleString('ru-RU')}.`;
  }
  return null;
}

/* ------------------------------------------------------------------ filling */

/** One participant fleet as an order sees it. */
export type SunOrderPledge = {
  factionId: CombatFactionId;
  ships: Partial<Record<ShipId, number>>;
  commanders?: Partial<Record<CommanderId, number>>;
  /** The owner's upgrade levels (ships and commander ships). */
  levels: Partial<Record<string, number>>;
};

/** Slot key → hulls placed (a ship slot) or population placed (the «любые» slot). */
export type SunOrderFill = Map<string, number>;

function pledgeEntities(pledge: SunOrderPledge): [SunOrderEntityId, number][] {
  const ships = (Object.entries(pledge.ships) as [ShipId, number][]).filter(([id]) => isOrderEntity(id));
  const commanders = (Object.entries(pledge.commanders ?? {}) as [CommanderId, number][]).filter(([id]) => isCommanderEntity(id));
  return [...ships, ...commanders].map(([id, count]) => [id, whole(count)] as [SunOrderEntityId, number])
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

const levelOf = (pledge: SunOrderPledge, id: string) => Math.max(0, Math.floor(pledge.levels[id] ?? 0));

/**
 * Places one pledge into the order on top of `fill`: each hull into its own slot
 * first (when its level is high enough), what is left into «любые». `refused` is
 * population that fits nowhere (0 for an accepted pledge).
 */
export function placeSunPledge(order: SunRaidOrder, fill: SunOrderFill, pledge: SunOrderPledge): { fill: SunOrderFill; refused: number; refusedIds: SunOrderEntityId[] } {
  const next = new Map(fill);
  const any = order.slots.find((slot): slot is SunRaidOrderAnySlot => slot.kind === 'any');
  let refused = 0;
  const refusedIds: SunOrderEntityId[] = [];
  for (const [id, count] of pledgeEntities(pledge)) {
    const level = levelOf(pledge, id);
    const population = entityPopulation(pledge.factionId, id);
    let left = count;
    const slot = order.slots.find((item): item is SunRaidOrderShipSlot => item.kind === 'ship' && item.factionId === pledge.factionId && item.entityId === id);
    if (slot && level >= whole(slot.minLevel)) {
      const key = slotKey(slot);
      const take = Math.min(left, Math.max(0, slot.count - (next.get(key) ?? 0)));
      if (take > 0) { next.set(key, (next.get(key) ?? 0) + take); left -= take; }
    }
    if (left > 0 && any && level >= whole(any.minLevel)) {
      const room = Math.max(0, any.population - (next.get('any') ?? 0));
      const take = Math.min(left, Math.floor(room / population));
      if (take > 0) { next.set('any', (next.get('any') ?? 0) + take * population); left -= take; }
    }
    if (left > 0) { refused += left * population; refusedIds.push(id); }
  }
  return { fill: next, refused, refusedIds };
}

/** How full each slot is after these pledges (in their stored order). */
export function sunOrderFill(order: SunRaidOrder, pledges: readonly SunOrderPledge[]): SunOrderFill {
  let fill: SunOrderFill = new Map();
  for (const pledge of pledges) fill = placeSunPledge(order, fill, pledge).fill;
  return fill;
}

/** Open population of each slot (what a new pledge may still add). */
export function sunOrderOpenPopulation(order: SunRaidOrder, fill: SunOrderFill): number {
  return order.slots.reduce((sum, slot) => {
    const used = fill.get(slotKey(slot)) ?? 0;
    return sum + (slot.kind === 'any' ? Math.max(0, slot.population - used) : Math.max(0, slot.count - used) * entityPopulation(slot.factionId, slot.entityId));
  }, 0);
}

/**
 * The most of each hull an owner may add now: its own slot's open count (level
 * permitting), and the «любые» room shared by the rest. Used to preselect a
 * player's ships and to cut a bot's force to the order.
 */
export function sunOrderRoomFor(order: SunRaidOrder, fill: SunOrderFill, factionId: CombatFactionId, levels: Partial<Record<string, number>>): { perEntity: Partial<Record<SunOrderEntityId, number>>; anyPopulation: number; anyMinLevel: number } {
  const perEntity: Partial<Record<SunOrderEntityId, number>> = {};
  for (const slot of order.slots) {
    if (slot.kind !== 'ship' || slot.factionId !== factionId) continue;
    if (Math.max(0, Math.floor(levels[slot.entityId] ?? 0)) < whole(slot.minLevel)) continue;
    const open = Math.max(0, slot.count - (fill.get(slotKey(slot)) ?? 0));
    if (open > 0) perEntity[slot.entityId] = open;
  }
  const any = order.slots.find((slot): slot is SunRaidOrderAnySlot => slot.kind === 'any');
  return { perEntity, anyPopulation: any ? Math.max(0, any.population - (fill.get('any') ?? 0)) : 0, anyMinLevel: whole(any?.minLevel) };
}

/* ------------------------------------------------------------------- value */

/** Level multiplier of a hull's attack and life (the battle engine's own coefficient). */
export function hullLevelMultiplier(entityId: string, level: number): number {
  if (isCommanderEntity(entityId)) return 1;
  const coefficient = entityId === 'death-star' ? COMBAT_SHIP_LEVEL_COEFFICIENTS['death-star']
    : (COMBAT_SHIP_LEVEL_COEFFICIENTS as Readonly<Record<string, number>>)[entityId] ?? 0;
  return 1 + coefficient * Math.max(0, Math.floor(level));
}

/** Square-law strength per population of one hull at a level: what a slot of it is worth. */
export function hullValuePerPopulation(factionId: CombatFactionId, entityId: SunOrderEntityId, level: number): number {
  const entity = getFactionCombatEntity(factionId, entityId);
  const combat = (entity as { combat?: { attack: number; life: number } }).combat;
  if (!combat) return 0;
  const multiplier = hullLevelMultiplier(entityId, level);
  return Math.sqrt(Math.max(0, combat.attack) * Math.max(0, combat.life)) * multiplier / entityPopulation(factionId, entityId);
}

/* ------------------------------------------------------------------ presets */

/** Population shares by hull type (race-agnostic): a «balanced» line, heavy hulls first. */
export const BALANCED_SUN_MIX: Readonly<Partial<Record<ShipId, number>>> = Object.freeze({
  battleship: 0.3, destroyer: 0.25, bomber: 0.2, defender: 0.15, cruiser: 0.1,
});

/** What the alliance can field of one race and hull (free hulls of its members). */
export type SunOrderSupply = { factionId: CombatFactionId; entityId: SunOrderEntityId; count: number; level: number };

/**
 * An order of `perSide` population from hull-type shares, spread over `races`:
 * each type's share goes to the races by what their members can field of it
 * (equally when nobody can), counts rounded down, then the gap is closed with
 * the smallest hull of the first race so the order fills the cap exactly.
 */
export function buildSunOrderFromMix(mix: Readonly<Partial<Record<string, number>>>, races: readonly CombatFactionId[], perSide: number,
  supply: readonly SunOrderSupply[], preset: SunOrderPreset): SunRaidOrder | null {
  const ordered = COMBAT_FACTION_IDS.filter((race) => races.includes(race));
  if (!ordered.length || perSide <= 0) return null;
  const total = Object.values(mix).reduce<number>((sum, value) => sum + Math.max(0, value ?? 0), 0);
  if (total <= 0) return null;
  const counts = new Map<string, { factionId: CombatFactionId; entityId: SunOrderEntityId; count: number }>();
  const types = Object.keys(mix).filter((id) => isOrderEntity(id) && (mix[id] ?? 0) > 0).sort((left, right) => (mix[right]! - mix[left]!) || (left < right ? -1 : 1));
  for (const type of types) {
    const share = mix[type]! / total;
    const able = ordered.filter((race) => orderCatalog(race).includes(type as SunOrderEntityId));
    if (!able.length) continue;
    const weights = able.map((race) => supply.filter((item) => item.factionId === race && item.entityId === type)
      .reduce((sum, item) => sum + item.count * entityPopulation(race, item.entityId), 0));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    able.forEach((race, index) => {
      const part = weightTotal > 0 ? weights[index]! / weightTotal : 1 / able.length;
      const population = Math.floor(perSide * share * part);
      const count = Math.floor(population / entityPopulation(race, type as SunOrderEntityId));
      if (count > 0) counts.set(`${race}:${type}`, { factionId: race, entityId: type as SunOrderEntityId, count });
    });
  }
  const slots: SunRaidOrderShipSlot[] = [...counts.values()].map((item) => ({ kind: 'ship', ...item }));
  return padSunOrder({ version: 1, preset, slots: slots.slice(0, SUN_ORDER_MAX_SLOTS - 1) }, ordered, perSide);
}

/** Closes the gap to `perSide` with the smallest combat hull of the races (the order must fill the cap). */
export function padSunOrder(order: SunRaidOrder, races: readonly CombatFactionId[], perSide: number): SunRaidOrder {
  let gap = perSide - orderPopulation(order);
  if (gap <= 0) return order;
  const slots = order.slots.map((slot) => ({ ...slot }));
  const candidates = races.flatMap((race) => orderCatalog(race).filter((id) => !isCommanderEntity(id)).map((id) => ({ race, id, population: entityPopulation(race, id) })))
    .sort((left, right) => left.population - right.population || (left.race < right.race ? -1 : 1) || (left.id < right.id ? -1 : 1));
  // Prefer topping up a hull already in the order; otherwise the smallest hull.
  const existing = candidates.filter((candidate) => slots.some((slot) => slot.kind === 'ship' && slot.factionId === candidate.race && slot.entityId === candidate.id));
  for (const candidate of [...existing, ...candidates]) {
    if (gap < candidate.population) continue;
    const add = Math.floor(gap / candidate.population);
    const index = slots.findIndex((slot) => slot.kind === 'ship' && slot.factionId === candidate.race && slot.entityId === candidate.id);
    if (index >= 0) (slots[index] as SunRaidOrderShipSlot).count += add;
    else if (slots.length < SUN_ORDER_MAX_SLOTS) slots.push({ kind: 'ship', factionId: candidate.race, entityId: candidate.id, count: add });
    else continue;
    gap -= add * candidate.population;
    if (gap <= SUN_RAID_CONFIG.raidLaunchTolerance) break;
  }
  return { ...order, slots };
}

/** Population shares by hull type of a list of (type, population) rows. */
export function typeShares(rows: readonly { e: string; p: number }[]): Record<string, number> {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.p), 0);
  const shares: Record<string, number> = {};
  if (total <= 0) return shares;
  for (const row of rows) if (row.p > 0) shares[row.e] = (shares[row.e] ?? 0) + row.p / total;
  return shares;
}
