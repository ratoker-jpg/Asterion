import { COMBAT_ENGINE_VERSION } from '../domain/combat/report.ts';
import {
  beginSeriesCampaign,
  campaignIdFromSalt,
  foldCampaign,
  type CampaignFacts,
  type CampaignFold,
  type PersonaEdgeFacts,
  type PersonaOwnerFacts,
  type PersonaRegistry,
} from '../domain/npc/persona-registry.ts';
import { readNpcRelationEdge } from '../domain/npc/relations.ts';
import { respreadNpcPopulation } from '../domain/npc/state.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { npcActivityOf } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { isGrievanceBattle } from './npc-grudges.ts';

/**
 * A series of campaigns seen from the save (domain/npc/persona-registry.ts):
 * what a finished campaign confirms, and what a new world takes from the
 * registry. These run only at the boundary of a campaign.
 */

export function campaignIdOf(state: SaveState): string | null {
  return state.npc ? campaignIdFromSalt(state.npc.personaSalt) : null;
}

/** True when this campaign's NPC came from a series; nothing outside the save is read. */
export function isSeriesCampaign(state: SaveState): boolean {
  return Object.values(state.npc?.profiles ?? {}).some((profile) => profile.inherited !== undefined);
}

export type SeriesCampaignState = Readonly<{ state: SaveState; registry: PersonaRegistry; round: number }>;

/** A freshly created world whose NPC are the series' personas. Only character and memory change: the map stays as generated. */
export function bindNewCampaignToSeries(registry: PersonaRegistry, seriesId: string, state: SaveState, at: number): SeriesCampaignState | null {
  const npc = state.npc;
  if (!npc) return null;
  const started = beginSeriesCampaign(registry, seriesId, {
    campaignId: campaignIdFromSalt(npc.personaSalt),
    ownerIds: Object.keys(npc.profiles),
    playerId: state.profile.playerId,
    salt: npc.personaSalt,
    at,
    combatVersion: COMBAT_ENGINE_VERSION,
  });
  if (!started) return null;
  const profiles: Record<string, NpcProfile> = {};
  for (const [ownerId, profile] of Object.entries(npc.profiles)) {
    const persona = started.personas[ownerId];
    profiles[ownerId] = persona ? Object.freeze({
      ...profile,
      traits: persona.traits,
      planning: Object.freeze({ horizon: persona.traits.planningHorizon, commitment: persona.traits.persistence, reconsiderAt: null }),
      activity: Object.freeze({ ...profile.activity, propensity: persona.propensity }),
      session: Object.freeze({ ...profile.session, timezoneOffsetMinutes: persona.timezoneOffsetMinutes }),
      inherited: started.inherited[ownerId]!,
    }) : profile;
  }
  const rank = (ownerId: string, axis: 'activity' | 'skill') => (axis === 'skill' ? profiles[ownerId]!.traits.mechanicsKnowledge : profiles[ownerId]!.activity.propensity);
  return {
    state: { ...state, npc: Object.freeze({ ...npc, profiles: respreadNpcPopulation(profiles, npc.personaSalt, rank, npcActivityOf(state.worldConfig)) }) },
    registry: started.registry,
    round: started.round,
  };
}

type RunningFacts = {
  attackWins: number; attackLosses: number; defenseWins: number; defenseLosses: number;
  attacksByRace: Record<string, { wins: number; losses: number }>;
};

type EdgeCounts = { attacks: number; damage: number; helpReceived: number; helpGiven: number; jointOps: number; final?: NonNullable<PersonaEdgeFacts['final']> };

/**
 * Only what the save confirms: battle reports, attacks remembered, aid that
 * arrived, raids flown together. What this owner meant to do counts for nothing.
 */
export function collectCampaignFacts(state: SaveState, kind: CampaignFacts['kind'], at: number): CampaignFacts | null {
  const npc = state.npc;
  if (!npc) return null;
  const playerId = state.profile.playerId;
  const known = (ownerId: string) => ownerId === playerId || Boolean(npc.profiles[ownerId]);
  const raceOf = new Map<string, string>([[playerId, state.profile.factionId]]);
  for (const target of Object.values(state.espionage?.targets ?? {})) if (!raceOf.has(target.ownerId)) raceOf.set(target.ownerId, target.raceId);

  const running = new Map<string, RunningFacts>();
  const runningOf = (ownerId: string) => {
    let entry = running.get(ownerId);
    if (!entry) { entry = { attackWins: 0, attackLosses: 0, defenseWins: 0, defenseLosses: 0, attacksByRace: {} }; running.set(ownerId, entry); }
    return entry;
  };
  const seenReports = new Set<string>();
  for (const report of state.combat.reports) {
    if (seenReports.has(report.id) || !isGrievanceBattle(report)) continue;
    seenReports.add(report.id);
    const attacker = report.attacker.playerId!;
    const defender = report.defender.playerId!;
    if (npc.profiles[attacker]) {
      const entry = runningOf(attacker);
      const won = report.winner === 'attacker';
      if (won) entry.attackWins += 1;
      else entry.attackLosses += 1;
      const race = raceOf.get(defender);
      if (race) {
        const stat = entry.attacksByRace[race] ?? { wins: 0, losses: 0 };
        entry.attacksByRace[race] = { wins: stat.wins + (won ? 1 : 0), losses: stat.losses + (won ? 0 : 1) };
      }
    }
    if (npc.profiles[defender]) {
      const entry = runningOf(defender);
      if (report.winner === 'defender') entry.defenseWins += 1;
      else entry.defenseLosses += 1;
    }
  }

  const edges = new Map<string, EdgeCounts>();
  const edgeOf = (from: string, to: string) => {
    const key = JSON.stringify([from, to]);
    let edge = edges.get(key);
    if (!edge) { edge = { attacks: 0, damage: 0, helpReceived: 0, helpGiven: 0, jointOps: 0 }; edges.set(key, edge); }
    return edge;
  };
  for (const profile of Object.values(npc.profiles)) {
    for (const [offender, grudge] of Object.entries(profile.grudges ?? {})) {
      if (!known(offender)) continue;
      const edge = edgeOf(profile.ownerId, offender);
      edge.attacks += grudge.attacks;
      edge.damage += grudge.damage;
    }
  }
  const requests = new Map(state.command.requests.map((request) => [request.id, request]));
  for (const event of state.command.aidEvents) {
    if (event.kind !== 'aid_delivered') continue;
    const recipient = requests.get(event.requestId)?.authorOwnerId;
    const sender = event.actorOwnerId;
    if (!recipient || recipient === sender || !known(recipient) || !known(sender)) continue;
    edgeOf(recipient, sender).helpReceived += 1;
    edgeOf(sender, recipient).helpGiven += 1;
  }
  for (const raid of state.sunRaid?.raids ?? []) {
    if (raid.status !== 'resolved') continue;
    const flown = (raid.result?.attackerOwnerIds ?? []).filter(known);
    for (const from of flown) for (const to of flown) if (from !== to) edgeOf(from, to).jointOps += 1;
  }
  // What the campaign's own relations kept: they outlive the archives above, and know the agreements and the transports.
  for (const [from, list] of Object.entries(state.npcStrategy?.relations ?? {})) {
    if (!known(from)) continue;
    for (const relation of list) {
      if (!known(relation.to)) continue;
      const view = readNpcRelationEdge(relation, undefined, at)!;
      const edge = edgeOf(from, relation.to);
      edge.helpReceived = Math.max(edge.helpReceived, relation.helpsReceived);
      edge.helpGiven = Math.max(edge.helpGiven, relation.helpsGiven);
      edge.jointOps = Math.max(edge.jointOps, relation.jointOps);
      edge.final = { trust: view.trust, affinity: view.affinity, fear: view.fear, resentment: view.resentment,
        ...(relation.promisesKept + relation.promisesBroken > 0 ? { reliability: view.reliability } : {}) };
    }
  }

  const result = state.sunRaid?.campaignResult;
  const winners = new Set<string>();
  if (result) {
    if (result.winner.kind === 'owner') winners.add(result.winner.id);
    else for (const member of state.command.alliances.find((alliance) => alliance.id === result.winner.id)?.members ?? []) winners.add(member.ownerId);
  }
  const planStats = planStatsOf(state);
  const owners: Record<string, PersonaOwnerFacts> = {};
  for (const [ownerId, profile] of Object.entries(npc.profiles)) {
    const entry = runningOf(ownerId);
    owners[ownerId] = {
      traits: profile.traits,
      propensity: profile.activity.propensity,
      timezoneOffsetMinutes: profile.session.timezoneOffsetMinutes,
      won: winners.has(ownerId),
      attackWins: entry.attackWins,
      attackLosses: entry.attackLosses,
      defenseWins: entry.defenseWins,
      defenseLosses: entry.defenseLosses,
      attacksByRace: entry.attacksByRace,
      plans: planStats[ownerId] ?? {},
    };
  }
  return {
    campaignId: campaignIdFromSalt(npc.personaSalt),
    kind,
    at,
    playerId,
    combatVersion: COMBAT_ENGINE_VERSION,
    owners,
    edges: [...edges.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([key, edge]): PersonaEdgeFacts => {
      const [from, to] = JSON.parse(key) as [string, string];
      return { from, to, ...edge };
    }),
  };
}

/** The plan statistics of the strategy section, where a campaign has one. */
function planStatsOf(state: SaveState): Record<string, PersonaOwnerFacts['plans']> {
  const outcomes = (state as { npcStrategy?: { outcomes?: Record<string, Record<string, { n?: unknown; wins?: unknown; cancelled?: unknown }>> } }).npcStrategy?.outcomes ?? {};
  const count = (value: unknown) => (Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0);
  return Object.fromEntries(Object.entries(outcomes).map(([ownerId, stats]) => [ownerId, Object.fromEntries(Object.entries(stats)
    .map(([template, stat]) => [template, { n: count(stat.n), wins: count(stat.wins), cancelled: count(stat.cancelled) }]))]));
}

/** Folds this campaign into the registry; a repeat changes nothing (`changed: false`). */
export function settleCampaign(registry: PersonaRegistry, state: SaveState, kind: CampaignFacts['kind'], at: number): CampaignFold | null {
  const facts = collectCampaignFacts(state, kind, at);
  return facts ? foldCampaign(registry, facts) : null;
}
