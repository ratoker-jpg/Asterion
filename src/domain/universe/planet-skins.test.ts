import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_COLONY_SKIN, LEGACY_PLANET_SKIN_IDS, PLANET_SKIN_CATALOG, PLANET_SKIN_GROUPS, PLANET_SKIN_IDS, PUBLIC_PLANET_SKIN_IDS,
  canPickPlanetSkin, displayedPlanetSkinId, isAlliancePlanetSkin, isPlanetSkinId,
} from './planet-skins.ts';
import { selectOwnerMembership } from '../command/selectors.ts';
import type { AllianceRecord } from '../command/types.ts';

const allianceSkins = PLANET_SKIN_CATALOG.filter((skin) => skin.tier === 'alliance').map((skin) => skin.id);

test('old saves: every look shipped before the new catalogue is still known', () => {
  for (const id of LEGACY_PLANET_SKIN_IDS) assert.ok(isPlanetSkinId(id), id);
  assert.equal(LEGACY_PLANET_SKIN_IDS.length, 30);
});

test('catalogue: unique ids and names, real names instead of «Облик 002», every group has looks', () => {
  assert.equal(new Set(PLANET_SKIN_IDS).size, PLANET_SKIN_IDS.length);
  assert.equal(new Set(PLANET_SKIN_CATALOG.map((skin) => skin.label)).size, PLANET_SKIN_CATALOG.length);
  for (const skin of PLANET_SKIN_CATALOG) assert.doesNotMatch(skin.label, /^Облик\s/, skin.id);
  for (const group of PLANET_SKIN_GROUPS) assert.ok(PLANET_SKIN_CATALOG.some((skin) => skin.group === group.id), group.id);
  assert.ok(allianceSkins.length >= 6 && allianceSkins.length <= 10);
  assert.ok(PLANET_SKIN_CATALOG.length >= 95);
});

test('alliance looks: only the alliance leader may pick them, other looks are open to all', () => {
  for (const id of allianceSkins) {
    assert.ok(isAlliancePlanetSkin(id));
    assert.equal(canPickPlanetSkin(id, 'leader'), true);
    assert.equal(canPickPlanetSkin(id, 'deputy'), false);
    assert.equal(canPickPlanetSkin(id, 'member'), false);
    assert.equal(canPickPlanetSkin(id, null), false);
  }
  assert.equal(canPickPlanetSkin('terran', null), true);
  assert.equal(canPickPlanetSkin('ps-crystal', 'member'), true);
  assert.equal(canPickPlanetSkin('no-such-look', 'leader'), false);
});

test('NPC colonies never wear alliance looks', () => {
  for (const id of allianceSkins) assert.ok(!PUBLIC_PLANET_SKIN_IDS.includes(id));
  assert.equal(PUBLIC_PLANET_SKIN_IDS.length + allianceSkins.length, PLANET_SKIN_IDS.length);
});

test('leader steps down: the alliance look hides behind «Колония» and comes back when they lead again', () => {
  const alliance = (leaderOwnerId: string): AllianceRecord => ({
    id: 'a1', name: 'Северный союз', tag: 'SEV', leaderOwnerId,
    members: [{ ownerId: 'player', joinedAt: 0 }, { ownerId: 'npc-1', joinedAt: 0 }],
  } as unknown as AllianceRecord);
  const roleIn = (alliances: AllianceRecord[]) => selectOwnerMembership({ alliances }, 'player')?.role ?? null;

  const saved = 'ally-crown';
  assert.equal(displayedPlanetSkinId(saved, roleIn([alliance('player')])), saved);
  // Handed the lead to an ally: still in the alliance, no longer the leader.
  assert.equal(roleIn([alliance('npc-1')]), 'member');
  assert.equal(displayedPlanetSkinId(saved, roleIn([alliance('npc-1')])), DEFAULT_COLONY_SKIN);
  // Left the alliance.
  assert.equal(displayedPlanetSkinId(saved, roleIn([])), DEFAULT_COLONY_SKIN);
  // Leads again: the saved look is back, nothing was lost.
  assert.equal(displayedPlanetSkinId(saved, roleIn([alliance('player')])), saved);
  // Regular looks never depend on the alliance.
  assert.equal(displayedPlanetSkinId('ps-autumn', null), 'ps-autumn');
  assert.equal(displayedPlanetSkinId('unknown-look', 'leader'), DEFAULT_COLONY_SKIN);
});
