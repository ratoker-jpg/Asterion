import assert from 'node:assert/strict';
import test from 'node:test';

import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createAlliance, applyToAlliance, acceptApplication } from '../domain/command/membership.ts';
import { declareWar, proposeTruce } from '../domain/command/diplomacy.ts';
import { MAX_ALLIANCE_MEMBERS } from '../domain/command/catalog.ts';
import type { SaveState } from './contracts.ts';
import { createInitialSaveState } from './persistence.ts';
import { applyNpcDiplomacyAction, getNpcDiplomacyCandidates } from './npc-diplomacy.ts';

const NOW = Date.UTC(2026, 9, 20, 12);
const SETTINGS = { name: 'Союз Тест', tag: 'TST', motto: '', description: '', emblem: { glyph: 'starforge' as const, accent: 'cyan' as const } };

function campaign(seed: string, npcCount = 12): SaveState {
  const config = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Игрок' });
  const state = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount } });
  const targets = Object.values(state.espionage!.targets!);
  const ownerIds = [...new Set(targets.filter((target) => target.kind === 'npc').map((target) => target.ownerId))].sort();
  const npc = createNpcState(ownerIds, `diplomacy:${seed}`, NOW);
  const withHallTargets = Object.fromEntries(Object.entries(state.espionage!.targets!).map(([id, target]) => [id,
    target.kind === 'npc' && target.ownerId === ownerIds[0]
      ? { ...target, buildings: { ...target.buildings, 'planetary-government': 1 } }
      : target,
  ]));
  return { ...state, npc, espionage: { ...state.espionage!, targets: withHallTargets } };
}

function firstNpc(state: SaveState) {
  const ownerId = Object.keys(state.npc!.profiles).sort()[0]!;
  return { ownerId, profile: state.npc!.profiles[ownerId]! };
}

function createPlayerAlliance(state: SaveState) {
  const made = createAlliance(state.command, {
    ownerId: state.profile.playerId,
    displayName: state.profile.displayName,
    settings: SETTINGS,
  }, { now: NOW, random: () => 0.25 });
  assert.equal(made.ok, true);
  return { ...state, command: made.state };
}

function addNpcHall(state: SaveState, ownerId: string): SaveState {
  const target = Object.values(state.espionage!.targets!).find((item) => item.ownerId === ownerId && item.kind === 'npc');
  assert.ok(target);
  return {
    ...state,
    espionage: {
      ...state.espionage!,
      targets: {
        ...state.espionage!.targets!,
        [target.id]: { ...target, buildings: { ...target.buildings, 'planetary-government': 1 } },
      },
    },
  };
}

test('NPC founding uses its public name and persists one real owner membership', () => {
  const initial = campaign('NPCDIPLOCREATE1');
  const { ownerId, profile } = firstNpc(initial);
  const state = addNpcHall(initial, ownerId);
  const publicName = Object.values(state.espionage!.targets!).find((target) => target.ownerId === ownerId)!.ownerName;
  const candidate = getNpcDiplomacyCandidates(state, profile, NOW).find((item) => item.kind === 'create-alliance');
  assert.ok(candidate);

  const created = applyNpcDiplomacyAction(state, ownerId, candidate, NOW, candidate.id);
  assert.equal(created.ok, true);
  const alliance = created.state.command.alliances.find((item) => item.members.some((member) => member.ownerId === ownerId));
  assert.ok(alliance);
  assert.equal(alliance.name, `${publicName.slice(0, 30)} Союз`);
  assert.equal(alliance.members[0]?.displayName, publicName);
  assert.equal(alliance.fixtureId, undefined);

  const repeated = applyNpcDiplomacyAction(created.state, ownerId, candidate, NOW, candidate.id);
  assert.equal(repeated.ok, false);
  assert.deepEqual(repeated.state.command, created.state.command);
});

test('NPC alliance application stays pending and replaying its action id changes nothing', () => {
  let state = createPlayerAlliance(campaign('NPCDIPLOAPP1'));
  const { ownerId, profile } = firstNpc(state);
  state = addNpcHall(state, ownerId);
  const beforePlayerAlliance = state.command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === state.profile.playerId));
  assert.ok(beforePlayerAlliance);

  const firstCandidates = getNpcDiplomacyCandidates(state, profile, NOW);
  assert.deepEqual(getNpcDiplomacyCandidates(state, profile, NOW), firstCandidates);
  const application = firstCandidates.find((candidate) => candidate.kind === 'apply-to-alliance' && candidate.payload.allianceId === beforePlayerAlliance.id);
  assert.ok(application);
  const applied = applyNpcDiplomacyAction(state, ownerId, application, NOW, application.id);
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.state.command.alliances.find((alliance) => alliance.id === beforePlayerAlliance.id), beforePlayerAlliance);
  assert.equal(applied.state.command.applications.find((item) => item.ownerId === ownerId)?.status, 'pending');

  const repeated = applyNpcDiplomacyAction(applied.state, ownerId, application, NOW, application.id);
  assert.equal(repeated.ok, false);
  assert.deepEqual(repeated.state.command, applied.state.command);
});

test('full alliances and active cooldowns do not produce illegal join or create candidates', () => {
  let state = createPlayerAlliance(campaign('NPCDIPLOCAP1'));
  const { ownerId, profile } = firstNpc(state);
  state = addNpcHall(state, ownerId);
  const target = state.command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === state.profile.playerId))!;

  for (let index = 0; index < MAX_ALLIANCE_MEMBERS - 1; index += 1) {
    const applicantOwnerId = `cap-member-${index}`;
    const submitted = applyToAlliance(state.command, { ownerId: applicantOwnerId, displayName: applicantOwnerId, allianceId: target.id }, { now: NOW + index });
    assert.equal(submitted.ok, true);
    const accepted = acceptApplication(submitted.state, state.profile.playerId, submitted.applicationId, { now: NOW + index, random: () => 0.5 });
    assert.equal(accepted.ok, true);
    state = { ...state, command: accepted.state };
  }
  assert.equal(state.command.alliances.find((alliance) => alliance.id === target.id)?.members.length, MAX_ALLIANCE_MEMBERS);
  assert.equal(getNpcDiplomacyCandidates(state, profile, NOW).some((candidate) => candidate.kind === 'apply-to-alliance' && candidate.payload.allianceId === target.id), false);

  const cooled = {
    ...state,
    command: {
      ...state.command,
      cooldowns: [...state.command.cooldowns, { ownerId, allianceId: null, until: NOW + 60_000, cause: 'left' as const }],
    },
  };
  const kinds = getNpcDiplomacyCandidates(cooled, profile, NOW).map((candidate) => candidate.kind);
  assert.equal(kinds.includes('apply-to-alliance'), false);
  assert.equal(kinds.includes('create-alliance'), false);
});

test('NPC leaders leave player applications and truce offers pending, but can decide NPC applications', () => {
  let state = campaign('NPCDIPLOPENDING1');
  const { ownerId, profile } = firstNpc(state);
  state = addNpcHall(state, ownerId);
  const made = createAlliance(state.command, { ownerId, displayName: 'Открытое имя NPC', settings: { ...SETTINGS, name: 'Союз NPC', tag: 'NPC' } }, { now: NOW, random: () => 0.4 });
  assert.equal(made.ok, true);
  state = { ...state, command: made.state };
  const allianceId = made.allianceId;

  const playerApplication = applyToAlliance(state.command, { ownerId: state.profile.playerId, displayName: state.profile.displayName, allianceId }, { now: NOW });
  assert.equal(playerApplication.ok, true);
  state = { ...state, command: playerApplication.state };
  assert.equal(getNpcDiplomacyCandidates(state, profile, NOW).some((candidate) => candidate.kind.endsWith('application') && candidate.payload.applicationId === playerApplication.applicationId), false);

  const otherOwnerId = Object.keys(state.npc!.profiles).sort().find((id) => id !== ownerId)!;
  const otherTarget = Object.values(state.espionage!.targets!).find((item) => item.ownerId === otherOwnerId && item.kind === 'npc')!;
  const otherApplication = applyToAlliance(state.command, { ownerId: otherOwnerId, displayName: otherTarget.ownerName, allianceId }, { now: NOW + 1 });
  assert.equal(otherApplication.ok, true);
  state = { ...state, command: otherApplication.state };
  const accept = getNpcDiplomacyCandidates(state, profile, NOW + 1).find((candidate) => candidate.kind === 'accept-application' && candidate.payload.applicationId === otherApplication.applicationId);
  assert.ok(accept);
  const answered = applyNpcDiplomacyAction(state, ownerId, accept, NOW + 1, accept.id);
  assert.equal(answered.ok, true);
  assert.equal(answered.state.command.applications.find((item) => item.id === otherApplication.applicationId)?.status, 'accepted');

  const playerAllianceState = createPlayerAlliance(answered.state);
  const playerAlliance = playerAllianceState.command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === playerAllianceState.profile.playerId))!;
  const war = declareWar(playerAllianceState.command, playerAllianceState.profile.playerId, allianceId, { now: NOW + 2 });
  assert.equal(war.ok, true);
  const truce = proposeTruce(war.state, playerAllianceState.profile.playerId, allianceId, { now: NOW + 2 + 3 * 60 * 60 * 1_000 });
  assert.equal(truce.ok, true);
  const offered = { ...playerAllianceState, command: truce.state };
  assert.equal(getNpcDiplomacyCandidates(offered, profile, NOW + 2 + 3 * 60 * 60 * 1_000).some((candidate) => candidate.kind === 'respond-truce' && candidate.payload.fromAllianceId === playerAlliance.id), false);
});
