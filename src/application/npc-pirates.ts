import { calculateFleetPopulation, createEmptyFleetState, resolveSavedFleetState } from '../domain/fleet/runtime.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { createBot01IncomingAttackSnapshot } from './attack.ts';
import { getHangarCapacity } from '../domain/buildings/balance-v1.ts';
import { getFlightSlotUsage, isFlightLimitExempt } from '../domain/flights/limit.ts';
import { dispatchFlight, getFlightByRequestId } from '../domain/flights/runtime.ts';
import { isFlightCoordinate } from '../domain/flights/distance.ts';
import type { FlightRecord, FlightScienceLevels, MissionId } from '../domain/flights/types.ts';
import { createPirateReconMissionSnapshot, canDispatchPirateRecon, pirateReconCooldownKey } from '../domain/pirates/recon.ts';
import { calculatePirateEliminationPopulationBudget } from '../domain/pirates/profile.ts';
import { getOrCreatePirateOwnerProfile } from '../domain/pirates/contact.ts';
import { defaultPirateOwnerAdaptation, pirateAdaptiveFleetWeight } from '../domain/pirates/adaptive.ts';
import { pirateDebrisRewardMultiplier } from '../domain/pirates/threat.ts';
import { PIRATE_ELIMINATION_DEFEAT_MULTIPLIER, PIRATE_ELIMINATION_DRAW_MULTIPLIER } from '../domain/pirates/debris.ts';
import { createDefaultPirateState, type PirateMissionSnapshot } from '../domain/pirates/mission.ts';
import type { PirateReconReport } from '../domain/pirates/recon-report.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { createDefaultEspionageState, getEspionageTargets } from '../domain/espionage/runtime.ts';
import { getNpcMissionAvailableFleet } from './npc-missions.ts';
import { getOwnerRelation } from './owner-relations.ts';
import { getCurrentPirateContact, isPirateEliminationShip, resolvePirateFlightAtTarget } from './pirates.ts';
import { pirateOperationId } from './pirate-presentation.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { SpyOwnerProfile, SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';

export type NpcPirateCandidate = Readonly<{
  id: string;
  kind: 'pve' | 'recon';
  weight: number;
  ownerId: string;
  originPlanetId: string;
  operationId: string;
  contactCycleKey: string;
  coordinate: Readonly<{ galaxy: number; system: number; position: number }>;
  missionId: 'pirate-recon' | 'pirate-elimination';
  selectedShips: Readonly<Partial<Record<ShipId, number>>>;
  /** The acting owner's canonical public recon report, if one exists for this cycle. */
  ownReconReport?: PirateReconReport;
}>;

export type NpcPirateResult = Readonly<{
  state: SaveState;
  ok: boolean;
  reason: string | null;
  flight?: FlightRecord;
  created?: boolean;
}>;

function safeCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function ownerTargets(state: SaveState, ownerId: string): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc' && target.ownerId === ownerId);
}

function ownerProfile(state: SaveState, target: SpyTargetState): SpyOwnerProfile {
  return {
    scienceLevels: { ...(state.npcScience?.owners[target.ownerId]?.levels ?? target.ownerProfile?.scienceLevels ?? {}) },
    shipLevels: { ...(target.ownerProfile?.shipLevels ?? {}) },
    commanderLevels: { ...(target.ownerProfile?.commanderLevels ?? {}) },
  };
}

function pirateOwnerProfile(state: SaveState, ownerId: string, cycleKey: string) {
  const contact = state.pirate?.contact ?? createDefaultPirateState().contact;
  const score = selectOwnerScores(state)[ownerId];
  return getOrCreatePirateOwnerProfile(contact, {
    ownerId,
    contactCycleKey: cycleKey,
    score: {
      resourcePoints: score?.resourcePoints ?? 0,
      battlePoints: score?.battlePoints ?? 0,
      totalPoints: (score?.resourcePoints ?? 0) + (score?.battlePoints ?? 0),
    },
  });
}

function activePirateFlights(state: SaveState, ownerId: string, cycleKey: string): FlightRecord[] {
  return state.flights.records.filter((flight) => flight.ownerSide === 'npc'
    && flight.ownerId === ownerId
    && flight.pirateSnapshot?.contactCycleKey === cycleKey
    && ['outbound', 'arrived', 'returning'].includes(flight.phase));
}

function ownerCanUseFlightSlot(state: SaveState, ownerId: string, profile: SpyOwnerProfile, missionId: MissionId): boolean {
  if (isFlightLimitExempt(missionId)) return true;
  const ownerFlights = state.flights.records.filter((flight) => flight.ownerSide === 'npc' && flight.ownerId === ownerId)
    .map((flight) => ({ ...flight, ownerSide: 'player' as const }));
  return getFlightSlotUsage(ownerFlights, profile.scienceLevels[6]).free > 0;
}

function sameCoordinate(left: { galaxy: number; system: number; position: number }, right: { galaxy: number; system: number; position: number }): boolean {
  return left.galaxy === right.galaxy && left.system === right.system && left.position === right.position;
}

function fail(state: SaveState, reason: string): NpcPirateResult {
  return { state, ok: false, reason };
}

function liveContact(state: SaveState, origin: SpyTargetState, contactCycleKey: string, coordinate: NpcPirateCandidate['coordinate'], at: number) {
  if (!isFlightCoordinate(coordinate)) return null;
  const contact = getCurrentPirateContact(state, coordinate, at);
  return contact && contact.contactCycleKey === contactCycleKey && sameCoordinate(contact.coordinate, coordinate)
    && origin.coordinate.galaxy === coordinate.galaxy && origin.coordinate.system === coordinate.system
    ? contact : null;
}

/** Exposes only public current pirate contacts in the NPC owner's own systems and its own fleet/recon ledger. */
export function getNpcPirateCandidates(state: SaveState, profile: NpcProfile, at: number): NpcPirateCandidate[] {
  if (!Number.isSafeInteger(at) || at < 0 || !profile.ownerId.trim()) return [];
  const ownerId = profile.ownerId;
  const targets = ownerTargets(state, ownerId).sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const candidates: NpcPirateCandidate[] = [];
  for (const origin of targets) {
    const systemKey = `${origin.coordinate.galaxy}:${origin.coordinate.system}`;
    if (seen.has(systemKey)) continue;
    seen.add(systemKey);
    const contact = getCurrentPirateContact(state, { ...origin.coordinate, position: 1 }, at);
    if (!contact || getOwnerRelation(state, ownerId, 'pirates') !== 'neutral') continue;
    const ownReconReport = state.pirate?.reconReports
      .filter((report) => report.ownerId === ownerId && report.contactCycleKey === contact.contactCycleKey)
      .sort((left, right) => right.arrivedAt - left.arrivedAt)[0];
    const free = getNpcMissionAvailableFleet(state, ownerId, origin.id);
    const active = activePirateFlights(state, ownerId, contact.contactCycleKey);
    const spyAvailable = safeCount(free['spy-probe']) > 0;
    const cooldownKey = pirateReconCooldownKey(ownerId, contact.contactCycleKey);
    const reconAvailable = canDispatchPirateRecon({
      ownerId,
      contactCycleKey: contact.contactCycleKey,
      now: at,
      lastDispatchAt: state.pirate?.reconLastDispatchAt[cooldownKey],
      inFlight: active.some((flight) => flight.missionId === 'pirate-recon'),
    }).allowed;
    if (spyAvailable && reconAvailable) candidates.push({
      id: `pirate-recon:${JSON.stringify([ownerId, origin.id, contact.contactCycleKey])}`,
      kind: 'recon', weight: 1, ownerId, originPlanetId: origin.id,
      operationId: pirateOperationId(contact.contactCycleKey), contactCycleKey: contact.contactCycleKey,
      coordinate: { ...contact.coordinate }, missionId: 'pirate-recon', selectedShips: { 'spy-probe': 1 },
      ...(ownReconReport ? { ownReconReport } : {}),
    });
    const combatShips = Object.fromEntries(Object.entries(free).filter(([id, count]) =>
      safeCount(count) > 0 && isPirateEliminationShip(id as ShipId, origin.raceId))) as Partial<Record<ShipId, number>>;
    if (Object.keys(combatShips).length > 0 && ownerCanUseFlightSlot(state, ownerId, ownerProfile(state, origin), 'pirate-elimination')) candidates.push({
      id: `pirate-elimination:${JSON.stringify([ownerId, origin.id, contact.contactCycleKey])}`,
      kind: 'pve', weight: 1, ownerId, originPlanetId: origin.id,
      operationId: pirateOperationId(contact.contactCycleKey), contactCycleKey: contact.contactCycleKey,
      coordinate: { ...contact.coordinate }, missionId: 'pirate-elimination', selectedShips: combatShips,
      ...(ownReconReport ? { ownReconReport } : {}),
    });
  }
  return candidates;
}

/** Launches a canonical pirate mission while physically debiting this NPC planet. */
export function dispatchNpcPirateMission(
  state: SaveState,
  ownerId: string,
  candidate: NpcPirateCandidate,
  at: number,
  requestId: string,
  timeScale: number,
): NpcPirateResult {
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isFinite(timeScale) || timeScale <= 0) return fail(state, 'invalid-time');
  if (!requestId.trim() || requestId.length > 160) return fail(state, 'request-id-required');
  if (candidate.ownerId !== ownerId) return fail(state, 'candidate-owner-mismatch');
  const existing = getFlightByRequestId(state.flights, requestId);
  if (existing) return existing.ownerSide === 'npc' && existing.ownerId === ownerId
    && existing.originPlanetId === candidate.originPlanetId && existing.missionId === candidate.missionId
    ? { state, ok: true, reason: null, flight: existing, created: false }
    : fail(state, 'request-id-owned-by-another-flight');
  const origin = getEspionageTargets(state.espionage)[candidate.originPlanetId];
  if (!origin || origin.kind !== 'npc' || origin.ownerId !== ownerId) return fail(state, 'npc-origin-not-found');
  const contact = liveContact(state, origin, candidate.contactCycleKey, candidate.coordinate, at);
  if (!contact || candidate.operationId !== pirateOperationId(contact.contactCycleKey)) return fail(state, 'target-not-available');
  if (getOwnerRelation(state, ownerId, 'pirates') !== 'neutral') return fail(state, 'target-relation-blocked');
  const profile = ownerProfile(state, origin);
  if (!ownerCanUseFlightSlot(state, ownerId, profile, candidate.missionId)) return fail(state, 'flight-limit-reached');
  const selectedShips: Partial<Record<ShipId, number>> = {};
  for (const [id, raw] of Object.entries(candidate.selectedShips)) {
    if (!getFactionShipCatalog(origin.raceId).some((entity) => entity.id === id)
      || !Number.isSafeInteger(raw) || Number(raw) <= 0) return fail(state, 'invalid-ship-selection');
    if ((getNpcMissionAvailableFleet(state, ownerId, origin.id)[id as ShipId] ?? 0) < Number(raw)) return fail(state, 'insufficient-ships');
    if (candidate.missionId === 'pirate-recon' && (id !== 'spy-probe' || raw !== 1)) return fail(state, 'invalid-recon-composition');
    if (candidate.missionId === 'pirate-elimination' && !isPirateEliminationShip(id as ShipId, origin.raceId)) return fail(state, 'invalid-elimination-composition');
    selectedShips[id as ShipId] = Number(raw);
  }
  if (!Object.keys(selectedShips).length) return fail(state, 'empty-ship-selection');
  if (candidate.missionId === 'pirate-recon') {
    if (Object.keys(selectedShips).length !== 1) return fail(state, 'invalid-recon-composition');
    const active = activePirateFlights(state, ownerId, contact.contactCycleKey);
    const key = pirateReconCooldownKey(ownerId, contact.contactCycleKey);
    if (!canDispatchPirateRecon({ ownerId, contactCycleKey: contact.contactCycleKey, now: at,
      lastDispatchAt: state.pirate?.reconLastDispatchAt[key], inFlight: active.some((flight) => flight.missionId === 'pirate-recon') }).allowed) {
      return fail(state, 'recon-unavailable');
    }
  } else if (candidate.missionId !== 'pirate-elimination') return fail(state, 'unsupported-mission');

  const pirate = state.pirate ?? createDefaultPirateState();
  const ownerPirateProfile = pirateOwnerProfile(state, ownerId, contact.contactCycleKey);
  const shipState = createEmptyFleetState();
  Object.assign(shipState.ships, selectedShips);
  const sentPopulation = Math.round(calculateFleetPopulation(shipState, origin.raceId));
  const ownerHangar = ownerTargets(state, ownerId).reduce((max, target) => Math.max(max, Math.max(0, Math.floor(target.buildings.hangar ?? 0))), 0);
  const historicalHangarLevel = Math.max(pirate.ownerMaxHangarLevel?.[ownerId] ?? 0, ownerHangar);
  const historicalHangarCapacity = getHangarCapacity(historicalHangarLevel);
  const adaptation = pirate.ownerAdaptations?.[ownerId] ?? defaultPirateOwnerAdaptation();
  const adaptiveWeight = pirateAdaptiveFleetWeight(origin.raceId, selectedShips, sentPopulation, historicalHangarCapacity);
  const eliminationBudget = candidate.missionId === 'pirate-elimination'
    ? calculatePirateEliminationPopulationBudget(sentPopulation, ownerPirateProfile.profile.shares,
      `pirate-elimination-v2:${ownerId}:${contact.contactCycleKey}:${requestId}`,
      { ownerId, cycleKey: contact.contactCycleKey, totalPoints: ownerPirateProfile.profile.score.totalPoints }, adaptation.q)
    : undefined;
  if (eliminationBudget && eliminationBudget.actualPopulation <= 0) return fail(state, 'fleet-too-small');
  const reconMission = candidate.missionId === 'pirate-recon'
    ? createPirateReconMissionSnapshot({ missionId: `flight-${requestId}`, ownerId, contactCycleKey: contact.contactCycleKey, dispatchedAt: at })
    : undefined;
  const snapshot: PirateMissionSnapshot = {
    version: 1,
    missionId: candidate.missionId,
    ownerId,
    contactCycleKey: contact.contactCycleKey,
    coordinate: { ...contact.coordinate },
    cycleIndex: contact.cycleIndex,
    startAt: contact.startAt,
    expiresAt: contact.expiresAt,
    profile: ownerPirateProfile.profile,
    ...(eliminationBudget ? {
      eliminationBudget,
      sentCombatPopulation: sentPopulation,
      historicalHangarCapacity,
      rewardMultiplier: pirateDebrisRewardMultiplier(sentPopulation, historicalHangarCapacity),
      defeatMultiplier: PIRATE_ELIMINATION_DEFEAT_MULTIPLIER,
      drawMultiplier: PIRATE_ELIMINATION_DRAW_MULTIPLIER,
      adaptiveWeight,
      adaptiveQ: adaptation.q,
    } : {}),
    ...(reconMission ? { reconMission } : {}),
  };
  const domain = dispatchFlight(state.flights, {
    requestId,
    missionId: candidate.missionId,
    ownerSide: 'npc', ownerId,
    originPlanetId: origin.id,
    originCoordinate: { ...origin.coordinate },
    destination: { kind: 'coordinate', coordinate: { ...contact.coordinate } },
    selectedShips,
    selectedCommanders: {},
    targetKind: 'pirate',
    targetRelation: 'neutral',
    targetPlanetName: contact.name,
    pirateSnapshot: snapshot,
    ...(candidate.missionId === 'pirate-elimination' ? {
      attackSnapshot: createBot01IncomingAttackSnapshot(origin, profile),
      populationReserved: sentPopulation,
    } : {}),
    departedAt: at,
    factionId: origin.raceId,
    science: profile.scienceLevels as FlightScienceLevels,
    speedCommanderLevels: { typhoon: profile.commanderLevels.typhoon ?? 0 },
  });
  const duration = Math.max(1, Math.round(domain.flight.oneWayDurationMs / timeScale));
  const flight: FlightRecord = { ...domain.flight, oneWayDurationMs: duration, arrivalAt: at + duration };
  if (origin.resources.gas < flight.gasCost) return fail(state, 'insufficient-gas');
  const remainingShips = { ...origin.fleet.ships };
  for (const [id, count] of Object.entries(selectedShips) as [ShipId, number][]) remainingShips[id] = Math.max(0, (remainingShips[id] ?? 0) - count);
  const targets = { ...getEspionageTargets(state.espionage), [origin.id]: {
    ...origin,
    fleet: { ...origin.fleet, ships: remainingShips },
    resources: { ...origin.resources, gas: origin.resources.gas - flight.gasCost },
  } };
  const pirateState = {
    ...pirate,
    contact: ownerPirateProfile.state,
    ownerMaxHangarLevel: { ...pirate.ownerMaxHangarLevel, [ownerId]: historicalHangarLevel },
    ...(candidate.missionId === 'pirate-recon' ? { reconLastDispatchAt: {
      ...pirate.reconLastDispatchAt, [pirateReconCooldownKey(ownerId, contact.contactCycleKey)]: at,
    } } : {}),
    ...(eliminationBudget ? { ownerAdaptations: { ...pirate.ownerAdaptations, [ownerId]: adaptation } } : {}),
  };
  const nextFlights = { ...domain.state, records: domain.state.records.map((item) => item.id === flight.id ? flight : item) };
  const espionage = state.espionage ?? createDefaultEspionageState();
  return { state: { ...state, flights: nextFlights, espionage: { ...espionage, targets }, pirate: pirateState }, ok: true, reason: null, flight, created: true };
}

/** Resolves the canonical pirate engine against an ephemeral owner-shaped source, then merges only pirate outputs. */
export function resolveNpcPirateArrival(state: SaveState, flight: FlightRecord, at: number): NpcPirateResult {
  if (flight.ownerSide !== 'npc' || !flight.ownerId || at < flight.arrivalAt
    || !['outbound', 'arrived'].includes(flight.phase)
    || (flight.missionId !== 'pirate-recon' && flight.missionId !== 'pirate-elimination')) return fail(state, 'invalid-arrival');
  const origin = getEspionageTargets(state.espionage)[flight.originPlanetId];
  if (!origin || origin.kind !== 'npc' || origin.ownerId !== flight.ownerId) return fail(state, 'npc-origin-not-found');
  const canonicalOrigin = resolveSavedFleetState(origin.fleet, origin.raceId);
  const combatShips = { ...canonicalOrigin.ships };
  for (const [id, count] of Object.entries(flight.selectedShips) as [ShipId, number][]) combatShips[id] = (combatShips[id] ?? 0) + safeCount(count);
  const originTemplate = Object.values(state.planets)[0];
  if (!originTemplate && flight.missionId === 'pirate-elimination') return fail(state, 'canonical-origin-template-unavailable');
  const ephemeralId = `npc-pirate-origin:${flight.ownerId}:${origin.id}`;
  const shadowFleet = createEmptyFleetState();
  Object.assign(shadowFleet.ships, combatShips);
  const shadowOrigin = originTemplate ? {
    ...originTemplate,
    id: ephemeralId,
    name: origin.name,
    fleet: shadowFleet,
  } : undefined;
  const shadowState: SaveState = {
    ...state,
    profile: { ...state.profile, playerId: flight.ownerId, displayName: origin.ownerName, factionId: origin.raceId },
    planets: shadowOrigin ? { ...state.planets, [flight.originPlanetId]: shadowOrigin } : state.planets,
  };
  const result = resolvePirateFlightAtTarget(shadowState, flight, at);
  let next = state;
  if (result.state.pirate) next = { ...next, pirate: result.state.pirate };
  if (result.state.combat !== state.combat) next = { ...next, combat: result.state.combat };
  if (result.state.espionage?.orbitalDebris !== state.espionage?.orbitalDebris) {
    const espionage = next.espionage ?? createDefaultEspionageState();
    next = { ...next, espionage: { ...espionage, orbitalDebris: result.state.espionage?.orbitalDebris } };
  }
  const resolvedFlight = result.state.flights.records.find((item) => item.id === flight.id) ?? flight;
  const survivors = { ...flight.selectedShips };
  if (flight.missionId === 'pirate-elimination') {
    const report = result.state.combat.reports.find((item) => item.id === `battle-pirate-${flight.id}`);
    if (report) {
      for (const [id, raw] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
        const destroyed = report.attackerForce.stacks.find((stack) => stack.entityId === id)?.destroyed ?? 0;
        const left = Math.max(0, safeCount(raw) - safeCount(destroyed));
        // A hull type the battle wiped out leaves the manifest: a zero count
        // made the save reject the whole returning fleet.
        if (left > 0) survivors[id] = left;
        else delete survivors[id];
      }
    }
  }
  return {
    state: next,
    ok: result.status !== 'no-target',
    reason: result.status === 'no-target' ? 'target-unavailable' : null,
    // Ships remain in the flight until its exact return time. This canonical
    // manifest lets the owner-scoped return settle only combat survivors.
    flight: { ...resolvedFlight, selectedShips: survivors },
  };
}
