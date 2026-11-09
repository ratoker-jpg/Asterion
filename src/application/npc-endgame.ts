import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { composeRaidForce, raidForceQuality, type RaidHull } from '../domain/npc/raid-composition.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import type { NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { ACTIVE_RUNTIME_MODE } from '../domain/runtime/mode.ts';
import { sunRaidCapsOf } from '../domain/sun-raid/config.ts';
import { getHolderCrystals, missingCrystals } from '../domain/sun-raid/rules.ts';
import type { SaveState } from './contracts.ts';
import { getNpcMissionAvailableFleet } from './npc-missions.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import { strategyOf, type NpcUtilityContext } from './npc-utility.ts';
import { activeNpcSunPrep } from './npc-sun-prep-state.ts';
import { hullLevelMultiplier, sunOrderRoomFor, type SunRaidOrder } from '../domain/sun-raid/order.ts';
import type { SunRaidRecord } from '../domain/sun-raid/types.ts';
import {
  crystalHolderOf,
  currentSunRaidState,
  joinNpcSunRaid,
  npcSunFlightGas,
  raidPledgeRoom,
  selectOwnerGateContext,
  selectRaidOrderFill,
  selectRaidSides,
  sendNpcSunSupport,
  startNpcGateConstruction,
  sunFleetPopulation,
  type SunRuntimeOptions,
} from './sun-raid.ts';

/**
 * The endgame for autonomous NPC owners, by the player's rules: alliance
 * leadership raids Suns for crystals, owners with planets in a galaxy defend
 * its Suns from rival alliances, and whoever holds all four crystals lays the
 * Gate. Breaking a rival Gate is an ordinary attack (see `npc-utility`).
 */

type Outcome = { state: SaveState; started: boolean; reason: string | null; planetId?: string };
export type NpcEndgameChoice = { candidate: NpcAutonomyCandidate; run: (state: SaveState, key: string) => Outcome };


const CIVIL_SHIPS = new Set<ShipId>(['spy-probe', 'colonizer', 'transporter', 'mega-transporter', 'recycler', 'solar-satellite']);

function unit(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 0.5;
}

function sunOptions(at: number, timeScale: number): SunRuntimeOptions {
  return { now: at, mode: ACTIVE_RUNTIME_MODE, timeScale };
}

/** The owner's ship upgrade levels (owner-wide, kept on each of its planets' profile). */
export function npcShipLevels(state: SaveState, ownerId: string): Partial<Record<string, number>> {
  const target = Object.values(state.espionage?.targets ?? {}).find((item) => item.kind === 'npc' && item.ownerId === ownerId);
  return { ...(target?.ownerProfile?.shipLevels ?? {}) };
}

/**
 * The combat hulls an owner has free on one planet (a share of them), as raid hulls. Attack and
 * life carry the hull's upgrade level (the battle engine's own coefficient), so a level-10 hull
 * outranks a level-0 one per population (owner 09.11.2026: no level-0 filler); `value` may scale
 * a hull type further (the Sun battle experience).
 */
function planetRaidHulls(state: SaveState, ownerId: string, planetId: string, raceId: string, share: number, value?: Readonly<Record<string, number>>): RaidHull[] {
  const free = getNpcMissionAvailableFleet(state, ownerId, planetId) ?? {};
  const levels = npcShipLevels(state, ownerId);
  const hulls: RaidHull[] = [];
  for (const entity of getFactionShipCatalog(raceId as never)) {
    const id = entity.id as ShipId;
    if (entity.category !== 'Боевой корабль' || CIVIL_SHIPS.has(id) || !entity.combat) continue;
    const count = Math.floor((free[id] ?? 0) * share);
    const multiplier = hullLevelMultiplier(id, levels[id] ?? 0) * (value?.[id] ?? 1);
    if (count > 0) hulls.push({ key: `${planetId}|${id}`, population: entity.population, attack: entity.combat.attack * multiplier, life: entity.combat.life * multiplier, count });
  }
  return hulls;
}

type OrderRoom = ReturnType<typeof sunOrderRoomFor>;

/**
 * The strongest force for `room` that a raid's order still accepts from this owner: hulls of its own
 * open slots first (each slot's open count over all its planets), then the «любые» room with what
 * is left (level permitting). Keys are `planet|ship`, like the free pool's.
 */
export function npcOrderedCounts(hulls: readonly RaidHull[], room: number, order: SunRaidOrder, open: OrderRoom, levels: Partial<Record<string, number>>): Map<string, number> {
  const shipOf = (key: string) => key.slice(key.indexOf('|') + 1);
  const byShip = new Map<string, RaidHull[]>();
  for (const hull of [...hulls].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))) {
    byShip.set(shipOf(hull.key), [...(byShip.get(shipOf(hull.key)) ?? []), hull]);
  }
  const aggregated: RaidHull[] = [];
  for (const [id, list] of byShip) {
    const limit = open.perEntity[id as ShipId] ?? 0;
    const have = list.reduce((sum, hull) => sum + hull.count, 0);
    if (limit > 0 && have > 0) aggregated.push({ key: id, population: list[0]!.population, attack: list[0]!.attack, life: list[0]!.life, count: Math.min(limit, have) });
  }
  const chosen = new Map<string, number>();
  let used = 0;
  for (const [id, count] of composeRaidForce(aggregated, room)) {
    let left = count;
    for (const hull of byShip.get(id) ?? []) {
      const take = Math.min(left, hull.count);
      if (take > 0) { chosen.set(hull.key, take); left -= take; used += take * hull.population; }
    }
  }
  const anyRoom = Math.min(room - used, open.anyPopulation);
  if (anyRoom > 0 && order.slots.some((slot) => slot.kind === 'any')) {
    const leftovers = hulls.filter((hull) => (levels[shipOf(hull.key)] ?? 0) >= open.anyMinLevel)
      .map((hull) => ({ ...hull, count: hull.count - (chosen.get(hull.key) ?? 0) })).filter((hull) => hull.count > 0);
    for (const [key, count] of composeRaidForce(leftovers, anyRoom)) chosen.set(key, (chosen.get(key) ?? 0) + count);
  }
  return chosen;
}

/** Population a raid's order still accepts from this owner (0: nothing it has fits an open slot). */
export function npcOrderOpenFor(state: SaveState, raid: SunRaidRecord, ownerId: string): number {
  if (!raid.order) return Number.POSITIVE_INFINITY;
  const planets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (!planets.length) return 0;
  const { hulls, counts } = npcSunComposePool(state, ownerId, planets, raidPledgeRoom(state, raid, ownerId), raid);
  return hulls.reduce((sum, hull) => sum + (counts.get(hull.key) ?? 0) * hull.population, 0);
}

function shipsOfHulls(hulls: readonly RaidHull[], counts: ReadonlyMap<string, number>, planetId: string): Partial<Record<ShipId, number>> {
  const ships: Partial<Record<ShipId, number>> = {};
  for (const hull of hulls) {
    const count = counts.get(hull.key) ?? 0;
    if (count > 0 && hull.key.startsWith(`${planetId}|`)) ships[hull.key.slice(planetId.length + 1) as ShipId] = count;
  }
  return ships;
}

/**
 * Combat hulls free on one planet, a share of them, trimmed to the side's population room:
 * with more than the room the strongest force for it (npc/raid-composition.ts), not a slice of each type.
 */
export function npcSunForce(state: SaveState, ownerId: string, planetId: string, raceId: string, share: number, room: number): Partial<Record<ShipId, number>> {
  const hulls = planetRaidHulls(state, ownerId, planetId, raceId, share);
  return shipsOfHulls(hulls, composeRaidForce(hulls, room), planetId);
}

/**
 * One owner's strongest force of `room` population over all its planets at once (the best hulls first,
 * wherever they stand), planet by planet.
 */
export function npcSunComposePool(state: SaveState, ownerId: string, planets: readonly { id: string; raceId: string }[], room: number,
  raid?: SunRaidRecord, value?: Readonly<Record<string, number>>): { hulls: RaidHull[]; counts: Map<string, number> } {
  const hulls = planets.flatMap((planet) => planetRaidHulls(state, ownerId, planet.id, planet.raceId, 1, value));
  // A raid with an order: only what its open slots still accept from this owner.
  if (raid?.order && planets.length) {
    const levels = npcShipLevels(state, ownerId);
    const open = sunOrderRoomFor(raid.order, selectRaidOrderFill(state, raid), planets[0]!.raceId as never, levels);
    return { hulls, counts: npcOrderedCounts(hulls, room, raid.order, open, levels) };
  }
  return { hulls, counts: composeRaidForce(hulls, room) };
}

/** Strength per population of the force this owner would bring into `room`: what it tells its alliance. */
export function npcSunForceQuality(state: SaveState, ownerId: string, planets: readonly { id: string; raceId: string }[], room: number): number {
  const { hulls, counts } = npcSunComposePool(state, ownerId, planets, room);
  return raidForceQuality(hulls, counts);
}

/** The part of a force its planet's gas can fly to this Sun: a fuller hold would only be refused at launch. */
export function npcSunAffordableForce(state: SaveState, ownerId: string, planetId: string, ships: Partial<Record<ShipId, number>>, galaxy: number, system: number, options: SunRuntimeOptions): Partial<Record<ShipId, number>> {
  const gas = state.espionage?.targets?.[planetId]?.resources.gas ?? 0;
  const cost = npcSunFlightGas(state, ownerId, planetId, ships, galaxy, system, options);
  if (cost <= gas) return ships;
  const scale = cost > 0 ? 0.98 * gas / cost : 0;
  return Object.fromEntries(Object.entries(ships).map(([id, count]) => [id, Math.floor((count ?? 0) * scale)]).filter(([, count]) => (count as number) > 0)) as Partial<Record<ShipId, number>>;
}

/** What one owner can put into a raid: combat hulls from its planets, strongest first, up to its 75 000. */
function pledgeablePopulation(state: SaveState, ownerId: string, share: number): number {
  let total = 0;
  for (const target of Object.values(state.espionage?.targets ?? {})) {
    if (target.kind !== 'npc' || target.ownerId !== ownerId) continue;
    total += sunFleetPopulation(npcSunForce(state, ownerId, target.id, target.raceId, share, Infinity), target.raceId as never);
  }
  return Math.min(sunRaidCapsOf(state).participant, total);
}

/**
 * Pledges this owner's strongest force into a gathering raid, up to `limit` (its own promise or allotment):
 * the best hulls of all its planets first, then each planet sends its part (a second pass spends room
 * a planet's gas could not fly; ships that left are already off the planet's stock).
 */
export function npcSunPledgeFromPlanets(state: SaveState, ownerId: string, raidId: string, share: number, key: string, options: SunRuntimeOptions, limit = Number.POSITIVE_INFINITY): { state: SaveState; pledged: number } {
  let next = state;
  let pledged = 0;
  const planets = Object.values(next.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (let pass = 0; pass < 2; pass += 1) {
    const first = currentSunRaidState(next).raids.find((item) => item.id === raidId);
    if (!first || first.status !== 'gathering') break;
    const room = Math.min(raidPledgeRoom(next, first, ownerId), limit - pledged);
    if (room <= 0) break;
    const pool = npcSunComposePool(next, ownerId, planets, room, first);
    let sentAny = false;
    for (const planet of planets) {
      const raid = currentSunRaidState(next).raids.find((item) => item.id === raidId);
      if (!raid || raid.status !== 'gathering') break;
      const planetRoom = Math.min(raidPledgeRoom(next, raid, ownerId), limit - pledged);
      if (planetRoom <= 0) break;
      const planned = shipsOfHulls(pool.hulls, pool.counts, planet.id);
      const ships = npcSunAffordableForce(next, ownerId, planet.id, npcSunTrim(planned, planet.raceId, planetRoom), raid.galaxy, raid.system, options);
      if (!Object.keys(ships).length) continue;
      const result = joinNpcSunRaid(next, ownerId, { raidId, originPlanetId: planet.id, ships, requestId: `${key}:${planet.id}${pass ? ':2' : ''}` }, options);
      if (!result.ok) continue;
      next = result.state;
      pledged += sunFleetPopulation(ships, planet.raceId as never);
      sentAny = true;
    }
    if (!sentAny) break;
  }
  return { state: next, pledged };
}

/** A planned force cut to a smaller room, the strongest part kept (the room may have shrunk while others joined). */
function npcSunTrim(ships: Partial<Record<ShipId, number>>, raceId: string, room: number): Partial<Record<ShipId, number>> {
  if (sunFleetPopulation(ships, raceId as never) <= room) return ships;
  const hulls: RaidHull[] = [];
  for (const entity of getFactionShipCatalog(raceId as never)) {
    const count = ships[entity.id as ShipId] ?? 0;
    if (count > 0 && entity.combat) hulls.push({ key: entity.id, population: entity.population, attack: entity.combat.attack, life: entity.combat.life, count });
  }
  const counts = composeRaidForce(hulls, room);
  return Object.fromEntries([...counts].filter(([, count]) => count > 0)) as Partial<Record<ShipId, number>>;
}

export function getNpcEndgameChoices(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number,
  scored: (candidateId: string, estimate: number) => number): NpcEndgameChoice[] {
  const ownerId = profile.ownerId;
  const sunRaid = currentSunRaidState(state);
  if (sunRaid.campaignResult) return [];
  const choices: NpcEndgameChoice[] = [];
  const traits = profile.traits;
  const drives = strategyOf(utility);
  const planets = utility.ownPlanets;
  if (!planets.length) return [];

  // 1. Four crystals: lay the Gate on the main planet. Nothing is worth more.
  const gate = selectOwnerGateContext(state, ownerId, at);
  if (gate.canStart) {
    const id = `gate-start:${ownerId}`;
    choices.push({ candidate: { id, kind: 'endgame', weight: utilityToWeight(3), payload: { ownerId } }, run: (current) => {
      const result = startNpcGateConstruction(current, ownerId, sunOptions(at, timeScale));
      return result.ok ? { state: result.state, started: true, reason: null } : { state: current, started: false, reason: result.error };
    } });
  }

  // 2. Sun raids are gathered (owner rule 25.10.2026): exactly 225 000 population,
  // at most 75 000 from any one participant, 30 minutes to fill up.
  const membership = selectOwnerMembership(state.command, ownerId);
  const { holder } = crystalHolderOf(state, ownerId);
  const missing = missingCrystals(getHolderCrystals(sunRaid, holder)).length;
  // A participant brings all it can within its 75 000: the risk of an empty
  // home is weighed when deciding to raid, not by sending a token force.
  const share = 1;
  const options = sunOptions(at, timeScale);
  // 2a. A member answers the call of its own alliance's gathering.
  for (const raid of sunRaid.raids) {
    if (!membership || raid.status !== 'gathering' || raid.allianceId !== membership.alliance.id || (raid.gatherEndsAt ?? 0) <= at) continue;
    // A plan's own gathering: a member who answered keeps to its answer (npc-sun-prep.ts); only the others may still come.
    const planned = activeNpcSunPrep(state, raid.allianceId);
    if (planned?.raidId === raid.id && planned.rsvps[ownerId]) continue;
    if (raidPledgeRoom(state, raid, ownerId) <= 0 || pledgeablePopulation(state, ownerId, share) <= 0 || npcOrderOpenFor(state, raid, ownerId) <= 0) continue;
    const id = `sun-raid-join:${ownerId}:${raid.id}`;
    // The alliance's call comes first (owner 31.10.2026: allies never came and all 12 gatherings disbanded).
    const estimate = 1.2 + 0.8 * unit(traits.cooperation) + 0.4 * drives.operations + 0.3 * (4 - missing) / 4;
    choices.push({ candidate: { id, kind: 'endgame', weight: scored(id, estimate), payload: { raidId: raid.id } }, run: (current, key) => {
      const result = npcSunPledgeFromPlanets(current, ownerId, raid.id, 1, key, options);
      return { state: result.state, started: result.pledged > 0, reason: result.pledged > 0 ? null : 'nothing-to-pledge' };
    } });
  }
  // 2b. Leadership no longer calls a gathering on the spot: it plans one ahead (npc-sun-prep.ts).

  // 3. «Поддержка солнца»: a rival alliance raids a Sun of a galaxy where this owner lives.
  for (const raid of sunRaid.raids) {
    if (raid.status !== 'incoming' || raid.arrivesAt <= at || raid.allianceId === membership?.alliance.id) continue;
    const local = planets.filter((planet) => planet.coordinate.galaxy === raid.galaxy);
    if (!local.length) continue;
    const room = sunRaidCapsOf(state).perSide - selectRaidSides(state, raid.id).defenders.population;
    if (room <= 0) continue;
    const raiders = { kind: 'alliance' as const, id: raid.allianceId };
    const raiderCrystals = getHolderCrystals(sunRaid, raiders).length;
    const atWar = membership ? selectAllianceRelations(state.command, membership.alliance.id)
      .some((relation) => relation.id === raid.allianceId && relation.status === 'war') : false;
    const ownSystem = local.some((planet) => planet.coordinate.system === raid.system);
    // Stop an alliance close to the Gate, an enemy, or a raid that dims this owner's own Sun.
    // A raid far from home is someone else's business until the raiders are one crystal from the Gate.
    const motive = 0.25 * raiderCrystals + (atWar ? 0.6 : 0) + (ownSystem ? 0.7 : 0);
    if (motive < 0.6) continue;
    const origin = local.sort((left, right) => sunFleetPopulation(npcSunForce(state, ownerId, right.id, right.raceId, 1, Infinity), right.raceId as never)
      - sunFleetPopulation(npcSunForce(state, ownerId, left.id, left.raceId, 1, Infinity), left.raceId as never) || left.id.localeCompare(right.id))[0]!;
    // A share of the fleet's population, but of its strongest hulls: a slice of every type would send the weak ones too.
    const total = sunFleetPopulation(npcSunForce(state, ownerId, origin.id, origin.raceId, 1, Infinity), origin.raceId as never);
    const ships = npcSunForce(state, ownerId, origin.id, origin.raceId, 1, Math.min(room, Math.floor(total * (0.2 + 0.35 * unit(traits.riskTolerance)))));
    if (!Object.keys(ships).length) continue;
    const id = `sun-support:${ownerId}:${raid.id}`;
    // (kind endgame: the Sun is its own family of choices, not one more PvE trip)
    const estimate = -1 + motive + 0.4 * unit(traits.cooperation) + 0.3 * drives.military;
    choices.push({ candidate: { id, kind: 'endgame', weight: scored(id, estimate), payload: { planetId: origin.id } }, run: (current, key) => {
      const result = sendNpcSunSupport(current, ownerId, { raidId: raid.id, originPlanetId: origin.id, ships, requestId: key }, sunOptions(at, timeScale));
      return result.ok ? { state: result.state, started: true, reason: null, planetId: origin.id } : { state: current, started: false, reason: result.error, planetId: origin.id };
    } });
  }
  return choices;
}
