import { ORBITAL_CREST_CATALOG } from './orbital-crest-catalog.generated.ts';
import type {
  AllianceAccent,
  AllianceCrest,
  AllianceCrestField,
  AllianceCrestFrame,
  AllianceCrestGlyph,
  AllianceCrestPattern,
} from './types.ts';

/**
 * «Орбитальные дома» crest contract (assets/source/command-heraldry-orbital-v2,
 * OPUS_HANDOFF.md). Ids and names come from the generated catalog only; the
 * limits below are the package's geometry decisions.
 */
export const CREST_FRAMES: readonly AllianceCrestFrame[] = ORBITAL_CREST_CATALOG.frames.map((item) => item.id);
export const CREST_FIELDS: readonly AllianceCrestField[] = ORBITAL_CREST_CATALOG.fields.map((item) => item.id);
export const CREST_PATTERNS: readonly AllianceCrestPattern[] = ORBITAL_CREST_CATALOG.patterns.map((item) => item.id);
export const CREST_GLYPHS: readonly AllianceCrestGlyph[] = ORBITAL_CREST_CATALOG.glyphs.map((item) => item.id);
export const CREST_COLORS: readonly AllianceAccent[] = ORBITAL_CREST_CATALOG.colors.map((item) => item.id);

export const CREST_GLYPH_SCALE = { min: 0.4, max: ORBITAL_CREST_CATALOG.geometry.haloRadiusFactor, default: ORBITAL_CREST_CATALOG.geometry.glyphRadiusFactor } as const;
export const CREST_ROTATION_LIMIT = 180;
export const CREST_OFFSET_LIMIT = ORBITAL_CREST_CATALOG.geometry.maxOffsetFactor;
export const CREST_HALO_RADIUS = ORBITAL_CREST_CATALOG.geometry.haloRadiusFactor;
const EPSILON = 1e-6;

export function crestPatternLayout(pattern: AllianceCrest['pattern']): 'field' | 'halo' | null {
  return ORBITAL_CREST_CATALOG.patterns.find((item) => item.id === pattern)?.layout ?? null;
}

/** Opacity a pattern starts with when the player picks it. */
export function defaultPatternOpacity(pattern: AllianceCrest['pattern']): number {
  return crestPatternLayout(pattern) === 'halo' ? 0.6 : 0.24;
}

export const DEFAULT_ALLIANCE_CREST: AllianceCrest = {
  version: 2,
  frame: 'aegis',
  field: 'abyss',
  pattern: 'none',
  patternOpacity: 0.24,
  glyph: 'phoenix',
  color: 'cyan',
  glyphScale: CREST_GLYPH_SCALE.default,
  rotation: 0,
  mirrorX: false,
  offsetX: 0,
  offsetY: 0,
};

function inList<T extends string>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min - EPSILON && value <= max + EPSILON;
}

/**
 * Strict validation: unknown ids, colours outside the palette and numbers
 * outside their limits reject the whole crest (null) instead of being guessed.
 */
export function parseCrest(value: unknown): AllianceCrest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const offsetX = source.offsetX ?? 0;
  const offsetY = source.offsetY ?? 0;
  if (source.version !== 2) return null;
  if (!inList(CREST_FRAMES, source.frame) || !inList(CREST_FIELDS, source.field) || !inList(CREST_GLYPHS, source.glyph) || !inList(CREST_COLORS, source.color)) return null;
  if (source.pattern !== 'none' && !inList(CREST_PATTERNS, source.pattern)) return null;
  if (!inRange(source.patternOpacity, 0, 1)) return null;
  if (!inRange(source.glyphScale, CREST_GLYPH_SCALE.min, CREST_GLYPH_SCALE.max)) return null;
  if (!inRange(source.rotation, -CREST_ROTATION_LIMIT, CREST_ROTATION_LIMIT)) return null;
  if (typeof source.mirrorX !== 'boolean') return null;
  if (!inRange(offsetX, -CREST_OFFSET_LIMIT, CREST_OFFSET_LIMIT) || !inRange(offsetY, -CREST_OFFSET_LIMIT, CREST_OFFSET_LIMIT)) return null;
  if (Math.hypot(offsetX, offsetY) > CREST_OFFSET_LIMIT + EPSILON) return null;
  return {
    version: 2,
    frame: source.frame,
    field: source.field,
    pattern: source.pattern as AllianceCrest['pattern'],
    patternOpacity: source.patternOpacity,
    glyph: source.glyph,
    color: source.color,
    glyphScale: source.glyphScale,
    rotation: source.rotation,
    mirrorX: source.mirrorX,
    offsetX,
    offsetY,
  };
}

/** Pulls an offset back onto the safe circle (|offset| ≤ 0.12R) for editor input. */
export function clampCrestOffset(offsetX: number, offsetY: number): { offsetX: number; offsetY: number } {
  const length = Math.hypot(offsetX, offsetY);
  if (length <= CREST_OFFSET_LIMIT) return { offsetX, offsetY };
  const ratio = CREST_OFFSET_LIMIT / length;
  return { offsetX: offsetX * ratio, offsetY: offsetY * ratio };
}

export function crestLabel(kind: 'frames' | 'fields' | 'patterns' | 'glyphs' | 'colors', id: string): string {
  if (id === 'none') return 'Без узора';
  return (ORBITAL_CREST_CATALOG[kind] as readonly { id: string; name: string }[]).find((item) => item.id === id)?.name ?? id;
}
