import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREST_COLORS,
  CREST_FIELDS,
  CREST_FRAMES,
  CREST_GLYPH_SCALE,
  CREST_GLYPHS,
  CREST_OFFSET_LIMIT,
  CREST_PATTERNS,
  clampCrestOffset,
  DEFAULT_ALLIANCE_CREST,
  defaultPatternOpacity,
  parseCrest,
} from './crest.ts';
import { normalizeEmblem } from './emblem.ts';
import { createAlliance, updateAllianceSettings } from './membership.ts';
import { ORBITAL_CREST_CATALOG } from './orbital-crest-catalog.generated.ts';
import { createDefaultCommandState, migrateCommandState } from './repository.ts';
import { toAllianceIdentity } from './selectors.ts';
import type { AllianceCrest, AllianceSettingsInput } from './types.ts';
import { createDefaultPlayerProfileState, migratePlayerProfileState, syncPlayerProfileWithCommand } from '../profile/repository.ts';

const T0 = 1_800_000_000_000;
const CREST: AllianceCrest = { ...DEFAULT_ALLIANCE_CREST, frame: 'pennant', field: 'royal', pattern: 'constellation', patternOpacity: 0.6, glyph: 'leviathan', color: 'violet', glyphScale: 0.85, rotation: -135, mirrorX: true, offsetX: 0.06, offsetY: -0.1 };

function settings(patch: Partial<AllianceSettingsInput> = {}): AllianceSettingsInput {
  return { name: 'Орбитальный Дом', tag: 'ORB', motto: 'Девиз', description: 'Описание', emblem: { glyph: 'orbit', accent: 'amber' }, ...patch };
}

function founded(emblem: AllianceSettingsInput['emblem']) {
  const result = createAlliance(createDefaultCommandState('production'), { ownerId: 'leader', displayName: 'L', settings: settings({ emblem }) }, { now: T0, random: () => 0.5 });
  assert.equal(result.ok, true, result.ok ? '' : result.message);
  return result.ok ? result.state : null!;
}

test('the catalog matches the package: 6 frames, 6 fields, 8 patterns, 12 glyphs in 6 colours', () => {
  assert.equal(CREST_FRAMES.length, 6);
  assert.equal(CREST_FIELDS.length, 6);
  assert.equal(CREST_PATTERNS.length, 8);
  assert.equal(CREST_GLYPHS.length, 12);
  assert.deepEqual([...CREST_COLORS], ['cyan', 'amber', 'violet', 'crimson', 'emerald', 'silver']);
  for (const glyph of ORBITAL_CREST_CATALOG.glyphs) assert.deepEqual(Object.keys(glyph.placement).sort(), [...CREST_COLORS].sort(), glyph.id);
  // Every sign at the maximum size and offset stays inside the safe circle R.
  assert.ok(CREST_GLYPH_SCALE.max + CREST_OFFSET_LIMIT < 1);
  assert.equal(CREST_GLYPH_SCALE.default, 0.64);
});

test('pattern opacity defaults: 0.6 for the halo constellation, 0.24 for field patterns', () => {
  assert.equal(defaultPatternOpacity('constellation'), 0.6);
  for (const pattern of CREST_PATTERNS.filter((item) => item !== 'constellation')) assert.equal(defaultPatternOpacity(pattern), 0.24, pattern);
});

test('a valid crest round-trips unchanged through JSON and validation', () => {
  assert.deepEqual(parseCrest(JSON.parse(JSON.stringify(CREST))), CREST);
  assert.deepEqual(parseCrest(DEFAULT_ALLIANCE_CREST), DEFAULT_ALLIANCE_CREST);
});

test('unknown ids, colours and out-of-range numbers reject the whole crest', () => {
  const broken: Record<string, unknown>[] = [
    { version: 1 },
    { frame: 'shield' },
    { field: 'gold' },
    { pattern: 'stars' },
    { glyph: 'starforge' },
    { color: 'pink' },
    { patternOpacity: 1.2 },
    { patternOpacity: -0.1 },
    { glyphScale: 0.9 },
    { glyphScale: 0.2 },
    { rotation: 181 },
    { rotation: Number.NaN },
    { mirrorX: 'yes' },
    { offsetX: 0.13 },
    { offsetX: 0.1, offsetY: 0.1 },
  ];
  for (const patch of broken) assert.equal(parseCrest({ ...DEFAULT_ALLIANCE_CREST, ...patch }), null, JSON.stringify(patch));
  assert.equal(parseCrest(null), null);
  assert.equal(parseCrest([]), null);
});

test('editor offset input is pulled back onto the 0.12R circle', () => {
  const clamped = clampCrestOffset(0.12, 0.12);
  assert.ok(Math.abs(Math.hypot(clamped.offsetX, clamped.offsetY) - CREST_OFFSET_LIMIT) < 1e-9);
  assert.ok(parseCrest({ ...DEFAULT_ALLIANCE_CREST, ...clamped }));
  assert.deepEqual(clampCrestOffset(0.05, -0.02), { offsetX: 0.05, offsetY: -0.02 });
});

test('legacy emblems stay exactly as saved; an invalid crest falls back to the legacy emblem', () => {
  const legacy = { glyph: 'blades', accent: 'crimson', shape: 'hex', field: 'rays', fieldColor: 'crimson' };
  assert.deepEqual(normalizeEmblem(legacy), legacy);
  assert.deepEqual(normalizeEmblem({ ...legacy, crest: { ...CREST, glyph: 'unknown' } }), legacy);
  assert.deepEqual(normalizeEmblem({ ...legacy, crest: CREST }), { ...legacy, crest: CREST });
});

test('founding and editing validate the crest; saves, identity and profile keep it', () => {
  const state = founded({ glyph: 'orbit', accent: 'violet', crest: CREST });
  const alliance = state.alliances[0];
  assert.deepEqual(alliance.emblem.crest, CREST);
  assert.deepEqual(migrateCommandState(JSON.parse(JSON.stringify(state)), 'production'), state);
  assert.deepEqual(toAllianceIdentity(alliance).emblem.crest, CREST);

  const profile = syncPlayerProfileWithCommand({ ...createDefaultPlayerProfileState(), playerId: 'leader' }, state);
  assert.deepEqual(profile.alliance?.emblem.crest, CREST);
  assert.deepEqual(migratePlayerProfileState(JSON.parse(JSON.stringify(profile))).alliance?.emblem.crest, CREST);

  const rejected = updateAllianceSettings(state, 'leader', settings({ emblem: { glyph: 'orbit', accent: 'violet', crest: { ...CREST, glyphScale: 2 } } }));
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, 'invalid_emblem');

  const legacyState = founded({ glyph: 'crown', accent: 'amber' });
  assert.equal('crest' in legacyState.alliances[0].emblem, false, 'no crest is invented for a legacy emblem');
});
