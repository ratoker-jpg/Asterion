import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import type { NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { ACTIVE_RUNTIME_MODE } from '../domain/runtime/mode.ts';
import { SUN_RAID_CONFIG } from '../domain/sun-raid/config.ts';
import { checkRaidLaunch, getHolderCrystals, missingCrystals } from '../domain/sun-raid/rules.ts';
import { WORLD_LIMITS } from '../domain/world/config.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import type { SaveState } from './contracts.ts';
import { getNpcMissionAvailableFleet } from './npc-missions.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import { strategyOf, type NpcUtilityContext } from './npc-utility.ts';
import {
  crystalHolderOf,
  currentSunRaidState,
  launchNpcSunRaid,
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

/** Smallest raiding force worth three hours each way: a Sun nobody defends falls to any real fleet. */
export const NPC_SUN_RAID_MIN_POPULATION = 300;

const CIVIL_SHIPS = new Set<ShipId>(['spy-probe', 'colonizer', 'transporter', 'mega-transporter', 'recycler', 'solar-satellite']);

function unit(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 0.5;
}

function sunOptions(at: number, timeScale: number): SunRuntimeOptions {
  return { now: at, mode: ACTIVE_RUNTIME_MODE, timeScale };
}

/** Combat hulls free on one planet, a share of them, trimmed to the side's population room. */
function sunForce(state: SaveState, ownerId: string, planetId: string, raceId: string, share: number, room: number): Partial<Record<ShipId, number>> {
  const free = getNpcMissionAvailableFleet(state, ownerId, planetId) ?? {};
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
  }
  return ships;
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

  // 2. Alliance leadership raids a Sun while the alliance still lacks crystals.
  const membership = selectOwnerMembership(state.command, ownerId);
  const { holder } = crystalHolderOf(state, ownerId);
  const missing = missingCrystals(getHolderCrystals(sunRaid, holder)).length;
  if (membership && (membership.role === 'leader' || membership.role === 'deputy') && missing > 0) {
    const origin = [...planets].sort((left, right) => sunFleetPopulation(sunForce(state, ownerId, right.id, right.raceId, 1, Infinity), right.raceId as never)
      - sunFleetPopulation(sunForce(state, ownerId, left.id, left.raceId, 1, Infinity), left.raceId as never) || left.id.localeCompare(right.id))[0]!;
    // Bold owners commit more of the fleet; the rest guards home.
    const ships = sunForce(state, ownerId, origin.id, origin.raceId, 0.45 + 0.45 * unit(traits.riskTolerance), SUN_RAID_CONFIG.populationCapPerSide);
    const population = sunFleetPopulation(ships, origin.raceId as never);
    // A raid needs a real battle fleet; the side's population cap is the yardstick.
    if (population >= NPC_SUN_RAID_MIN_POPULATION) {
      const random = createSeededRandom(`npc-sun:${ownerId}:${at}`);
      const galaxy = origin.coordinate.galaxy;
      // A few Suns this owner looks at this time; the first one open to a raid is chosen.
      const systems = Array.from({ length: 6 }, () => 1 + Math.floor(random() * WORLD_LIMITS.systemsPerGalaxy));
      const system = systems.find((candidate) => checkRaidLaunch({ state: sunRaid, allianceId: membership.alliance.id, role: membership.role,
        galaxy, system: candidate, population, now: at }).ok);
      if (system !== undefined) {
        const id = `sun-raid:${ownerId}:${galaxy}:${system}`;
        const estimate = -0.4 + 0.9 * drives.operations + 0.7 * drives.war + 0.3 * (4 - missing) / 4
          + 0.6 * Math.min(1, population / (0.25 * SUN_RAID_CONFIG.populationCapPerSide)) + 0.3 * (unit(traits.riskTolerance) - 0.5);
        choices.push({ candidate: { id, kind: 'pve', weight: scored(id, estimate), payload: { planetId: origin.id } }, run: (current, key) => {
          const result = launchNpcSunRaid(current, ownerId, { galaxy, system, originPlanetId: origin.id, ships, requestId: key }, sunOptions(at, timeScale));
          return result.ok ? { state: result.state, started: true, reason: null, planetId: origin.id } : { state: current, started: false, reason: result.error, planetId: origin.id };
        } });
      }
    }
  }

  // 3. «Поддержка солнца»: a rival alliance raids a Sun of a galaxy where this owner lives.
  for (const raid of sunRaid.raids) {
    if (raid.status !== 'incoming' || raid.arrivesAt <= at || raid.allianceId === membership?.alliance.id) continue;
    const local = planets.filter((planet) => planet.coordinate.galaxy === raid.galaxy);
    if (!local.length) continue;
    const room = SUN_RAID_CONFIG.populationCapPerSide - selectRaidSides(state, raid.id).defenders.population;
    if (room <= 0) continue;
    const raiders = { kind: 'alliance' as const, id: raid.allianceId };
    const raiderCrystals = getHolderCrystals(sunRaid, raiders).length;
    const atWar = membership ? selectAllianceRelations(state.command, membership.alliance.id)
      .some((relation) => relation.id === raid.allianceId && relation.status === 'war') : false;
    const ownSystem = local.some((planet) => planet.coordinate.system === raid.system);
    // Stop an alliance close to the Gate, an enemy, or a raid that dims this owner's own Sun.
    // A raid far from home by an alliance with few crystals is someone else's business.
    const motive = 0.25 * raiderCrystals + (atWar ? 0.6 : 0) + (ownSystem ? 0.7 : 0);
    if (motive < 0.5) continue;
    const origin = local.sort((left, right) => sunFleetPopulation(sunForce(state, ownerId, right.id, right.raceId, 1, Infinity), right.raceId as never)
      - sunFleetPopulation(sunForce(state, ownerId, left.id, left.raceId, 1, Infinity), left.raceId as never) || left.id.localeCompare(right.id))[0]!;
    const ships = sunForce(state, ownerId, origin.id, origin.raceId, 0.2 + 0.35 * unit(traits.riskTolerance), room);
    if (!Object.keys(ships).length) continue;
    const id = `sun-support:${ownerId}:${raid.id}`;
    const estimate = -1 + motive + 0.4 * unit(traits.cooperation) + 0.3 * drives.military;
    choices.push({ candidate: { id, kind: 'pve', weight: scored(id, estimate), payload: { planetId: origin.id } }, run: (current, key) => {
      const result = sendNpcSunSupport(current, ownerId, { raidId: raid.id, originPlanetId: origin.id, ships, requestId: key }, sunOptions(at, timeScale));
      return result.ok ? { state: result.state, started: true, reason: null, planetId: origin.id } : { state: current, started: false, reason: result.error, planetId: origin.id };
    } });
  }
  return choices;
}
