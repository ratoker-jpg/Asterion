import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import type { NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { ACTIVE_RUNTIME_MODE } from '../domain/runtime/mode.ts';
import { SUN_RAID_CONFIG, sunRaidCapsOf } from '../domain/sun-raid/config.ts';
import { checkRaidLaunch, getHolderCrystals, missingCrystals } from '../domain/sun-raid/rules.ts';
import { WORLD_LIMITS } from '../domain/world/config.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import type { SaveState } from './contracts.ts';
import { getNpcMissionPlanningFleet } from './npc-missions.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import { strategyOf, type NpcUtilityContext } from './npc-utility.ts';
import {
  crystalHolderOf,
  currentSunRaidState,
  joinNpcSunRaid,
  launchNpcSunRaid,
  raidPledgeRoom,
  selectOwnerGateContext,
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

/** Combat hulls free on one planet, a share of them, trimmed to the side's population room. */
function sunForce(state: SaveState, ownerId: string, planetId: string, raceId: string, share: number, room: number): Partial<Record<ShipId, number>> {
  const free = getNpcMissionPlanningFleet(state, ownerId, planetId) ?? {};
  const combat = new Set(getFactionShipCatalog(raceId as never).filter((entity) => entity.category === 'Боевой корабль').map((entity) => entity.id));
  let ships: Partial<Record<ShipId, number>> = {};
  for (const [id, count] of Object.entries(free) as [ShipId, number][]) {
    if (CIVIL_SHIPS.has(id) || !combat.has(id)) continue;
    const sent = Math.floor((count ?? 0) * share);
    if (sent > 0) ships[id] = sent;
  }
  const population = sunFleetPopulation(ships, raceId as never);
  if (population > room && population > 0) {
    const scale = room / population;
    ships = Object.fromEntries(Object.entries(ships).map(([id, count]) => [id, Math.floor((count ?? 0) * scale)]).filter(([, count]) => (count as number) > 0));
    // Rounding down leaves a gap; the smallest hulls still at hand close it.
    let left = room - sunFleetPopulation(ships, raceId as never);
    const bySize = getFactionShipCatalog(raceId as never).filter((entity) => combat.has(entity.id) && !CIVIL_SHIPS.has(entity.id as ShipId))
      .sort((a, b) => a.population - b.population || a.id.localeCompare(b.id));
    for (const entity of bySize) {
      const id = entity.id as ShipId;
      const spare = Math.max(0, Math.floor((free[id] ?? 0) * share) - (ships[id] ?? 0));
      const add = Math.min(spare, Math.floor(left / Math.max(1, entity.population)));
      if (add > 0) { ships[id] = (ships[id] ?? 0) + add; left -= add * entity.population; }
    }
  }
  return ships;
}

/** What one owner can put into a raid: combat hulls from its planets, strongest first, up to its 75 000. */
function pledgeablePopulation(state: SaveState, ownerId: string, share: number): number {
  let total = 0;
  for (const target of Object.values(state.espionage?.targets ?? {})) {
    if (target.kind !== 'npc' || target.ownerId !== ownerId) continue;
    total += sunFleetPopulation(sunForce(state, ownerId, target.id, target.raceId, share, Infinity), target.raceId as never);
  }
  return Math.min(sunRaidCapsOf(state).participant, total);
}

/** Pledges this owner's share of combat hulls, planet by planet, into a gathering raid. */
function pledgeFromPlanets(state: SaveState, ownerId: string, raidId: string, share: number, key: string, options: SunRuntimeOptions): { state: SaveState; pledged: number } {
  let next = state;
  let pledged = 0;
  const planets = Object.values(next.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const planet of planets) {
    const raid = currentSunRaidState(next).raids.find((item) => item.id === raidId);
    if (!raid || raid.status !== 'gathering') break;
    const room = raidPledgeRoom(next, raid, ownerId);
    if (room <= 0) break;
    const ships = sunForce(next, ownerId, planet.id, planet.raceId, share, room);
    if (!Object.keys(ships).length) continue;
    const result = joinNpcSunRaid(next, ownerId, { raidId, originPlanetId: planet.id, ships, requestId: `${key}:${planet.id}` }, options);
    if (!result.ok) continue;
    next = result.state;
    pledged += sunFleetPopulation(ships, planet.raceId as never);
  }
  return { state: next, pledged };
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
    if (raidPledgeRoom(state, raid, ownerId) <= 0 || pledgeablePopulation(state, ownerId, share) <= 0) continue;
    const id = `sun-raid-join:${ownerId}:${raid.id}`;
    // The alliance's call comes first (owner 31.10.2026: allies never came and all 12 gatherings disbanded).
    const estimate = 1.2 + 0.8 * unit(traits.cooperation) + 0.4 * drives.operations + 0.3 * (4 - missing) / 4;
    choices.push({ candidate: { id, kind: 'endgame', weight: scored(id, estimate), payload: { raidId: raid.id } }, run: (current, key) => {
      const result = pledgeFromPlanets(current, ownerId, raid.id, 1, key, options);
      return { state: result.state, started: result.pledged > 0, reason: result.pledged > 0 ? null : 'nothing-to-pledge' };
    } });
  }
  // 2b. Leadership declares a gathering only when the alliance can fill it.
  if (membership && (membership.role === 'leader' || membership.role === 'deputy') && missing > 0) {
    const alliance = state.command.alliances.find((item) => item.id === membership.alliance.id);
    // Only members at the game now can answer within the 30-minute gathering (owner 31.10.2026):
    // the leader calls when those online, itself included, can really fill the side.
    const online = (memberId: string) => memberId === ownerId || state.npc?.profiles[memberId]?.session.active === true;
    const reachable = (alliance?.members ?? []).filter((member) => online(member.ownerId))
      .reduce((total, member) => total + pledgeablePopulation(state, member.ownerId, share), 0);
    const own = pledgeablePopulation(state, ownerId, share);
    if (own > 0 && reachable >= sunRaidCapsOf(state).perSide) {
      const origin = [...planets].sort((left, right) => sunFleetPopulation(sunForce(state, ownerId, right.id, right.raceId, 1, Infinity), right.raceId as never)
        - sunFleetPopulation(sunForce(state, ownerId, left.id, left.raceId, 1, Infinity), left.raceId as never) || left.id.localeCompare(right.id))[0]!;
      const ships = sunForce(state, ownerId, origin.id, origin.raceId, share, sunRaidCapsOf(state).participant);
      const population = sunFleetPopulation(ships, origin.raceId as never);
      const random = createSeededRandom(`npc-sun:${ownerId}:${at}`);
      const galaxy = origin.coordinate.galaxy;
      // A few Suns this owner looks at this time; the first one open to a raid is chosen.
      const systems = Array.from({ length: 6 }, () => 1 + Math.floor(random() * WORLD_LIMITS.systemsPerGalaxy));
      const system = population > 0 ? systems.find((candidate) => checkRaidLaunch({ state: sunRaid, allianceId: membership.alliance.id, role: membership.role,
        galaxy, system: candidate, population, now: at, participantCap: sunRaidCapsOf(state).participant }).ok) : undefined;
      if (system !== undefined) {
        const id = `sun-raid:${ownerId}:${galaxy}:${system}`;
        const estimate = 0.4 + 0.9 * drives.operations + 0.7 * drives.war + 0.3 * (4 - missing) / 4 + 0.3 * (unit(traits.riskTolerance) - 0.5);
        choices.push({ candidate: { id, kind: 'endgame', weight: scored(id, estimate), payload: { planetId: origin.id } }, run: (current, key) => {
          const result = launchNpcSunRaid(current, ownerId, { galaxy, system, originPlanetId: origin.id, ships, requestId: key }, options);
          if (!result.ok || !result.raidId) return { state: current, started: false, reason: result.ok ? 'no-raid' : result.error, planetId: origin.id };
          // The leader tops its own share up from its other planets.
          return { state: pledgeFromPlanets(result.state, ownerId, result.raidId, 1, key, options).state, started: true, reason: null, planetId: origin.id };
        } });
      }
    }
  }

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
    const origin = local.sort((left, right) => sunFleetPopulation(sunForce(state, ownerId, right.id, right.raceId, 1, Infinity), right.raceId as never)
      - sunFleetPopulation(sunForce(state, ownerId, left.id, left.raceId, 1, Infinity), left.raceId as never) || left.id.localeCompare(right.id))[0]!;
    const ships = sunForce(state, ownerId, origin.id, origin.raceId, 0.2 + 0.35 * unit(traits.riskTolerance), room);
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
