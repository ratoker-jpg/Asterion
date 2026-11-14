import { CREST_COLORS, CREST_FIELDS, CREST_FRAMES, CREST_GLYPH_SCALE, CREST_GLYPHS, CREST_PATTERNS, DEFAULT_ALLIANCE_CREST, defaultPatternOpacity } from './crest.ts';
import type { AllianceAccent, AllianceCrest, AllianceEmblem, AllianceEmblemGlyph } from './types.ts';

/**
 * Founding an alliance (concept «Достижения, титулы и облик», section 8): the
 * banner comes first. Six ready looks to start from, a random crest, and the
 * rule that a new alliance always gets a constructor crest — the flat legacy
 * emblem stays only on alliances that already wear it.
 */

type Look = Pick<AllianceCrest, 'frame' | 'field' | 'glyph' | 'color'> & { pattern?: AllianceCrest['pattern'] };

const crestOf = (look: Look): AllianceCrest => {
  const pattern = look.pattern ?? 'none';
  return {
    ...DEFAULT_ALLIANCE_CREST,
    frame: look.frame,
    field: look.field,
    glyph: look.glyph,
    color: look.color,
    pattern,
    patternOpacity: pattern === 'none' ? DEFAULT_ALLIANCE_CREST.patternOpacity : defaultPatternOpacity(pattern),
  };
};

/** The six ready looks of the «Знамя» step, in the mockup's order. */
export const FOUNDING_PRESETS: readonly AllianceCrest[] = [
  crestOf({ frame: 'orbital', field: 'navy', glyph: 'crown', color: 'amber' }),
  crestOf({ frame: 'aegis', field: 'abyss', glyph: 'phoenix', color: 'cyan' }),
  crestOf({ frame: 'octagon', field: 'crimson', glyph: 'blades', color: 'crimson' }),
  crestOf({ frame: 'hex', field: 'forest', glyph: 'compass', color: 'emerald' }),
  crestOf({ frame: 'diamond', field: 'royal', glyph: 'nexus', color: 'violet' }),
  crestOf({ frame: 'pennant', field: 'bronze', glyph: 'anvil', color: 'silver' }),
];

/** Legacy glyph kept beside a crest for screens that still draw the old emblem. */
const LEGACY_GLYPH: Readonly<Partial<Record<AllianceCrest['glyph'], AllianceEmblemGlyph>>> = {
  crown: 'crown', blades: 'blades', comet: 'comet', compass: 'orbit', citadel: 'vanguard', anvil: 'vanguard',
};

/** The emblem record for a crest: the colour mirrors into `accent`, which tints the alliance UI. */
export function emblemFromCrest(crest: AllianceCrest): AllianceEmblem {
  return { glyph: LEGACY_GLYPH[crest.glyph] ?? 'starforge', accent: crest.color, crest: { ...crest } };
}

/** A new alliance never gets the flat legacy emblem: without a crest it gets the default one in its colour. */
export function withFoundingCrest(emblem: AllianceEmblem): AllianceEmblem {
  if (emblem.crest) return emblem;
  return { ...emblem, crest: { ...DEFAULT_ALLIANCE_CREST, color: emblem.accent } };
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;

/** «Случайный герб»: frame, enamel, pattern, sign and colour from the constructor's own lists. */
export function randomFoundingCrest(random: () => number = Math.random): AllianceCrest {
  const pattern = random() < 0.35 ? 'none' : pick(CREST_PATTERNS, random);
  return {
    ...DEFAULT_ALLIANCE_CREST,
    frame: pick(CREST_FRAMES, random),
    field: pick(CREST_FIELDS, random),
    pattern,
    patternOpacity: pattern === 'none' ? DEFAULT_ALLIANCE_CREST.patternOpacity : defaultPatternOpacity(pattern),
    glyph: pick(CREST_GLYPHS, random),
    color: pick(CREST_COLORS, random) as AllianceAccent,
    glyphScale: CREST_GLYPH_SCALE.default,
    mirrorX: random() < 0.5,
  };
}
