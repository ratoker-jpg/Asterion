/**
 * Deterministic randomness shared by the world generator and the Sun raid.
 * Every roll is derived from a string seed, so a reload before a resolution
 * never changes its outcome and tests can replay any campaign exactly.
 */

/** FNV-1a 32-bit hash of a string. */
export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 stream: uniform values in [0, 1). */
export function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInteger(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function pickRandom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** Visible, typeable campaign seed: 8 characters without ambiguous glyphs. */
export function createCampaignSeed(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let seed = '';
  for (let index = 0; index < 8; index += 1) seed += alphabet[Math.floor(random() * alphabet.length)];
  return seed;
}
