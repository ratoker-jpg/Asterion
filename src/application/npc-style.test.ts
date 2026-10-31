// Play styles (owner 31.10.2026): the character gives the usual style, the
// situation changes it, and the style only weighs action families.
import assert from 'node:assert/strict';
import test from 'node:test';
import { npcCharacterStyle, npcStyleBias, readNpcPlayStyle } from './npc-style.ts';
import { createNpcUtilityContext, strategyOf } from './npc-utility.ts';
import { createInitialSaveState } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { NpcProfile } from '../domain/npc/types.ts';

const NOW = Date.UTC(2026, 9, 31);

function withTraits(profile: NpcProfile, traits: Partial<NpcProfile['traits']>): NpcProfile {
  return { ...profile, traits: { ...profile.traits, ...traits } };
}

test('a character leans to a style, an attack turns any owner to its fortress', () => {
  const config = createDefaultNewGameConfig({ seed: 'NPCSTYLE', factionId: 'aegis', playerName: 'Style Test' });
  const state = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount: 3 } });
  const base = Object.values(state.npc!.profiles)[0]!;
  const raider = withTraits(base, { aggression: 0.95, riskTolerance: 0.9, planningHorizon: 0.1, economyFocus: 0.2, cooperation: 0.9, militaryFocus: 0.3 });
  assert.equal(npcCharacterStyle(raider), 'raider');
  const economist = withTraits(base, { economyFocus: 0.95, expansionFocus: 0.9, militaryFocus: 0.05, aggression: 0.1, riskTolerance: 0.6, cooperation: 0.2 });
  assert.equal(npcCharacterStyle(economist), 'economist');
  const calm = createNpcUtilityContext(state, raider, NOW, 1);
  assert.equal(readNpcPlayStyle(state, raider, calm, strategyOf(calm)).reason, 'character');
  const attacked = { ...calm, threat: 1 };
  assert.deepEqual(readNpcPlayStyle(state, raider, attacked, strategyOf(attacked)), { style: 'fortress', reason: 'attacked' });
  assert.ok(npcStyleBias('fortress', 'attack') < 1 && npcStyleBias('raider', 'attack') > 1);
});
