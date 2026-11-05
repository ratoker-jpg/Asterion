import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBattlePoints } from './battle-points.ts';
import { createBattleReportViewModel } from './battle-report-view-model.ts';
import { getFactionCombatEntity } from './faction-catalog.ts';
import type { CombatFactionId } from './factions.ts';
import { combatBaseEntityId, combatGroupTag, type ShipId } from './ids.ts';
import { createDefaultCombatPriority } from './priority.ts';
import { calculateCombatStackPreview, resolveCombat } from './resolver.ts';
import type { CombatInput } from './simulator.ts';
import { createDefaultCombatTechnologies } from './technologies.ts';

/**
 * Joint raids (owner report, 05.11): three owners of three races send fleets to one
 * raid. Every ship must fight by its own race, technologies and level, be lost to its
 * own owner and show up in the report; nothing may be re-skinned as the lead's race.
 */

const priority = createDefaultCombatPriority();
const SHIPS: readonly ShipId[] = ['scout', 'cruiser', 'bomber'];

type Owner = { tag: string | null; factionId: CombatFactionId; laser: number; level: number; counts: Record<string, number> };
const OWNERS: readonly Owner[] = [
  { tag: null, factionId: 'aegis', laser: 0, level: 0, counts: { scout: 50, cruiser: 40, bomber: 30 } },
  { tag: 'g2', factionId: 'synod', laser: 6, level: 3, counts: { scout: 40, cruiser: 30, bomber: 20 } },
  { tag: 'g3', factionId: 'veyra', laser: 12, level: 5, counts: { scout: 30, cruiser: 20, bomber: 10 } },
];

const technologies = (laser: number) => ({ ...createDefaultCombatTechnologies(), laserScience: laser });
const stacksOf = (owner: Owner) => SHIPS.map((id) => ({ entityId: id, count: owner.counts[id]!, level: owner.level }));

function jointInput(): CombatInput {
  const [lead, ...rest] = OWNERS;
  return {
    scenarioId: 'joint-sides',
    timestamp: '2026-11-05T09:00:00.000Z',
    seed: 'joint-sides',
    profileId: 'asterion-attack-v1',
    maxRounds: 8,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    attackerTechnologies: technologies(lead!.laser),
    defenderTechnologies: createDefaultCombatTechnologies(),
    technologyMode: 'independent',
    executionMode: 'production',
    attacker: {
      participant: { side: 'attacker', playerId: 'a', playerName: 'Астера + Лар + Рой', planetName: 'Рейд', coordinates: '1:1:0', race: 'Aegis' },
      factionId: lead!.factionId,
      ships: stacksOf(lead!),
      allyGroups: rest.map((owner) => ({ tag: owner.tag!, factionId: owner.factionId, technologies: technologies(owner.laser), ships: stacksOf(owner) })),
      commanders: [],
    },
    defender: {
      participant: { side: 'defender', playerId: 'sun', playerName: 'Солнце', planetName: 'Солнце', coordinates: '1:1:0', race: 'Aegis' },
      factionId: 'aegis',
      ships: [{ entityId: 'battleship', count: 400, level: 0 }],
      commanders: [],
    },
  };
}

const report = resolveCombat(jointInput(), { reportId: 'joint-sides-report', missionType: 'attack', allowPopulationOverflow: true });

test('every owner of a joint side fights: all three races are in the battle with all their ships', () => {
  for (const owner of OWNERS) {
    for (const id of SHIPS) {
      const stack = report.attackerForce.stacks.find((item) => combatBaseEntityId(item.entityId) === id && combatGroupTag(item.entityId) === owner.tag);
      assert.ok(stack, `${owner.factionId} ${id} is in the battle`);
      assert.equal(stack.countBefore, owner.counts[id], `${owner.factionId} ${id} came with all its ships`);
      assert.equal(stack.factionId, owner.factionId, `${id} keeps the race of its owner`);
    }
  }
  assert.equal(report.attackerForce.stacks.length, 9);
});

test('every ship fights by its own race, technology and level (no lead-race stats for the others)', () => {
  for (const owner of OWNERS) {
    for (const id of SHIPS) {
      const stack = report.attackerForce.stacks.find((item) => combatBaseEntityId(item.entityId) === id && combatGroupTag(item.entityId) === owner.tag)!;
      const expected = calculateCombatStackPreview({ entityId: id, count: owner.counts[id]!, level: owner.level }, owner.factionId, technologies(owner.laser), 'production')!;
      const first = report.initialSnapshot.attacker.stacks.find((item) => item.entityId === stack.entityId)!;
      assert.equal(first.attackPerUnit, expected.attackPerUnit, `${owner.factionId} ${id}: own attack`);
      assert.equal(first.lifePerUnit, expected.lifePerUnit, `${owner.factionId} ${id}: own life`);
    }
  }
  const aegis = getFactionCombatEntity('aegis', 'cruiser').combat;
  const veyra = getFactionCombatEntity('veyra', 'cruiser').combat;
  assert.notDeepEqual(aegis, veyra, 'the races really differ, so the check above is meaningful');
});

test('the report shows every race and points count each ship at its own race price', () => {
  const view = createBattleReportViewModel(report);
  const names = new Set(view.attacker.stacks.map((stack) => `${stack.factionId ?? 'aegis'}:${stack.name}`));
  for (const owner of OWNERS) {
    for (const id of SHIPS) {
      assert.ok(names.has(`${owner.factionId}:${getFactionCombatEntity(owner.factionId, id).name}`), `${owner.factionId} ${id} named in its own race`);
    }
  }
  // The same destroyed hulls priced per race differ from pricing all of them as the lead race.
  const mixed = calculateBattlePoints('attacker', view.attacker.stacks, [], [], [], 'aegis', 'aegis');
  const asLead = calculateBattlePoints('attacker', view.attacker.stacks.map((stack) => ({ ...stack, factionId: undefined })), [], [], [], 'aegis', 'aegis');
  assert.ok(mixed.attackerResourcePointsLost > 0, 'the attackers lost hulls');
  assert.notEqual(mixed.attackerResourcePointsLost, asLead.attackerResourcePointsLost, 'each race is priced by its own catalog');
});

test('a single-owner side is untouched: no group tags and no race fields appear in its report', () => {
  const single = { ...jointInput() };
  single.attacker = { ...single.attacker, allyGroups: undefined };
  const solo = resolveCombat(single, { reportId: 'solo', missionType: 'attack', allowPopulationOverflow: true });
  assert.ok(solo.attackerForce.stacks.every((stack) => combatGroupTag(stack.entityId) === null && stack.factionId === undefined));
});
