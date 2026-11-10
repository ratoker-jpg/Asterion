/**
 * Accusative case of a building (or zone) name for phrases like «Копит на …»,
 * «Сначала строим …», «Возвращение в …».
 *
 * Building names are inanimate, so only feminine phrases change: the
 * adjectives before the head noun take -ую/-юю and the head noun takes -у/-ю
 * («Металлическая шахта I» → «Металлическую шахту I», «Фабрика» → «Фабрику»,
 * «Палата управления» → «Палату управления»). Masculine and neuter names and
 * feminine nouns in -ь («Верфь», «Энергосеть») stay as they are.
 */
const ADJECTIVE_ENDING = /(ая|яя|ый|ий|ой|ое|ее)$/i;

function keepCase(source: string, replacement: string): string {
  return source === source.toUpperCase() && source !== source.toLowerCase() ? replacement.toUpperCase() : replacement;
}

export function toAccusative(name: string): string {
  const words = name.split(' ');
  const head = words.findIndex((word) => !ADJECTIVE_ENDING.test(word));
  if (head < 0) return name;
  const noun = words[head];
  const feminine = /[ая]$/i.test(noun) && words.slice(0, head).every((word) => /(ая|яя)$/i.test(word));
  if (!feminine) return name;
  return words.map((word, index) => {
    if (index < head) return word.replace(/(а|я)я$/i, (_, vowel: string) => keepCase(vowel, vowel.toLowerCase() === 'а' ? 'у' : 'ю') + keepCase(vowel, 'ю'));
    if (index === head) return word.replace(/[ая]$/i, (vowel) => keepCase(vowel, vowel.toLowerCase() === 'а' ? 'у' : 'ю'));
    return word;
  }).join(' ');
}
