import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_DEPARTURES } from '../domain/command/catalog.ts';
import { acceptApplication, applyToAlliance, createAlliance, kickMember, leaveAlliance } from '../domain/command/membership.ts';
import { declareWar } from '../domain/command/diplomacy.ts';
import { migrateCommandState } from '../domain/command/repository.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { createNpcState } from '../domain/npc/state.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { createInitialSaveState } from './persistence.ts';
import { allianceFit, bestStrengths, joinPull, npcAllianceTaste, selectAllianceStrengths, selectNpcDefection } from './npc-alliance-choice.ts';
import { applyNpcDiplomacyAction, getNpcDiplomacyCandidates } from './npc-diplomacy.ts';
import { npcRegard, recordNpcBattleRelations } from './npc-relations.ts';

const T0 = Date.UTC(2026, 10, 1, 12);
const HOUR = 3_600_000;
const SETTINGS = (name: string, tag: string) => ({ name, tag, motto: '', description: '', emblem: { glyph: 'starforge' as const, accent: 'cyan' as const } });

function world(seed: string): { state: SaveState; ids: string[] } {
  const config = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Игрок' });
  const initial = createInitialSaveState('production', T0, { ...config, world: { ...config.world, npcCount: 12 } });
  const ids = [...new Set(Object.values(initial.espionage!.targets!).filter((target) => target.kind === 'npc').map((target) => target.ownerId))].sort();
  const npc = createNpcState(ids, `alliance-choice:${seed}`, T0);
  const targets = Object.fromEntries(Object.entries(initial.espionage!.targets!).map(([id, target]) => [id,
    target.kind === 'npc' ? { ...target, buildings: { ...target.buildings, 'planetary-government': 1 } } : target]));
  return { state: { ...initial, npc, espionage: { ...initial.espionage!, targets } }, ids };
}

/** Sets traits of one NPC (the rest of its profile stays). */
function withTraits(state: SaveState, ownerId: string, traits: Partial<NpcProfile['traits']>): SaveState {
  const profile = state.npc!.profiles[ownerId]!;
  return { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [ownerId]: { ...profile, traits: { ...profile.traits, ...traits } } } } };
}

function found(state: SaveState, ownerId: string, name: string, tag: string, at = T0): SaveState {
  const made = createAlliance(state.command, { ownerId, displayName: ownerId, settings: SETTINGS(name, tag) }, { now: at, random: () => 0.3 });
  assert.equal(made.ok, true);
  return { ...state, command: made.state };
}

function join(state: SaveState, ownerId: string, allianceLeaderId: string, at = T0): SaveState {
  const alliance = selectOwnerMembership(state.command, allianceLeaderId)!.alliance;
  const applied = applyToAlliance(state.command, { ownerId, displayName: ownerId, allianceId: alliance.id }, { now: at });
  assert.equal(applied.ok, true);
  const accepted = acceptApplication(applied.state, allianceLeaderId, applied.applicationId, { now: at, random: () => 0.5 });
  assert.equal(accepted.ok, true);
  return { ...state, command: accepted.state };
}

const withBattlePoints = (state: SaveState, points: Record<string, number>): SaveState => ({
  ...state, rating: { ...state.rating, archivedBattlePoints: { ...state.rating.archivedBattlePoints, ...points } },
});

const WARLIKE = { militaryFocus: 1, aggression: 1, economyFocus: 0, cooperation: 0.9, socialStyle: 0.9 };
const applyWeights = (state: SaveState, ownerId: string, at = T0) => new Map(getNpcDiplomacyCandidates(state, state.npc!.profiles[ownerId]!, at)
  .filter((candidate) => candidate.kind === 'apply-to-alliance')
  .map((candidate) => [String(candidate.payload.allianceId), candidate.weight]));

function battle(id: string, attacker: string, defender: string): BattleReport {
  return {
    id, missionType: 'attack', winner: 'attacker', timestamp: new Date(T0).toISOString(),
    attacker: { playerId: attacker }, defender: { playerId: defender },
    defenderForce: { stacks: [], defenses: [] }, resources: { metal: 0, minerals: 0, gas: 0 },
  } as unknown as BattleReport;
}

/* ------------------------------------------------------------------ A: answers */

test('A: an NPC leader answers the player\'s application by character, with no priority, and the player sees the outcome', () => {
  for (const [cooperation, expected] of [[0.9, 'accepted'], [0.05, 'rejected']] as const) {
    const { state: base, ids } = world(`ALLIANCEA${cooperation}`);
    const [leader] = ids as [string];
    let state = withTraits(found(base, leader, 'Лидеры', 'LDR'), leader, { cooperation, socialStyle: 0 });
    const alliance = selectOwnerMembership(state.command, leader)!.alliance;
    const player = state.profile.playerId;
    const applied = applyToAlliance(state.command, { ownerId: player, displayName: 'Игрок', allianceId: alliance.id }, { now: T0 });
    state = { ...state, command: applied.state };

    const answer = getNpcDiplomacyCandidates(state, state.npc!.profiles[leader]!, T0 + HOUR).find((candidate) => candidate.kind.endsWith('-application'));
    assert.ok(answer, 'the application of the player is answered');
    const result = applyNpcDiplomacyAction(state, leader, answer, T0 + HOUR, answer.id);
    assert.equal(result.ok, true);
    const stored = result.state.command.applications.find((item) => item.ownerId === player)!;
    assert.equal(stored.status, expected, 'the application is resolved, so the player\'s screen shows ПРИНЯТА / ОТКЛОНЕНА');
    assert.equal(stored.resolvedAt, T0 + HOUR);
    assert.equal(Boolean(selectOwnerMembership(result.state.command, player)), expected === 'accepted');
  }
});

test('A: an application already pending in an old save is answered the same way', () => {
  const { state: base, ids } = world('ALLIANCEAOLD');
  const [leader] = ids as [string];
  const state = withTraits(found(base, leader, 'Старый', 'OLD'), leader, { cooperation: 0.9 });
  const alliance = selectOwnerMembership(state.command, leader)!.alliance;
  // The application was filed a week ago; nobody answered.
  const old = applyToAlliance(state.command, { ownerId: state.profile.playerId, displayName: 'Игрок', allianceId: alliance.id }, { now: T0 - 7 * 24 * HOUR });
  const loaded = { ...state, command: migrateCommandState(JSON.parse(JSON.stringify(old.state)), 'production') };
  const answer = getNpcDiplomacyCandidates(loaded, loaded.npc!.profiles[leader]!, T0).find((candidate) => candidate.kind === 'accept-application');
  assert.ok(answer);
});

test('A: the same applicant gets the same answer whether it is the player or an NPC', () => {
  const { state: base, ids } = world('ALLIANCEASAME');
  const [leader, other] = ids as [string, string];
  let state = withTraits(found(base, leader, 'Одинаково', 'EQ'), leader, { cooperation: 0.4, socialStyle: 0.2 });
  const alliance = selectOwnerMembership(state.command, leader)!.alliance;
  for (const ownerId of [state.profile.playerId, other]) {
    const applied = applyToAlliance(state.command, { ownerId, displayName: ownerId, allianceId: alliance.id }, { now: T0 });
    state = { ...state, command: applied.state };
  }
  const kinds = getNpcDiplomacyCandidates(state, state.npc!.profiles[leader]!, T0).filter((candidate) => candidate.kind.endsWith('-application'));
  assert.equal(kinds.length, 2);
  assert.equal(kinds[0]!.kind, kinds[1]!.kind);
});

/* ------------------------------------------------------------------ B: choice by taste */

test('B: the strong draw applicants by taste: warlike want combat points, economists want resource points', () => {
  const { state: base, ids } = world('ALLIANCEB1');
  const [applicant, warLeader, richLeader] = ids as [string, string, string];
  let state = found(found(base, warLeader, 'Воины', 'WAR'), richLeader, 'Богачи', 'RCH');
  state = withBattlePoints(state, { [warLeader]: 400_000 });
  const warAlliance = selectOwnerMembership(state.command, warLeader)!.alliance.id;
  const richAlliance = selectOwnerMembership(state.command, richLeader)!.alliance.id;
  const strengths = selectAllianceStrengths(state);
  assert.ok(strengths.get(warAlliance)!.combat > strengths.get(richAlliance)!.combat);

  const fighter = applyWeights(withTraits(state, applicant, WARLIKE), applicant);
  assert.ok(fighter.get(warAlliance)! > 2 * fighter.get(richAlliance)!, `fighter ${fighter.get(warAlliance)} vs ${fighter.get(richAlliance)}`);

  // An economist reads the resource column: same two alliances, but the one rich in resources wins for him.
  const taste = npcAllianceTaste({ ...state.npc!.profiles[applicant]!, traits: { ...state.npc!.profiles[applicant]!.traits, militaryFocus: 0, aggression: 0, economyFocus: 1 } });
  const synthetic = { fighters: { id: 'f', size: 3, combat: 900, resource: 100, total: 1_000 }, traders: { id: 't', size: 3, combat: 100, resource: 900, total: 1_000 } };
  const top = bestStrengths(new Map(Object.entries(synthetic).map(([key, value]) => [key, value])));
  assert.ok(allianceFit(taste, synthetic.traders, top) > 2 * allianceFit(taste, synthetic.fighters, top));
  const fighterTaste = npcAllianceTaste({ ...state.npc!.profiles[applicant]!, traits: { ...state.npc!.profiles[applicant]!.traits, ...WARLIKE } });
  assert.ok(allianceFit(fighterTaste, synthetic.fighters, top) > 2 * allianceFit(fighterTaste, synthetic.traders, top));
  assert.ok(joinPull(0.9) > 4 * joinPull(0.2), 'a strong alliance weighs several times a weak one');
});

test('B: a strong player alliance gets applicants, a weak one does not, and the player has no bonus of his own', () => {
  const { state: base, ids } = world('ALLIANCEB2');
  const [applicant, npcLeader] = ids as [string, string];
  const player = base.profile.playerId;
  const build = (strong: 'player' | 'npc') => {
    let state = found(found(base, player, 'Игроки', 'PLR'), npcLeader, 'Боты', 'BOT');
    state = withBattlePoints(state, { [strong === 'player' ? player : npcLeader]: 500_000 });
    return withTraits(state, applicant, WARLIKE);
  };
  const playerAllianceId = (state: SaveState) => selectOwnerMembership(state.command, player)!.alliance.id;
  const npcAllianceId = (state: SaveState) => selectOwnerMembership(state.command, npcLeader)!.alliance.id;

  const strongPlayer = build('player');
  const w1 = applyWeights(strongPlayer, applicant);
  assert.ok(w1.get(playerAllianceId(strongPlayer))! > 2 * w1.get(npcAllianceId(strongPlayer))!, 'the strong player alliance is wanted');

  const weakPlayer = build('npc');
  const w2 = applyWeights(weakPlayer, applicant);
  assert.ok(w2.get(playerAllianceId(weakPlayer))! < 0.5 * w2.get(npcAllianceId(weakPlayer))!, 'the weak one is not');
});

test('B: loners stay loners and a full alliance is never offered', () => {
  const { state: base, ids } = world('ALLIANCEB3');
  const [loner, leader] = ids as [string, string];
  const state = withTraits(found(base, leader, 'Союз', 'SYZ'), loner, { cooperation: 0.1, socialStyle: 0.1 });
  assert.equal(getNpcDiplomacyCandidates(state, state.npc!.profiles[loner]!, T0).some((candidate) => candidate.kind === 'apply-to-alliance' || candidate.kind === 'create-alliance'), false);
});

/* ------------------------------------------------------------------ C: leaving */

/** `leaver` sits in a weak alliance while a strong one is open. Loyalty and taste as given. */
function discontented(seed: string, traits: Partial<NpcProfile['traits']>) {
  const { state: base, ids } = world(seed);
  const [leaver, weakLeader, strongLeader] = ids as [string, string, string];
  let state = found(found(base, weakLeader, 'Слабые', 'WEK'), strongLeader, 'Сильные', 'STR');
  state = join(state, leaver, weakLeader, T0);
  state = withBattlePoints(state, { [strongLeader]: 600_000 });
  state = withTraits(state, leaver, { ...WARLIKE, persistence: 0, adaptability: 1, ...traits });
  return { state, leaver, weakLeader, strongLeader };
}
const LATER = T0 + 3 * 24 * HOUR;

test('C: a restless warlike NPC walks out of a weak alliance for a much stronger one; a loyal one stays', () => {
  const { state, leaver, strongLeader } = discontented('ALLIANCEC1', { cooperation: 0.1 });
  const candidate = getNpcDiplomacyCandidates(state, state.npc!.profiles[leaver]!, LATER).find((item) => item.kind === 'leave-alliance');
  assert.ok(candidate, 'wants out');
  const left = applyNpcDiplomacyAction(state, leaver, candidate, LATER, candidate.id);
  assert.equal(left.ok, true);
  assert.equal(selectOwnerMembership(left.state.command, leaver), null);
  assert.deepEqual(left.state.command.departures?.map((entry) => [entry.ownerId, entry.cause, entry.at]), [[leaver, 'left', LATER]]);
  // Replaying the same action changes nothing.
  assert.equal(applyNpcDiplomacyAction(left.state, leaver, candidate, LATER, candidate.id).ok, false);
  // The two-hour delay applies, then it applies to the strong one, not back to the weak one it left.
  const soon = getNpcDiplomacyCandidates(left.state, left.state.npc!.profiles[leaver]!, LATER + 3 * HOUR).filter((item) => item.kind === 'apply-to-alliance');
  const strongId = selectOwnerMembership(left.state.command, strongLeader)!.alliance.id;
  assert.deepEqual(soon.map((item) => item.payload.allianceId), [strongId]);

  const loyal = withTraits(state, leaver, { cooperation: 1, persistence: 1, adaptability: 0 });
  assert.equal(getNpcDiplomacyCandidates(loyal, loyal.npc!.profiles[leaver]!, LATER).some((item) => item.kind === 'leave-alliance'), false);
});

test('C: nobody leaves on a whim: fresh members, equal alliances, a recent departure and a winning war all keep it', () => {
  const { state, leaver, weakLeader, strongLeader } = discontented('ALLIANCEC2', { cooperation: 0.1 });
  const profile = state.npc!.profiles[leaver]!;
  assert.ok(selectNpcDefection(state, profile, LATER));
  assert.equal(selectNpcDefection(state, profile, T0 + 2 * HOUR), null, 'tenure');
  const equal = withBattlePoints(state, { [strongLeader]: 0 });
  assert.equal(selectNpcDefection(equal, profile, LATER), null, 'no better alliance');
  const recent = { ...state, command: { ...state.command, departures: [{ ownerId: leaver, allianceId: 'alliance-x', at: LATER - HOUR, cause: 'left' as const }] } };
  assert.equal(selectNpcDefection(recent, profile, LATER), null, 'just left another');

  // The own alliance wins its war: no deserting.
  const war = declareWar(state.command, weakLeader, selectOwnerMembership(state.command, strongLeader)!.alliance.id, { now: T0 + 1 });
  assert.equal(war.ok, true);
  const winning = withBattlePoints({ ...state, command: war.state }, { [strongLeader]: 0, [weakLeader]: 100 });
  assert.equal(selectNpcDefection(winning, profile, LATER), null, 'winning war');
});

test('C: crystals, a Gate or a Sun raid of the alliance hold its members; solo crystals never mix with alliances', () => {
  const { state, leaver } = discontented('ALLIANCEC3', { cooperation: 0.1 });
  const profile = state.npc!.profiles[leaver]!;
  const allianceId = selectOwnerMembership(state.command, leaver)!.alliance.id;
  const holding = { ...state, sunRaid: { ...(state.sunRaid ?? { version: 1, suns: {}, crystals: {}, raids: [], gates: [], gateCooldowns: {}, history: [] }), crystals: { [`alliance:${allianceId}`]: ['crystal-1'] } } } as unknown as SaveState;
  assert.equal(selectNpcDefection(holding, profile, LATER), null);
  const raiding = { ...state, sunRaid: { version: 1, suns: {}, crystals: {}, gates: [], gateCooldowns: {}, history: [], raids: [{ id: 'r', allianceId, status: 'gathering' }] } } as unknown as SaveState;
  assert.equal(selectNpcDefection(raiding, profile, LATER), null);
});

test('C: a leader hands the alliance over to the deputy when it leaves and a lone leader disbands it; the player is never made leader unasked', () => {
  const { state: base, ids } = world('ALLIANCEC4');
  const [leader, deputy, strongLeader] = ids as [string, string, string];
  let state = found(found(base, leader, 'Вожак', 'VZH'), strongLeader, 'Сильные', 'STR');
  state = join(state, deputy, leader);
  state = join(state, state.profile.playerId, leader);
  const alliance = selectOwnerMembership(state.command, leader)!.alliance;
  state = { ...state, command: { ...state.command, alliances: state.command.alliances.map((item) => item.id === alliance.id ? { ...item, deputyOwnerId: state.profile.playerId } : item) } };
  state = withBattlePoints(state, { [strongLeader]: 900_000 });
  state = withTraits(state, leader, { ...WARLIKE, cooperation: 0, persistence: 0, adaptability: 1 });
  const defection = selectNpcDefection(state, state.npc!.profiles[leader]!, LATER);
  assert.ok(defection);
  assert.equal(defection.successorOwnerId, deputy, 'the player-deputy is passed over for the NPC member');
  const candidate = getNpcDiplomacyCandidates(state, state.npc!.profiles[leader]!, LATER).find((item) => item.kind === 'leave-alliance')!;
  const left = applyNpcDiplomacyAction(state, leader, candidate, LATER, candidate.id);
  assert.equal(left.ok, true);
  const remaining = left.state.command.alliances.find((item) => item.id === alliance.id)!;
  assert.equal(remaining.leaderOwnerId, deputy);
  assert.equal(remaining.members.some((member) => member.ownerId === leader), false);

  // Only the player left to take over: it stays rather than hand him an alliance.
  const alone = leaveAlliance(state.command, deputy, LATER - 1);
  assert.equal(alone.ok, true);
  const onlyPlayer = { ...state, command: alone.state };
  assert.equal(selectNpcDefection(onlyPlayer, onlyPlayer.npc!.profiles[leader]!, LATER), null);
});

/* ------------------------------------------------------------------ D: memory */

test('D: a defector who then fights its old alliance is remembered, refused, and the memory is bounded', () => {
  const { state: base, ids } = world('ALLIANCED1');
  const [defector, old1, old2] = ids as [string, string, string];
  let state = found(base, old1, 'Старый союз', 'OLD');
  state = join(state, old2, old1);
  state = join(state, defector, old1);
  state = withTraits(withTraits(state, old1, { cooperation: 0.9, socialStyle: 0.9 }), defector, { cooperation: 0.9, socialStyle: 0.9 });
  const oldAlliance = selectOwnerMembership(state.command, old1)!.alliance.id;
  const left = leaveAlliance(state.command, defector, T0 + 30 * HOUR);
  assert.equal(left.ok, true);
  state = { ...state, command: left.state };

  const regardBefore = npcRegard(state, state.npc!.profiles[old2]!, defector, T0 + 40 * HOUR);
  // It attacks its old alliance: the attacked and the others who were in it remember.
  const fought = recordNpcBattleRelations(state, battle('b1', defector, old2), T0 + 40 * HOUR, 50_000);
  assert.ok(npcRegard(fought, fought.npc!.profiles[old1]!, defector, T0 + 40 * HOUR) < -0.3, 'a colleague who was not even attacked remembers the betrayal');
  assert.ok(npcRegard(fought, fought.npc!.profiles[old2]!, defector, T0 + 40 * HOUR) < regardBefore - 0.5);
  // An attack on a stranger is just an attack.
  const stranger = recordNpcBattleRelations(state, battle('b2', defector, ids[5]!), T0 + 40 * HOUR, 50_000);
  assert.equal(npcRegard(stranger, stranger.npc!.profiles[old1]!, defector, T0 + 40 * HOUR), regardBefore);

  // Later it asks to come back: the leader and the members refuse, though the leader is the friendliest sort.
  const reapplied = applyToAlliance(fought.command, { ownerId: defector, displayName: 'D', allianceId: oldAlliance }, { now: T0 + 60 * HOUR });
  assert.equal(reapplied.ok, true);
  const asked = { ...fought, command: reapplied.state };
  const answer = getNpcDiplomacyCandidates(asked, asked.npc!.profiles[old1]!, T0 + 60 * HOUR).find((item) => item.kind.endsWith('-application'));
  assert.equal(answer?.kind, 'reject-application');
  // And it does not ask them in the first place.
  const asking = getNpcDiplomacyCandidates(fought, fought.npc!.profiles[defector]!, T0 + 100 * HOUR).some((item) => item.kind === 'apply-to-alliance' && item.payload.allianceId === oldAlliance);
  assert.equal(asking, false);
});

test('D: the player who left a bot\'s alliance and attacked it is remembered the same way, with no new score', () => {
  const { state: base, ids } = world('ALLIANCED2');
  const [leader, member] = ids as [string, string];
  const player = base.profile.playerId;
  let state = found(base, leader, 'Союз бота', 'BOT');
  state = join(state, player, leader);
  state = join(state, member, leader);
  const left = leaveAlliance(state.command, player, T0 + 5 * HOUR);
  assert.equal(left.ok, true);
  state = { ...state, command: left.state };
  const fought = recordNpcBattleRelations(state, battle('p1', player, member), T0 + 8 * HOUR, 10_000);
  assert.ok(npcRegard(fought, fought.npc!.profiles[leader]!, player, T0 + 8 * HOUR) < -0.3);
  assert.deepEqual(Object.keys(fought).filter((key) => !(key in state)), ['npcStrategy'], 'only the relation edges the save already has for every NPC opinion');
});

test('D: kicked members are not defectors; the list stays bounded and old saves without it load', () => {
  const { state: base, ids } = world('ALLIANCED3');
  const [leader, kicked] = ids as [string, string];
  let state = join(found(base, leader, 'Союз', 'SYZ'), kicked, leader);
  const out = kickMember(state.command, leader, kicked, T0 + HOUR);
  assert.equal(out.ok, true);
  state = { ...state, command: out.state };
  const fought = recordNpcBattleRelations(state, battle('k1', kicked, leader), T0 + 2 * HOUR, 10_000);
  assert.ok(npcRegard(fought, fought.npc!.profiles[leader]!, kicked, T0 + 2 * HOUR) > -0.6, 'only the attack itself counts, no betrayal');

  // Bounded: far more leavers than the list holds.
  let command = state.command;
  for (let index = 0; index < MAX_DEPARTURES + 25; index += 1) {
    const joined = applyToAlliance(command, { ownerId: `x-${index}`, displayName: 'x', allianceId: command.alliances[0]!.id }, { now: T0 + index });
    assert.equal(joined.ok, true);
    if (!joined.ok) throw new Error('unreachable');
    const accepted = acceptApplication(joined.state, leader, joined.applicationId, { now: T0 + index, random: () => 0.1 });
    command = leaveAlliance(accepted.state, `x-${index}`, T0 + index).state;
  }
  assert.equal(command.departures!.length, MAX_DEPARTURES);
  const reloaded = migrateCommandState(JSON.parse(JSON.stringify(command)), 'production');
  assert.deepEqual(reloaded.departures, command.departures);
  // A save from before has no list at all.
  const { departures: _gone, ...legacy } = command;
  assert.equal(migrateCommandState(JSON.parse(JSON.stringify(legacy)), 'production').departures, undefined);
});
