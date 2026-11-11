// Bot letters to the player («Личные»): who writes, how rarely, and what «Принять» / «Отказаться» does.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { createEmptyDefenseState, createDefaultFleetProductionState } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { createAlliance } from '../domain/command/membership.ts';
import { NPC_LETTER_BALANCE, isNpcLetterRecord, type NpcLetterRecord } from '../domain/npc/letters.ts';
import type { NpcJointStrikeProposal } from '../domain/npc/pacts.ts';
import { isNpcStrategyState, migrateNpcStrategyState } from '../domain/npc/strategy.ts';
import { createNpcState } from '../domain/npc/state.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { personalLetters } from '../domain/reports/letters.ts';
import { buildReportSheet } from '../domain/reports/sheet.ts';
import { buildReportsFeed } from '../domain/reports/adapters.ts';
import { createInitialSaveState } from './persistence.ts';
import type { SaveState } from './contracts.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { answerNpcLetter, recordPlayerPactArrival, refreshNpcLetters, settleNpcLetters } from './npc-letters.ts';
import { mayWritePlayer, npcLettersOf, playerInvitations, withNpcLetter } from './npc-letter-state.ts';
import { recordNpcPactArrival } from './npc-pact-state.ts';
import { refreshNpcPacts } from './npc-pacts.ts';
import { npcRelationView } from './npc-relations.ts';
import { createNpcUtilityContext } from './npc-utility.ts';

const START = Date.UTC(2026, 9, 27, 12);
const HOUR = 3_600_000;
const MINUTE = 60_000;
const SCIENCE = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 15]));

type World = { state: SaveState; bot: string; target: string; targetPlanet: string; botPlanet: string; player: string };

function npcPlanets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc').sort((left, right) => left.id.localeCompare(right.id));
}

function withReport(state: SaveState, ownerId: string, sourcePlanetId: string, target: SpyTargetState, at: number): SaveState {
  const report: SpyReportSnapshot = {
    ownerId, id: `letter-test-${ownerId}-${at}`, missionId: `letter-test-mission-${ownerId}-${at}`, createdAt: at, sourcePlanetId,
    targetPlanetId: target.id, targetPlanetName: target.name, targetOwnerId: target.ownerId, targetOwnerName: target.ownerName,
    targetRaceId: target.raceId, targetRelation: 'neutral', targetCoordinate: { ...target.coordinate },
    spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 0.5, quality: 'full',
    resources: { ...target.resources }, defense: { ...target.defense.defenses }, fleet: { ...target.fleet.ships }, firstReport: true,
  };
  return { ...state, espionage: { ...state.espionage!, reports: [...(state.espionage!.reports ?? []), report] } };
}

/** One armed bot with a fresh report of a target too strong for it alone, and a friendly view of the player: the only partner it can ask. */
function world(seed: string, options: Readonly<{ cooperation?: number }> = {}): World {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Letters' });
  let state = createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 7, campaignSpeed: 'standard' as const } });
  state = { ...state, npc: createNpcState(getNpcOwnerIds(state.espionage!.targets, state.profile.playerId), `salt-${seed}`, START) };
  const [pa, , pt] = npcPlanets(state);
  const targets = { ...getEspionageTargets(state.espionage) };
  const fleet = createEmptyFleetState();
  targets[pa!.id] = { ...pa!, raceId: 'aegis', ownerProfile: { scienceLevels: SCIENCE, shipLevels: {}, commanderLevels: {} } as SpyTargetState['ownerProfile'],
    resources: { ...pa!.resources, metal: 150_000, minerals: 150_000, gas: 150_000 },
    buildings: { ...pa!.buildings, shipyard: 20, hangar: 100, 'advanced-factory': 10, 'metal-storage': 30, 'mineral-storage': 30, 'gas-storage': 30 },
    fleet: { ...fleet, ships: { ...fleet.ships, cruiser: 60, transporter: 200, 'spy-probe': 5 } }, fleetProduction: createDefaultFleetProductionState() } as SpyTargetState;
  const cruiser = getFactionShipCatalog('aegis').find((entity) => entity.id === 'cruiser')!.combat!;
  const battery = getFactionDefenseCatalog(pt!.raceId).find((entity) => entity.id === 'ion-plasma-battery')!.combat!;
  const defense = createEmptyDefenseState();
  const count = Math.ceil(1.6 * 60 * Math.sqrt(cruiser.attack * cruiser.life) / Math.sqrt(battery.attack * battery.life));
  targets[pt!.id] = { ...pt!, resources: { ...pt!.resources, metal: 9_000_000, minerals: 9_000_000, gas: 9_000_000 },
    defense: { ...defense, defenses: { ...defense.defenses, 'ion-plasma-battery': count } }, fleet: { ...pt!.fleet, ships: {} } } as SpyTargetState;
  const player = state.profile.playerId;
  state = withAttackEligiblePoints({ ...state, espionage: { ...state.espionage!, targets } }, [pa!.ownerId, pt!.ownerId, player], 2_000_000);
  state = withReport(state, pa!.ownerId, pa!.id, targets[pt!.id]!, START);
  const profiles = { ...state.npc!.profiles };
  const profile = profiles[pa!.ownerId]!;
  profiles[pa!.ownerId] = { ...profile, traits: { ...profile.traits, riskTolerance: 0.8, cooperation: options.cooperation ?? 0.7, socialStyle: 0.7, attention: 0.9, aggression: 0.4, militaryFocus: 0.7 },
    activity: { ...profile.activity, propensity: 1 },
    inherited: { round: 2, prefs: {}, lessons: [], relations: { [pt!.ownerId]: { trust: 0, affinity: 0, resentment: 0.5 }, [player]: { trust: 0.7, affinity: 0.4, resentment: 0 } } } };
  state = { ...state, npc: { ...state.npc!, profiles } };
  return { state, bot: pa!.ownerId, target: pt!.ownerId, targetPlanet: pt!.id, botPlanet: pa!.id, player };
}

function look(state: SaveState, ownerId: string, at: number): SaveState {
  const profile = state.npc!.profiles[ownerId]!;
  const utility = createNpcUtilityContext(state, profile, at, 1);
  return refreshNpcLetters(refreshNpcPacts(state, profile, utility, at, 1), profile, utility, at);
}

/** The bot writes the player once; returns the world after that look. */
function invited(w: World): { state: SaveState; pact: NpcJointStrikeProposal } {
  const state = look(w.state, w.bot, START + MINUTE);
  const pact = playerInvitations(state)[0];
  assert.ok(pact, 'a bot with a target too strong alone and a friendly player writes him');
  return { state, pact };
}

const context = (state: SaveState, now: number) => ({ strategy: state.npcStrategy, now, targets: state.espionage?.targets });
const lettersOf = (state: SaveState, now: number) => personalLetters(state.command, state.profile.playerId, context(state, now));

test('a bot invites the player to a joint attack: target, arrival window and fleet size are on the letter', () => {
  const w = world('letter-invite');
  const { state, pact } = invited(w);
  assert.equal(pact.from, w.bot);
  assert.equal(pact.to, w.player);
  assert.equal(pact.terms.targetOwnerId, w.target);
  assert.ok((pact.terms.fromShips ?? 0) > 0, 'the bot says how big its fleet is');
  assert.ok(pact.terms.strikeAt >= START + MINUTE + NPC_LETTER_BALANCE.inviteMinLeadHours * HOUR, 'a person gets time to prepare');
  assert.ok(pact.expiresAt >= START + MINUTE + 3 * HOUR && pact.expiresAt <= START + MINUTE + NPC_LETTER_BALANCE.inviteAnswerHours * HOUR);
  const letter = lettersOf(state, START + 2 * MINUTE).find((item) => item.kind === 'bot-joint-strike')!;
  assert.ok(letter, 'the invitation is a letter in «Личные»');
  assert.deepEqual(letter.result, { label: 'Новое', tone: 'info' });
  assert.deepEqual(letter.answers.map((answer) => answer.kind), ['accept', 'decline']);
  assert.equal(letter.place?.planetId, w.targetPlanet, 'the target opens on the map');
  assert.match(letter.text, /Цель:/);
  assert.match(letter.text, /кораблей/);
  assert.match(letter.text, /Ваш флот ждут/);
  assert.equal(buildReportSheet(personalItem(state, letter.id, START + 2 * MINUTE)).actions.map((action) => action.kind).join(), 'accept,decline');
});

function personalItem(state: SaveState, id: string, now: number) {
  const item = buildReportsFeed([], { items: [] } as never, state.command, state.espionage, [], [], [], [], [], undefined, state.profile.playerId, {}, context(state, now)).find((entry) => entry.id === id);
  assert.ok(item, id);
  return item;
}

test('«Принять»: the bot really plans and launches its part, and the answer is remembered', () => {
  const w = world('letter-accept');
  const { state, pact } = invited(w);
  const outcome = answerNpcLetter(state, { kind: 'joint-strike', id: pact.proposalId }, 'accept', START + 30 * MINUTE);
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.reason);
  const accepted = outcome.state;
  assert.equal(playerInvitations(accepted)[0]!.status, 'accepted');
  const letter = lettersOf(accepted, START + 31 * MINUTE).find((item) => item.kind === 'bot-joint-strike')!;
  assert.equal(letter.result.label, 'Принято');
  assert.deepEqual(letter.answers.map((answer) => answer.kind), ['open_fleets']);
  // The bot's own next look drafts its plan of the agreed strike: its wave is real.
  const later = look(accepted, w.bot, START + 40 * MINUTE);
  const plan = (later.npcStrategy?.plans[w.bot] ?? []).find((item) => item.template === 'strike' && item.partner?.proposalId === pact.proposalId);
  assert.ok(plan && plan.template === 'strike', 'the bot drafted its part');
  assert.equal(plan.partner?.ownerId, w.player);
  assert.equal(plan.partner?.wave, 1);
  // Nobody else may be asked into a second strike meanwhile.
  const second = answerNpcLetter(accepted, { kind: 'joint-strike', id: pact.proposalId }, 'accept', START + 41 * MINUTE);
  assert.equal(second.ok, false);
});

test('«Отказаться»: the bot remembers it, answers in a line, and stays quiet for four days', () => {
  const w = world('letter-decline');
  const { state, pact } = invited(w);
  const before = npcRelationView(state, state.npc!.profiles[w.bot]!, w.player, START + 30 * MINUTE)!.regard;
  const outcome = answerNpcLetter(state, { kind: 'joint-strike', id: pact.proposalId }, 'decline', START + 30 * MINUTE);
  assert.ok(outcome.ok);
  const declined = outcome.state;
  const after = npcRelationView(declined, declined.npc!.profiles[w.bot]!, w.player, START + 30 * MINUTE)!.regard;
  assert.ok(after < before, `regard falls: ${before} -> ${after}`);
  const letters = lettersOf(declined, START + 31 * MINUTE);
  assert.equal(letters.find((item) => item.kind === 'bot-joint-strike')!.answers.length, 0, 'no live buttons after the answer');
  assert.equal(letters.find((item) => item.kind === 'bot-joint-strike')!.result.label, 'Вы отказались');
  assert.equal(letters.filter((item) => item.kind === 'bot-reply').length, 1, 'the bot writes back once');
  assert.equal(mayWritePlayer(declined, w.bot, START + 3 * 24 * HOUR), false, 'quiet for 96 hours after a refusal');
  assert.equal(mayWritePlayer(declined, w.bot, START + 5 * 24 * HOUR), true);
  // A second answer to a closed letter does nothing.
  assert.equal(answerNpcLetter(declined, { kind: 'joint-strike', id: pact.proposalId }, 'accept', START + 32 * MINUTE).ok, false);
});

test('a letter whose moment passed shows «Истекло», has no buttons, and cannot be answered', () => {
  const w = world('letter-expire');
  const { state, pact } = invited(w);
  const late = pact.expiresAt + MINUTE;
  const letter = lettersOf(state, late).find((item) => item.kind === 'bot-joint-strike')!;
  assert.deepEqual(letter.result, { label: 'Истекло', tone: 'neutral' });
  assert.equal(letter.answers.length, 0);
  assert.equal(answerNpcLetter(state, { kind: 'joint-strike', id: pact.proposalId }, 'accept', late).ok, false);
  // The bot closes it in its own look too (catch-up does the same thing in order).
  assert.equal(playerInvitations(look(state, w.bot, late))[0]!.status, 'expired');
});

test('the player keeps his word or not: the arrival counts, a no-show breaks it and the bot says so', () => {
  const w = world('letter-word');
  const { state, pact } = invited(w);
  const accepted = answerNpcLetter(state, { kind: 'joint-strike', id: pact.proposalId }, 'accept', START + 30 * MINUTE);
  assert.ok(accepted.ok);
  const strikeAt = pact.terms.strikeAt;
  const report = { attacker: { playerId: w.player }, defender: { playerId: w.target }, winner: 'attacker' } as BattleReport;
  // Outside the window nothing counts.
  assert.equal(playerInvitations(recordPlayerPactArrival(accepted.state, report, strikeAt - HOUR))[0]!.arrivals, undefined);
  // The bot came, the player did not: broken by the player.
  const botCame = recordNpcPactArrival(accepted.state, pact.proposalId, w.bot, { at: strikeAt, won: true, gain: 1, loss: 1 });
  const lateAt = strikeAt + 3 * pact.terms.toleranceMs + HOUR;
  const broken = look(botCame, w.bot, lateAt);
  const closed = playerInvitations(broken)[0]!;
  assert.equal(closed.status, 'broken');
  assert.equal(closed.by, w.player);
  assert.ok(npcLettersOf(broken).some((item) => item.kind === 'reply' && item.cause === 'no-show'), 'a reply letter follows');
  assert.ok(npcRelationView(broken, broken.npc!.profiles[w.bot]!, w.player, lateAt)!.reliability < 0.5, 'the bot remembers a broken promise');
  assert.equal(lettersOf(broken, lateAt).find((item) => item.kind === 'bot-joint-strike')!.result.label, 'Сорвано вами');
  // Both came: fulfilled.
  const both = recordPlayerPactArrival(botCame, report, strikeAt + 20 * MINUTE);
  assert.equal(playerInvitations(both)[0]!.status, 'fulfilled');
  assert.equal(lettersOf(both, strikeAt + HOUR).find((item) => item.kind === 'bot-joint-strike')!.result.label, 'Выполнено');
});

test('budget: one letter per bot per 48 h, four a day from all bots, three waiting at once', () => {
  const w = world('letter-budget');
  const record = (index: number, from: string, at: number, status: NpcLetterRecord['status'] = 'new'): NpcLetterRecord => ({ letterId: `x:${index}`, kind: 'ally-offer', from, createdAt: at, expiresAt: at + 24 * HOUR, status, ...(status === 'new' ? {} : { closedAt: at + HOUR }) });
  let state = w.state;
  assert.equal(mayWritePlayer(state, w.bot, START), true);
  state = withNpcLetter(state, record(1, w.bot, START, 'declined'));
  assert.equal(mayWritePlayer(state, w.bot, START + 47 * HOUR), false, 'the same bot waits');
  assert.equal(mayWritePlayer(state, 'other-bot', START + HOUR), true, 'another bot may write');
  state = withNpcLetter(withNpcLetter(withNpcLetter(state, record(2, 'b2', START)), record(3, 'b3', START)), record(4, 'b4', START));
  assert.equal(mayWritePlayer(state, 'b5', START + MINUTE), false, 'three waiting is the most');
  // Answered ones free the slots, but the day cap holds.
  state = [2, 3].reduce((current, index) => withNpcLetter(current, record(index, `b${index}`, START, 'declined')), state);
  assert.equal(mayWritePlayer(state, 'b5', START + 2 * HOUR), false, 'four letters within a day is the most');
  assert.equal(mayWritePlayer(state, 'b5', START + 25 * HOUR), true);
});

test('over ten days an unanswering player gets a trickle, never a flood, and every letter expires', () => {
  const w = world('letter-trickle');
  let state = w.state;
  const seen = new Set<string>();
  for (let step = 1; step <= 10 * 48; step += 1) {
    const at = START + step * 30 * MINUTE;
    state = look(state, w.bot, at);
    for (const proposal of playerInvitations(state)) seen.add(proposal.proposalId);
    for (const record of npcLettersOf(state)) seen.add(record.letterId);
    const open = lettersOf(state, at).filter((item) => item.answers.some((answer) => answer.kind === 'accept')).length;
    assert.ok(open <= NPC_LETTER_BALANCE.openMax, `at most ${NPC_LETTER_BALANCE.openMax} waiting at once`);
  }
  assert.ok(seen.size <= 10 / 2 + 1, `one bot writes at most every 48 h: ${seen.size} letters in ten days`);
  state = settleNpcLetters(state, START + 11 * 24 * HOUR);
  assert.equal(lettersOf(state, START + 11 * 24 * HOUR).filter((item) => item.answers.length > 0).length, 0, 'nothing is left open');
});

test('a bot in the player\'s alliance asks for help when attacked, and the player\'s deployment keeps or breaks the promise', () => {
  const w = world('letter-help');
  const player = w.player;
  const created = createAlliance(w.state.command, { ownerId: player, displayName: 'Letters', settings: { name: 'Help Tests', tag: 'HLP', motto: '', description: '', emblem: w.state.command.alliances[0]?.emblem ?? ({} as never) } }, { now: START, random: () => 0.5 });
  assert.ok(created.ok, created.ok ? '' : created.message);
  const allianceId = created.allianceId;
  const members = created.state.alliances.map((alliance) => (alliance.id === allianceId ? { ...alliance, members: [...alliance.members, { ...alliance.members[0]!, ownerId: w.bot, displayName: 'Ally' }] } : alliance));
  let state: SaveState = { ...w.state, command: { ...created.state, alliances: members } };
  const attack = { id: 'enemy-flight', requestId: 'r', ownerSide: 'npc', ownerId: w.target, missionId: 'attack', phase: 'outbound', departedAt: START, arrivalAt: START + 2 * HOUR,
    destinationPlanetId: w.botPlanet } as unknown as SaveState['flights']['records'][number];
  state = { ...state, flights: { ...state.flights, records: [...state.flights.records, attack] } };
  const asked = look(state, w.bot, START + MINUTE);
  const help = npcLettersOf(asked).find((item) => item.kind === 'help-request');
  assert.ok(help, 'an ally under attack asks');
  const accepted = answerNpcLetter(asked, { kind: 'help-request', id: help.letterId }, 'accept', START + 5 * MINUTE);
  assert.ok(accepted.ok);
  const deploy = { id: 'deploy', requestId: 'd', ownerSide: 'player', ownerId: player, missionId: 'deployment', phase: 'outbound', departedAt: START + 10 * MINUTE, arrivalAt: START + HOUR,
    destinationPlanetId: w.botPlanet } as unknown as SaveState['flights']['records'][number];
  const helped = settleNpcLetters({ ...accepted.state, flights: { ...accepted.state.flights, records: [...accepted.state.flights.records, deploy] } }, START + 2 * HOUR + MINUTE);
  assert.equal(npcLettersOf(helped).find((item) => item.letterId === help.letterId)!.status, 'kept');
  const failed = settleNpcLetters(accepted.state, START + 2 * HOUR + MINUTE);
  assert.equal(npcLettersOf(failed).find((item) => item.letterId === help.letterId)!.status, 'failed');
  assert.ok(npcLettersOf(failed).some((item) => item.kind === 'reply'), 'a broken promise is answered');
});

test('letters survive the save format: records validate, old saves without them still load', () => {
  const w = world('letter-save');
  const { state, pact } = invited(w);
  const declined = answerNpcLetter(state, { kind: 'joint-strike', id: pact.proposalId }, 'decline', START + 30 * MINUTE);
  assert.ok(declined.ok);
  const strategy = JSON.parse(JSON.stringify(declined.state.npcStrategy));
  assert.ok(isNpcStrategyState(strategy));
  assert.ok((strategy.letters ?? []).every(isNpcLetterRecord));
  assert.equal(JSON.stringify(migrateNpcStrategyState(strategy)), JSON.stringify(strategy));
  const { letters: _letters, ...old } = strategy;
  assert.ok(isNpcStrategyState(old), 'a save without letters is valid');
  assert.equal(isNpcStrategyState({ ...strategy, letters: [{ letterId: 'x' }] }), false, 'a half-written record is dropped, not trusted');
});

test('an alliance leader invites a player without an alliance; «Принять» joins through the ordinary commands, «Отказаться» is remembered', () => {
  const w = world('letter-ally');
  const created = createAlliance(w.state.command, { ownerId: w.bot, displayName: 'Leader', settings: { name: 'Offer Tests', tag: 'OFR', motto: '', description: '', emblem: w.state.command.alliances[0]?.emblem ?? ({} as never) } }, { now: START, random: () => 0.5 });
  assert.ok(created.ok, created.ok ? '' : created.message);
  // No report of a target: the bot has no strike to propose, so its one letter in 48 hours is the offer.
  const state: SaveState = { ...w.state, command: created.state, espionage: { ...w.state.espionage!, reports: [] } };
  const asked = look(state, w.bot, START + MINUTE);
  const offer = npcLettersOf(asked).find((item) => item.kind === 'ally-offer');
  assert.ok(offer, 'a leader with room writes to a strong player who has no alliance');
  assert.equal(offer.allianceId, created.allianceId);
  assert.match(lettersOf(asked, START + 2 * MINUTE).find((item) => item.kind === 'bot-ally-offer')!.text, /OFR/);
  const joined = answerNpcLetter(asked, { kind: 'ally-offer', id: offer.letterId }, 'accept', START + 5 * MINUTE);
  assert.ok(joined.ok, joined.ok ? '' : joined.reason);
  assert.ok(joined.state.command.alliances.find((alliance) => alliance.id === created.allianceId)!.members.some((member) => member.ownerId === w.player), 'the player is a member now');
  assert.equal(lettersOf(joined.state, START + 6 * MINUTE).find((item) => item.kind === 'bot-ally-offer')!.result.label, 'Вы в союзе');
  const refused = answerNpcLetter(asked, { kind: 'ally-offer', id: offer.letterId }, 'decline', START + 5 * MINUTE);
  assert.ok(refused.ok);
  assert.equal(selectMember(refused.state, w.player), false, 'declining joins nothing');
  assert.equal(mayWritePlayer(refused.state, w.bot, START + 2 * 24 * HOUR), false, 'the leader stays quiet after a refusal');
  // A player already in an alliance gets no offers.
  const member = look(joined.state, w.bot, START + 80 * HOUR);
  assert.equal(npcLettersOf(member).filter((item) => item.kind === 'ally-offer').length, 1);
});

function selectMember(state: SaveState, ownerId: string): boolean {
  return state.command.alliances.some((alliance) => alliance.members.some((member) => member.ownerId === ownerId));
}
