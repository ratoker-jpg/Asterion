import { createSeededRandom } from './random.ts';

/**
 * One-word player nicknames (owner rule, 24.10.2026), the way people name
 * themselves in browser strategies: invented words in Cyrillic or Latin,
 * sometimes with digits. Drawn from their own seeded stream so world
 * placement draws stay where they were; unique within a campaign and not
 * tied to an owner's index, race or character.
 */

const CYRILLIC_HEADS = [
  'Вар', 'Кал', 'Тор', 'Лир', 'Зар', 'Мор', 'Кир', 'Дар', 'Рен', 'Сол', 'Ност', 'Гран', 'Вель', 'Тар', 'Эрг', 'Фен',
  'Крас', 'Ярк', 'Бор', 'Ска', 'Лум', 'Хор', 'Нир', 'Ост', 'Сайр', 'Дрей', 'Мак', 'Ворд', 'Гел', 'Кор', 'Рат', 'Зен',
] as const;
const CYRILLIC_TAILS = [
  'ион', 'ар', 'ис', 'ен', 'ор', 'акс', 'ель', 'ус', 'ин', 'ан', 'ит', 'он', 'ерн', 'аш', 'ок', 'ия', 'ар', 'ус',
  'ендор', 'омир', 'иан', 'ург', 'ектор', 'алис',
] as const;
const LATIN_HEADS = [
  'Vor', 'Kael', 'Thar', 'Nyx', 'Zer', 'Mor', 'Dra', 'Rav', 'Sol', 'Grim', 'Vex', 'Tor', 'Lyr', 'Kor', 'Xan', 'Fen',
  'Ash', 'Bran', 'Cyr', 'Drak', 'Eon', 'Hex', 'Jar', 'Quel', 'Ryn', 'Syl', 'Ulm', 'Wrex', 'Zyr', 'Oro', 'Vald', 'Tess',
] as const;
const LATIN_TAILS = [
  'on', 'ax', 'is', 'en', 'or', 'ius', 'ar', 'yx', 'ith', 'ael', 'os', 'ek', 'an', 'ir', 'us', 'enn', 'ora', 'ix',
  'andor', 'eris', 'oth', 'ium', 'ane', 'rok',
] as const;

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length]!;
}

function nickname(random: () => number): string {
  const latin = random() < 0.45;
  let word = latin
    ? pick(random, LATIN_HEADS) + pick(random, LATIN_TAILS)
    : pick(random, CYRILLIC_HEADS) + pick(random, CYRILLIC_TAILS);
  // Some players add a number, some lowercase the whole word.
  const style = random();
  if (style < 0.18) word += String(2 + Math.floor(random() * 98));
  else if (style < 0.26) word = word.toLowerCase();
  return word;
}

/** `count` distinct one-word nicknames for one campaign seed, never equal to any of `taken`. */
export function generateNpcNicknames(seed: string, count: number, taken: readonly string[] = []): string[] {
  const random = createSeededRandom(JSON.stringify(['npc-nicknames:v1', seed]));
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const names: string[] = [];
  for (let attempt = 0; names.length < count && attempt < count * 200; attempt += 1) {
    const name = nickname(random);
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    names.push(name);
  }
  // A guaranteed fallback keeps every owner named even in a pathological draw.
  while (names.length < count) names.push(`Пилот${names.length + 1}`);
  return names;
}
