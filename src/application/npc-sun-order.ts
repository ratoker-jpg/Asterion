import type { ShipId } from '../domain/combat/ids.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcSunRaidPrepPlan } from '../domain/npc/sun-prep.ts';
import { SUN_RAID_CONFIG } from '../domain/sun-raid/config.ts';
import { expectedSunDefence, sunExperience, type SunExperience } from '../domain/sun-raid/battle-log.ts';
import {
  hullValuePerPopulation,
  SUN_EXACT_SLOT_HULLS,
  SUN_ORDER_MAX_SLOTS,
  sunOrderRoomFor,
  validateSunRaidOrder,
  type SunOrderEntityId,
  type SunRaidOrder,
  type SunRaidOrderShipSlot,
} from '../domain/sun-raid/order.ts';
import type { SaveState } from './contracts.ts';
import { npcOrderedCounts, npcShipLevels, npcSunComposePool } from './npc-endgame.ts';
import { allianceSunRaces, currentSunRaidState } from './sun-raid.ts';

/**
 * The order a bot launcher gives its raid (owner rule 09.11.2026). At the call
 * every member who answered «приду» / «дам не более N» reports its best offer
 * for its share: the strongest hulls per population at their real levels, with
 * the alliance's Sun battle experience weighing the hull types (types that won
 * against a defence like the expected one count more). The launcher takes the
 * most valuable offers into exact slots, drops filler far below the alliance's
 * own standard and leaves a small «любые» room so one member's late loss does
 * not sink the gathering. Numbers are the bots' judgement, not game rules.
 */
export const NPC_SUN_ORDER_BALANCE = Object.freeze({
  /**
   * Share of the side cap kept as the «любые» room at least: members bring less than they offered
   * (gas, ships called away), and only this room lets another member cover it (bot lab 10.11.2026:
   * with 10% four gatherings of ten fell apart).
   */
  anyShare: 0.35,
  /** Exact slots take this share of what the called members offered, so they fill first; the rest goes to «любые». */
  slotShare: 0.8,
  /** Members are called (as the allotment does) until their promises cover this many sides. */
  callMargin: 1.2,
  /** Offers worth less than this share of the population-weighted median value per population are filler. */
  fillerFloor: 0.45,
});

type Offer = { factionId: CombatFactionId; entityId: SunOrderEntityId; level: number; count: number; population: number; value: number };

function ownPlanets(state: SaveState, ownerId: string): SpyTargetState[] {
  return Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** One member's best offer of `room` population, hull type by type. */
function memberOffers(state: SaveState, ownerId: string, room: number, experience: SunExperience): Offer[] {
  const planets = ownPlanets(state, ownerId);
  const race = planets[0]?.raceId as CombatFactionId | undefined;
  if (!race || room <= 0) return [];
  const levels = npcShipLevels(state, ownerId);
  const { hulls, counts } = npcSunComposePool(state, ownerId, planets, room, undefined, experience.multipliers);
  const byShip = new Map<string, number>();
  for (const hull of hulls) {
    const count = counts.get(hull.key) ?? 0;
    if (count > 0) byShip.set(hull.key.slice(hull.key.indexOf('|') + 1), (byShip.get(hull.key.slice(hull.key.indexOf('|') + 1)) ?? 0) + count);
  }
  return [...byShip.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([id, count]) => {
    const entityId = id as SunOrderEntityId;
    const level = Math.max(0, Math.floor(levels[id] ?? 0));
    const population = hulls.find((hull) => hull.key.endsWith(`|${id}`))!.population;
    return { factionId: race, entityId, level, count, population: count * population, value: hullValuePerPopulation(race, entityId, level) * (experience.multipliers[id] ?? 1) };
  });
}

function weightedMedian(offers: readonly Offer[]): number {
  const sorted = [...offers].sort((left, right) => left.value - right.value);
  const total = sorted.reduce((sum, offer) => sum + offer.population, 0);
  let seen = 0;
  for (const offer of sorted) {
    seen += offer.population;
    if (seen * 2 >= total) return offer.value;
  }
  return 0;
}

export type NpcSunOrderChoice = { order: SunRaidOrder; experience: SunExperience; offered: number; filler: number };

/** The launcher's order for a planned raid, or null when the members' offers cannot make a valid one. */
export function composeNpcSunOrder(state: SaveState, plan: NpcSunRaidPrepPlan, caps: { perSide: number; participant: number }): NpcSunOrderChoice | null {
  const log = currentSunRaidState(state).battleLog ?? [];
  const experience = sunExperience(log, expectedSunDefence(log, plan.galaxy, plan.system));
  const offers: Offer[] = [];
  // The members the gathering will call, in the allotment's order: the leader, then the best force per population,
  // each within its own promise and cap, until the promises cover the side with a margin. Only their hulls are ordered.
  const leaderRsvp = plan.rsvps[plan.ownerId];
  const called: [string, number][] = [[plan.ownerId, Math.min(caps.participant, leaderRsvp?.answer === 'limit' ? leaderRsvp.population : caps.participant)]];
  let covered = called[0]![1];
  const others = Object.entries(plan.rsvps)
    .filter(([ownerId, rsvp]) => ownerId !== plan.ownerId && rsvp.answer !== 'no' && rsvp.population > 0)
    .sort(([leftId, left], [rightId, right]) => (right.quality ?? 0) - (left.quality ?? 0) || (leftId < rightId ? -1 : 1));
  for (const [ownerId, rsvp] of others) {
    if (covered >= caps.perSide * NPC_SUN_ORDER_BALANCE.callMargin) break;
    const room = Math.min(caps.participant, rsvp.population);
    called.push([ownerId, room]);
    covered += room;
  }
  for (const [ownerId, room] of called) offers.push(...memberOffers(state, ownerId, room, experience));
  if (!offers.length) return null;
  const floor = NPC_SUN_ORDER_BALANCE.fillerFloor * weightedMedian(offers);
  const quality = offers.filter((offer) => offer.value >= floor);
  const filler = offers.filter((offer) => offer.value < floor).reduce((sum, offer) => sum + offer.population, 0);
  // One slot per race + hull, battleship class and bigger only: hulls of the members who offer it, the lowest
  // of their levels. Smaller hulls (and filler) are left to «любые», where members bring their best.
  const slots = new Map<string, { slot: SunRaidOrderShipSlot; value: number; unit: number }>();
  for (let offer of quality.filter((item) => SUN_EXACT_SLOT_HULLS.has(item.entityId))) {
    const key = `${offer.factionId}:${offer.entityId}`;
    const known = slots.get(key);
    const unit = offer.population / offer.count;
    offer = { ...offer, count: Math.floor(offer.count * NPC_SUN_ORDER_BALANCE.slotShare) };
    if (offer.count <= 0) continue;
    if (known) {
      known.slot.count += offer.count;
      known.slot.minLevel = Math.min(known.slot.minLevel ?? 0, offer.level);
      known.value = Math.min(known.value, offer.value);
    } else slots.set(key, { slot: { kind: 'ship', factionId: offer.factionId, entityId: offer.entityId, count: offer.count, minLevel: offer.level }, value: offer.value, unit });
  }
  const ranked = [...slots.entries()].sort(([leftKey, left], [rightKey, right]) => right.value - left.value || (leftKey < rightKey ? -1 : 1)).map(([, item]) => item);
  const budget = Math.floor(caps.perSide * (1 - NPC_SUN_ORDER_BALANCE.anyShare));
  const chosen: SunRaidOrderShipSlot[] = [];
  let used = 0;
  let anyMinLevel = Number.POSITIVE_INFINITY;
  for (const item of ranked) {
    if (chosen.length >= SUN_ORDER_MAX_SLOTS - 1) { anyMinLevel = Math.min(anyMinLevel, item.slot.minLevel ?? 0); continue; }
    const fit = Math.min(item.slot.count, Math.floor((budget - used) / item.unit));
    if (fit < item.slot.count) anyMinLevel = Math.min(anyMinLevel, item.slot.minLevel ?? 0);
    if (fit <= 0) continue;
    const slot: SunRaidOrderShipSlot = { kind: 'ship', factionId: item.slot.factionId, entityId: item.slot.entityId, count: fit };
    if (item.slot.minLevel) slot.minLevel = item.slot.minLevel;
    chosen.push(slot);
    used += fit * item.unit;
  }
  // The «любые» room takes the rest; its level bar is the lowest level among the quality offers left over
  // (no quality offer left over: the members' filler may close the gap, any level).
  const anyPopulation = caps.perSide - used;
  // A level bar on «любые» only when the called members' good hulls alone cover the side well over.
  const qualityTotal = quality.reduce((sum, offer) => sum + offer.population, 0);
  const minLevel = Number.isFinite(anyMinLevel) && qualityTotal >= caps.perSide * NPC_SUN_ORDER_BALANCE.callMargin ? anyMinLevel : 0;
  const order: SunRaidOrder = {
    version: 1, preset: 'npc',
    slots: [...chosen, ...(anyPopulation > SUN_RAID_CONFIG.raidLaunchTolerance || !chosen.length ? [{ kind: 'any' as const, population: Math.max(1, anyPopulation), ...(minLevel ? { minLevel } : {}) }] : [])],
  };
  const error = validateSunRaidOrder(order, { perSide: caps.perSide, races: allianceSunRaces(state, plan.allianceId) });
  return error ? null : { order, experience, offered: Math.round(offers.reduce((sum, offer) => sum + offer.population, 0)), filler: Math.round(filler) };
}

/** What one planet of the leader sends with the call: the strongest part of it its exact slots accept («любые» stays for the members). */
export function npcOrderForceForPlanet(state: SaveState, ownerId: string, planet: SpyTargetState, room: number, order: SunRaidOrder, exactOnly = true): Partial<Record<ShipId, number>> {
  const levels = npcShipLevels(state, ownerId);
  const { hulls } = npcSunComposePool(state, ownerId, [planet], room);
  const counts = npcOrderedCounts(hulls, room, order, sunOrderRoomFor(order, new Map(), planet.raceId as CombatFactionId, levels), levels, exactOnly);
  const ships: Partial<Record<ShipId, number>> = {};
  for (const hull of hulls) {
    const count = counts.get(hull.key) ?? 0;
    if (count > 0) ships[hull.key.slice(hull.key.indexOf('|') + 1) as ShipId] = count;
  }
  return ships;
}

/** Short text forms for the bot journal. */
export function describeSunOrder(order: SunRaidOrder): string {
  return order.slots.map((slot) => slot.kind === 'any' ? `any:${slot.population}${slot.minLevel ? `:L${slot.minLevel}` : ''}` : `${slot.factionId}:${slot.entityId}:${slot.count}${slot.minLevel ? `:L${slot.minLevel}` : ''}`).join(',');
}

export function describeSunExperience(experience: SunExperience): string {
  return Object.entries(experience.multipliers).map(([type, value]) => `${type}:${value}`).join(',');
}
