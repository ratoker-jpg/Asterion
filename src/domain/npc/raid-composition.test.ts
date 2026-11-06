import assert from 'node:assert/strict';
import test from 'node:test';

import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import { createDefaultCombatPriority } from '../combat/priority.ts';
import { resolveCombat } from '../combat/resolver.ts';
import { composeRaidForce, raidForcePower, raidForceQuality, type RaidHull } from './raid-composition.ts';

const RACES: readonly CombatFactionId[] = ['aegis', 'synod', 'veyra'];
const priority = createDefaultCombatPriority();

/** A fleet of every combat hull of a race in equal population shares. */
function pool(race: CombatFactionId, population: number): RaidHull[] {
  const hulls = getFactionShipCatalog(race).filter((entity) => entity.category === 'Боевой корабль' && entity.combat && entity.population > 0);
  return hulls.map((entity) => ({ key: entity.id, population: entity.population, attack: entity.combat!.attack, life: entity.combat!.life,
    count: Math.max(1, Math.floor(population / hulls.length / entity.population)) }));
}

const popOf = (hulls: readonly RaidHull[], counts: ReadonlyMap<string, number>) =>
  hulls.reduce((sum, hull) => sum + (counts.get(hull.key) ?? 0) * hull.population, 0);

/** What the bots did before: the same share of every hull type. */
function proportional(hulls: readonly RaidHull[], room: number): Map<string, number> {
  const total = popOf(hulls, new Map(hulls.map((hull) => [hull.key, hull.count])));
  const scale = Math.min(1, room / total);
  return new Map(hulls.map((hull) => [hull.key, Math.floor(hull.count * scale)]));
}

test('the whole fleet goes when it fits the room; nothing without room', () => {
  const hulls = pool('aegis', 20_000);
  const all = composeRaidForce(hulls, 50_000);
  assert.deepEqual([...all.entries()].sort(), hulls.map((hull) => [hull.key, hull.count] as const).sort());
  assert.equal(composeRaidForce(hulls, 0).size, 0);
  assert.equal(composeRaidForce(hulls, Number.POSITIVE_INFINITY).size, hulls.length);
});

test('a short room is filled with the strongest hulls per population; the weakest go last', () => {
  for (const race of RACES) {
    const hulls = pool(race, 80_000);
    const room = 20_000;
    const chosen = composeRaidForce(hulls, room);
    assert.ok(popOf(hulls, chosen) <= room, 'never above the room');
    assert.ok(popOf(hulls, chosen) >= room * 0.97, 'and the room is used');
    const quality = (hull: RaidHull) => Math.sqrt(hull.attack * hull.life) / hull.population;
    const weakest = [...hulls].sort((left, right) => quality(left) - quality(right))[0]!;
    const strongest = [...hulls].sort((left, right) => quality(right) - quality(left))[0]!;
    // At most a sliver of leftover room goes to the weakest hull.
    assert.ok((chosen.get(weakest.key) ?? 0) * weakest.population <= room * 0.02, `${race}: the weakest hull ${weakest.key} stays (almost) home`);
    assert.ok((chosen.get(strongest.key) ?? 0) > 0, `${race}: the strongest hull ${strongest.key} flies`);
    const slice = proportional(hulls, room);
    assert.ok(raidForceQuality(hulls, chosen) > raidForceQuality(hulls, slice) * 1.1, `${race}: clearly stronger per population than a slice of everything`);
  }
});

test('weak hulls are used when they are all there is to fill the room', () => {
  const hulls = pool('veyra', 80_000).filter((hull) => hull.key === 'scout' || hull.key === 'cruiser');
  const chosen = composeRaidForce(hulls, 10_000);
  assert.ok(popOf(hulls, chosen) >= 9_700);
  assert.ok((chosen.get('scout') ?? 0) > 0 || (chosen.get('cruiser') ?? 0) > 0);
});

test('the same input gives the same force, whatever the order of the hulls', () => {
  const hulls = pool('synod', 70_000);
  const left = composeRaidForce(hulls, 25_000);
  const right = composeRaidForce([...hulls].reverse(), 25_000);
  assert.deepEqual([...left.entries()].sort(), [...right.entries()].sort());
  assert.equal(raidForcePower(hulls, left), raidForcePower(hulls, right));
});

/**
 * The game's own battle engine, inside its 35 000 population cap: the composed force against the same
 * defender as the old proportional slice. Both fight a defence of 30 000 population of the same race
 * (every hull in equal shares), eight rounds, one seed.
 */
test('on the real combat engine the composed force beats the old slice (net population destroyed)', () => {
  for (const race of RACES) {
    const hulls = pool(race, 90_000);
    const room = 30_000;
    const fight = (counts: ReadonlyMap<string, number>) => {
      const report = resolveCombat({
        scenarioId: `raid-composition:${race}`, timestamp: '2026-01-01T00:00:00.000Z',
        attacker: { participant: { playerId: 'a', playerName: 'A', side: 'attacker' }, factionId: race, commanders: [],
          ships: hulls.filter((hull) => (counts.get(hull.key) ?? 0) > 0).map((hull) => ({ entityId: hull.key as never, count: counts.get(hull.key)! })) },
        defender: { participant: { playerId: 'd', playerName: 'D', side: 'defender' }, factionId: race, commanders: [], defenses: [],
          ships: pool(race, 30_000).map((hull) => ({ entityId: hull.key as never, count: hull.count })) },
        maxRounds: 8, attackerPriority: [...priority.attack], defenderPriority: [...priority.defense],
        technologyMode: 'independent', executionMode: 'production', seed: `raid-composition:${race}`, profileId: 'asterion-attack-v1',
      }, { reportId: `raid-composition-${race}`, missionType: 'attack' });
      const lost = (force: { populationBefore: number; populationAfter: number }) => force.populationBefore - force.populationAfter;
      return lost(report.defenderForce) - lost(report.attackerForce);
    };
    const composed = fight(composeRaidForce(hulls, room));
    const slice = fight(proportional(hulls, room));
    assert.ok(composed >= slice, `${race}: composed net ${composed} must not trail the slice ${slice}`);
  }
});
