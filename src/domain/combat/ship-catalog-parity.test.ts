import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { COMMANDER_COMBAT_CATALOG } from './catalog.ts';
import { COMMANDER_ABILITIES, COMMANDER_IDS } from './commanders.ts';
import { getFactionShipCatalog } from './faction-catalog.ts';
import { FACTION_SHIP_MECHANICS } from './faction-ship-data.ts';
import { FACTION_SHIP_BASE_PRODUCTION_TIMES } from './ship-time-rebalanced.ts';
import type { CombatFactionId } from './factions.ts';
import type { ShipId } from './ids.ts';

const SOURCE_REVISION = '87afb017749e2aa227ec29ea7825726387b4d4cf';
const FACTION_IDS: readonly CombatFactionId[] = ['aegis', 'synod', 'veyra'];
const COMBAT_SHIP_IDS: readonly ShipId[] = [
  'scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber', 'death-star',
];

type SourceRequirement = {
  sourceText: string;
  valueKind: 'level' | 'quantity' | 'UNKNOWN';
  targetName: string;
  value: number | null;
};

type SourceShip = {
  factionId: CombatFactionId;
  slotId: ShipId;
  sourceName: string;
  sourceFile: string;
  sourcePageId: number;
  sourceLevel: number;
  sourceDescription: string;
  sourceImage: string | null;
  sourceRole: string;
  asterionDisplayName: string;
  asterionRole: string;
  population: number;
  cost: { metal: number; minerals: number; gas: number };
  attack: number;
  life: number;
  weaponType: string;
  armorType: string;
  armorStrength: number;
  cargo: number | null;
  speed: number | null;
  fuel: number | null;
  sourceTime: string;
  requirements: SourceRequirement[];
};

type ShipFixture = {
  repository: string;
  revision: string;
  selectors: Record<string, string>;
  records: SourceShip[];
};

type AbilityFixture = {
  source: { revision: string };
  ships: Array<{
    factionId: CombatFactionId;
    slotId: ShipId;
    sourceName: string;
    sourceFile: string;
    abilities: Array<{
      sourceMetrics: Array<{ sourceValue: string; interpretation: string }>;
      catalogSupport: {
        existingRecord: { kind: 'attack' | 'life' | 'armor'; rate: number; cap?: number } | null;
      };
    }>;
  }>;
};

type CommanderFixture = {
  repository: string;
  revision: string;
  selectors: Record<string, string>;
  sourceSlotMap: {
    records: Array<{
      sourceSlotId: number;
      sourcePageId: number;
      sourceFile: string;
      sourceName: string;
      sourceLevel: number;
      sourceImage: string;
      abilityTooltip: { rawHtml: string; text: string; status: 'OBSERVED' | 'DAMAGED_SOURCE_TEXT' };
      hull: {
        population: number;
        cost: { metal: number; minerals: number; gas: number };
        attack: number;
        life: number;
        weaponType: string;
        armorType: string;
        armorStrength: number;
        cargo: number;
        speed: number;
        fuel: number;
      };
      sourceTime: string;
      requirements: SourceRequirement[];
      asterion: { commanderId: string; name: string; artAsset: string };
    }>;
  };
};

type CommanderAbilityFixture = {
  repository: string;
  revision: string;
  sourceFixture: string;
  sourceSelector: string;
  projectionPolicy: { status: string; normalization: string; rates: string };
  records: Array<{
    commanderId: (typeof COMMANDER_IDS)[number];
    expectedCatalog: {
      commanderName: string;
      ability: string;
      description: string;
      ratePerLevel: string;
      implementationStatus: 'implemented' | 'catalog-only';
    };
    sourceEvidence: Array<{
      text: string;
      normalizedEffect: string;
      ratePerLevel: number | null;
    }>;
  }>;
};

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./source-fixtures/${name}`, import.meta.url), 'utf8')) as T;
}

function sourceRequirementToCatalog(requirement: SourceRequirement): string {
  if (requirement.valueKind === 'level' && requirement.value !== null) {
    return `${requirement.targetName} · уровень ${requirement.value}`;
  }
  if (requirement.valueKind === 'quantity' && requirement.value !== null) {
    return `${requirement.targetName} · количество ${requirement.value}`;
  }
  assert.fail(`Unsupported source requirement in ordinary ship fixture: ${requirement.sourceText}`);
}

function artBasename(art: string): string {
  return decodeURIComponent(new URL(art).pathname).split(/[\\/]/u).at(-1) ?? '';
}

const SHIP_FIXTURES = Object.fromEntries(FACTION_IDS.map((factionId) => [
  factionId,
  readFixture<ShipFixture>(`${factionId}-ships.json`),
])) as Record<CombatFactionId, ShipFixture>;

test('all 39 ordinary ship catalog rows match the pinned source fixtures while keeping Asterion presentation and rebalance times', () => {
  let recordCount = 0;

  for (const factionId of FACTION_IDS) {
    const fixture = SHIP_FIXTURES[factionId];
    assert.equal(fixture.revision, SOURCE_REVISION, `${factionId} source revision`);
    assert.ok(fixture.selectors['sourceName'], `${factionId} source-name selector`);
    assert.ok(fixture.selectors['sourceImage'], `${factionId} source-image selector`);
    assert.ok(fixture.selectors['sourceRole'], `${factionId} source-role selector`);
    assert.equal(fixture.records.length, 13, `${factionId} source record count`);
    assert.equal(new Set(fixture.records.map(({ slotId }) => slotId)).size, 13, `${factionId} unique slot IDs`);
    assert.equal(new Set(fixture.records.map(({ sourcePageId }) => sourcePageId)).size, 13, `${factionId} unique source page IDs`);

    const catalog = getFactionShipCatalog(factionId);
    assert.equal(catalog.length, 13, `${factionId} catalog record count`);

    for (const source of fixture.records) {
      recordCount += 1;
      const mechanics = FACTION_SHIP_MECHANICS[factionId][source.slotId];
      const entity = catalog.find(({ id }) => id === source.slotId);
      assert.ok(entity, `${factionId}/${source.slotId} catalog entity`);
      assert.equal(source.factionId, factionId, `${factionId}/${source.slotId} fixture faction`);
      assert.equal(source.sourceLevel, 0, `${factionId}/${source.slotId} source level`);
      assert.ok(source.sourceDescription.length > 0, `${factionId}/${source.slotId} source description`);
      assert.ok(source.sourceRole.length > 0, `${factionId}/${source.slotId} source role`);
      assert.ok(source.sourceFile.startsWith('saved_pages/312313/Корабли/'), `${factionId}/${source.slotId} source file`);

      assert.equal(mechanics.sourceName, source.sourceName, `${factionId}/${source.slotId} source name`);
      assert.equal(mechanics.sourceFile, source.sourceFile, `${factionId}/${source.slotId} source path`);
      assert.equal(mechanics.sourceTime, source.sourceTime, `${factionId}/${source.slotId} original production time`);
      assert.equal(mechanics.population, source.population, `${factionId}/${source.slotId} population`);
      assert.deepEqual(mechanics.cost, source.cost, `${factionId}/${source.slotId} cost`);
      assert.deepEqual(mechanics.combat, {
        attack: source.attack,
        life: source.life,
        weaponType: source.weaponType,
        armorType: source.armorType,
        armorStrength: source.armorStrength,
      }, `${factionId}/${source.slotId} combat stats`);

      const sourceTraits = source.cargo === null && source.speed === null && source.fuel === null
        ? undefined
        : { cargo: source.cargo, speed: source.speed, fuel: source.fuel };
      assert.deepEqual(mechanics.ship, sourceTraits, `${factionId}/${source.slotId} flight traits; null means absent in source`);

      const shipyardRequirement = source.requirements.find((requirement) => (
        requirement.targetName === 'Верфь' && requirement.valueKind === 'level'
      ));
      assert.ok(shipyardRequirement?.value !== null && shipyardRequirement?.value !== undefined, `${factionId}/${source.slotId} shipyard requirement`);
      assert.equal(mechanics.construction.requiredShipyardLevel, shipyardRequirement.value, `${factionId}/${source.slotId} shipyard level`);
      assert.deepEqual(mechanics.construction.requirements, source.requirements.map(sourceRequirementToCatalog), `${factionId}/${source.slotId} requirements`);
      assert.equal(mechanics.construction.time, FACTION_SHIP_BASE_PRODUCTION_TIMES[factionId][source.slotId], `${factionId}/${source.slotId} Time Rebalanced runtime time`);

      assert.equal(entity.name, source.asterionDisplayName, `${factionId}/${source.slotId} retained Asterion name`);
      assert.equal(entity.role, source.asterionRole, `${factionId}/${source.slotId} retained Asterion role`);
    }
  }

  assert.equal(recordCount, 39);
});

test('all 13 commander hull records and stable Asterion identities match their source fixture', () => {
  const fixture = readFixture<CommanderFixture>('commanders.json');
  const abilityFixture = readFixture<CommanderAbilityFixture>('commander-abilities.json');
  const sourceCommanders = fixture.sourceSlotMap.records;
  assert.equal(fixture.revision, SOURCE_REVISION);
  assert.equal(abilityFixture.revision, SOURCE_REVISION);
  assert.equal(abilityFixture.repository, fixture.repository);
  assert.equal(abilityFixture.sourceFixture, 'commanders.json');
  assert.equal(abilityFixture.sourceSelector, fixture.selectors.abilityTooltip);
  assert.ok(abilityFixture.projectionPolicy.normalization.length > 0);
  assert.ok(abilityFixture.projectionPolicy.status.length > 0);
  assert.ok(abilityFixture.projectionPolicy.rates.length > 0);
  assert.equal(sourceCommanders.length, 13);
  assert.equal(abilityFixture.records.length, 13);
  assert.deepEqual(abilityFixture.records.map(({ commanderId }) => commanderId).sort(), [...COMMANDER_IDS].sort());
  assert.deepEqual(sourceCommanders.map(({ sourcePageId }) => sourcePageId).sort((a, b) => a - b), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.equal(new Set(sourceCommanders.map(({ asterion }) => asterion.commanderId)).size, 13);

  for (const source of sourceCommanders) {
    const commanderId = source.asterion.commanderId as (typeof COMMANDER_IDS)[number];
    const commander = COMMANDER_COMBAT_CATALOG.find(({ id }) => id === commanderId);
    assert.ok(commander, `commander ID ${source.asterion.commanderId}`);
    const abilitySource = abilityFixture.records.find(({ commanderId: id }) => id === commanderId);
    assert.ok(abilitySource, `${source.sourceName} curated ability projection`);
    const sourceProjection = COMMANDER_ABILITIES[commanderId];
    assert.deepEqual({
      commanderName: sourceProjection.commanderName,
      ability: sourceProjection.ability,
      description: sourceProjection.description,
      ratePerLevel: sourceProjection.ratePerLevel,
      implementationStatus: sourceProjection.implementationStatus,
    }, abilitySource.expectedCatalog, `${source.sourceName} full COMMANDER_ABILITIES projection`);
    assert.equal(sourceProjection.commanderName, source.sourceName === 'Polias' ? 'Полиас' : source.sourceName, `${source.sourceName} source/catalog identity`);
    assert.equal(source.abilityTooltip.rawHtml, source.abilityTooltip.text.replace(/\n/g, '<br>'), `${source.sourceName} tooltip text is the normalized source HTML`);
    assert.equal(source.abilityTooltip.status, source.sourceName === 'Реаниматор' ? 'DAMAGED_SOURCE_TEXT' : 'OBSERVED', `${source.sourceName} source status`);
    assert.ok(abilitySource.sourceEvidence.length > 0, `${source.sourceName} has curated source effect components`);
    for (const evidence of abilitySource.sourceEvidence) {
      assert.ok(source.abilityTooltip.rawHtml.includes(evidence.text), `${source.sourceName} source evidence: ${evidence.normalizedEffect}`);
      if (evidence.ratePerLevel !== null) {
        const sourceRate = evidence.text.match(/(\d+(?:\.\d+)?)%/u)?.[1];
        assert.ok(sourceRate, `${source.sourceName} ${evidence.normalizedEffect} has source percent evidence`);
        assert.equal(Number(sourceRate), Math.abs(evidence.ratePerLevel), `${source.sourceName} ${evidence.normalizedEffect} source rate magnitude`);
        if (evidence.ratePerLevel < 0) {
          assert.match(evidence.normalizedEffect, /reduction/u, `${source.sourceName} negative rate direction is identified as a normalized reduction`);
        }
      }
    }
    assert.equal(commander.name, source.asterion.name, `${source.sourceName} retained Asterion name`);
    assert.ok(decodeURIComponent(commander.art).replaceAll('\\', '/').endsWith(`/${source.asterion.artAsset}`), `${source.sourceName} retained Asterion art mapping`);
    assert.ok(source.abilityTooltip.text.length > 0, `${source.sourceName} source ability tooltip`);
    assert.deepEqual(commander.commanderAbility, {
      ability: abilitySource.expectedCatalog.ability,
      description: abilitySource.expectedCatalog.description,
      ratePerLevel: abilitySource.expectedCatalog.ratePerLevel,
    }, `${source.sourceName} catalog runtime ability projection`);
    assert.equal(commander.population, source.hull.population, `${source.sourceName} population`);
    assert.deepEqual(commander.cost, source.hull.cost, `${source.sourceName} cost`);
    assert.deepEqual(commander.combat, {
      attack: source.hull.attack,
      life: source.hull.life,
      weaponType: source.hull.weaponType,
      armorType: source.hull.armorType,
      armorStrength: source.hull.armorStrength,
    }, `${source.sourceName} combat stats`);
    assert.deepEqual(commander.ship, {
      cargo: source.hull.cargo,
      speed: source.hull.speed,
      fuel: source.hull.fuel,
    }, `${source.sourceName} flight traits`);
    assert.equal(commander.construction.time, source.sourceTime, `${source.sourceName} source production time`);

    const sourceRequirements = source.requirements.map((requirement) => {
      if (requirement.valueKind === 'level' && requirement.value !== null) {
        return `${requirement.targetName} Уровень: ${requirement.value}`;
      }
      return requirement.sourceText.replace(/<br\s*\/?\s*>/giu, ' ').replace(/\s+/gu, ' ').trim();
    });
    assert.deepEqual(commander.sourceRequirements, sourceRequirements, `${source.sourceName} source requirements`);

    if (source.asterion.commanderId === 'reanimator') {
      assert.equal(source.abilityTooltip.status, 'DAMAGED_SOURCE_TEXT');
      assert.ok(source.abilityTooltip.rawHtml.includes('\uFFFD'));
    } else {
      assert.equal(source.abilityTooltip.status, 'OBSERVED');
    }
    if (source.asterion.commanderId === 'argo') {
      assert.equal(source.abilityTooltip.text.match(/1%/gu)?.length, 2, 'Argo has two independent 1% source effects');
    }
    if (source.asterion.commanderId === 'polias') {
      assert.match(source.abilityTooltip.text, /даже если ваш командирский корабль будет уничтожен/iu);
    }
  }
});

test('all 21 ordinary combat ships preserve source ability tooltips and only supported passive components are represented', () => {
  const fixture = readFixture<AbilityFixture>('ship-abilities.json');
  assert.equal(fixture.source.revision, SOURCE_REVISION);
  assert.equal(fixture.ships.length, 21);
  assert.equal(new Set(fixture.ships.map(({ factionId, slotId }) => `${factionId}/${slotId}`)).size, 21);

  let tooltipCount = 0;
  let unknown1001Metrics = 0;
  for (const factionId of FACTION_IDS) {
    const factionShips = fixture.ships.filter((ship) => ship.factionId === factionId);
    assert.equal(factionShips.length, 7, `${factionId} combat ability pages`);
    assert.deepEqual(factionShips.map(({ slotId }) => slotId).sort(), [...COMBAT_SHIP_IDS].sort(), `${factionId} combat ship slots`);
  }

  for (const source of fixture.ships) {
    const mechanics = FACTION_SHIP_MECHANICS[source.factionId][source.slotId];
    const entity = getFactionShipCatalog(source.factionId).find(({ id }) => id === source.slotId);
    assert.ok(entity, `${source.factionId}/${source.slotId} catalog entity`);
    assert.equal(mechanics.sourceName, source.sourceName, `${source.factionId}/${source.slotId} ability source name`);
    assert.equal(mechanics.sourceFile, source.sourceFile, `${source.factionId}/${source.slotId} ability source path`);

    const representedRecords = source.abilities
      .map(({ catalogSupport }) => catalogSupport.existingRecord)
      .filter((record): record is NonNullable<typeof record> => record !== null);
    const currentRecord = entity.specialBonus
      ? { kind: entity.specialBonus.kind, rate: entity.specialBonus.rate, cap: entity.specialBonus.cap }
      : null;
    assert.deepEqual(representedRecords, currentRecord ? [currentRecord] : [], `${source.factionId}/${source.slotId} passive schema projection`);
    tooltipCount += source.abilities.length;

    for (const ability of source.abilities) {
      for (const metric of ability.sourceMetrics) {
        if (metric.sourceValue === '1001%') {
          assert.equal(metric.interpretation, 'UNKNOWN', `${source.factionId}/${source.slotId} 1001% interpretation`);
          unknown1001Metrics += 1;
        }
      }
    }
  }

  assert.equal(tooltipCount, 24);
  assert.equal(unknown1001Metrics, 3);
});

test('Veyra Nemesis and Absorber keep their approved local names and art assets under the stable IDs', () => {
  const catalog = getFactionShipCatalog('veyra');
  const cruiser = catalog.find(({ id }) => id === 'cruiser');
  const defender = catalog.find(({ id }) => id === 'defender');
  assert.ok(cruiser);
  assert.ok(defender);
  assert.equal(cruiser.name, 'Стрекоза');
  assert.equal(defender.name, 'Панцирник');
  assert.equal(artBasename(cruiser.art), 'ship.veyra.nemesis.png');
  assert.equal(artBasename(defender.art), 'ship.veyra.absorber.png');
});
