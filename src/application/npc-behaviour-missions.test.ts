import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcProfile, NpcTraits } from '../domain/npc/types.ts';
import { COMMANDER_IDS, type CommanderId } from '../domain/combat/commanders.ts';
import { advanceUniverseAsteroidSimulationAt } from '../domain/universe/asteroid-simulation.ts';
import { previewSpaceportUpgrade } from '../domain/buildings/spaceport-upgrades.ts';
import { calculateRepairCost, getRepairEntity } from '../domain/repair/workshop.ts';
import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchNpcDeployment, dispatchNpcGas, dispatchNpcMission } from './npc-missions.ts';
import { reconcileFlights } from './flights.ts';
import { forecastAsteroidAt } from './asteroid-gas-collection.ts';
import { planNpcGasMission } from './npc-gas.ts';
import { createNpcUtilityContext, estimateCommanderUpgradeUtility } from './npc-utility.ts';
import { npcCombatPriority, npcCommanderStyle, npcEnemyShape, npcMainCommander } from './npc-commanders.ts';
import { getNpcSpaceportCommanderCandidates, settleNpcSpaceport, startNpcSpaceportUpgrade } from './npc-spaceport.ts';
import { assessNpcPlanetThreat } from './npc-threat.ts';
import { npcRepairPoolValue, repairNpcPlanet } from './npc-repair.ts';
import { applyNpcAutonomyAttention } from './npc-autonomy.ts';
import type { SaveState } from './contracts.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';

const START = Date.UTC(2026, 9, 27, 12);

function makeCampaign(seed: string, npcCount = 3): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'NPC missions' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount, campaignSpeed: 'standard' as const } });
}

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage))
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function saveReload(state: SaveState, saveKey: string): SaveState {
  const persistence = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey, now: () => START });
  const written = persistence.write(state);
  assert.equal(written.ok, true, written.ok ? undefined : written.error);
  const loaded = persistence.load();
  if (loaded.status !== 'loaded') assert.fail('problem' in loaded ? JSON.stringify(loaded.problem) : 'save was missing after write');
  return loaded.state;
}

function withTarget(state: SaveState, target: SpyTargetState): SaveState {
  return { ...state, espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [target.id]: target } } };
}

function planet(state: SaveState, id: string): SpyTargetState {
  return getEspionageTargets(state.espionage)[id]!;
}

function withTraits(state: SaveState, ownerId: string, traits: Partial<NpcTraits>): SaveState {
  const profile = state.npc!.profiles[ownerId]!;
  return { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [ownerId]: { ...profile, traits: { ...profile.traits, ...traits } } } } };
}

function profileOf(state: SaveState, ownerId: string): NpcProfile {
  return state.npc!.profiles[ownerId]!;
}

function withCommanders(state: SaveState, planetId: string, commanders: Partial<Record<CommanderId, number>>, levels: Partial<Record<CommanderId, number>> = {}): SaveState {
  const target = planet(state, planetId);
  const ownerProfile = { scienceLevels: {}, shipLevels: {}, ...(target.ownerProfile ?? {}), commanderLevels: { ...(target.ownerProfile?.commanderLevels ?? {}), ...levels } };
  return withTarget(state, {
    ...target,
    ownerProfile: ownerProfile as SpyTargetState['ownerProfile'],
    fleet: { ...target.fleet, commanders: { ...target.fleet.commanders, ...commanders } },
    commanders: Object.fromEntries(Object.entries({ ...target.fleet.commanders, ...commanders }).filter(([, count]) => (count ?? 0) > 0)
      .map(([id, count]) => [id, { level: ownerProfile.commanderLevels[id as CommanderId] ?? 0, count: count! }])) as SpyTargetState['commanders'],
  });
}

test('gas: the owner aims where the asteroid will be at arrival and brings home what the game collects there', () => {
  const campaign = makeCampaign('npc-missions-gas', 2);
  const simulation = campaign.asteroidSimulation!;
  const asteroid = [...simulation.asteroids].sort((left, right) => right.nextMoveAt - left.nextMoveAt).find((item) => item.nextCoordinate)!;
  assert.ok(asteroid, 'the campaign has a moving asteroid');
  const owner = npcTargets(campaign)[0]!;
  // The owner's planet sits next to the asteroid, short of gas, with recyclers at home.
  const home: SpyTargetState = { ...owner, coordinate: { ...asteroid.coordinate, position: asteroid.coordinate.position === 1 ? 2 : 1 },
    resources: { ...owner.resources, gas: 5_000 }, fleet: { ...owner.fleet, ships: { ...owner.fleet.ships, recycler: 4 } } };
  const state = withTarget(campaign, home);
  const context = createNpcUtilityContext(state, profileOf(state, owner.ownerId), START, 1);
  const plan = planNpcGasMission(state, context, 1);
  assert.ok(plan, 'a planet short of gas next to an asteroid plans a trip');
  const forecast = forecastAsteroidAt(simulation, plan.coordinate, plan.arrivalAt);
  assert.ok(forecast, 'the game model confirms the asteroid will be at the aimed coordinate');

  const sent = dispatchNpcGas(state, { requestId: 'npc-autonomy:missions:gas', ownerId: owner.ownerId, originPlanetId: home.id,
    coordinate: plan.coordinate, selectedShips: plan.ships }, START, 1);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  assert.equal(sent.flight!.arrivalAt, plan.arrivalAt);
  // The save keeps an NPC gas flight.
  const reloaded = saveReload(sent.state, 'npc-missions-gas');
  // The replay moves asteroids before flights at a checkpoint; do the same here.
  const moved = { ...reloaded, asteroidSimulation: advanceUniverseAsteroidSimulationAt(reloaded.asteroidSimulation!, plan.arrivalAt, 1).state };
  const arrived = reconcileFlights(moved, plan.arrivalAt, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  const flight = arrived.flights.records.find((item) => item.id === sent.flight!.id)!;
  assert.equal(flight.phase, 'returning');
  assert.equal(flight.cargo?.gas, plan.haul, 'the haul is what the forecast promised');
  const gasBefore = planet(arrived, home.id).resources.gas;
  const back = reconcileFlights(arrived, flight.returnAt!, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  assert.ok(planet(back, home.id).resources.gas > gasBefore, 'the gas lands in the stores');
  assert.equal(back.flights.records.find((item) => item.id === flight.id)?.phase, 'completed');
  // Nothing about gas reaches the player's reports.
  assert.equal(back.reports, reloaded.reports);
});

test('commanders fly with an NPC deployment, survive save and load, and join the destination', () => {
  const campaign = makeCampaign('npc-missions-deploy-commanders', 2);
  const owner = npcTargets(campaign)[0]!;
  const colony: SpyTargetState = { ...owner, id: `${owner.id}-colony`, name: 'Колония теста',
    coordinate: { ...owner.coordinate, position: owner.coordinate.position === 1 ? 2 : 1 }, fleet: { ...owner.fleet, ships: { ...owner.fleet.ships } } };
  let state = withCommanders(withTarget(campaign, colony), owner.id, { executioner: 1 }, { executioner: 7 });
  const sent = dispatchNpcDeployment(state, { requestId: 'npc-autonomy:missions:deploy-commander', ownerId: owner.ownerId, originPlanetId: owner.id,
    destinationPlanetId: colony.id, selectedShips: { scout: 1 }, selectedCommanders: { executioner: 1 } }, START, 1);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  assert.equal(sent.flight!.selectedCommanders?.executioner, 1);
  assert.equal(sent.flight!.selectedCommanderLevels?.executioner, 7);
  assert.equal(planet(sent.state, owner.id).fleet.commanders.executioner ?? 0, 0, 'the commander left its planet');
  const tooMany = dispatchNpcDeployment(sent.state, { requestId: 'npc-autonomy:missions:deploy-commander-2', ownerId: owner.ownerId, originPlanetId: owner.id,
    destinationPlanetId: colony.id, selectedShips: {}, selectedCommanders: { executioner: 1 } }, START, 1);
  assert.equal(tooMany.reason, 'insufficient-commanders');
  state = saveReload(sent.state, 'npc-missions-deploy-commander');
  const landed = reconcileFlights(state, sent.flight!.arrivalAt, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  assert.equal(planet(landed, colony.id).fleet.commanders.executioner, 1);
  assert.equal(planet(landed, colony.id).commanders.executioner?.level, 7, 'it fights at its owner-wide level');
});

test('the main commander follows the owner\'s style, is stable, comes first and is raised at the player\'s prices', () => {
  const aggressor = { aggression: 1, militaryFocus: 1, riskTolerance: 0.5, persistence: 0, mechanicsKnowledge: 0, scienceFocus: 0,
    operationsInterest: 0, economyFocus: 0, cooperation: 0 } as unknown as NpcTraits;
  const defender = { aggression: 0, militaryFocus: 0.8, riskTolerance: 0, persistence: 1, mechanicsKnowledge: 0, scienceFocus: 0,
    operationsInterest: 0, economyFocus: 0, cooperation: 0 } as unknown as NpcTraits;
  assert.equal(npcCommanderStyle(aggressor), 'aggressor');
  assert.equal(npcMainCommander(aggressor), 'executioner');
  assert.equal(npcMainCommander(defender), 'juggernaut');
  assert.equal(npcMainCommander(aggressor), npcMainCommander({ ...aggressor }), 'deterministic');

  const campaign = makeCampaign('npc-missions-main-commander', 2);
  const owner = npcTargets(campaign)[0]!;
  let state = withTraits(campaign, owner.ownerId, aggressor);
  const home = planet(state, owner.id);
  state = withTarget(state, { ...home, buildings: { ...home.buildings, spaceport: 5, shipyard: 10 },
    resources: { ...home.resources, metal: 5_000_000, minerals: 5_000_000, gas: 5_000_000 } });
  state = withCommanders(state, owner.id, { executioner: 1, viper: 1 }, { executioner: 3, viper: 0 });
  // Every science the commander track asks for is known (the test is about choice and price, not requirements).
  const science = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 10]));
  const target = planet(state, owner.id);
  const candidates = getNpcSpaceportCommanderCandidates(target, science, 1, { executioner: 1, viper: 1 });
  const main = candidates.find((preview) => preview.shipId === 'executioner');
  assert.ok(main, 'the main commander can be raised in the Spaceport');

  const context = createNpcUtilityContext(state, profileOf(state, owner.ownerId), START, 1);
  const mainUtility = estimateCommanderUpgradeUtility(context, 'executioner', 3, 3, main.cost);
  const otherUtility = estimateCommanderUpgradeUtility(context, 'viper', 0, 3, candidates.find((preview) => preview.shipId === 'viper')?.cost ?? null);
  assert.ok(mainUtility > otherUtility, 'the main commander is raised first');

  const started = startNpcSpaceportUpgrade(target, 'executioner', science, START, 1, 'npc-autonomy:missions:commander-upgrade', 'commanders');
  assert.equal(started.ok, true, started.reason ?? undefined);
  // The same price the player pays for this level.
  const playerPrice = previewSpaceportUpgrade({ state: { shipLevels: { executioner: 3 }, shipQueue: [], commanderQueue: [] },
    wallet: { metal: 5_000_000, minerals: 5_000_000, gas: 5_000_000 }, buildings: migrateBuildingLevels(target.buildings), scienceLevels: science,
    spaceportLevel: 5, factionId: target.raceId, mode: 'production', testTimeScale: 1 }, 'commanders', 'executioner').cost;
  assert.deepEqual({ metal: target.resources.metal - started.target.resources.metal, minerals: target.resources.minerals - started.target.resources.minerals,
    gas: target.resources.gas - started.target.resources.gas }, playerPrice);
  const task = started.target.spaceportUpgrades!.commanderQueue[0]!;
  const raised = settleNpcSpaceport(started.target, task.finishAt);
  assert.equal(raised.ownerProfile?.commanderLevels.executioner, 4);
  assert.equal(raised.commanders.executioner?.level, 4, 'the commander on the planet fights at the new level');
});

test('NPC combat priority decides which commander leads, and below espionage 10 it never reads the attack\'s ships', () => {
  const campaign = makeCampaign('npc-missions-priority', 2);
  const [attacker, defender] = npcTargets(campaign);
  let state = withCommanders(campaign, defender.id, { executioner: 1, juggernaut: 1 }, { executioner: 5, juggernaut: 5 });
  state = withAttackEligiblePoints({ ...state }, [attacker.ownerId, defender.ownerId], 1_000);
  const fight = (order: CommanderId[], requestId: string) => {
    const profile = profileOf(state, defender.ownerId);
    const ordered = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [defender.ownerId]: { ...profile,
      combatPriority: { attack: [...COMMANDER_IDS], defense: order } } } } };
    const origin = planet(ordered, attacker.id);
    const sent = dispatchNpcMission(withTarget(ordered, { ...origin, fleet: { ...origin.fleet, ships: { ...origin.fleet.ships, cruiser: 5 } } }), {
      ownerId: attacker.ownerId, originPlanetId: attacker.id, requestId, missionId: 'attack', selectedShips: { cruiser: 5 },
      destination: { kind: 'planet', planetId: defender.id, coordinate: defender.coordinate }, targetPlanetId: defender.id }, START, 1);
    assert.equal(sent.ok, true, sent.reason ?? undefined);
    const after = reconcileFlights(sent.state, sent.flight!.arrivalAt, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
    return after.combat.reports.find((report) => report.id === `battle-attack-${sent.flight!.id}`)!.defenderForce.activeCommanderId;
  };
  assert.equal(fight(['juggernaut', ...COMMANDER_IDS.filter((id) => id !== 'juggernaut')], 'npc-autonomy:missions:priority-1'), 'juggernaut');
  assert.equal(fight(['executioner', ...COMMANDER_IDS.filter((id) => id !== 'executioner')], 'npc-autonomy:missions:priority-2'), 'executioner');

  // What the order may rest on: a heavily armoured attack known from espionage 10 lifts the Judge.
  const tactician = { aggression: 0, militaryFocus: 0, riskTolerance: 0.5, persistence: 0, mechanicsKnowledge: 1, scienceFocus: 1,
    operationsInterest: 0, economyFocus: 0, cooperation: 0 } as unknown as NpcTraits;
  const heavy = npcEnemyShape('aegis', { destroyer: 10 });
  assert.ok(heavy && heavy.heavyArmourShare > 0.9);
  const withoutKnowledge = npcCombatPriority(tactician, {}, null, COMMANDER_IDS);
  const withKnowledge = npcCombatPriority(tactician, {}, heavy, COMMANDER_IDS);
  assert.equal(withKnowledge[0], npcMainCommander(tactician));
  assert.ok(withKnowledge.indexOf('judge') <= withoutKnowledge.indexOf('judge'));

  // Espionage 9: the attack's ships are not known (no own reports on the attacker), so nothing shapes the order.
  const origin = planet(state, attacker.id);
  const launched = dispatchNpcMission(withTarget(state, { ...origin, fleet: { ...origin.fleet, ships: { ...origin.fleet.ships, destroyer: 3 } } }), {
    ownerId: attacker.ownerId, originPlanetId: attacker.id, requestId: 'npc-autonomy:missions:priority-blind', missionId: 'attack', selectedShips: { destroyer: 3 },
    destination: { kind: 'planet', planetId: defender.id, coordinate: defender.coordinate }, targetPlanetId: defender.id }, START, 1);
  assert.equal(launched.ok, true, launched.reason ?? undefined);
  const levelled = (level: number) => {
    const science = launched.state.npcScience!.owners[defender.ownerId]!;
    return { ...launched.state, npcScience: { ...launched.state.npcScience!, owners: { ...launched.state.npcScience!.owners,
      [defender.ownerId]: { ...science, levels: { ...science.levels, 5: level } } } } };
  };
  const blind = levelled(9);
  const seen = levelled(10);
  const knownAt = (world: SaveState) => assessNpcPlanetThreat(world, createNpcUtilityContext(world, profileOf(world, defender.ownerId), START + 1, 1),
    planet(world, defender.id), 1)?.incoming[0]?.knownShips;
  assert.equal(knownAt(blind), undefined, 'at level 9 the composition is not read');
  assert.deepEqual(knownAt(seen)?.ships, { destroyer: 3 });
});

test('the workshop: an NPC repairs at the player\'s prices and meets a second attack with its fleet restored', () => {
  const campaign = makeCampaign('npc-missions-repair', 2);
  const [attacker, defender] = npcTargets(campaign);
  let state = withAttackEligiblePoints(campaign, [attacker.ownerId, defender.ownerId], 1_000);
  const home = planet(state, defender.id);
  state = withTarget(state, { ...home, fleet: { ...home.fleet, ships: { ...home.fleet.ships, cruiser: 30 } },
    resources: { ...home.resources, metal: 2_000_000, minerals: 2_000_000, gas: 2_000_000 } });
  const source = planet(state, attacker.id);
  state = withTarget(state, { ...source, fleet: { ...source.fleet, ships: { ...source.fleet.ships, cruiser: 20 } } });
  const send = (world: SaveState, ships: Record<string, number>, requestId: string, at: number) => {
    const sent = dispatchNpcMission(world, { ownerId: attacker.ownerId, originPlanetId: attacker.id, requestId, missionId: 'attack', selectedShips: ships,
      destination: { kind: 'planet', planetId: defender.id, coordinate: defender.coordinate }, targetPlanetId: defender.id }, at, 1);
    assert.equal(sent.ok, true, sent.reason ?? undefined);
    return sent;
  };
  const first = send(state, { cruiser: 10 }, 'npc-autonomy:missions:repair-1', START);
  const second = send(first.state, { cruiser: 10 }, 'npc-autonomy:missions:repair-2', START + 60 * 60_000);
  const afterFirst = reconcileFlights(second.state, first.flight!.arrivalAt, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  const hurt = planet(afterFirst, defender.id);
  const pool = hurt.repair?.ships.cruiser ?? 0;
  assert.ok(pool > 0, 'ships lost in defence wait in the workshop');
  assert.ok(npcRepairPoolValue(hurt) > 0);

  // The repair costs what the player pays.
  const entity = getRepairEntity(hurt.raceId, 'ship', 'cruiser')!;
  const repaired = repairNpcPlanet(hurt, 1);
  assert.equal(repaired.target.fleet.ships.cruiser, (hurt.fleet.ships.cruiser ?? 0) + pool);
  // Everything waiting in the workshop came back, each at the player's repair price.
  let expected = 0;
  for (const [category, units] of [['ship', hurt.repair!.ships], ['defense', hurt.repair!.defenses]] as const) {
    for (const [id, count] of Object.entries(units)) {
      if (!count || id === 'solar-satellite') continue;
      const repairEntity = getRepairEntity(hurt.raceId, category, id);
      if (repairEntity) expected += calculateRepairCost(repairEntity, count).metal;
    }
  }
  assert.ok(entity);
  assert.equal(hurt.resources.metal - repaired.target.resources.metal, expected);

  // Between the two attacks the owner looks at the game: it repairs before judging the second one.
  const look = applyNpcAutonomyAttention(afterFirst, profileOf(afterFirst, defender.ownerId), 'npc-missions-repair-look', first.flight!.arrivalAt + 60_000, 1, 1);
  const lookState = look.at(-1)!.state;
  const restored = planet(lookState, defender.id);
  assert.equal(restored.repair?.ships.cruiser ?? 0, 0, 'the workshop is emptied before anything else');
  // The look's own action may then move the fleet (fight, reinforce or leave): count it wherever it is.
  const flying = lookState.flights.records.filter((flight) => flight.originPlanetId === defender.id && flight.departedAt === first.flight!.arrivalAt + 60_000)
    .reduce((sum, flight) => sum + (flight.selectedShips.cruiser ?? 0), 0);
  assert.equal((restored.fleet.ships.cruiser ?? 0) + flying, (hurt.fleet.ships.cruiser ?? 0) + pool, 'the repaired cruisers are back in service');
  const context = (world: SaveState) => createNpcUtilityContext(world, profileOf(world, defender.ownerId), first.flight!.arrivalAt + 60_000, 1);
  // The second attack judged with the fleet after repair (the repaired planet, before any action of the look).
  const repairedWorld = withTarget(afterFirst, repaired.target);
  const before = assessNpcPlanetThreat(afterFirst, context(afterFirst), hurt, 1)!;
  const after = assessNpcPlanetThreat(repairedWorld, context(repairedWorld), repaired.target, 1)!;
  assert.equal(after.arrivalAt, second.flight!.arrivalAt);
  assert.ok(after.defence > before.defence, 'the second attack is judged with the fleet after repair');
});

test('older saves: NPC profiles without combat priority load and get one at the next look', () => {
  const campaign = makeCampaign('npc-missions-old-save', 2);
  const owner = npcTargets(campaign)[0]!;
  const loaded = saveReload(campaign, 'npc-missions-old-save');
  assert.equal(profileOf(loaded, owner.ownerId).combatPriority, undefined);
  const look = applyNpcAutonomyAttention(loaded, profileOf(loaded, owner.ownerId), 'npc-missions-old-save-look', START + 60_000, 1, 1);
  const priority = profileOf(look.at(-1)!.state, owner.ownerId).combatPriority;
  assert.ok(priority);
  assert.equal(priority.defense[0], npcMainCommander(profileOf(loaded, owner.ownerId).traits), 'the main commander leads');
  assert.deepEqual(profileOf(saveReload(look.at(-1)!.state, 'npc-missions-old-save-2'), owner.ownerId).combatPriority, priority);
});
