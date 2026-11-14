import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { getFactionShipCatalog } from './faction-catalog.ts';
import type { CombatFactionId } from './factions.ts';
import type { ShipId } from './ids.ts';

const FACTION_IDS: readonly CombatFactionId[] = ['aegis', 'synod', 'veyra'];

// Reviewed Asterion presentation mapping. These are the local custom renders
// associated with source identities, not byte-for-byte copies of Nemexia PNGs.
const ASTERION_ART_ASSETS: Readonly<Record<CombatFactionId, Readonly<Record<ShipId, string>>>> = {
  aegis: {
    'solar-satellite': 'ship.aegis.solar-satellite.webp',
    'spy-probe': 'ship.aegis.spy-probe.webp',
    transporter: 'ship.aegis.transporter.webp',
    'mega-transporter': 'ship.aegis.mega-transporter.webp',
    colonizer: 'ship.aegis.colonizer.webp',
    recycler: 'ship.aegis.recycler.webp',
    scout: 'ship.aegis.scout.webp',
    cruiser: 'ship.aegis.cruiser.webp',
    defender: 'ship.aegis.defender.webp',
    battleship: 'ship.aegis.battleship.webp',
    destroyer: 'ship.aegis.destroyer.webp',
    bomber: 'ship.aegis.bomber.webp',
    'death-star': 'ship.aegis.death-star.webp',
  },
  synod: {
    'solar-satellite': 'ship.synod.solar-satellite.webp',
    'spy-probe': 'ship.synod.spy-bot.webp',
    transporter: 'ship.synod.cargo-bot.webp',
    'mega-transporter': 'ship.synod.large-cargo-bot.webp',
    colonizer: 'ship.synod.colonizer-bot.webp',
    recycler: 'ship.synod.recycler.webp',
    scout: 'ship.synod.fighter.webp',
    cruiser: 'ship.synod.interceptor.webp',
    defender: 'ship.synod.shield-bot.webp',
    battleship: 'ship.synod.star-armada.webp',
    destroyer: 'ship.synod.goliath.webp',
    bomber: 'ship.synod.bomberbot.webp',
    'death-star': 'ship.synod.titan.webp',
  },
  veyra: {
    'solar-satellite': 'ship.veyra.organic-satellite.webp',
    'spy-probe': 'ship.veyra.nox-mind.webp',
    transporter: 'ship.veyra.transporter.webp',
    'mega-transporter': 'ship.veyra.mega-transporter.webp',
    colonizer: 'ship.veyra.settler.webp',
    recycler: 'ship.veyra.recycler-drone.webp',
    scout: 'ship.veyra.nox-dart.webp',
    cruiser: 'ship.veyra.nemesis.webp',
    defender: 'ship.veyra.absorber.webp',
    battleship: 'ship.veyra.ghost.webp',
    destroyer: 'ship.veyra.hornet.webp',
    bomber: 'ship.veyra.bomber.webp',
    'death-star': 'ship.veyra.nox-queen.webp',
  },
};

type SourceShipImageFixture = {
  revision: string;
  records: Array<{ slotId: ShipId; sourceName: string; sourceImage: string | null }>;
};

test('all 39 source identities retain their reviewed Asterion artwork mapping', () => {
  let checkedMappings = 0;

  for (const factionId of FACTION_IDS) {
    const fixture = JSON.parse(readFileSync(
      new URL('./source-fixtures/' + factionId + '-ships.json', import.meta.url),
      'utf8',
    )) as SourceShipImageFixture;
    assert.equal(fixture.revision, '87afb017749e2aa227ec29ea7825726387b4d4cf', `${factionId} source revision`);
    assert.equal(fixture.records.length, 13, `${factionId} source image records`);

    const catalog = getFactionShipCatalog(factionId);
    for (const source of fixture.records) {
      assert.ok(source.sourceImage, `${factionId}/${source.slotId} source image path`);
      const entity = catalog.find(({ id }) => id === source.slotId);
      assert.ok(entity, `${factionId}/${source.slotId} catalog entity`);
      const expectedAsset = ASTERION_ART_ASSETS[factionId][source.slotId];
      assert.ok(expectedAsset, `${factionId}/${source.slotId} reviewed local art mapping`);
      assert.equal(decodeURIComponent(new URL(entity.art).pathname).split('/').at(-1), expectedAsset, `${source.sourceName} local asset`);
      assert.equal(existsSync(fileURLToPath(entity.art)), true, `${source.sourceName} local art file exists`);
      checkedMappings += 1;
    }
  }

  assert.equal(checkedMappings, 39);
});
