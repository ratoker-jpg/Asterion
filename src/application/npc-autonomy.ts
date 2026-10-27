import { chooseNpcAutonomyAction, updateNpcAutonomyMemory, type NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import { ownerFlights } from './npc-knowledge-index.ts';
import { findNextNpcSessionEvent } from '../domain/npc/calendar.ts';
import { MAX_SPACE_FLIGHT_DURATION_MS, MIN_SPACE_FLIGHT_DURATION_MS } from '../domain/flights/runtime.ts';
import { getFleetCargoCapacity, type TransportCargo } from '../domain/flights/cargo.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import type { ScienceId } from '../domain/science/types.ts';
import type { SaveState } from './contracts.ts';
import { getNpcBuildingCandidates, startNpcBuilding } from './npc-economy.ts';
import { getNpcScienceCandidates, startNpcScience } from './npc-science.ts';
import { getNpcFleetProductionCandidates, startNpcFleetProduction } from './npc-fleet-production.ts';
import { applyNpcDiplomacyAction, getNpcDiplomacyCandidates } from './npc-diplomacy.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { getNpcMissionCandidates, candidateToNpcMissionCommand } from './npc-mission-policy.ts';
import { assessNpcPlanetThreat, estimateReinforcementUtility } from './npc-threat.ts';
import { applyNpcAllianceHeraldry } from './npc-identity.ts';
import { dispatchNpcDeployment, dispatchNpcMission, dispatchNpcSpaceFlight, dispatchNpcTransport, getNpcMissionAvailableFleet, NPC_SPACE_FLIGHT_GAS_FEE, resolveNpcMissionArrival } from './npc-missions.ts';
import { beginFlightReturn } from '../domain/flights/runtime.ts';
import { getNpcPirateCandidates, dispatchNpcPirateMission } from './npc-pirates.ts';
import { getNpcEndgameChoices } from './npc-endgame.ts';
import { getNpcSpaceportCandidates, startNpcSpaceportUpgrade } from './npc-spaceport.ts';
import { createNpcAidRequest, getNpcAidCandidates, getNpcAidRequestCandidates, dispatchNpcAid } from './npc-aid.ts';
import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import { collectRecyclingJob, getRecyclingLevel, getRecyclingMaxConcurrentJobs, startRecyclingJob } from '../domain/buildings/recycling.ts';
import { creditResources } from '../domain/resources/credit.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { estimationError, NPC_MAX_UTILITY, utilityToWeight } from '../domain/npc/utility.ts';
import { getFactionShipCatalog, getFactionDefenseCatalog } from '../domain/combat/faction-catalog.ts';
import {
  chooseNpcAttackForce, chooseNpcStrategy, combatEfficiency, createNpcUtilityContext, describeNpcPlanet,
  estimateAttackUtility, estimateBuildingUtility, estimateRaidEconomics, estimateRevengeEconomics, estimateColonizeUtility, estimateEspionageUtility,
  estimateOperationUtility, estimateProductionItemUtility, flightRemoteness, estimateScienceUtility, npcProductionBatch,
  npcProductionPurpose, NPC_STRATEGY_FAMILY, strategyOf, type NpcStrategyDrives,
  estimateFleetSaveUtility, npcFleetValue, spaceFlightLegFor, estimateSpaceportUpgradeUtility, NPC_FLAGSHIP_ID,
} from './npc-utility.ts';

/** A look within this long of the session end is the owner's last before leaving. */
const NPC_REPLAY_LAST_LOOK_MS = 3 * 60_000;

/** The owner's next visit after `after`: people know their own plans. */
function nextNpcSessionStartAfter(profile: NpcProfile, after: number): number | null {
  let from = after;
  for (let step = 0; step < 6; step += 1) {
    const event = findNextNpcSessionEvent(profile, from, from + 3 * 24 * 60 * 60_000, profile.activity, 3);
    if (!event) return null;
    if (event.boundary === 'session-start') return event.at;
    from = event.at;
  }
  return null;
}

/** Fill the holds from the planet's stores, keeping the space flight's gas fee. */
function npcSpaceFlightCargo(origin: SpyTargetState, ships: Readonly<Record<string, number>>): TransportCargo {
  const catalog = Object.fromEntries(getFactionShipCatalog(origin.raceId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
  let room = getFleetCargoCapacity(ships, catalog);
  const take = (available: number) => {
    const amount = Math.max(0, Math.min(room, Math.floor(available)));
    room -= amount;
    return amount;
  };
  const metal = take(origin.resources.metal);
  const minerals = take(origin.resources.minerals);
  const gas = take(origin.resources.gas - NPC_SPACE_FLIGHT_GAS_FEE);
  return { metal, minerals, gas, debris: 0 };
}

/** How strongly the owner's current strategy pushes each action family. */
function familyDrive(drives: NpcStrategyDrives, kind: string): number {
  switch (kind) {
    case 'economy': return drives.economy;
    case 'science': return drives.science;
    case 'production': return Math.max(drives.military, 0.7 * drives.war);
    case 'attack': return drives.war;
    case 'colonize': return drives.expansion;
    case 'pve': return drives.operations;
    case 'recon': return Math.max(drives.war, drives.operations, 0.5 * drives.military);
    case 'diplomacy': case 'aid': return drives.diplomacy;
    case 'fleetsave': return Math.max(0.6, drives.military);
    default: return 0.5;
  }
}

/** A planet sends its surplus home every six game hours at most. */
const NPC_TRANSPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const STRATEGIC_GOAL_KINDS: ReadonlySet<string> = new Set(Object.values(NPC_STRATEGY_FAMILY));
const ENERGY_SHORT_REASON = 'Недостаточно энергии.';

type Outcome = { state: SaveState; started: boolean; reason: string | null; economyActionId?: string; planetId?: string };
type Choice = { candidate: NpcAutonomyCandidate; run: (state: SaveState, key: string) => Outcome };
export type NpcAutonomyDecision = Outcome & {
  kind: string; wait: boolean; idempotencyKey: string;
  selectedRole: BuildingRole | null; selectedScienceId: ScienceId | null;
};

/** One owner-wide draw, across all real planets and all legal action kinds. */
export function applyNpcAutonomyDecision(state: SaveState, profile: NpcProfile, eventId: string, at: number, timeScale: number): NpcAutonomyDecision {
  return applyNpcAutonomyAttention(state, profile, eventId, at, timeScale, 1)[0]!;
}

/** Replay key of the action at `index` within one look at the game; the first keeps the event's own id. */
export function npcAttentionActionId(eventId: string, index: number): string {
  return index === 0 ? eventId : `${eventId}:${index}`;
}

/**
 * What one action ties up, so a single look at the game does not plan two
 * things on it: the science queue, a planet's fleet for attacks and
 * operations, a colonizer. Buildings and orders are per item: a look may fill
 * a construction queue (the queue's own capacity refuses the rest) and place
 * several fleet orders. Spying and returns are per target; dispatch still
 * checks real ships.
 */
function actionSlot(candidate: NpcAutonomyCandidate): string {
  const id = candidate.id;
  if (id.startsWith('science:')) return 'science';
  if (candidate.kind === 'diplomacy') return 'diplomacy';
  if (candidate.kind === 'aid') return 'aid';
  if (id.startsWith('pirate:')) return 'pirate';
  if (id.startsWith('fleetsave:')) return `fleet:${String(candidate.payload?.planetId)}`;
  if (id.startsWith('recycling-start:')) return id;
  if (id.startsWith('npc-mission:')) {
    const [, , missionId, origin] = id.split(':');
    if (missionId === 'attack' || missionId === 'expedition') return `fleet:${origin}`;
    if (missionId === 'colonize') return `colonizer:${origin}`;
  }
  return id;
}

/**
 * One look at the game (owner rule 24.10.2026: no cap on actions while
 * online). Options are estimated once from what the owner sees, then it does
 * several non-overlapping things in turn, as a player does on one screen;
 * each is a seeded draw and runs through the canonical command on the then
 * current state. A wait, or three refusals, ends the look.
 */
export function applyNpcAutonomyAttention(state: SaveState, profile: NpcProfile, eventId: string, at: number, timeScale: number,
  maxActions: number): NpcAutonomyDecision[] {
  const ownerId = profile.ownerId;
  // A leadership that looks at the game keeps its alliance crest in line with
  // its reasons (a new leader, a war, a change of course); usually a no-op.
  if (state.npc) {
    const command = applyNpcAllianceHeraldry(state.command, ownerId, state.npc.profiles);
    if (command !== state.command) state = { ...state, command };
  }
  const choices: Choice[] = [];
  const utility = createNpcUtilityContext(state, profile, at, timeScale);
  // Concept U: estimated benefit − cost − risk + goal, plus this owner's seeded misjudgement.
  const scored = (candidateId: string, estimate: number) => utilityToWeight(estimate + estimationError(profile, eventId, candidateId));
  const missionUtility = (mission: { id: string; kind: string; payload: Readonly<Record<string, string | number | boolean | null>> }): number => {
    const origin = state.espionage?.targets?.[String(mission.payload.originPlanetId)];
    if (!origin) return 0;
    const destinationPlanetId = String(mission.payload.destinationPlanetId ?? '');
    const remoteness = flightRemoteness(origin.coordinate, { galaxy: Number(mission.payload.destinationGalaxy), system: Number(mission.payload.destinationSystem) });
    if (mission.kind === 'attack') return estimateAttackUtility(utility, origin, destinationPlanetId, attackShips(mission), remoteness);
    if (mission.kind === 'espionage') return estimateEspionageUtility(utility, destinationPlanetId, remoteness, ownerOfPlanet(destinationPlanetId));
    if (mission.kind === 'colonize') return estimateColonizeUtility(utility, origin,
      { galaxy: Number(mission.payload.destinationGalaxy), system: Number(mission.payload.destinationSystem) });
    if (mission.kind === 'expedition') return estimateOperationUtility(utility, 'expedition');
    // Free resources at the cost of a flight: worth more the bigger the field.
    if (mission.kind === 'recycle') return estimateOperationUtility(utility, 'recycle')
      + 0.6 * Math.log1p(Number(mission.payload.debris ?? 0) / Math.max(1, utility.dayValue)) - 0.4 * remoteness;
    if (mission.kind === 'exploration-recon') return estimateOperationUtility(utility, 'recon');
    return 0;
  };
  // Planet owners are public (the map shows them).
  const ownerOfPlanet = (planetId: string): string | undefined => state.espionage?.targets?.[planetId]?.ownerId
    ?? (state.planets[planetId] ? state.profile.playerId : undefined);
  // An attack sends the force the owner believes is enough, not everything.
  const attackForces = new Map<string, Record<string, number> | null>();
  function attackShips(mission: { id: string; payload: Readonly<Record<string, string | number | boolean | null>> }): Record<string, number> {
    let ships: Record<string, number> = {};
    try { ships = JSON.parse(String(mission.payload.selectedShips ?? '{}')) as Record<string, number>; } catch { ships = {}; }
    if (!attackForces.has(mission.id)) {
      const origin = state.espionage?.targets?.[String(mission.payload.originPlanetId)];
      attackForces.set(mission.id, origin ? chooseNpcAttackForce(utility, origin, String(mission.payload.destinationPlanetId ?? ''), ships) : null);
    }
    return attackForces.get(mission.id) ?? ships;
  }
  const drives = strategyOf(utility);
  const planets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const withTarget = (current: SaveState, target: (typeof planets)[number]): SaveState => ({
    ...current, espionage: { ...current.espionage!, targets: { ...current.espionage!.targets, [target.id]: target } },
  });
  for (const target of planets) {
    const reservedPopulation = ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc'
      && flight.originPlanetId === target.id && ['outbound', 'arrived', 'returning'].includes(flight.phase))
      .reduce((sum, flight) => { const empty = createEmptyFleetState(); return sum + calculateFleetPopulation({ ships: { ...empty.ships, ...flight.selectedShips }, commanders: { ...empty.commanders, ...flight.selectedCommanders } }, target.raceId); }, 0);
    const buildings = getNpcBuildingCandidates(target, true);
    const production = getNpcFleetProductionCandidates(target, ownerId, at, timeScale, reservedPopulation);
    const energyCosts = buildings.filter(({ availability }) => availability.cost && availability.cost.energy > 0)
      .map(({ availability }) => availability.cost!.energy).sort((a, b) => a - b);
    const situation = describeNpcPlanet(target,
      buildings.filter(({ availability }) => availability.reason === ENERGY_SHORT_REASON).length,
      energyCosts[Math.floor(energyCosts.length / 2)] ?? 0,
      production.some((preview) => !preview.available && preview.reason === 'Недостаточно населения флота.'));
    for (const { role, availability } of buildings) {
      if (!availability.canBuild) continue;
      if (role === 'research' && (!state.npcScience || at < state.npcScience.activatedAt)) continue;
      const kind = role === 'shipyard' || role === 'hangar' ? 'production' : 'economy';
      const buildingId = `building:${target.id}:${role}`;
      const buildingWeight = scored(buildingId, estimateBuildingUtility(utility, target, role,
        availability.nextLevel ?? availability.currentLevel + 1, availability.cost, getStorageCapacities(target.buildings), situation));
      choices.push({ candidate: { id: buildingId, kind, weight: buildingWeight, payload: { planetId: target.id, role } }, run: (current, key) => {
        const result = startNpcBuilding(current.espionage!.targets![target.id]!, role, at, { timeScale }, key);
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: target.id, ...(result.ok ? { economyActionId: key } : {}) };
      } });
    }
    const science = state.npcScience?.owners[ownerId];
    if (science && at >= state.npcScience!.activatedAt) for (const preview of getNpcScienceCandidates(target, science, at, timeScale)) {
      if (!preview.canStart) continue;
      const scienceCandidateId = `science:${target.id}:${preview.scienceId}`;
      choices.push({ candidate: { id: scienceCandidateId, kind: 'science', weight: scored(scienceCandidateId, estimateScienceUtility(utility, preview.cost, situation, preview.scienceId)), payload: { scienceId: preview.scienceId } }, run: (current, key) => {
        const result = startNpcScience(current.espionage!.targets![target.id]!, current.npcScience!.owners[ownerId]!, preview.scienceId, at, timeScale, key);
        return { state: { ...withTarget(current, result.target), npcScience: { ...current.npcScience!, owners: { ...current.npcScience!.owners, [ownerId]: result.science } } }, started: result.ok, reason: result.reason, planetId: target.id, ...(result.ok ? { economyActionId: key } : {}) };
      } });
    }
    const shipCatalog = getFactionShipCatalog(target.raceId);
    const defenseCatalog = getFactionDefenseCatalog(target.raceId);
    const entityOf = (queueKind: string, itemId: string) => queueKind === 'ships'
      ? shipCatalog.find((entity) => entity.id === itemId)
      : queueKind === 'defense' ? defenseCatalog.find((entity) => entity.id === itemId) : undefined;
    const categoryOf = (entity: ReturnType<typeof entityOf>) => entity && 'category' in entity ? String(entity.category) : undefined;
    const bestEfficiency = { ships: 0, defense: 0 };
    for (const preview of production) {
      if (!preview.available || (preview.queueKind !== 'ships' && preview.queueKind !== 'defense')) continue;
      const entity = entityOf(preview.queueKind, preview.itemId);
      if (preview.queueKind === 'ships' && categoryOf(entity) !== 'Боевой корабль') continue;
      bestEfficiency[preview.queueKind] = Math.max(bestEfficiency[preview.queueKind], combatEfficiency(entity));
    }
    for (const preview of production) {
      if (!preview.available) continue;
      const productionId = `production:${target.id}:${preview.queueKind}:${preview.itemId}`;
      const entity = entityOf(preview.queueKind, preview.itemId);
      const best = preview.queueKind === 'ships' || preview.queueKind === 'defense' ? bestEfficiency[preview.queueKind] : 0;
      const relative = best > 0 ? combatEfficiency(entity) / best : 1;
      const purpose = npcProductionPurpose(preview.queueKind, preview.itemId, categoryOf(entity));
      const estimate = estimateProductionItemUtility(utility, target, preview.queueKind, preview.itemId, preview.cost, situation, relative);
      choices.push({ candidate: { id: productionId, kind: 'production', weight: scored(productionId, estimate), payload: { itemId: preview.itemId } }, run: (current, key) => {
        const planet = current.espionage!.targets![target.id]!;
        // Ask for the batch the owner wants; a refused batch (room, limits) halves until one fits.
        let quantity = npcProductionBatch(utility, planet, purpose, preview.cost, situation);
        let result = startNpcFleetProduction(planet, ownerId, preview.queueKind, preview.itemId, at, timeScale, key, reservedPopulation, quantity);
        while (!result.ok && quantity > 1) {
          quantity = Math.floor(quantity / 2);
          result = startNpcFleetProduction(planet, ownerId, preview.queueKind, preview.itemId, at, timeScale, key, reservedPopulation, quantity);
        }
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: target.id, ...(result.ok && result.orderId ? { economyActionId: result.orderId } : {}) };
      } });
    }
  }
  // Logistics, as a player runs it daily: a colony whose stores fill up ships
  // its surplus to the main planet, and the main planet supplies a colony that
  // has run dry. Whichever planet has the transporters makes the trip.
  const main = planets.find((planet) => planet.id === `${ownerId}-planet`) ?? planets[0];
  if (main && planets.length > 1) for (const source of planets) {
    const free = getNpcMissionAvailableFleet(state, ownerId, source.id) ?? {};
    const holds = { transporter: free.transporter ?? 0, 'mega-transporter': free['mega-transporter'] ?? 0 };
    const catalog = getFactionShipCatalog(source.raceId);
    const capacityOf = (id: string) => catalog.find((entity) => entity.id === id)?.ship?.cargo ?? 0;
    const capacity = holds.transporter * capacityOf('transporter') + holds['mega-transporter'] * capacityOf('mega-transporter');
    if (capacity <= 0) continue;
    const fill = describeNpcPlanet(source, 0, 0, false).fill;
    const fullest = Math.max(fill.metal, fill.minerals, fill.gas);
    let destination: typeof main | undefined;
    let keep = 0.2;
    let urgency = 0;
    // One transport from a planet at a time, and a few trips a day at most.
    if (source.lastTransportAt !== undefined && at - source.lastTransportAt < NPC_TRANSPORT_INTERVAL_MS / Math.max(1, timeScale)) continue;
    if (ownerFlights(state.flights.records, ownerId).some((flight) => flight.missionId === 'transport' && flight.originPlanetId === source.id
      && (flight.phase === 'outbound' || flight.phase === 'arrived'))) continue;
    if (source.id !== main.id) {
      if (fullest < 0.75) continue;
      destination = main;
      urgency = fullest - 0.5;
    } else {
      const dry = planets.filter((planet) => planet.id !== main.id)
        .map((planet) => ({ planet, fill: describeNpcPlanet(planet, 0, 0, false).fill }))
        .map((item) => ({ ...item, lowest: Math.min(item.fill.metal, item.fill.minerals, item.fill.gas) }))
        .filter((item) => item.lowest < 0.15)
        .sort((left, right) => left.lowest - right.lowest || left.planet.id.localeCompare(right.planet.id))[0];
      if (!dry || fullest < 0.35) continue;
      destination = dry.planet;
      keep = 0.6;
      urgency = 0.3 - dry.lowest;
    }
    // Keep part of each store for the source's own work; gas also pays the flight.
    const surplus = { metal: Math.floor(source.resources.metal * (1 - keep)), minerals: Math.floor(source.resources.minerals * (1 - keep)),
      gas: Math.floor(source.resources.gas * (1 - keep) * 0.75) };
    const total = surplus.metal + surplus.minerals + surplus.gas;
    if (total < 0.02 * utility.dayValue) continue;
    const share = Math.min(1, capacity / total);
    const cargo = { metal: Math.floor(surplus.metal * share), minerals: Math.floor(surplus.minerals * share), gas: Math.floor(surplus.gas * share), debris: 0 };
    const to = destination;
    const transportId = `transport:${source.id}:${to.id}`;
    const estimate = -0.4 + 1.6 * urgency + 0.4 * strategyOf(utility).economy + 0.3 * Math.min(1, total / (0.05 * utility.dayValue));
    const selected = Object.fromEntries(Object.entries(holds).filter(([, count]) => count > 0)) as Partial<Record<ShipId, number>>;
    choices.push({ candidate: { id: transportId, kind: 'economy', weight: scored(transportId, estimate), payload: { planetId: source.id } }, run: (current, key) => {
      const result = dispatchNpcTransport(current, { requestId: key, ownerId, originPlanetId: source.id, destinationPlanetId: to.id, selectedShips: selected, cargo }, at, timeScale);
      const sent = result.ok ? withTarget(result.state, { ...result.state.espionage!.targets![source.id]!, lastTransportAt: at }) : result.state;
      return { state: sent, started: result.ok, reason: result.reason, planetId: source.id };
    } });
  }
  // Spaceport: ship upgrades by the player's catalog; levels are owner-wide.
  const ownedShips: Partial<Record<string, number>> = {};
  for (const target of planets) for (const [id, count] of Object.entries(target.fleet.ships)) ownedShips[id] = (ownedShips[id] ?? 0) + (count ?? 0);
  if (utility.flagship?.unlocked) ownedShips[NPC_FLAGSHIP_ID] = Math.max(1, ownedShips[NPC_FLAGSHIP_ID] ?? 0);
  const scienceLevels = state.npcScience?.owners[ownerId]?.levels;
  // One upgrade queue per owner, as the player's: it runs at the main planet's Spaceport.
  const spaceportHome = planets.find((planet) => planet.id === `${ownerId}-planet`) ?? planets[0];
  for (const target of spaceportHome ? [spaceportHome] : []) {
    const levels = scienceLevels ?? target.ownerProfile?.scienceLevels ?? {};
    for (const preview of getNpcSpaceportCandidates(target, levels, timeScale, ownedShips)) {
      const upgradeId = `spaceport:${target.id}:${preview.shipId}`;
      const estimate = estimateSpaceportUpgradeUtility(utility, preview.shipId, ownedShips[preview.shipId] ?? 0, preview.cost, describeNpcPlanet(target, 0, 0, false));
      choices.push({ candidate: { id: upgradeId, kind: 'production', weight: scored(upgradeId, estimate), payload: { planetId: target.id, shipId: preview.shipId } }, run: (current, key) => {
        const planet = current.espionage!.targets![target.id]!;
        const result = startNpcSpaceportUpgrade(planet, preview.shipId as ShipId, levels, at, timeScale, key);
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: target.id, ...(result.ok ? { economyActionId: key } : {}) };
      } });
    }
  }
  // The recycling centre: collect what is ready (free resources), and turn
  // collected debris into the resource this planet is shortest of.
  for (const target of planets) {
    const recycling = target.recycling;
    const level = getRecyclingLevel(migrateBuildingLevels(target.buildings));
    if (!recycling || level <= 0) continue;
    for (const job of recycling.jobs) {
      if (job.finishAt > at) continue;
      const collectId = `recycling-collect:${target.id}:${job.id}`;
      choices.push({ candidate: { id: collectId, kind: 'economy', weight: utilityToWeight(2), payload: { planetId: target.id } }, run: (current) => {
        const planet = current.espionage!.targets![target.id]!;
        const collected = collectRecyclingJob(planet.recycling ?? recycling, job.id, at);
        if (!collected.ok || !collected.output) return { state: current, started: false, reason: collected.reason, planetId: target.id };
        const credited = creditResources({ metal: planet.resources.metal, minerals: planet.resources.minerals, gas: planet.resources.gas, energy: 0 },
          getStorageCapacities(migrateBuildingLevels(planet.buildings)), collected.output);
        return { state: withTarget(current, { ...planet, recycling: collected.state,
          resources: { ...planet.resources, metal: credited.wallet.metal, minerals: credited.wallet.minerals, gas: credited.wallet.gas } }),
          started: true, reason: null, planetId: target.id };
      } });
    }
    if (recycling.availableDebris > 0 && recycling.jobs.length < getRecyclingMaxConcurrentJobs(level)) {
      const startId = `recycling-start:${target.id}`;
      choices.push({ candidate: { id: startId, kind: 'economy', weight: utilityToWeight(1.5), payload: { planetId: target.id } }, run: (current, key) => {
        const planet = current.espionage!.targets![target.id]!;
        const store = planet.recycling ?? recycling;
        const fill = describeNpcPlanet(planet, 0, 0, false).fill;
        const scarcest = (['metal', 'minerals', 'gas'] as const).reduce((best, key2) => fill[key2] < fill[best] ? key2 : best, 'metal' as 'metal' | 'minerals' | 'gas');
        const allocation = { metal: 0, minerals: 0, gas: 0, [scarcest]: 100 };
        const started = startRecyclingJob(store, level, store.availableDebris, allocation, at, key);
        if (!started.canStart) return { state: current, started: false, reason: started.reason, planetId: target.id };
        return { state: withTarget(current, { ...planet, recycling: started.state }), started: true, reason: null, planetId: target.id };
      } });
    }
  }
  // Fleet saving with «Космический рейс»: before leaving the game, or away from an attack on its way.
  const leaving = profile.session.active && typeof profile.session.sessionEndsAt === 'number'
    && profile.session.sessionEndsAt - at <= NPC_REPLAY_LAST_LOOK_MS;
  const nextVisit = leaving ? nextNpcSessionStartAfter(profile, profile.session.sessionEndsAt!) : null;
  for (const target of planets) {
    // The fleet guarding this owner's own Gate stays to fight; hiding it loses the Gate.
    if (utility.ownGateHosts?.has(target.id)) continue;
    // An attack on its way is judged first: fight it, reinforce the planet with
    // parallel deployments, or take the fleet away (see npc-threat.ts).
    const threat = assessNpcPlanetThreat(state, utility, target, timeScale);
    if (threat?.decision === 'fight') continue;
    if (threat?.decision === 'reinforce') {
      const reinforceId = `reinforce:${target.id}`;
      const estimate = estimateReinforcementUtility(utility, threat);
      choices.push({ candidate: { id: reinforceId, kind: 'fleetsave', weight: scored(reinforceId, estimate), payload: { planetId: target.id } }, run: (current, key) => {
        let next = current;
        let sent = 0;
        let reason: string | null = null;
        for (const source of threat.reinforcements) {
          const result = dispatchNpcDeployment(next, { requestId: `${key}:${source.originPlanetId}`, ownerId, originPlanetId: source.originPlanetId,
            destinationPlanetId: target.id, selectedShips: source.ships }, at, timeScale);
          next = result.state;
          if (result.ok) sent += 1; else reason ??= result.reason;
        }
        return { state: next, started: sent > 0, reason: sent > 0 ? null : reason, planetId: target.id };
      } });
      continue;
    }
    const free = getNpcMissionAvailableFleet(state, ownerId, target.id) ?? {};
    const ships = Object.fromEntries(Object.entries(free).filter(([shipId, count]) => shipId !== 'solar-satellite' && (count ?? 0) > 0)) as Record<string, number>;
    const value = npcFleetValue(target.raceId, ships);
    if (!Object.keys(ships).length || value < 0.3 * utility.dayValue) continue;
    const incoming = threat?.decision === 'evacuate' ? threat.arrivalAt : null;
    const dodgeLeg = incoming === null ? null : spaceFlightLegFor(at, incoming + 10 * 60_000, MIN_SPACE_FLIGHT_DURATION_MS, MAX_SPACE_FLIGHT_DURATION_MS);
    const leaveLeg = nextVisit === null ? null : spaceFlightLegFor(at, nextVisit, MIN_SPACE_FLIGHT_DURATION_MS, MAX_SPACE_FLIGHT_DURATION_MS)
      ?? MAX_SPACE_FLIGHT_DURATION_MS;
    const plan = dodgeLeg !== null ? { leg: dodgeLeg, reason: 'dodge' as const } : leaveLeg !== null ? { leg: leaveLeg, reason: 'leaving' as const } : null;
    if (!plan) continue;
    const saveId = `fleetsave:${target.id}`;
    choices.push({ candidate: { id: saveId, kind: 'fleetsave', weight: scored(saveId, estimateFleetSaveUtility(utility, value, plan.reason)), payload: { planetId: target.id } }, run: (current, key) => {
      const origin = current.espionage!.targets![target.id]!;
      const result = dispatchNpcSpaceFlight(current, { requestId: key, ownerId, originPlanetId: target.id, selectedShips: ships,
        cargo: npcSpaceFlightCargo(origin, ships), oneWayDurationMs: plan.leg }, at);
      return { state: result.state, started: result.ok, reason: result.reason, planetId: target.id };
    } });
  }
  for (const candidate of getNpcDiplomacyCandidates(state, profile, at)) choices.push({ candidate: { ...candidate, kind: 'diplomacy' }, run: (current, key) => {
    const result = applyNpcDiplomacyAction(current, ownerId, candidate, at, key);
    return { state: result.state, started: result.ok, reason: result.ok ? null : result.reason };
  } });
  for (const mission of getNpcMissionCandidates(state, profile, at)) {
    // An attack the owner does not believe it wins with its own margin, even
    // with everything at hand, is not an option (a lone ship against a
    // defended planet was); nor is one whose haul does not pay for the flight
    // (a raid for 63 resources every few minutes was).
    if (mission.kind === 'attack') {
      const force = attackShips(mission);
      if (!attackForces.get(mission.id)) continue;
      const origin = state.espionage?.targets?.[String(mission.payload.originPlanetId)];
      const report = utility.latestReports.get(String(mission.payload.destinationPlanetId ?? ''));
      if (!origin || !report) continue;
      const destination = String(mission.payload.destinationPlanetId ?? '');
      // A raid must pay; a revenge on an offender may cost (owner rule 26.10.2026), the attack rule still applies.
      if (!utility.rivalGateHosts?.has(destination) && !estimateRaidEconomics(utility, origin, report, force).worthFlight
        && !estimateRevengeEconomics(utility, origin, report, force).worthFlight) continue;
    }
    choices.push({
      candidate: { ...mission, weight: mission.weight * scored(mission.id, missionUtility(mission)),
        kind: mission.kind === 'espionage' || mission.kind === 'exploration-recon' ? 'recon' : mission.kind === 'expedition' || mission.kind === 'recycle' ? 'pve' : mission.kind },
      run: (current, key) => {
        const chosen = mission.kind === 'attack' ? attackForces.get(mission.id) : undefined;
        const sent = chosen ? { ...mission, payload: { ...mission.payload, selectedShips: JSON.stringify(Object.fromEntries(Object.entries(chosen).sort(([a], [b]) => a < b ? -1 : 1))) } } : mission;
        const command = candidateToNpcMissionCommand(sent, ownerId, key);
        if (!command) return { state: current, started: false, reason: 'invalid-mission-candidate' };
        const result = dispatchNpcMission(current, command, at, timeScale);
        return { state: result.state, started: result.ok, reason: result.reason };
      },
    });
  }
  for (const mission of getNpcPirateCandidates(state, profile, at)) choices.push({
    candidate: { id: `pirate:${mission.id}`, kind: mission.missionId === 'pirate-recon' ? 'recon' : 'pve',
      weight: mission.weight * scored(`pirate:${mission.id}`, estimateOperationUtility(utility,
        mission.missionId === 'pirate-recon' ? 'recon' : 'pve', mission.ownReconReport !== undefined)) },
    run: (current, key) => {
      const result = dispatchNpcPirateMission(current, ownerId, mission, at, key, timeScale);
      return { state: result.state, started: result.ok, reason: result.reason };
    },
  });
  for (const request of getNpcAidRequestCandidates(state, profile, at)) choices.push({ candidate: request, run: (current) => {
    const result = createNpcAidRequest(current, ownerId, request, at, timeScale);
    return { state: result.state, started: result.ok, reason: result.reason };
  } });
  // The endgame by the player's rules: Gates, Sun raids, Sun defence.
  for (const choice of getNpcEndgameChoices(state, profile, utility, at, timeScale, scored)) choices.push(choice);
  for (const aid of getNpcAidCandidates(state, profile, at)) choices.push({ candidate: aid, run: (current, key) => {
    const result = dispatchNpcAid(current, ownerId, aid, at, key, timeScale);
    return { state: result.state, started: result.ok, reason: result.reason };
  } });
  for (const mission of state.espionage?.missions ?? []) {
    if (mission.ownerId !== ownerId || mission.status !== 'orbiting') continue;
    const flight = ownerFlights(state.flights.records, ownerId).find((record) => record.id === mission.flightId && record.phase === 'arrived');
    if (!flight) continue;
    // Once the report is in, a player calls the probe home to use it again.
    choices.push({ candidate: { id: `spy-return:${flight.id}`, kind: 'recon', weight: utilityToWeight(1.5) }, run: (current, key) => ({
      state: { ...current, flights: beginFlightReturn(current.flights, flight.id, at, 'normal-return'),
        espionage: { ...current.espionage!, missions: current.espionage!.missions.map((item) => item.id === mission.id ? { ...item, status: 'returning', nextReportAt: undefined } : item) } },
      started: true, reason: null,
    }) });
    if (mission.nextReportAt !== undefined && at >= mission.nextReportAt) choices.push({
      candidate: { id: `spy-report:${flight.id}`, kind: 'recon', weight: 0.7 }, run: (current, key) => {
        const result = resolveNpcMissionArrival(current, flight, at, timeScale, true);
        return { state: result.state, started: result.ok, reason: result.reason };
      },
    });
  }
  // Catalog size and number of colonies must not multiply an action family's
  // total propensity: within a family the estimates share it. The family's
  // best estimate then scales it, so a family of only losing options (an
  // attack this owner expects to lose) is rarely drawn and a clearly good one
  // (a mine that pays back fast) dominates. Strategy and traits weight families.
  const totals = new Map<string, number>();
  const best = new Map<string, number>();
  for (const { candidate } of choices) {
    totals.set(candidate.kind, (totals.get(candidate.kind) ?? 0) + candidate.weight);
    best.set(candidate.kind, Math.max(best.get(candidate.kind) ?? 0, candidate.weight));
  }
  const familyScale = (kind: string) => Math.min(utilityToWeight(NPC_MAX_UTILITY), Math.max(0.05, best.get(kind)!))
    * (0.4 + familyDrive(drives, kind));
  const candidates = choices.map(({ candidate }) => ({ ...candidate, weight: candidate.weight / totals.get(candidate.kind)! * familyScale(candidate.kind) }));
  const strategy = chooseNpcStrategy(drives, (item) => estimationError(profile, eventId, `strategy:${item}`));
  const decisions: NpcAutonomyDecision[] = [];
  let current = state;
  let open = candidates;
  let refusals = 0;
  for (let index = 0; index < Math.max(1, maxActions); index += 1) {
    const actionId = npcAttentionActionId(eventId, index);
    const idempotencyKey = `npc-autonomy:${JSON.stringify([ownerId, actionId])}`;
    const acting = current.npc?.profiles[ownerId] ?? profile;
    const selected = chooseNpcAutonomyAction(acting, open, actionId);
    const choice = selected ? choices.find(({ candidate }) => candidate.id === selected.id)! : null;
    const outcome = choice?.run(current, idempotencyKey) ?? { state: current, started: false, reason: null };
    const observedProfile = outcome.state.npc?.profiles[ownerId] ?? acting;
    const remembered = updateNpcAutonomyMemory(observedProfile, actionId, at, selected?.kind ?? 'wait', outcome.started,
      [`decision:${actionId}:${outcome.started ? 'started' : selected ? 'denied' : 'wait'}`],
      { goalKind: NPC_STRATEGY_FAMILY[strategy], goalKinds: STRATEGIC_GOAL_KINDS });
    current = outcome.state.npc ? { ...outcome.state, npc: { ...outcome.state.npc, profiles: { ...outcome.state.npc.profiles, [ownerId]: remembered } } } : outcome.state;
    decisions.push({ ...outcome, state: current, kind: selected?.kind ?? 'wait', wait: selected === null, idempotencyKey,
      selectedRole: selected?.payload?.role as BuildingRole ?? null,
      selectedScienceId: selected?.payload?.scienceId as ScienceId ?? null });
    if (!selected) break;
    const slot = actionSlot(selected);
    open = open.filter((candidate) => candidate.id !== selected.id && actionSlot(candidate) !== slot);
    if (!outcome.started && ++refusals >= 4) break;
    if (!open.length) break;
  }
  return decisions;
}
