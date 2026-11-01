import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import {
  campaignIdFromSalt,
  createPersonaRegistry,
  findSeries,
  parsePersonaRegistry,
  PERSONA_LIMITS,
  PERSONA_TRAIT_DRIFT_MAX,
  PLAYER_PERSONA_ID,
  selectPersonas,
  type PersonaRegistry,
} from '../domain/npc/persona-registry.ts';
import { createNpcState, NPC_TRAIT_NAMES, validateNpcState } from '../domain/npc/state.ts';
import { weightNpcAction } from '../domain/npc/autonomy-policy.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { SaveState } from './contracts.ts';
import { getNpcDiplomacyCandidates } from './npc-diplomacy.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { bindNewCampaignToSeries, campaignIdOf, isSeriesCampaign, settleCampaign } from './npc-series.ts';
import { readPersonaRegistry, writePersonaRegistry, type PersonaBridge } from './persona-store.ts';
import { createInitialSaveState } from './persistence.ts';
import { createSlot, exportSaveSlot, type SlotStorage } from './slots.ts';

const NOW = Date.UTC(2026, 10, 1, 12);
const DAY = 24 * 60 * 60 * 1000;
const PERSONA_ID_TEXT = /\bp-[0-9a-f]{16}\b/;

function world(seed: string, npcCount = 12, playerName = 'Dendrilion'): SaveState {
  const config = createDefaultNewGameConfig({ seed, playerName });
  const state = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount } });
  // A fixed salt in place of the crypto one, so that one seed + version replays exactly.
  return { ...state, npc: createNpcState(getNpcOwnerIds(state.espionage!.targets, state.profile.playerId), , NOW) };
}

const owners = (state: SaveState) => Object.keys(state.npc!.profiles).sort();
const nickOf = (state: SaveState, ownerId: string) => Object.values(state.espionage!.targets ?? {}).find((target) => target.ownerId === ownerId)!.ownerName;
const planetOf = (state: SaveState, ownerId: string) => Object.values(state.espionage!.targets ?? {}).find((target) => target.ownerId === ownerId)!;

function battle(id: string, attacker: string, defender: string, winner: 'attacker' | 'defender'): BattleReport {
  return {
    id, missionType: 'attack', winner, timestamp: new Date(NOW + DAY).toISOString(),
    attacker: { playerId: attacker }, defender: { playerId: defender },
    defenderForce: { stacks: [], defenses: [] }, resources: { metal: 0, minerals: 0, gas: 0 },
  } as unknown as BattleReport;
}

/** `helper` delivered aid to `helped`, the way the save records it. */
function withAid(state: SaveState, helper: string, helped: string, deliveries = 1): SaveState {
  const requestId = `request-${helper}-${helped}`;
  return {
    ...state,
    command: {
      ...state.command,
      requests: [...state.command.requests, { id: requestId, authorOwnerId: helped } as SaveState['command']['requests'][number]],
      aidEvents: [...state.command.aidEvents, ...Array.from({ length: deliveries }, (_, index) => ({
        id: `aid_delivered:${requestId}:${index}`, kind: 'aid_delivered' as const, at: NOW + DAY, allianceId: 'a', requestId, actorOwnerId: helper, audience: 'alliance' as const,
      }))],
    },
  };
}

function withJointRaid(state: SaveState, flown: string[]): SaveState {
  const raid = { id: `raid-${flown.join('-')}`, status: 'resolved', result: { winner: 'attacker', attackerOwnerIds: flown } };
  return { ...state, sunRaid: { ...state.sunRaid!, raids: [...(state.sunRaid?.raids ?? []), raid as never] } };
}

function withBattles(state: SaveState, reports: BattleReport[]): SaveState {
  return { ...state, combat: { ...state.combat, reports: [...state.combat.reports, ...reports] } };
}

function firstRound(seed = 'ROUNDA01', npcCount = 12) {
  const state = world(seed, npcCount);
  const fold = settleCampaign(createPersonaRegistry(), state, 'gate', NOW + 2 * DAY)!;
  return { state, fold, seriesId: fold.seriesId };
}

/** Which persona plays which owner: only the registry can say. */
function bindingsOf(registry: PersonaRegistry, seriesId: string, state: SaveState): Record<string, string> {
  const open = findSeries(registry, seriesId)!.open.find((item) => item.campaignId === campaignIdOf(state))!;
  return { ...open.bindings };
}

test('the first finished campaign founds a series out of its own NPC, without their worlds', () => {
  const { state, fold, seriesId } = firstRound();
  const series = findSeries(fold.registry, seriesId)!;
  assert.equal(fold.changed, true);
  assert.equal(series.rounds, 1);
  assert.equal(series.personas.length, 12);
  assert.ok(series.personas.every((persona) => persona.campaigns === 1 && PERSONA_ID_TEXT.test(persona.personaId)));
  // Nothing of a world crosses over: not its coordinates, resources, planets or nicknames.
  const text = JSON.stringify(fold.registry);
  for (const key of ['coordinate', 'resources', 'fleet', 'planet', 'galaxy', 'metal', 'ownerName']) assert.ok(!text.includes(`"${key}"`), key);
  for (const ownerId of owners(state)) assert.ok(!text.includes(nickOf(state, ownerId)));
});

test('T-ID-01: the same persona under another nickname and owner; ids stay out of the save, its export and the screens', () => {
  const { fold, seriesId, state: roundA } = firstRound('ROUNDA01');
  const bound = bindNewCampaignToSeries(fold.registry, seriesId, world('ROUNDB02', 12, 'НовыйНик'), NOW + 3 * DAY)!;
  const bindings = bindingsOf(bound.registry, seriesId, bound.state);
  assert.equal(Object.keys(bindings).length, 12);
  assert.equal(new Set(Object.values(bindings)).size, 12);
  // Character carries over; only the two population axes are re-spread in the persona's own order.
  const personaById = new Map(findSeries(fold.registry, seriesId)!.personas.map((persona) => [persona.personaId, persona]));
  let movedOwner = 0;
  let changedNick = 0;
  for (const [ownerId, personaId] of Object.entries(bindings)) {
    const persona = personaById.get(personaId)!;
    const profile = bound.state.npc!.profiles[ownerId]!;
    for (const trait of NPC_TRAIT_NAMES) if (trait !== 'mechanicsKnowledge') assert.equal(profile.traits[trait], persona.traits[trait], trait);
    assert.equal(profile.session.timezoneOffsetMinutes, persona.timezoneOffsetMinutes);
    const founder = owners(roundA).find((id) => roundA.npc!.profiles[id]!.traits.aggression === persona.traits.aggression
      && roundA.npc!.profiles[id]!.traits.adaptability === persona.traits.adaptability)!;
    if (founder !== ownerId) movedOwner += 1;
    if (nickOf(roundA, founder) !== nickOf(bound.state, ownerId)) changedNick += 1;
  }
  assert.ok(movedOwner >= 6, `owner numbers say nothing about personas (${movedOwner}/12 moved)`);
  assert.ok(changedNick >= 6, `nicknames say nothing about personas (${changedNick}/12 changed)`);
  assert.equal(bound.state.profile.displayName, 'НовыйНик');
  assert.ok(isSeriesCampaign(bound.state));
  assert.ok(validateNpcState(bound.state.npc));

  const text = JSON.stringify(bound.state);
  assert.ok(!PERSONA_ID_TEXT.test(text), 'a persona id leaked into the save');
  assert.ok(!text.includes(PLAYER_PERSONA_ID));
  assert.ok(!text.includes(seriesId));
  const data = new Map<string, string>();
  const storage: SlotStorage = {
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)); }, removeItem: (key) => { data.delete(key); },
    key: (position) => [...data.keys()][position] ?? null, get length() { return data.size; },
  };
  const created = createSlot(bound.state, 'Раунд 2', { now: NOW, storage });
  assert.ok(created.ok && created.slot);
  const exported = exportSaveSlot(created.slot!.id, storage, NOW);
  assert.ok(exported.ok);
  assert.ok(!PERSONA_ID_TEXT.test(exported.ok ? exported.text : ''), 'a persona id leaked into the export');
});

test('T-ID-02: a new match is a new world; old relations know no planets and create no knowledge', () => {
  const { state: roundA, fold, seriesId } = firstRound('ROUNDA01');
  const clean = world('ROUNDB02');
  const bound = bindNewCampaignToSeries(fold.registry, seriesId, clean, NOW + 3 * DAY)!;
  // Binding touches character and memory only: the generated world stays byte for byte.
  assert.deepEqual(bound.state.espionage, clean.espionage);
  assert.deepEqual(bound.state.planets, clean.planets);
  assert.deepEqual(bound.state.command, clean.command);
  assert.deepEqual(bound.state.npcScience, clean.npcScience);
  assert.notDeepEqual(planetOf(bound.state, owners(clean)[0]!).coordinate, planetOf(roundA, owners(clean)[0]!).coordinate);
  for (const profile of Object.values(bound.state.npc!.profiles)) {
    assert.deepEqual(profile.memory, []);
    assert.deepEqual(profile.knowledge, {});
    assert.equal(profile.grudges, undefined);
    assert.equal(profile.cursor, null);
  }
  assert.ok(bound.state.espionage!.reports === undefined || Object.keys(bound.state.espionage!.reports).length === 0);
});

test('T-ID-03: without the switch the population is clean; two series never mix, even with the same owner ids', () => {
  const a = firstRound('SERIESAA');
  const hurt = world('SERIESBB');
  const [first, second] = owners(hurt);
  const b = settleCampaign(a.fold.registry, withAid(hurt, first!, second!, 4), 'gate', NOW + 2 * DAY)!;
  assert.notEqual(b.seriesId, a.seriesId);
  assert.equal(b.registry.series.length, 2);
  const seriesA = findSeries(b.registry, a.seriesId)!;
  const seriesB = findSeries(b.registry, b.seriesId)!;
  assert.deepEqual(seriesA, findSeries(a.fold.registry, a.seriesId));
  const idsA = new Set(seriesA.personas.map((persona) => persona.personaId));
  assert.ok(seriesB.personas.every((persona) => !idsA.has(persona.personaId)));
  assert.ok(seriesA.personas.every((persona) => persona.relations.length === 0), 'help in another series reached this one');

  // A plain new game next to an existing series: nothing inherited, nothing bound, the same as before.
  const plain = world('PLAINGME');
  assert.equal(isSeriesCampaign(plain), false);
  assert.ok(Object.values(plain.npc!.profiles).every((profile) => profile.inherited === undefined));
  assert.equal(JSON.stringify(plain), JSON.stringify({ ...plain }));
  // Finishing it founds its own series: it joins none of the existing ones.
  const third = settleCampaign(b.registry, plain, 'gate', NOW + 3 * DAY)!;
  assert.ok(![a.seriesId, b.seriesId].includes(third.seriesId));
  assert.deepEqual(findSeries(third.registry, a.seriesId), seriesA);
});

test('T-MEM-01: help in round A means more trust in round B, but no alliance: acceptance is still a choice', () => {
  const roundA = world('ROUNDA01');
  const [helper, helped] = owners(roundA);
  const fold = settleCampaign(createPersonaRegistry(), withAid(roundA, helper!, helped!, 4), 'gate', NOW + 2 * DAY)!;
  const series = findSeries(fold.registry, fold.seriesId)!;
  const relationHolder = series.personas.find((persona) => persona.relations.some((relation) => relation.helpReceived === 4))!;
  const relation = relationHolder.relations.find((item) => item.helpReceived === 4)!;
  assert.ok(relation.trust > 0.4 && relation.affinity > 0.2 && relation.resentment === 0);
  // Directed: the one who helped does not start trusting more because of it.
  const giver = series.personas.find((persona) => persona.personaId === relation.other)!;
  assert.equal(giver.relations.find((item) => item.other === relationHolder.personaId)?.helpGiven, 4);
  assert.equal(giver.relations.find((item) => item.other === relationHolder.personaId)?.trust, 0);

  const bound = bindNewCampaignToSeries(fold.registry, fold.seriesId, world('ROUNDB02'), NOW + 3 * DAY)!;
  const bindings = bindingsOf(bound.registry, fold.seriesId, bound.state);
  const ownerOf = (personaId: string) => Object.keys(bindings).find((ownerId) => bindings[ownerId] === personaId)!;
  const newHelped = ownerOf(relationHolder.personaId);
  const newHelper = ownerOf(relation.other);
  const inherited = bound.state.npc!.profiles[newHelped]!.inherited!.relations[newHelper]!;
  assert.ok(inherited.trust > 0 && inherited.trust < relation.trust, 'remembered, with lower confidence');
  // Nothing is decided for them: no alliance, no membership, no application.
  assert.deepEqual(bound.state.command.alliances, []);
  assert.deepEqual(bound.state.command.applications, []);

  // Trust tilts the answer to a real application; low cooperation can still refuse.
  const leader = bound.state.npc!.profiles[newHelped]!;
  const state = {
    ...bound.state,
    command: {
      ...bound.state.command,
      alliances: [{ id: 'all-1', leaderOwnerId: newHelped, deputyOwnerId: null, members: [{ ownerId: newHelped, role: 'leader' }], name: 'Союз', tag: 'СЮЗ', motto: '', description: '', emblem: {} } as never],
      applications: [{ id: 'app-1', allianceId: 'all-1', ownerId: newHelper, status: 'pending' } as never],
    },
  } as SaveState;
  const hallTargets = { ...state.espionage!.targets };
  for (const [id, target] of Object.entries(hallTargets)) if (target.ownerId === newHelped) hallTargets[id] = { ...target, buildings: { ...target.buildings, 'planetary-government': 1 } };
  const withHall = { ...state, espionage: { ...state.espionage!, targets: hallTargets } } as SaveState;
  const answer = (cooperation: number, keep: boolean) => getNpcDiplomacyCandidates(withHall, {
    ...leader, traits: { ...leader.traits, cooperation, socialStyle: 0 },
    ...(keep ? {} : { inherited: undefined }),
  }, NOW + 4 * DAY).find((candidate) => candidate.kind.endsWith('-application'))!.kind;
  const threshold = 0.5 - 0.15 * inherited.trust / 2;
  assert.equal(answer(threshold, false), 'reject-application');
  assert.equal(answer(threshold, true), 'accept-application');
  assert.equal(answer(0.1, true), 'reject-application');
});

test('T-MEM-03: a repeated outcome, a reload and a second save of one campaign change nothing', () => {
  const roundA = withAid(world('ROUNDA01'), owners(world('ROUNDA01'))[0]!, owners(world('ROUNDA01'))[1]!, 3);
  const once = settleCampaign(createPersonaRegistry(), roundA, 'gate', NOW + 2 * DAY)!;
  assert.equal(once.changed, true);
  const twice = settleCampaign(once.registry, roundA, 'gate', NOW + 9 * DAY)!;
  assert.equal(twice.changed, false);
  assert.equal(twice.registry, once.registry);
  assert.equal(twice.seriesId, once.seriesId);
  // The same campaign after a reload, even if the facts grew or it ended differently.
  const reloaded = JSON.parse(JSON.stringify(roundA)) as SaveState;
  const again = settleCampaign(once.registry, withAid(reloaded, owners(reloaded)[0]!, owners(reloaded)[2]!), 'left', NOW + 9 * DAY)!;
  assert.equal(again.changed, false);
  assert.equal(again.registry, once.registry);
  // One battle report listed twice counts once.
  const [one, two] = owners(roundA);
  const report = battle('r-1', one!, two!, 'attacker');
  const doubled = settleCampaign(createPersonaRegistry(), withBattles(roundA, [report, report]), 'gate', NOW)!;
  const results = findSeries(doubled.registry, doubled.seriesId)!.personas.flatMap((persona) => persona.results);
  assert.equal(results.reduce((sum, result) => sum + result.attackWins, 0), 1);
  // A round of a series: a repeat neither re-binds nor re-counts.
  const bound = bindNewCampaignToSeries(once.registry, once.seriesId, world('ROUNDB02'), NOW + 3 * DAY)!;
  const second = settleCampaign(bound.registry, bound.state, 'gate', NOW + 4 * DAY)!;
  const third = settleCampaign(second.registry, bound.state, 'gate', NOW + 5 * DAY)!;
  assert.equal(third.registry, second.registry);
  const series = findSeries(third.registry, once.seriesId)!;
  assert.equal(series.rounds, 2);
  assert.ok(series.personas.every((persona) => persona.campaigns === 2));
  assert.deepEqual(series.open, []);
});

function playRound(registry: PersonaRegistry, seriesId: string | null, seed: string, at: number) {
  const fresh = world(seed);
  const bound = seriesId ? bindNewCampaignToSeries(registry, seriesId, fresh, at)! : { state: fresh, registry, round: 1 };
  const [one, two, three] = owners(bound.state);
  // The same story every round: `one` keeps winning attacks on `two` and `three` helps `one`.
  const reports = Array.from({ length: 6 }, (_, index) => battle(`${seed}-${index}`, one!, two!, 'attacker'));
  const played = withJointRaid(withAid(withBattles(bound.state, reports), three!, one!, 2), [one!, three!]);
  return settleCampaign(bound.registry, played, 'gate', at + DAY)!;
}

test('two campaigns in a row keep character and lessons, reproducibly', () => {
  const run = () => {
    const a = playRound(createPersonaRegistry(), null, 'ROUNDA01', NOW);
    const b = playRound(a.registry, a.seriesId, 'ROUNDB02', NOW + 2 * DAY);
    return { a, b };
  };
  const first = run();
  assert.equal(JSON.stringify(first.b.registry), JSON.stringify(run().b.registry), 'one seed + version gives one registry');
  const before = new Map(findSeries(first.a.registry, first.a.seriesId)!.personas.map((persona) => [persona.personaId, persona]));
  const after = findSeries(first.b.registry, first.b.seriesId)!.personas;
  assert.equal(after.length, 12);
  for (const persona of after) {
    assert.equal(persona.campaigns, 2);
    assert.equal(persona.results.length, 2);
    const old = before.get(persona.personaId)!;
    for (const trait of NPC_TRAIT_NAMES) {
      if (trait === 'mechanicsKnowledge') continue;
      assert.ok(Math.abs(persona.traits[trait] - old.traits[trait]) <= PERSONA_TRAIT_DRIFT_MAX + 1e-9, `${trait} drifted too far`);
    }
    assert.ok(persona.lessons.length <= PERSONA_LIMITS.lessons && persona.relations.length <= PERSONA_LIMITS.relations);
    assert.ok(!PERSONA_ID_TEXT.test(JSON.stringify(persona.lessons)));
  }
  // The winner of round A learned something, and round B starts with it.
  const learned = [...before.values()].find((persona) => persona.lessons.length > 0)!;
  assert.ok(learned.lessons[0]!.evidence >= 3 && learned.prefs.attack! > 0);
  const roundB = bindNewCampaignToSeries(first.a.registry, first.a.seriesId, world('ROUNDB02'), NOW)!;
  const carrier = Object.values(roundB.state.npc!.profiles).find((profile) => profile.inherited!.lessons.length > 0)!;
  assert.ok(carrier.inherited!.prefs.attack! > 0);
  assert.ok(weightNpcAction(carrier, 'attack') > weightNpcAction({ ...carrier, inherited: undefined }, 'attack'), 'the lesson reaches decisions');
});

test('lessons weigh less after a balance change', () => {
  const a = playRound(createPersonaRegistry(), null, 'ROUNDA01', NOW);
  const stale = JSON.parse(JSON.stringify(a.registry)) as { series: { personas: { lastCombatVersion: string; lessons: { combatVersion: string }[] }[] }[] };
  for (const persona of stale.series[0]!.personas) {
    persona.lastCombatVersion = 'older-combat';
    for (const lesson of persona.lessons) lesson.combatVersion = 'older-combat';
  }
  const effect = (registry: PersonaRegistry) => Object.values(bindNewCampaignToSeries(registry, a.seriesId, world('ROUNDB02'), NOW)!.state.npc!.profiles)
    .map((profile) => profile.inherited!).find((inherited) => inherited.lessons.length)!;
  const fresh = effect(a.registry);
  const old = effect(stale as unknown as PersonaRegistry);
  assert.ok(Math.abs(old.lessons[0]!.effect - fresh.lessons[0]!.effect / 2) < 1e-3);
  assert.ok(Math.abs(old.prefs.attack! - fresh.prefs.attack! / 2) < 1e-3);
});

test('a smaller world takes the most connected personas and some random ones, deterministically; a larger one adds new faces', () => {
  const roundA = world('BIGROUND', 20);
  const ids = owners(roundA);
  // A clique of five helps each other; nobody else knows anybody.
  let played = roundA;
  for (const from of ids.slice(0, 5)) for (const to of ids.slice(0, 5)) if (from !== to) played = withAid(played, from, to, 2);
  const fold = settleCampaign(createPersonaRegistry(), played, 'gate', NOW)!;
  const series = findSeries(fold.registry, fold.seriesId)!;
  const clique = new Set(series.personas.filter((persona) => persona.relations.length > 0).map((persona) => persona.personaId));
  assert.equal(clique.size, 5);
  const picks = (salt: string) => selectPersonas(series, 10, salt);
  assert.deepEqual(picks('salt-1'), picks('salt-1'));
  assert.equal(new Set(picks('salt-1')).size, 10);
  // 70% connected: the clique comes first whatever the salt; the random part differs.
  for (const salt of ['salt-1', 'salt-2', 'salt-3']) assert.ok(picks(salt).slice(0, 5).every((id) => clique.has(id)), salt);
  assert.notDeepEqual(new Set(picks('salt-1')), new Set(picks('salt-2')));

  const small = bindNewCampaignToSeries(fold.registry, fold.seriesId, world('SMALLONE', 10), NOW)!;
  assert.equal(Object.keys(bindingsOf(small.registry, fold.seriesId, small.state)).length, 10);
  // The owner's mix holds whatever the size: skill and activity stay spread evenly.
  const skills = Object.values(small.state.npc!.profiles).map((profile) => profile.traits.mechanicsKnowledge).sort((left, right) => left - right);
  skills.forEach((skill, slot) => assert.ok(skill >= slot / 10 && skill <= (slot + 1) / 10));

  const big = bindNewCampaignToSeries(fold.registry, fold.seriesId, world('BIGGERON', 30), NOW)!;
  assert.equal(Object.keys(bindingsOf(big.registry, fold.seriesId, big.state)).length, 20);
  const grown = settleCampaign(big.registry, big.state, 'gate', NOW + DAY)!;
  assert.equal(findSeries(grown.registry, fold.seriesId)!.personas.length, 30);
});

test('leaving a series folds what happened; the Gate of that world later does not count twice', () => {
  const a = firstRound();
  const bound = bindNewCampaignToSeries(a.fold.registry, a.seriesId, world('ROUNDB02'), NOW)!;
  const left = settleCampaign(bound.registry, bound.state, 'left', NOW + DAY)!;
  const series = findSeries(left.registry, a.seriesId)!;
  assert.equal(series.rounds, 2);
  assert.ok(series.personas.every((persona) => persona.results.at(-1)!.kind === 'left' && persona.results.at(-1)!.won === false));
  assert.equal(settleCampaign(left.registry, bound.state, 'gate', NOW + 2 * DAY)!.changed, false);
});

test('the campaign id follows the salt, so copies of a save are one campaign and a restart is another', () => {
  const state = world('ROUNDA01');
  assert.equal(campaignIdOf(state), campaignIdOf(JSON.parse(JSON.stringify(state)) as SaveState));
  const config = createDefaultNewGameConfig({ seed: 'ROUNDA01' });
  assert.notEqual(campaignIdOf(createInitialSaveState('production', NOW, config)), campaignIdOf(createInitialSaveState('production', NOW, config)));
  assert.ok(!campaignIdOf(state)!.includes(state.npc!.personaSalt));
  assert.equal(campaignIdFromSalt('a'), campaignIdFromSalt('a'));
});

const require = createRequire(import.meta.url);
const { readPersonaFile, writePersonaFile } = require('../../electron/persona-file.cjs') as {
  readPersonaFile: (dir: string) => { text: string | null; backup: string | null };
  writePersonaFile: (dir: string, text: string) => void;
};

test('the file: atomic write, a backup of the previous version, damage and newer versions left alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asterion-personas-'));
  try {
    const bridge: PersonaBridge = { read: () => readPersonaFile(dir), write: (text) => writePersonaFile(dir, text) };
    assert.deepEqual(readPersonaRegistry(bridge), { status: 'ok', registry: createPersonaRegistry(), recovered: false });
    const { fold } = firstRound();
    assert.deepEqual(writePersonaRegistry(fold.registry, bridge), { ok: true });
    const read = readPersonaRegistry(bridge);
    assert.ok(read.status === 'ok' && !read.recovered);
    assert.deepEqual(read.status === 'ok' ? read.registry : null, JSON.parse(JSON.stringify(fold.registry)));
    assert.equal(readPersonaFile(dir).backup, null);
    writePersonaRegistry(createPersonaRegistry(), bridge);
    assert.deepEqual(JSON.parse(readPersonaFile(dir).backup!), JSON.parse(JSON.stringify(fold.registry)));
    assert.ok(readdirSync(dir).every((name) => !name.endsWith('.tmp')));

    // The main file damaged: the backup answers, and the next write keeps it as the good copy.
    writeFileSync(join(dir, 'personas.v1.json'), '{broken');
    const recovered = readPersonaRegistry(bridge);
    assert.ok(recovered.status === 'ok' && recovered.recovered);
    writePersonaRegistry(createPersonaRegistry(), bridge);
    assert.ok(parsePersonaRegistry(readPersonaFile(dir).backup!).ok);
    assert.equal(readFileSync(join(dir, 'personas.v1.damaged.json'), 'utf8'), '{broken');

    // A registry of a newer game: not read as ours, not overwritten.
    const newer = JSON.stringify({ version: 99, series: [] });
    writeFileSync(join(dir, 'personas.v1.json'), newer);
    assert.equal(readPersonaRegistry(bridge).status, 'unreadable');
    assert.equal(writePersonaRegistry(createPersonaRegistry(), bridge).ok, false);
    assert.equal(readPersonaFile(dir).text, newer);

    assert.throws(() => writePersonaFile(dir, 'not json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the browser has no registry and says so', () => {
  assert.deepEqual(readPersonaRegistry(null), { status: 'unavailable' });
  assert.equal(writePersonaRegistry(createPersonaRegistry(), null).ok, false);
});

test('a malformed registry is refused, field by field', () => {
  const { fold } = firstRound();
  const good = JSON.parse(JSON.stringify(fold.registry));
  assert.ok(parsePersonaRegistry(JSON.stringify(good)).ok);
  const broken = JSON.parse(JSON.stringify(good));
  broken.series[0].personas[0].traits.aggression = 7;
  assert.deepEqual(parsePersonaRegistry(JSON.stringify(broken)), { ok: false, reason: 'corrupt' });
  const doubled = JSON.parse(JSON.stringify(good));
  doubled.series[0].personas[1].personaId = doubled.series[0].personas[0].personaId;
  assert.deepEqual(parsePersonaRegistry(JSON.stringify(doubled)), { ok: false, reason: 'corrupt' });
  assert.deepEqual(parsePersonaRegistry('[]'), { ok: false, reason: 'corrupt' });
});
