import type {
  AllianceAccent,
  AllianceEmblem,
  AllianceEmblemField,
  AllianceEmblemFieldColor,
  AllianceEmblemGlyph,
  AllianceEmblemShape,
} from './types.ts';
import { DEFAULT_ALLIANCE_EMBLEM } from './catalog.ts';

/**
 * Coat-of-arms constructor catalog. The first three glyphs and accents are the
 * original PR 1 set; every later option is additive, so old saves stay valid.
 * Shape, field and field colour are optional: an emblem without them renders
 * exactly like before (shield, solid dark field).
 */
export const EMBLEM_GLYPHS: readonly AllianceEmblemGlyph[] = ['starforge', 'orbit', 'vanguard', 'crown', 'wings', 'planet', 'blades', 'comet'];
export const EMBLEM_ACCENTS: readonly AllianceAccent[] = ['cyan', 'amber', 'violet', 'crimson', 'emerald', 'silver'];
export const EMBLEM_SHAPES: readonly AllianceEmblemShape[] = ['shield', 'round', 'hex', 'banner'];
export const EMBLEM_FIELDS: readonly AllianceEmblemField[] = ['solid', 'split', 'chevron', 'rays', 'stars'];
export const EMBLEM_FIELD_COLORS: readonly AllianceEmblemFieldColor[] = ['abyss', 'navy', 'crimson', 'forest', 'royal', 'bronze'];


function pick<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return list.includes(value as T) ? value as T : undefined;
}

/** Validates every field; optional constructor parts are kept only when valid and present. */
export function normalizeEmblem(value: unknown, fallback: AllianceEmblem = DEFAULT_ALLIANCE_EMBLEM): AllianceEmblem {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!source) return { ...fallback };
  const shape = pick(EMBLEM_SHAPES, source.shape);
  const field = pick(EMBLEM_FIELDS, source.field);
  const fieldColor = pick(EMBLEM_FIELD_COLORS, source.fieldColor);
  return {
    glyph: pick(EMBLEM_GLYPHS, source.glyph) ?? fallback.glyph,
    accent: pick(EMBLEM_ACCENTS, source.accent) ?? fallback.accent,
    ...(shape ? { shape } : {}),
    ...(field ? { field } : {}),
    ...(fieldColor ? { fieldColor } : {}),
  };
}

const TRANSLIT: Record<string, string> = {
  а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'Z', з: 'Z', и: 'I', й: 'I', к: 'K', л: 'L', м: 'M',
  н: 'N', о: 'O', п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'C', ч: 'C', ш: 'S', щ: 'S', ы: 'Y',
  э: 'E', ю: 'U', я: 'A',
};

/**
 * Tag suggestion from the alliance name: initials of the words (latin, 2–4 letters).
 * A single word contributes its first letters. Only a suggestion: the player may edit it.
 */
export function suggestAllianceTag(name: string): string {
  const latin = (word: string) => [...word.toLocaleLowerCase('ru-RU')].map((char) => TRANSLIT[char] ?? char.toUpperCase()).join('').replace(/[^A-Z0-9]/g, '');
  const words = name.split(/[\s\-–—_.,]+/).map(latin).filter(Boolean);
  if (!words.length) return '';
  const tag = words.length === 1 ? words[0].slice(0, 3) : words.map((word) => word[0]).join('').slice(0, 4);
  return tag.length >= 2 ? tag : (words.join('').slice(0, 3));
}
