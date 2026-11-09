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
      let text = word.toLowerCase().replace(/[01345@$7]/g, (char) => LEET[char] ?? '').replace(/\d/g, '');
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
