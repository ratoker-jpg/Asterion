import assert from 'node:assert/strict';
import test from 'node:test';

import { getFactionDefenseCatalog, getFactionShipCatalog } from './faction-catalog.ts';
import { FACTION_SHIP_MECHANICS } from './faction-ship-data.ts';
import { COMBAT_FACTIONS, getCombatFactionName } from './factions.ts';
import { SHIP_IDS } from './ids.ts';
import { createDefaultCombatPriority } from './priority.ts';
import {
  migrateSimulatorState,
  normalizeSimulatorScenario,
} from './simulator-repository.ts';
import {
  createEmptySimulatorScenario,
  scenarioToCombatInput,
  setScenarioFaction,
} from './simulator.ts';
import { COMBAT_TECHNOLOGIES, normalizeCombatTechnologies } from './technologies.ts';

const populatedScenario = {
  ...createEmptySimulatorScenario(),
  attacker: {
    ships: [{ entityId: 'scout' as const, count: 3 }],
    commanders: [{ entityId: 'corsair' as const, count: 1 }],
  },
  defender: {
    ships: [{ entityId: 'battleship' as const, count: 2 }],
    commanders: [{ entityId: 'judge' as const, count: 1 }],
    defenses: [{ entityId: 'laser-turret' as const, count: 4 }],
  },
};

test('simulator exposes exactly the three Asterion player races', () => {
  assert.deepEqual(COMBAT_FACTIONS, [
    { id: 'aegis', name: 'Астеры' },
    { id: 'synod', name: 'Илары' },
    { id: 'veyra', name: 'Рой' },
  ]);
});

test('simulator science fields match the saved Nemexia fleet simulator', () => {
  assert.deepEqual(COMBAT_TECHNOLOGIES.map(({ sourceScienceId, name }) => [sourceScienceId, name]), [
    [10, 'Лазерная наука'],
    [11, 'Ионная наука'],
    [12, 'Плазменная наука'],
    [18, 'Пробивающая атака'],
    [21, 'Лёгкая броня'],
    [22, 'Средняя броня'],
    [23, 'Тяжёлая броня'],
    [7, 'Броня кораблей'],
    [19, 'Маневренная защита'],
    [20, 'Критический удар'],
  ]);
});

test('race presentation uses the naming contract approved in Asterion PR #26', () => {
  assert.deepEqual(getFactionShipCatalog('synod').map((entity) => entity.name), [
    'Энергосфера',
    'Сканер',
    'Транспортный дрон',
    'Транспортный модуль',
    'Ковчег',
    'Репликатор',
    'Ланцет',
    'Импульс',
    'Барьер',
    'Монолит',
    'Голиаф',
    'Пульсар',
    'Разлом',
  ]);
  assert.deepEqual(getFactionShipCatalog('veyra').map((entity) => entity.name), [
    'Симбионт',
    'Глаз',
    'Носильщик',
    'Тяжеловоз',
    'Зародыш',
    'Падальщик',
    'Жало',
    'Стрекоза',
    'Панцирник',
    'Скарабей',
    'Шмель',
    'Спороносец',
    'Пожиратель',
  ]);
  assert.deepEqual(getFactionDefenseCatalog('synod').map((entity) => entity.name), [
    'Ударная матрица',
    'Лазерная матрица',
    'Ионная матрица',
    'Плазменная матрица',
    'Лазерно-ионная матрица',
    'Плазменно-лазерная матрица',
    'Ионно-плазменная матрица',
    'Матричный щит',
    'Планетарная матрица',
  ]);
  assert.deepEqual(getFactionDefenseCatalog('veyra').map((entity) => entity.name), [
    'Шипомёт',
    'Лазерная железа',
    'Ионное плетение',
    'Плазменное плетение',
    'Лазерно-ионный орган',
    'Плазменно-лазерный орган',
    'Ионно-плазменный орган',
    'Хитиновый щит',
    'Планетарная мембрана',
  ]);
});

test('race selection swaps presentation roster while preserving canonical mechanical IDs', () => {
  const asterScout = getFactionShipCatalog('aegis').find((entity) => entity.id === 'scout');
  const ilarScout = getFactionShipCatalog('synod').find((entity) => entity.id === 'scout');
  const swarmScout = getFactionShipCatalog('veyra').find((entity) => entity.id === 'scout');
  assert.equal(asterScout?.name, 'Скаут');
  assert.equal(ilarScout?.name, 'Ланцет');
  assert.equal(swarmScout?.name, 'Жало');
  assert.notEqual(asterScout?.art, ilarScout?.art);
  assert.notEqual(ilarScout?.art, swarmScout?.art);
  assert.equal(asterScout?.combat.attack, 800);
  assert.equal(ilarScout?.combat.attack, 800);
  assert.equal(swarmScout?.combat.attack, 400);
  assert.notEqual(asterScout?.ship?.speed, ilarScout?.ship?.speed);
  assert.equal(ilarScout?.ship?.speed, swarmScout?.ship?.speed);

  const asterDefense = getFactionDefenseCatalog('aegis').find((entity) => entity.id === 'ballistic-turret');
  const ilarDefense = getFactionDefenseCatalog('synod').find((entity) => entity.id === 'ballistic-turret');
  const swarmDefense = getFactionDefenseCatalog('veyra').find((entity) => entity.id === 'ballistic-turret');
  assert.equal(asterDefense?.name, 'Защитная матрица');
  assert.equal(ilarDefense?.name, 'Ударная матрица');
  assert.equal(swarmDefense?.name, 'Шипомёт');
  assert.notEqual(asterDefense?.art, ilarDefense?.art);
  assert.notEqual(ilarDefense?.art, swarmDefense?.art);
});

test('canonical source registry resolves all 39 ships without a faction fallback', () => {
  const expectedFolders = {
    aegis: 'Корабли Синяя раса',
    synod: 'Корабли Зеленная раса',
    veyra: 'Корабли Рой Красные',
  } as const;

  for (const faction of COMBAT_FACTIONS) {
    const mechanics = FACTION_SHIP_MECHANICS[faction.id];
    assert.deepEqual(Object.keys(mechanics).sort(), [...SHIP_IDS].sort(), `${faction.id} must have 13 source records`);
    const catalog = getFactionShipCatalog(faction.id);
    assert.equal(catalog.length, 13);

    for (const entity of catalog) {
      const source = mechanics[entity.id];
      assert.ok(source, `${faction.id}/${entity.id} must have source data`);
      assert.match(source.sourceFile, new RegExp(`${expectedFolders[faction.id]}\\/page_.*\\.html$`));
      assert.equal(entity.population, source.population);
      assert.deepEqual(entity.cost, source.cost);
      assert.deepEqual(entity.combat, source.combat);
      assert.deepEqual(entity.ship, source.ship);
      assert.deepEqual(entity.construction, source.construction);
    }
  }

  const controls = {
    aegis: { civil: ['transporter', 1, 10, '00:10:00'], combat: ['scout', 2, 800, '00:20:00'], superheavy: ['death-star', 700, 700_000, '175:00:00'] },
    synod: { civil: ['transporter', 1, 10, '00:10:00'], combat: ['scout', 2, 800, '00:13:20'], superheavy: ['death-star', 615, 615_000, '153:45:00'] },
    veyra: { civil: ['transporter', 2, 10, '00:20:00'], combat: ['scout', 1, 400, '00:10:00'], superheavy: ['death-star', 320, 320_000, '80:00:00'] },
  } as const;

  for (const faction of COMBAT_FACTIONS) {
    for (const sample of Object.values(controls[faction.id])) {
      const [id, population, attack, time] = sample;
      const entity = getFactionShipCatalog(faction.id).find((item) => item.id === id);
      assert.ok(entity);
      assert.equal(entity.population, population);
      assert.equal(entity.combat.attack, attack);
      assert.equal(entity.construction.time, time);
    }
  }

  assert.equal(FACTION_SHIP_MECHANICS.aegis.transporter.cost.metal, FACTION_SHIP_MECHANICS.synod.transporter.cost.metal);
  assert.equal(FACTION_SHIP_MECHANICS.aegis.transporter.combat.attack, FACTION_SHIP_MECHANICS.veyra.transporter.combat.attack);
  assert.notDeepEqual(FACTION_SHIP_MECHANICS.aegis.transporter, FACTION_SHIP_MECHANICS.veyra.transporter);
  assert.notDeepEqual(FACTION_SHIP_MECHANICS.synod['death-star'], FACTION_SHIP_MECHANICS.veyra['death-star']);
  assert.equal(FACTION_SHIP_MECHANICS.veyra.cruiser.sourceName, 'Абсорбатор');
  assert.equal(FACTION_SHIP_MECHANICS.veyra.defender.sourceName, 'Немезис');

  const destroyerControls = {
    aegis: { time: '01:20:00', population: 30, attack: 19_500, cost: { metal: 93_900, minerals: 84_500, gas: 9_400 }, requirements: ['Верфь · уровень 9', 'Реактивные двигатели · уровень 6', 'Гиперпространство · уровень 5'] },
    synod: { time: '01:14:40', population: 28, attack: 18_200, cost: { metal: 87_600, minerals: 78_900, gas: 8_800 }, requirements: ['Верфь · уровень 9', 'Реактивные двигатели · уровень 6', 'Гиперпространство · уровень 5'] },
    veyra: { time: '00:45:20', population: 17, attack: 11_050, cost: { metal: 53_200, minerals: 47_900, gas: 5_300 }, requirements: ['Верфь · уровень 6', 'Плазменная наука · уровень 1', 'Немезис · количество 1'] },
  } as const;

  for (const faction of COMBAT_FACTIONS) {
    const destroyer = FACTION_SHIP_MECHANICS[faction.id].destroyer;
    const control = destroyerControls[faction.id];
    assert.equal(destroyer.construction.time, control.time);
    assert.equal(destroyer.population, control.population);
    assert.equal(destroyer.combat.attack, control.attack);
    assert.deepEqual(destroyer.cost, control.cost);
    assert.deepEqual(destroyer.construction.requirements, control.requirements);
  }
});

test('legacy simulator scenario migrates to Asters versus Asters with zero technologies', () => {
  const migrated = normalizeSimulatorScenario({
    attacker: { ships: [{ entityId: 'scout', count: 2 }], commanders: [] },
    defender: { ships: [{ entityId: 'cruiser', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 8,
  });

  assert.equal(migrated.attackerFactionId, 'aegis');
  assert.equal(migrated.defenderFactionId, 'aegis');
  assert.equal(migrated.attacker.ships[0]?.count, 2);
  assert.equal(migrated.defender.ships[0]?.count, 1);
  assert.deepEqual(migrated.attackerTechnologies, normalizeCombatTechnologies(undefined));
  assert.deepEqual(migrated.defenderTechnologies, normalizeCombatTechnologies(undefined));
});

test('attacker and defender race selections are independent', () => {
  const attackerChanged = setScenarioFaction(populatedScenario, 'attacker', 'synod');
  assert.equal(attackerChanged.attackerFactionId, 'synod');
  assert.equal(attackerChanged.defenderFactionId, 'aegis');
  assert.deepEqual(attackerChanged.attacker, { ships: [], commanders: [] });
  assert.deepEqual(attackerChanged.defender, populatedScenario.defender);

  const defenderChanged = setScenarioFaction(attackerChanged, 'defender', 'veyra');
  assert.equal(defenderChanged.attackerFactionId, 'synod');
  assert.equal(defenderChanged.defenderFactionId, 'veyra');
  assert.deepEqual(defenderChanged.attacker, { ships: [], commanders: [] });
  assert.deepEqual(defenderChanged.defender, { ships: [], commanders: [], defenses: [] });
});

test('changing to the already selected race does not clear the side', () => {
  const unchanged = setScenarioFaction(populatedScenario, 'attacker', 'aegis');
  assert.equal(unchanged, populatedScenario);
});

test('presets and last scenario retain independent race and technology selections', () => {
  const mixed = {
    ...populatedScenario,
    attackerFactionId: 'synod' as const,
    defenderFactionId: 'veyra' as const,
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 7, lightArmor: 4 }),
    defenderTechnologies: normalizeCombatTechnologies({ plasmaScience: 9, heavyArmor: 6 }),
  };
  const migrated = migrateSimulatorState({
    lastScenario: mixed,
    presets: [{ id: 'mixed-1', name: 'Mixed', createdAt: '2026-09-05T00:00:00.000Z', input: mixed }],
  });

  assert.equal(migrated.lastScenario?.attackerFactionId, 'synod');
  assert.equal(migrated.lastScenario?.defenderFactionId, 'veyra');
  assert.equal(migrated.lastScenario?.attackerTechnologies?.laserScience, 7);
  assert.equal(migrated.lastScenario?.defenderTechnologies?.heavyArmor, 6);
  assert.equal(migrated.presets[0]?.input.attackerFactionId, 'synod');
  assert.equal(migrated.presets[0]?.input.defenderFactionId, 'veyra');
  assert.equal(migrated.presets[0]?.input.attackerTechnologies?.lightArmor, 4);
  assert.equal(migrated.presets[0]?.input.defenderTechnologies?.plasmaScience, 9);
});

test('combat input receives selected race names and technology levels', () => {
  const mixed = {
    ...populatedScenario,
    attackerFactionId: 'synod' as const,
    defenderFactionId: 'veyra' as const,
    attackerTechnologies: normalizeCombatTechnologies({ ionScience: 5 }),
    defenderTechnologies: normalizeCombatTechnologies({ shipArmor: 8 }),
  };
  const input = scenarioToCombatInput(mixed, {
    scenarioId: 'race-test',
    timestamp: '2026-09-05T00:00:00.000Z',
    attacker: { playerName: 'A', side: 'attacker' },
    defender: { playerName: 'B', side: 'defender' },
    priority: createDefaultCombatPriority(),
  });

  assert.equal(input.attacker.participant.race, getCombatFactionName('synod'));
  assert.equal(input.defender.participant.race, getCombatFactionName('veyra'));
  assert.equal(input.attacker.participant.race, 'Илары');
  assert.equal(input.defender.participant.race, 'Рой');
  assert.equal(input.attackerTechnologies?.ionScience, 5);
  assert.equal(input.defenderTechnologies?.shipArmor, 8);
});
