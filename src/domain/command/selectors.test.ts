import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultCommandState, updateAllianceSettings } from './repository.ts';
import { selectCurrentAlliance } from './selectors.ts';
import { migratePlayerProfileState } from '../profile/repository.ts';

test('current alliance adapter normalizes the CommandState identity as one reusable snapshot', () => {
  const command = updateAllianceSettings(createDefaultCommandState(), {
    name: '  Содружество Гелион  ',
    tag: ' hln ',
    motto: 'Один контур.',
    description: 'Локальный союз.',
    emblem: { glyph: 'vanguard', accent: 'amber' },
  });

  assert.deepEqual(selectCurrentAlliance(command), {
    id: 'alliance-current',
    name: 'Содружество Гелион',
    tag: 'HLN',
    emblem: { glyph: 'vanguard', accent: 'amber' },
    glyph: 'vanguard',
  });
});

test('legacy profile alliance cannot override the current CommandState alliance', () => {
  const command = updateAllianceSettings(createDefaultCommandState(), {
    name: 'Живой Контур',
    tag: 'LIVE',
    motto: 'Один контур.',
    description: 'Локальный союз.',
    emblem: { glyph: 'orbit', accent: 'violet' },
  });
  const conflictingProfile = migratePlayerProfileState({
    playerId: 'player-current',
    displayName: 'Dendrilion',
    factionId: 'aegis',
    allianceId: 'alliance-legacy',
    alliance: { id: 'alliance-legacy', name: 'Старый Союз', tag: 'OLD', emblem: { glyph: 'starforge', accent: 'cyan' } },
  });

  const current = selectCurrentAlliance(command);
  assert.equal(current.name, 'Живой Контур');
  assert.equal(current.tag, 'LIVE');
  assert.notEqual(current.name, conflictingProfile.alliance?.name);
  assert.notEqual(current.tag, conflictingProfile.alliance?.tag);
  assert.equal(current.glyph, 'orbit');
});
