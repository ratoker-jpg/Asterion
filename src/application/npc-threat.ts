import { flightsToPlanet, ownerBattleReports, ownerFlights } from './npc-knowledge-index.ts';
import { describeIncomingAttack, type IncomingAttackKnowledge } from '../domain/flights/incoming-attack-knowledge.ts';
import { estimateForcePower, estimateWinProbability, type ForceStack } from '../domain/npc/utility.ts';
import { PIRATE_CATALOG_BY_ID } from '../domain/pirates/catalog.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { CommanderId } from '../domain/combat/commanders.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { calculatePlanetCapacity, OVERPOPULATION_WINDOW_MS } from '../domain/fleet/overpopulation.ts';
import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import type { NpcTraits } from '../domain/npc/types.ts';
import type { SaveState } from './contracts.ts';
import { dispatchNpcDeployment, getNpcMissionAvailableFleet, npcDeploymentFreeCapacity } from './npc-missions.ts';
import { npcDefenseValue, npcFleetValue, npcForcePower, npcPowerPerResource, type NpcUtilityContext } from './npc-utility.ts';

/**
 * Fight or leave (owner rule 26.10.2026, decisions 9 and 11): an NPC that
 * sees an attack coming judges it from what its owner may know. From
 * espionage 10 it reads the exact composition (the same `describeIncomingAttack`
 * the player's screens use); below that it has only public data: who flies,
 * their rating points, its own old spy reports on them and battles it fought
 * with them. The less it knows, the more it fears. Its character then decides:
 * a cautious owner leaves early, an aggressive one stays even against a
 * slightly stronger enemy. A weak attack is no reason to leave.
 *
 * Balance parameters (owner may change them; listed in the PR):
 */
export const NPC_THREAT_BALANCE = {
  /** Win belief needed to stay = base − aggression·a − riskTolerance·r, clamped. */
  stayBase: 0.7,
  stayAggression: 0.25,
  stayRisk: 0.2,
  stayMin: 0.2,
  stayMax: 0.75,
  /** Relative error the owner assumes: exact composition / old intel / only the rating. */
  uncertaintyKnown: 0.1,
  uncertaintyIntel: 0.35,
  uncertaintyBlind: 0.6,
  /** Unknown pirate raids are tailored to the planet they raid: assume them about its equal. */
  pirateBlindRatio: 1,
  /** Share of an attacker's public resource points believed to be warships (raised by battle points). */
  scoreFleetShareMin: 0.25,
  scoreFleetShareMax: 0.75,
  /** Attacks arriving this close to the first one are one wave. */
  waveWindowMs: 15 * 60_000,
  /** Reinforcements must land at least this long before the attack. */
  arrivalMarginMs: 60_000,
  /** At most this many own planets send a deployment for one defence. */
  maxReinforcementSources: 3,
  /** Expected overpopulation burn after the battle may cost at most this share of what is defended. */
  burnStakeShare: 0.5,
} as const;

const HOUR = 3_600_000;

function unit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Win belief this owner needs to keep its fleet on the planet. */
export function npcStayThreshold(traits: NpcTraits): number {
  const b = NPC_THREAT_BALANCE;
  return Math.min(b.stayMax, Math.max(b.stayMin, b.stayBase - b.stayAggression * unit(traits.aggression) - b.stayRisk * unit(traits.riskTolerance)));
}

export function npcEspionageLevel(state: SaveState, ownerId: string, planet: SpyTargetState): number {
  const levels = state.npcScience?.owners[ownerId]?.levels ?? planet.ownerProfile?.scienceLevels ?? {};
  return Math.max(0, Math.floor(Number((levels as Record<number, number>)[5] ?? 0)));
}

/** The attacker's race is public (rating, map); read it from its launch planet. */
function attackerRace(state: SaveState, flight: FlightRecord): CombatFactionId {
  const origin = state.espionage?.targets?.[flight.originPlanetId];
  if (origin) return origin.raceId;
  if (state.planets[flight.originPlanetId] || flight.ownerSide === 'player' || flight.ownerSide === undefined) return state.profile.factionId as CombatFactionId;
  return flight.attackSnapshot?.attackerFactionId ?? 'aegis';
}

function pirateStacks(ships: Readonly<Partial<Record<string, number>>>): ForceStack[] {
  return Object.entries(ships).flatMap(([id, count]) => {
    const entity = PIRATE_CATALOG_BY_ID[id as keyof typeof PIRATE_CATALOG_BY_ID];
    return entity && (count ?? 0) > 0 ? [{ count: count!, attack: entity.combat.attack, life: entity.combat.life }] : [];
  });
}

export type NpcIncomingEstimate = Readonly<{
  flightId: string;
  arrivalAt: number;
  attackerOwnerId: string | null;
  /** What the estimate rests on; never the flight's real ships below espionage 10. */
  basis: 'composition' | 'intel' | 'rating' | 'pirate-prior';
  power: number;
  uncertainty: number;
  /** Enemy ships the defender is allowed to know (composition from espionage 10, or its own reports and battles). */
  knownShips?: Readonly<{ raceId: CombatFactionId; ships: Readonly<Partial<Record<string, number>>> }>;
}>;

/** Force on and coming back to the planet before `by`, as its owner sees it: ships and commanders. */
function defenderForce(state: SaveState, ownerId: string, planet: SpyTargetState, by: number) {
  const ships: Record<string, number> = {};
  const commanders: Record<string, number> = {};
  const add = (into: Record<string, number>, source: Readonly<Partial<Record<string, number>>> | undefined) => {
    for (const [id, count] of Object.entries(source ?? {})) if (id !== 'solar-satellite' && (count ?? 0) > 0) into[id] = (into[id] ?? 0) + count!;
  };
  add(ships, planet.fleet.ships);
  add(commanders, planet.fleet.commanders);
  for (const flight of ownerFlights(state.flights.records, ownerId)) {
    if (flight.ownerSide !== 'npc') continue;
    // Fleets already on their way home or here (a deployment) that land in time.
    const home = flight.phase === 'returning' && flight.originPlanetId === planet.id && !flight.attackResolution
      && flight.returnAt !== undefined && flight.returnAt <= by;
    const deployed = flight.missionId === 'deployment' && flight.phase === 'outbound'
      && flight.destinationPlanetId === planet.id && flight.arrivalAt <= by;
    if (home || deployed) {
      add(ships, flight.selectedShips);
      add(commanders, flight.selectedCommanders);
    }
  }
  return { ships, commanders };
}

function fleetPopulation(raceId: CombatFactionId, ships: Readonly<Partial<Record<string, number>>>,
  commanders: Readonly<Partial<Record<string, number>>> = {}): number {
  const empty = createEmptyFleetState();
  return calculateFleetPopulation({ ships: { ...empty.ships, ...ships } as typeof empty.ships,
    commanders: { ...empty.commanders, ...commanders } as typeof empty.commanders }, raceId);
}

/**
 * One incoming fleet as the defender can judge it. With the composition it is
 * exact; without it the estimate comes only from what the defender itself
 * holds: its spy reports on the attacker's planets, battles it fought with the
 * attacker, and the public rating. The flight's real ships are never read.
 */
export function estimateIncomingAttack(state: SaveState, context: NpcUtilityContext, planet: SpyTargetState,
  knowledge: IncomingAttackKnowledge, flight: FlightRecord, ownPower: number): NpcIncomingEstimate {
  const base = { flightId: knowledge.flightId, arrivalAt: knowledge.arrivalAt, attackerOwnerId: knowledge.attackerOwnerId };
  const b = NPC_THREAT_BALANCE;
  const composition = knowledge.composition;
  if (composition?.kind === 'pirate') return { ...base, basis: 'composition', power: estimateForcePower(pirateStacks(composition.ships)), uncertainty: b.uncertaintyKnown };
  if (composition?.kind === 'fleet') return { ...base, basis: 'composition', power: npcForcePower(attackerRace(state, flight), composition.ships),
    uncertainty: b.uncertaintyKnown, knownShips: { raceId: attackerRace(state, flight), ships: composition.ships } };
  const ownerId = context.profile.ownerId;
  const ageFactor = (createdAt: number) => 1 + Math.min(1, Math.max(0, context.at - createdAt) / (72 * HOUR));
  if (knowledge.kind === 'pirate-raid') {
    // Pirates this owner already fought show what they bring.
    let seen = 0;
    for (const report of ownerBattleReports(state.combat.reports, ownerId)) {
      if (report.missionType !== 'pirate-raid' || report.defender.playerId !== ownerId) continue;
      const when = Date.parse(report.timestamp);
      if (!Number.isFinite(when) || when > context.at) continue;
      const stacks = report.attackerForce.stacks.flatMap((stack) => stack.countBefore > 0 && stack.attackPerUnit && stack.lifePerUnit
        ? [{ count: stack.countBefore, attack: stack.attackPerUnit, life: stack.lifePerUnit }] : []);
      seen = Math.max(seen, estimateForcePower(stacks) * ageFactor(when));
    }
    const prior = b.pirateBlindRatio * ownPower;
    return { ...base, basis: seen > 0 ? 'intel' : 'pirate-prior', power: Math.max(prior, seen), uncertainty: seen > 0 ? b.uncertaintyIntel : b.uncertaintyBlind };
  }
  const attacker = knowledge.attackerOwnerId;
  const race = attackerRace(state, flight);
  let intel = 0;
  let knownShips: NpcIncomingEstimate['knownShips'];
  if (attacker) {
    for (const report of context.latestReports.values()) {
      if (report.targetOwnerId !== attacker || !report.fleet) continue;
      const power = npcForcePower(report.targetRaceId as CombatFactionId, report.fleet) * ageFactor(report.createdAt);
      if (power > intel) { intel = power; knownShips = { raceId: report.targetRaceId as CombatFactionId, ships: report.fleet }; }
    }
    for (const report of ownerBattleReports(state.combat.reports, ownerId)) {
      const side = report.attacker.playerId === attacker ? report.attackerForce : report.defender.playerId === attacker ? report.defenderForce : null;
      if (!side) continue;
      const when = Date.parse(report.timestamp);
      if (!Number.isFinite(when) || when > context.at) continue;
      const ships = Object.fromEntries(side.stacks.map((stack) => [stack.entityId, stack.countBefore]));
      const power = npcForcePower(race, ships) * ageFactor(when);
      if (power > intel) { intel = power; knownShips = { raceId: race, ships }; }
    }
  }
  const score = attacker ? selectOwnerScore(state, attacker) : undefined;
  const battleShare = score && score.totalPoints > 0 ? score.battlePoints / score.totalPoints : 0;
  const fleetShare = Math.min(b.scoreFleetShareMax, b.scoreFleetShareMin + battleShare);
  const rated = (score?.resourcePoints ?? 0) * 1_000 * fleetShare * npcPowerPerResource(race);
  if (intel > 0) return { ...base, basis: 'intel', power: Math.max(intel, 0.5 * rated), uncertainty: b.uncertaintyIntel, ...(knownShips ? { knownShips } : {}) };
  return { ...base, basis: 'rating', power: rated, uncertainty: b.uncertaintyBlind };
}

export type NpcReinforcement = Readonly<{
  originPlanetId: string;
  ships: Partial<Record<ShipId, number>>;
  /** Commanders at the source fly along when the hangar room allows (their ability counts in battle). */
  commanders: Partial<Record<CommanderId, number>>;
  arrivalAt: number;
}>;

export type NpcThreatAssessment = Readonly<{
  planetId: string;
  arrivalAt: number;
  incoming: readonly NpcIncomingEstimate[];
  /** Enemy strength the owner fears: estimate inflated by its uncertainty and the owner's caution. */
  feared: number;
  defence: number;
  winProbability: number;
  stayThreshold: number;
  decision: 'fight' | 'reinforce' | 'evacuate';
  reinforcements: readonly NpcReinforcement[];
  reinforcedWinProbability?: number;
  /** Population expected to burn after the battle from the overfilled hangar. */
  expectedBurnPopulation?: number;
}>;

const SKIPPED_HULLS = new Set(['solar-satellite', 'spy-probe', 'colonizer', 'transporter', 'mega-transporter', 'recycler']);

/**
 * The owner's reading of attacks heading for one planet, or null when none
 * is coming. Only the earliest wave is judged; a later one is judged again
 * once it is the next.
 */
export function assessNpcPlanetThreat(state: SaveState, context: NpcUtilityContext, planet: SpyTargetState,
  timeScale: number): NpcThreatAssessment | null {
  const ownerId = context.profile.ownerId;
  const at = context.at;
  const espionage = npcEspionageLevel(state, ownerId, planet);
  const hostile = flightsToPlanet(state.flights.records, planet.id)
    .filter((flight) => flight.phase === 'outbound' && flight.arrivalAt > at && flight.ownerId !== ownerId)
    .map((flight) => ({ flight, knowledge: describeIncomingAttack(flight, espionage) }))
    .filter((item): item is { flight: FlightRecord; knowledge: IncomingAttackKnowledge } => item.knowledge !== null)
    .sort((left, right) => left.knowledge.arrivalAt - right.knowledge.arrivalAt || (left.flight.id < right.flight.id ? -1 : 1));
  if (!hostile.length) return null;
  const b = NPC_THREAT_BALANCE;
  const arrivalAt = hostile[0]!.knowledge.arrivalAt;
  const wave = hostile.filter((item) => item.knowledge.arrivalAt <= arrivalAt + b.waveWindowMs);
  const by = arrivalAt - b.arrivalMarginMs;
  const { ships, commanders } = defenderForce(state, ownerId, planet, by);
  const defence = npcForcePower(planet.raceId, ships, planet.defense.defenses, commanders);
  const incoming = wave.map(({ flight, knowledge }) => estimateIncomingAttack(state, context, planet, knowledge, flight, defence));
  const caution = 1 - unit(context.profile.traits.riskTolerance);
  // Separate fleets add up as one force (strength is not additive, firepower and hull are).
  const feared = Math.hypot(...incoming.map((item) => item.power * (1 + item.uncertainty * (0.5 + caution))));
  const winProbability = estimateWinProbability(defence, feared);
  const stayThreshold = npcStayThreshold(context.profile.traits);
  const common = { planetId: planet.id, arrivalAt, incoming, feared, defence, winProbability, stayThreshold };
  if (winProbability >= stayThreshold) return { ...common, decision: 'fight', reinforcements: [] };

  // Parallel deployments from the owner's other planets, each checked against
  // the hangar room as it is now (the player's rule), landing before the attack.
  const free = npcDeploymentFreeCapacity(planet);
  const sources: NpcReinforcement[] = [];
  if (free > 0) {
    const threatened = new Set(state.flights.records.filter((flight) => flight.phase === 'outbound' && flight.ownerId !== ownerId
      && (flight.missionId === 'attack' || flight.missionId === 'pirate-raid') && flight.arrivalAt <= arrivalAt + 30 * 60_000)
      .map((flight) => flight.destinationPlanetId));
    const options = context.ownPlanets.filter((source) => source.id !== planet.id && !threatened.has(source.id))
      .map((source) => {
        const available = getNpcMissionAvailableFleet(state, ownerId, source.id);
        const catalog = getFactionShipCatalog(source.raceId);
        const combat = Object.fromEntries(Object.entries(available).filter(([id, count]) => count > 0 && !SKIPPED_HULLS.has(id)
          && catalog.find((entity) => entity.id === id)?.category === 'Боевой корабль')) as Partial<Record<ShipId, number>>;
        // A deployment carries at most the room the target hangar has now; commanders first, they lead the battle.
        const home = Object.fromEntries(Object.entries(source.fleet.commanders ?? {}).filter(([, count]) => (count ?? 0) > 0)) as Partial<Record<CommanderId, number>>;
        const commanderPopulation = fleetPopulation(source.raceId, {}, home);
        const flyingCommanders = commanderPopulation <= free ? home : {};
        const room = free - (commanderPopulation <= free ? commanderPopulation : 0);
        const population = fleetPopulation(source.raceId, combat);
        const share = population > room ? Math.max(0, room) / population : 1;
        const fitted = Object.fromEntries(Object.entries(combat).map(([id, count]) => [id, Math.floor(count! * share)])
          .filter(([, count]) => (count as number) > 0)) as Partial<Record<ShipId, number>>;
        return { source, ships: fitted, commanders: flyingCommanders, power: npcForcePower(source.raceId, fitted, {}, flyingCommanders) };
      })
      .filter((option) => option.power > 0)
      .sort((left, right) => right.power - left.power || (left.source.id < right.source.id ? -1 : 1));
    for (const option of options) {
      if (sources.length >= b.maxReinforcementSources) break;
      // A dry run of the real command gives the arrival time and every launch check.
      const trial = dispatchNpcDeployment(state, { requestId: `npc-threat-trial:${option.source.id}`, ownerId, originPlanetId: option.source.id,
        destinationPlanetId: planet.id, selectedShips: option.ships, selectedCommanders: option.commanders }, at, timeScale);
      if (!trial.ok || !trial.flight || trial.flight.arrivalAt > by) continue;
      sources.push({ originPlanetId: option.source.id, ships: option.ships, commanders: option.commanders, arrivalAt: trial.flight.arrivalAt });
    }
  }
  if (sources.length) {
    const added: Record<string, number> = { ...ships };
    const addedCommanders: Record<string, number> = { ...commanders };
    for (const source of sources) {
      for (const [id, count] of Object.entries(source.ships)) added[id] = (added[id] ?? 0) + (count ?? 0);
      for (const [id, count] of Object.entries(source.commanders)) addedCommanders[id] = (addedCommanders[id] ?? 0) + (count ?? 0);
    }
    const capacity = calculatePlanetCapacity(migrateBuildingLevels(planet.buildings).hangar ?? 0);
    const population = fleetPopulation(planet.raceId, added, addedCommanders);
    const excess = Math.max(0, population - capacity);
    // The linear burn runs from the first landing to the battle.
    const firstLanding = Math.min(...sources.map((source) => source.arrivalAt));
    const burnedShare = excess > 0 ? Math.min(1, (arrivalAt - firstLanding) / OVERPOPULATION_WINDOW_MS) : 0;
    const atBattle = population > 0 ? (population - excess * burnedShare) / population : 1;
    // Commanders never burn; ships burn cheapest first, read here as a share of the fleet.
    const shipsAtBattle = Object.fromEntries(Object.entries(added).map(([id, count]) => [id, count * atBattle]));
    const reinforced = npcForcePower(planet.raceId, shipsAtBattle, planet.defense.defenses, addedCommanders);
    const reinforcedWinProbability = estimateWinProbability(reinforced, feared);
    const survivors = Math.sqrt(Math.max(0, 1 - (feared / Math.max(1, reinforced)) ** 2));
    const expectedBurnPopulation = Math.max(0, population * atBattle * survivors - capacity);
    const fleetValue = npcFleetValue(planet.raceId, added);
    const valuePerPopulation = population > 0 ? fleetValue / population : 0;
    const stake = fleetValue + npcDefenseValue(planet.raceId, planet.defense.defenses)
      + 0.5 * (planet.resources.metal + planet.resources.minerals + planet.resources.gas);
    if (reinforcedWinProbability >= stayThreshold && expectedBurnPopulation * valuePerPopulation <= b.burnStakeShare * stake) {
      return { ...common, decision: 'reinforce', reinforcements: sources, reinforcedWinProbability, expectedBurnPopulation };
    }
  }
  return { ...common, decision: 'evacuate', reinforcements: [] };
}

/**
 * Worth of a planned reinforcement: what it adds to the chance of holding the
 * planet, in the owner's terms. Owners who know the mechanics use it more.
 */
export function estimateReinforcementUtility(context: NpcUtilityContext, threat: NpcThreatAssessment): number {
  const knows = unit(context.profile.traits.mechanicsKnowledge);
  const gain = Math.max(0, (threat.reinforcedWinProbability ?? threat.winProbability) - threat.winProbability);
  return 0.2 + 0.8 * knows + 1.2 * gain + 0.3 * unit(context.profile.traits.militaryFocus);
}
