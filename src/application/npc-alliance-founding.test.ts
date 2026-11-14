import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ALLIANCE_CREST, parseCrest } from '../domain/command/crest.ts';
import { emblemFromCrest, FOUNDING_PRESETS, randomFoundingCrest, withFoundingCrest } from '../domain/command/founding.ts';
import { createAlliance, validateAllianceSettings } from '../domain/command/membership.ts';
import { migrateCommandState } from '../domain/command/repository.ts';
import { selectOwnerMembership, selectPendingApplication } from '../domain/command/selectors.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { inviteAllianceProspect, selectAllianceProspects } from './alliance-prospects.ts';
import type { SaveState } from './contracts.ts';
import { applyNpcDiplomacyAction, getNpcDiplomacyCandidates } from './npc-diplomacy.ts';
import { npcAllianceEmblem, npcHeraldryBasis } from './npc-identity.ts';
import { createInitialSaveState } from './persistence.ts';

/**
 * PR 1 of «Достижения, титулы и облик»: founding an alliance without a stub.
 * The player founds under a constructor crest picked on the «Знамя» step; a bot
 * founds under the crest of its character; nobody gets the flat legacy emblem
 * any more, while old saves keep theirs. The first screen asks bots that want
 * the new alliance, and «Позвать» makes them file an ordinary application.
 */

const NOW = Date.UTC(2026, 10, 15, 12);
const NAME_42 = 'Объединённый Северный Союз Звёздных Флотов';
const MOTTO_72 = 'Пока горят наши звёзды, ни один флот не пройдёт через Северный Рубеж!!';

function campaign(seed: string, npcCount = 12): SaveState {
  const config = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Игрок' });
  const state = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount } });
  const ownerIds = [...new Set(Object.values(state.espionage!.targets!).filter((target) => target.kind === 'npc').map((target) => target.ownerId))].sort();
  const npc = createNpcState(ownerIds, `founding:${seed}`, NOW);
  // Every bot has a Hall, so every one may found or join an alliance.
  const targets = Object.fromEntries(Object.entries(state.espionage!.targets!).map(([id, target]) => [id,
    target.kind === 'npc' ? { ...target, buildings: { ...target.buildings, 'planetary-government': 1 } } : target]));
  return { ...state, npc, espionage: { ...state.espionage!, targets } };
}

/** Bots keen on alliances (not loners), so the choice depends only on the alliances on offer. */
function sociable(state: SaveState): SaveState {
  const profiles = Object.fromEntries(Object.entries(state.npc!.profiles).map(([id, profile]) => [id,
    { ...profile, traits: { ...profile.traits, cooperation: 0.9, socialStyle: 0.8 } }]));
  return { ...state, npc: { ...state.npc!, profiles } };
}

test('player founding: the banner crest is kept, names at their limits pass, the flat emblem is never created', () => {
  const state = campaign('FOUNDPLAYER1');
  const crest = FOUNDING_PRESETS[0]!;
  const settings = { name: NAME_42, tag: 'NORTHSTR', motto: MOTTO_72, description: 'Союз **Северного Рубежа**.', emblem: emblemFromCrest(crest) };
  assert.equal(validateAllianceSettings(state.command, settings).ok, true, 'names at their limits are valid');
  const made = createAlliance(state.command, { ownerId: state.profile.playerId, displayName: state.profile.displayName, settings }, { now: NOW });
  assert.equal(made.ok, true);
  const alliance = selectOwnerMembership(made.state, state.profile.playerId)!.alliance;
  assert.deepEqual(alliance.emblem.crest, crest, 'the crest chosen on the banner step');
  assert.equal(alliance.emblem.accent, crest.color, 'the alliance colour tints the UI');
  assert.equal(alliance.name, NAME_42);
  assert.equal(alliance.motto, MOTTO_72);
  // No new save fields: the record round-trips through the loader unchanged.
  assert.deepEqual(migrateCommandState(JSON.parse(JSON.stringify(made.state)), 'production'), made.state);

  // A founding request without a crest (an old screen, a script) still gets a constructor crest in its colour.
  const plain = createAlliance(state.command, { ownerId: state.profile.playerId, displayName: state.profile.displayName,
    settings: { ...settings, emblem: { glyph: 'crown', accent: 'emerald' } } }, { now: NOW });
  assert.equal(plain.ok, true);
  const plainCrest = selectOwnerMembership(plain.state, state.profile.playerId)!.alliance.emblem.crest;
  assert.deepEqual(plainCrest, { ...DEFAULT_ALLIANCE_CREST, color: 'emerald' });

  // A name taken by another alliance is refused before founding.
  const twice = validateAllianceSettings(made.state, { ...settings, tag: 'OTHER' });
  assert.equal(twice.ok, false);
});

test('ready looks and the random crest are valid constructor crests', () => {
  assert.equal(FOUNDING_PRESETS.length, 6);
  for (const preset of FOUNDING_PRESETS) assert.ok(parseCrest(preset), `preset ${preset.glyph} is a valid crest`);
  assert.equal(new Set(FOUNDING_PRESETS.map((preset) => preset.color)).size, 6, 'six colours of the palette');
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let index = 0; index < 200; index += 1) assert.ok(parseCrest(randomFoundingCrest(random)), 'every random crest is valid');
  assert.deepEqual(withFoundingCrest(emblemFromCrest(FOUNDING_PRESETS[2]!)).crest, FOUNDING_PRESETS[2]);
});

test('bot founding: the alliance gets the crest of its character at once, not the flat emblem', () => {
  const state = sociable(campaign('NPCDIPLOCREATE1'));
  const ownerId = Object.keys(state.npc!.profiles).sort()[0]!;
  const profile = state.npc!.profiles[ownerId]!;
  const candidate = getNpcDiplomacyCandidates(state, profile, NOW).find((item) => item.kind === 'create-alliance');
  assert.ok(candidate, 'a sociable bot with a Hall may found an alliance');
  const created = applyNpcDiplomacyAction(state, ownerId, candidate, NOW, candidate.id);
  assert.equal(created.ok, true);
  const alliance = selectOwnerMembership(created.state.command, ownerId)!.alliance;
  assert.ok(alliance.emblem.crest, 'a constructor crest');
  const basis = npcHeraldryBasis(created.state.command, alliance, created.state.npc!.profiles);
  assert.ok(basis);
  assert.deepEqual(alliance.emblem, npcAllianceEmblem(alliance.id, basis), 'the crest of its character');
});

test('old saves: an alliance under the flat emblem loads as it was', () => {
  const state = campaign('FOUNDLEGACY1');
  const made = createAlliance(state.command, { ownerId: state.profile.playerId, displayName: state.profile.displayName,
    settings: { name: 'Старый союз', tag: 'OLD', motto: '', description: '', emblem: { glyph: 'crown', accent: 'amber' } } }, { now: NOW });
  assert.equal(made.ok, true);
  // A save written before this change: no crest on the record.
  const legacy = JSON.parse(JSON.stringify(made.state));
  delete legacy.alliances[0].emblem.crest;
  const loaded = migrateCommandState(legacy, 'production');
  assert.deepEqual(loaded.alliances[0]!.emblem, { glyph: 'crown', accent: 'amber' });
});

test('first screen: bots that want the new alliance are listed, «Позвать» files an ordinary application', () => {
  const state = sociable(campaign('FOUNDPROSPECT1'));
  const made = createAlliance(state.command, { ownerId: state.profile.playerId, displayName: state.profile.displayName,
    settings: { name: 'Орден Последнего Рассвета', tag: 'DAWN', motto: '', description: '', emblem: emblemFromCrest(FOUNDING_PRESETS[0]!) } }, { now: NOW });
  assert.equal(made.ok, true);
  const founded: SaveState = { ...state, command: made.state };
  const allianceId = selectOwnerMembership(founded.command, founded.profile.playerId)!.alliance.id;

  const prospects = selectAllianceProspects(founded, allianceId, NOW);
  assert.ok(prospects.length > 0 && prospects.length <= 4, `up to four bots, got ${prospects.length}`);
  assert.equal(prospects[0]!.keenness, 1, 'the keenest first');
  for (const prospect of prospects) {
    assert.ok(prospect.name && prospect.reason, 'a name and a reason in words');
    assert.equal(selectOwnerMembership(founded.command, prospect.ownerId), null, 'only bots without an alliance');
  }
  // Pure reading: the same save gives the same list.
  assert.deepEqual(selectAllianceProspects(founded, allianceId, NOW), prospects);

  const invited = inviteAllianceProspect(founded, allianceId, prospects[0]!.ownerId, NOW);
  assert.equal(invited.ok, true);
  const application = selectPendingApplication(invited.state.command, prospects[0]!.ownerId);
  assert.equal(application?.allianceId, allianceId, 'an ordinary pending application to the alliance');
  assert.equal(selectOwnerMembership(invited.state.command, prospects[0]!.ownerId), null, 'the leader still decides');
  assert.ok(!selectAllianceProspects(invited.state, allianceId, NOW).some((item) => item.ownerId === prospects[0]!.ownerId), 'an asked bot leaves the list');

  const again = inviteAllianceProspect(invited.state, allianceId, prospects[0]!.ownerId, NOW);
  assert.equal(again.ok, false, 'asked twice: already waiting');
  assert.equal(inviteAllianceProspect(founded, allianceId, 'no-such-bot', NOW).ok, false);
});
