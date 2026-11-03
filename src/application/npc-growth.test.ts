// NPC growth (owner playtest 03.11.2026): a max-activity NPC stood idle behind
// a drawn «wait» and never placed its production robots.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { MAX_PRODUCTION_BOTS_PER_RESOURCE, getAvailableProductionBots, getProductionBotAssignmentTotal } from '../domain/buildings/production-bots.ts';
import { chooseNpcAutonomyAction, type NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import { createInitialSaveState } from './persistence.ts';
import { applyNpcAutonomyAttention, npcKeepQueueBusyOptions } from './npc-autonomy.ts';
import { assignNpcProductionBots } from './npc-economy.ts';
import type { SaveState } from './contracts.ts';

const START = Date.UTC(2026, 10, 3, 14, 26);

function makeCampaign(seed: string): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'NPC growth' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 3, campaignSpeed: 'superfast' as const } });
}

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage))
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

const candidate = (id: string, kind: string, weight: number, role?: string): NpcAutonomyCandidate =>
  ({ id, kind, weight, ...(role ? { payload: { role } } : {}) });

test('a draw with no-wait never ends in a pause, the ordinary draw sometimes does', () => {
  const state = makeCampaign('npc-growth-wait');
  const owner = npcTargets(state)[0]!.ownerId;
  const profile = { ...state.npc!.profiles[owner]!, traits: { ...state.npc!.profiles[owner]!.traits, attention: 0, persistence: 0 } };
  const options = [candidate('building:p:metal-production-1', 'economy', 0.4, 'metal-production-1')];
  let ordinaryWaits = 0;
  for (let index = 0; index < 200; index += 1) {
    if (chooseNpcAutonomyAction(profile, options, `wait-${index}`) === null) ordinaryWaits += 1;
    assert.equal(chooseNpcAutonomyAction(profile, options, `wait-${index}`, { noWait: true })?.id, options[0]!.id);
  }
  assert.ok(ordinaryWaits > 0, 'the ordinary draw still lets an owner pause');
});

test('keep-busy options: economy buildings worth a fair share of the best, nothing else', () => {
  const open = [
    candidate('building:p:metal-production-1', 'economy', 4, 'metal-production-1'),
    candidate('building:p:metal-storage', 'economy', 0.5, 'metal-storage'),
    candidate('building:p:basic-energy', 'economy', 2, 'basic-energy'),
    candidate('building:p:spaceport', 'economy', 3, 'spaceport'),
    candidate('building:p:shipyard', 'production', 3, 'shipyard'),
    candidate('science:p:3', 'science', 3),
    candidate('npc-mission:x:attack:p', 'attack', 5),
  ];
  assert.deepEqual(npcKeepQueueBusyOptions(open).map((item) => item.id).sort(), ['building:p:basic-energy', 'building:p:metal-production-1']);
  assert.deepEqual(npcKeepQueueBusyOptions(open.slice(4)), []);
});

test('a look with money and a free queue always starts something, whatever the owner’s mood', () => {
  const state = makeCampaign('npc-growth-look');
  const planet = npcTargets(state)[0]!;
  const owner = planet.ownerId;
  const rich: SaveState = {
    ...state,
    espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [planet.id]: {
      ...planet, resources: { ...planet.resources, metal: 5_000_000, minerals: 5_000_000, gas: 5_000_000, developmentEnergy: 1_000 },
      resourceClock: { lastReconciledAt: START + 60_000, remainder: { metal: 0, minerals: 0, gas: 0 } },
    } } },
    npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [owner]: { ...state.npc!.profiles[owner]!,
      traits: { ...state.npc!.profiles[owner]!.traits, attention: 0, persistence: 0, economyFocus: 1 } } } },
  };
  for (let index = 0; index < 40; index += 1) {
    const decisions = applyNpcAutonomyAttention(rich, rich.npc!.profiles[owner]!, `growth-look-${index}`, START + 60_000, 5, 24);
    assert.ok(decisions.some((decision) => decision.started), `look ${index} started nothing`);
  }
});

test('production robots are placed where they add most, capped, and the placement is stable', () => {
  const planet = npcTargets(makeCampaign('npc-growth-bots'))[0]!;
  const withFactory: SpyTargetState = { ...planet, buildings: { ...planet.buildings, 'metal-production-1': 12, 'mineral-production-1': 10, 'gas-production-1': 8, construction: 8 } };
  assert.equal(getAvailableProductionBots({ construction: 8, 'advanced-factory': 0 }), 8);
  const placed = assignNpcProductionBots(withFactory);
  assert.equal(getProductionBotAssignmentTotal(placed.productionBots!), 8);
  assert.ok(placed.productionBots!.metal >= placed.productionBots!.minerals, 'the richest base income takes robots first');
  assert.equal(assignNpcProductionBots(placed), placed, 'same placement, same object');

  const huge: SpyTargetState = { ...withFactory, buildings: { ...withFactory.buildings, construction: 20, 'advanced-factory': 5 } };
  const full = assignNpcProductionBots(huge).productionBots!;
  assert.ok(Object.values(full).every((count) => count <= MAX_PRODUCTION_BOTS_PER_RESOURCE));
  assert.equal(getProductionBotAssignmentTotal(full), 30);

  assert.equal(assignNpcProductionBots(planet), planet, 'no factory, no robots');
});

test('a look places the robots of a settled planet and leaves an unsettled one alone', () => {
  const state = makeCampaign('npc-growth-bots-look');
  const planet = npcTargets(state)[0]!;
  const owner = planet.ownerId;
  const at = START + 120_000;
  const withRobots = (lastReconciledAt: number): SaveState => ({
    ...state,
    espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [planet.id]: {
      ...planet, buildings: { ...planet.buildings, construction: 6 },
      resourceClock: { lastReconciledAt, remainder: { metal: 0, minerals: 0, gas: 0 } },
    } } },
  });
  const settled = withRobots(at);
  const after = applyNpcAutonomyAttention(settled, settled.npc!.profiles[owner]!, 'growth-bots-look', at, 5, 1).at(-1)!.state;
  assert.equal(getProductionBotAssignmentTotal(after.espionage!.targets![planet.id]!.productionBots!), 6);
  const stale = withRobots(at - 60_000);
  const kept = applyNpcAutonomyAttention(stale, stale.npc!.profiles[owner]!, 'growth-bots-look', at, 5, 1).at(-1)!.state;
  assert.equal(kept.espionage!.targets![planet.id]!.productionBots, undefined);
});
