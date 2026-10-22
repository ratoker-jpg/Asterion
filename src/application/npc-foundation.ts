import type { SpyTargetState } from '../domain/espionage/types.ts';
import { createSeededRandom, hashSeed } from '../domain/world/random.ts';

/** New-campaign entropy is deliberately independent of the visible map seed. */
export function createNpcPersonaSalt(): string {
  const words = globalThis.crypto.getRandomValues(new Uint32Array(4));
  return Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('');
}

/**
 * Legacy saves have no private entropy. Derive it from their original payload,
 * never the load clock or the newly constructed fallback world. This exception
 * is for migration only; fresh campaigns always use cryptographic entropy.
 */
export function deriveLegacyNpcSalt(value: unknown): string {
  const payload = JSON.stringify(value);
  return `legacy-v1-${Array.from({ length: 4 }, (_, index) => (
    hashSeed(`npc-migration:${index}:${payload}`).toString(16).padStart(8, '0')
  )).join('')}`;
}

/** Separate name stream: neither geography nor persona generation consumes it. */
export function assignNpcDisplayNames(planets: readonly SpyTargetState[], salt: string): SpyTargetState[] {
  const ownerIds = [...new Set(planets.map((planet) => planet.ownerId))].sort();
  const names = ownerIds.map((ownerId) => planets.find((planet) => planet.ownerId === ownerId)!.ownerName);
  const random = createSeededRandom(`npc-display-names:v1:${salt}`);
  for (let index = names.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [names[index], names[other]] = [names[other]!, names[index]!];
  }
  const byOwner = new Map(ownerIds.map((ownerId, index) => [ownerId, names[index]!]));
  return planets.map((planet) => ({ ...planet, ownerName: byOwner.get(planet.ownerId)! }));
}

export function getNpcOwnerIds(targets: Record<string, SpyTargetState> | undefined, playerId: string): string[] {
  return [...new Set(Object.values(targets ?? {})
    .filter((target) => target.kind !== 'player' && target.ownerId !== playerId)
    .map((target) => target.ownerId))].sort();
}
