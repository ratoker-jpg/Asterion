import { createSeededRandom } from './random.ts';
import { NICKNAME_POOL } from './nickname-pool.ts';

/**
 * NPC nicknames of grown-up players (owner rule 10.11.2026). The nick is
 * drawn from a hand-written pool, shuffled by the campaign seed so a
 * world looks the same on server and client. Unique within a campaign
 * (case-insensitive) and never longer than `NICKNAME_MAX`.
 * Drawn from its own seeded stream so world placement draws stay where they were.
 */

export const NICKNAME_MAX = 24;

function shuffled<T>(random: () => number, items: readonly T[]): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [list[index], list[swap]] = [list[swap]!, list[index]!];
  }
  return list;
}

/** Past the end of the pool: a pool nick with a gamer-style number, still inside the length limit. */
function numbered(random: () => number, base: string): string {
  const suffix = String(2 + Math.floor(random() * 998));
  return `${base.slice(0, NICKNAME_MAX - suffix.length)}${suffix}`;
}

/** `count` distinct nicknames for one campaign seed, never equal to any of `taken`. */
export function generateNpcNicknames(seed: string, count: number, taken: readonly string[] = []): string[] {
  const random = createSeededRandom(JSON.stringify(['npc-nicknames:v2', seed]));
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const names: string[] = [];
  const add = (name: string): boolean => {
    const key = name.toLowerCase();
    if (!name || name.length > NICKNAME_MAX || used.has(key)) return false;
    used.add(key);
    names.push(name);
    return true;
  };
  for (const name of shuffled(random, NICKNAME_POOL)) {
    if (names.length >= count) break;
    add(name);
  }
  for (let attempt = 0; names.length < count && attempt < count * 200; attempt += 1) {
    add(numbered(random, NICKNAME_POOL[Math.floor(random() * NICKNAME_POOL.length)]!));
  }
  // A guaranteed fallback keeps every owner named even in a pathological draw.
  while (names.length < count) {
    const name = `Пилот${names.length + 1}`;
    if (!add(name)) names.push(`${name}_${names.length}`);
  }
  return names;
}
