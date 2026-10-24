import { chooseNpcAutonomyAction, updateNpcAutonomyMemory, type NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
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
import { dispatchNpcMission, resolveNpcMissionArrival } from './npc-missions.ts';
import { beginFlightReturn } from '../domain/flights/runtime.ts';
import { getNpcPirateCandidates, dispatchNpcPirateMission } from './npc-pirates.ts';
import { getNpcAidCandidates, dispatchNpcAid } from './npc-aid.ts';
import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import { estimationError, utilityToWeight } from '../domain/npc/utility.ts';
import {
  createNpcUtilityContext, estimateAttackUtility, estimateBuildingUtility, estimateColonizeUtility,
  estimateEspionageUtility, estimateOperationUtility, estimateProductionUtility, estimateScienceUtility,
} from './npc-utility.ts';

type Outcome = { state: SaveState; started: boolean; reason: string | null; economyActionId?: string; planetId?: string };
type Choice = { candidate: NpcAutonomyCandidate; run: (state: SaveState) => Outcome };
export type NpcAutonomyDecision = Outcome & {
  kind: string; wait: boolean; idempotencyKey: string;
  selectedRole: BuildingRole | null; selectedScienceId: ScienceId | null;
};

/** One owner-wide draw, across all real planets and all legal action kinds. */
export function applyNpcAutonomyDecision(state: SaveState, profile: NpcProfile, eventId: string, at: number, timeScale: number): NpcAutonomyDecision {
  const ownerId = profile.ownerId;
  const idempotencyKey = `npc-autonomy:${JSON.stringify([ownerId, eventId])}`;
  const choices: Choice[] = [];
  const utility = createNpcUtilityContext(state, profile, at, timeScale);
  // Concept U: estimated benefit − cost − risk + goal, plus this owner's seeded misjudgement.
  const scored = (candidateId: string, estimate: number) => utilityToWeight(estimate + estimationError(profile, eventId, candidateId));
  const missionUtility = (mission: { kind: string; payload: Readonly<Record<string, string | number | boolean | null>> }): number => {
    const origin = state.espionage?.targets?.[String(mission.payload.originPlanetId)];
    if (!origin) return 0;
    const destinationPlanetId = String(mission.payload.destinationPlanetId ?? '');
    if (mission.kind === 'attack') {
      let ships: Record<string, number> = {};
      try { ships = JSON.parse(String(mission.payload.selectedShips ?? '{}')) as Record<string, number>; } catch { ships = {}; }
      return estimateAttackUtility(utility, origin, destinationPlanetId, ships);
    }
    if (mission.kind === 'espionage') return estimateEspionageUtility(utility, destinationPlanetId);
    if (mission.kind === 'colonize') return estimateColonizeUtility(utility, origin,
      { galaxy: Number(mission.payload.destinationGalaxy), system: Number(mission.payload.destinationSystem) });
    if (mission.kind === 'expedition') return estimateOperationUtility(utility, 'expedition');
    if (mission.kind === 'exploration-recon') return estimateOperationUtility(utility, 'recon');
    return 0;
  };
  const planets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const withTarget = (current: SaveState, target: (typeof planets)[number]): SaveState => ({
    ...current, espionage: { ...current.espionage!, targets: { ...current.espionage!.targets, [target.id]: target } },
  });
  for (const target of planets) {
    const reservedPopulation = state.flights.records.filter((flight) => flight.ownerSide === 'npc' && flight.ownerId === ownerId
      && flight.originPlanetId === target.id && ['outbound', 'arrived', 'returning'].includes(flight.phase))
      .reduce((sum, flight) => { const empty = createEmptyFleetState(); return sum + calculateFleetPopulation({ ships: { ...empty.ships, ...flight.selectedShips }, commanders: { ...empty.commanders, ...flight.selectedCommanders } }, target.raceId); }, 0);
    for (const { role, availability } of getNpcBuildingCandidates(target, true)) {
      if (!availability.canBuild) continue;
      if (role === 'research' && (!state.npcScience || at < state.npcScience.activatedAt)) continue;
      const kind = role === 'shipyard' || role === 'hangar' ? 'production' : role === 'planetary-government' ? 'diplomacy' : 'economy';
      const buildingId = `building:${target.id}:${role}`;
      const buildingWeight = scored(buildingId, estimateBuildingUtility(utility, target, role,
        availability.nextLevel ?? availability.currentLevel + 1, availability.cost, getStorageCapacities(target.buildings)));
      choices.push({ candidate: { id: buildingId, kind, weight: buildingWeight, payload: { planetId: target.id, role } }, run: (current) => {
        const result = startNpcBuilding(current.espionage!.targets![target.id]!, role, at, { timeScale }, idempotencyKey);
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: target.id, ...(result.ok ? { economyActionId: idempotencyKey } : {}) };
      } });
    }
    const science = state.npcScience?.owners[ownerId];
    if (science && at >= state.npcScience!.activatedAt) for (const preview of getNpcScienceCandidates(target, science, at, timeScale)) {
      if (!preview.canStart) continue;
      const scienceCandidateId = `science:${target.id}:${preview.scienceId}`;
      choices.push({ candidate: { id: scienceCandidateId, kind: 'science', weight: scored(scienceCandidateId, estimateScienceUtility(utility, preview.cost)), payload: { scienceId: preview.scienceId } }, run: (current) => {
        const result = startNpcScience(current.espionage!.targets![target.id]!, current.npcScience!.owners[ownerId]!, preview.scienceId, at, timeScale, idempotencyKey);
        return { state: { ...withTarget(current, result.target), npcScience: { ...current.npcScience!, owners: { ...current.npcScience!.owners, [ownerId]: result.science } } }, started: result.ok, reason: result.reason, planetId: target.id, ...(result.ok ? { economyActionId: idempotencyKey } : {}) };
      } });
    }
    for (const preview of getNpcFleetProductionCandidates(target, ownerId, at, timeScale, reservedPopulation)) {
      if (!preview.available) continue;
      const productionId = `production:${target.id}:${preview.queueKind}:${preview.itemId}`;
      choices.push({ candidate: { id: productionId, kind: 'production', weight: scored(productionId, estimateProductionUtility(utility, preview.queueKind, preview.cost)), payload: { itemId: preview.itemId } }, run: (current) => {
        const result = startNpcFleetProduction(current.espionage!.targets![target.id]!, ownerId, preview.queueKind, preview.itemId, at, timeScale, idempotencyKey, reservedPopulation);
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: target.id, ...(result.ok && result.orderId ? { economyActionId: result.orderId } : {}) };
      } });
    }
  }
  for (const candidate of getNpcDiplomacyCandidates(state, profile, at)) choices.push({ candidate: { ...candidate, kind: 'diplomacy' }, run: (current) => {
    const result = applyNpcDiplomacyAction(current, ownerId, candidate, at, idempotencyKey);
    return { state: result.state, started: result.ok, reason: result.ok ? null : result.reason };
  } });
  for (const mission of getNpcMissionCandidates(state, profile, at)) choices.push({
    candidate: { ...mission, weight: mission.weight * scored(mission.id, missionUtility(mission)),
      kind: mission.kind === 'espionage' || mission.kind === 'exploration-recon' ? 'recon' : mission.kind === 'expedition' ? 'pve' : mission.kind },
    run: (current) => {
      const command = candidateToNpcMissionCommand(mission, ownerId, idempotencyKey);
      if (!command) return { state: current, started: false, reason: 'invalid-mission-candidate' };
      const result = dispatchNpcMission(current, command, at, timeScale);
      return { state: result.state, started: result.ok, reason: result.reason };
    },
  });
  for (const mission of getNpcPirateCandidates(state, profile, at)) choices.push({
    candidate: { id: `pirate:${mission.id}`, kind: mission.missionId === 'pirate-recon' ? 'recon' : 'pve',
      weight: mission.weight * scored(`pirate:${mission.id}`, estimateOperationUtility(utility,
        mission.missionId === 'pirate-recon' ? 'recon' : 'pve', mission.ownReconReport !== undefined)) },
    run: (current) => {
      const result = dispatchNpcPirateMission(current, ownerId, mission, at, idempotencyKey, timeScale);
      return { state: result.state, started: result.ok, reason: result.reason };
    },
  });
  for (const aid of getNpcAidCandidates(state, profile, at)) choices.push({ candidate: aid, run: (current) => {
    const result = dispatchNpcAid(current, ownerId, aid, at, idempotencyKey, timeScale);
    return { state: result.state, started: result.ok, reason: result.reason };
  } });
  for (const mission of state.espionage?.missions ?? []) {
    if (mission.ownerId !== ownerId || mission.status !== 'orbiting') continue;
    const flight = state.flights.records.find((record) => record.id === mission.flightId && record.ownerId === ownerId && record.phase === 'arrived');
    if (!flight) continue;
    choices.push({ candidate: { id: `spy-return:${flight.id}`, kind: 'recon', weight: 0.5 }, run: (current) => ({
      state: { ...current, flights: beginFlightReturn(current.flights, flight.id, at, 'normal-return'),
        espionage: { ...current.espionage!, missions: current.espionage!.missions.map((item) => item.id === mission.id ? { ...item, status: 'returning', nextReportAt: undefined } : item) } },
      started: true, reason: null,
    }) });
    if (mission.nextReportAt !== undefined && at >= mission.nextReportAt) choices.push({
      candidate: { id: `spy-report:${flight.id}`, kind: 'recon', weight: 0.7 }, run: (current) => {
        const result = resolveNpcMissionArrival(current, flight, at, timeScale, true);
        return { state: result.state, started: result.ok, reason: result.reason };
      },
    });
  }
  // Catalog size and number of colonies must not multiply an action family's
  // total propensity: within a family the estimates share it. The family's
  // best estimate then scales it, so a family of only losing options (an
  // attack this owner expects to lose) is rarely drawn. Traits weight families.
  const totals = new Map<string, number>();
  const best = new Map<string, number>();
  for (const { candidate } of choices) {
    totals.set(candidate.kind, (totals.get(candidate.kind) ?? 0) + candidate.weight);
    best.set(candidate.kind, Math.max(best.get(candidate.kind) ?? 0, candidate.weight));
  }
  const familyScale = (kind: string) => Math.min(3, Math.max(0.05, best.get(kind)!));
  const candidates = choices.map(({ candidate }) => ({ ...candidate, weight: candidate.weight / totals.get(candidate.kind)! * familyScale(candidate.kind) }));
  const selected = chooseNpcAutonomyAction(profile, candidates, eventId);
  const choice = selected ? choices.find(({ candidate }) => candidate.id === selected.id)! : null;
  const outcome = choice?.run(state) ?? { state, started: false, reason: null };
  const observedProfile = outcome.state.npc?.profiles[ownerId] ?? profile;
  const remembered = updateNpcAutonomyMemory(observedProfile, eventId, at, selected?.kind ?? 'wait', outcome.started,
    [`decision:${eventId}:${outcome.started ? 'started' : selected ? 'denied' : 'wait'}`]);
  const next = outcome.state.npc ? { ...outcome.state, npc: { ...outcome.state.npc, profiles: { ...outcome.state.npc.profiles, [ownerId]: remembered } } } : outcome.state;
  return { ...outcome, state: next, kind: selected?.kind ?? 'wait', wait: selected === null, idempotencyKey,
    selectedRole: selected?.payload?.role as BuildingRole ?? null,
    selectedScienceId: selected?.payload?.scienceId as ScienceId ?? null };
}
