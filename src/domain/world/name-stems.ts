/**
 * Roots of display names, used to keep NPC nicks and clan names from
 * repeating each other (owner rule 10.11.2026: no «Нагибатор» next to
 * «Нагибатор Про», no «Ворон» next to «Kr0w_Ворон»).
 *
 * A name is split into words (spaces, punctuation, camelCase), leetspeak
 * digits become letters, and Cyrillic and Latin are brought to one rough
 * phonetic spelling, so «Kraken», «Кракен» and «Kr4ken» all read «kraken».
 * The root of a word is its first four letters; words shorter than four
 * letters ("и", "of", "Ра") are ignored.
 */

export const NAME_STEM_LENGTH = 4;

const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

/** Latin spelled the way the Cyrillic table above spells it. Order matters: longer pairs first. */
const LATIN: readonly (readonly [RegExp, string])[] = [
  [/sch/g, 'sh'], [/tch/g, 'ch'], [/ph/g, 'f'], [/th/g, 't'], [/kh/g, 'h'], [/ck/g, 'k'],
  [/c(?=[eiy])/g, 's'], [/c(?!h)/g, 'k'], [/t[sz]/g, 'c'], [/x/g, 'ks'], [/q/g, 'k'], [/w/g, 'v'], [/j/g, 'i'], [/y/g, 'i'],
  [/ae/g, 'e'], [/oe/g, 'e'], [/ou/g, 'u'], [/ee/g, 'i'], [/oo/g, 'u'],
];

/** Words of a display name in one canonical spelling, doubled letters collapsed. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\d@$]+/u)
    .map((word) => {
      let text = word.toLowerCase().replace(/[01345@$7]/g, (char) => LEET[char] ?? '').replace(/\d/g, '').replace(/дж/g, 'j');
      text = [...text].map((char) => CYRILLIC[char] ?? char).join('');
      for (const [pattern, value] of LATIN) text = text.replace(pattern, value);
      return text.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
    })
    .filter(Boolean);
}

/** Distinct roots of a display name. */
export function nameStems(name: string): string[] {
  return [...new Set(nameWords(name).filter((word) => word.length >= NAME_STEM_LENGTH).map((word) => word.slice(0, NAME_STEM_LENGTH)))];
}

/** Every pair of names that share a root, as `root: first / second`. Empty when all names are distinct. */
export function sharedNameStems(names: readonly string[]): string[] {
  const owner = new Map<string, string>();
  const clashes: string[] = [];
  for (const name of names) {
    for (const stem of nameStems(name)) {
      const first = owner.get(stem);
      if (first !== undefined && first !== name) clashes.push(`${stem}: ${first} / ${name}`);
      else owner.set(stem, name);
    }
  }
  return clashes;
}

/**
 * Consonants of a word in the canonical spelling. With the same first letter
 * and a close length it catches transcriptions the root misses: «Viper» and
 * «Вайпер», «Juggernaut» and «Джаггернаут».
 */
export function wordSkeleton(word: string): string {
  return word.replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

/**
 * Names that clash with a game term: a one-word term (race, ship, building)
 * shares a root with a word of the name or sounds like it (same first letter,
 * same 3+ consonants, length within 2), or every word of a longer term
 * appears in the name. Returns `name ← term` pairs.
 */
export function gameTermClashes(names: readonly string[], terms: readonly string[]): string[] {
  const clashes: string[] = [];
  const stem = (word: string) => (word.length >= NAME_STEM_LENGTH ? word.slice(0, NAME_STEM_LENGTH) : word);
  const termWords = terms.map((term) => ({ term, words: nameWords(term).filter((word) => word.length >= 3) })).filter((item) => item.words.length > 0);
  for (const name of names) {
    const words = nameWords(name);
    const stems = new Set(words.map(stem));
    for (const { term, words: parts } of termWords) {
      const hit = parts.length === 1
        ? stems.has(stem(parts[0]!)) || words.some((word) => soundsAlike(word, parts[0]!))
        : parts.every((part) => stems.has(stem(part)));
      if (hit) clashes.push(`${name} ← ${term}`);
    }
  }
  return clashes;
}

function soundsAlike(word: string, term: string): boolean {
  const skeleton = wordSkeleton(term);
  return skeleton.length >= 3 && word[0] === term[0] && Math.abs(word.length - term.length) <= 2 && wordSkeleton(word) === skeleton;
}
