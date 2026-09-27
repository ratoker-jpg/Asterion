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
    'solar-satellite': 'ship.aegis.solar-satellite.png',
    'spy-probe': 'ship.aegis.spy-probe.png',
    transporter: 'ship.aegis.transporter.png',
    'mega-transporter': 'ship.aegis.mega-transporter.png',
    colonizer: 'ship.aegis.colonizer.png',
    recycler: 'ship.aegis.recycler.png',
    scout: 'ship.aegis.scout.png',
    cruiser: 'ship.aegis.cruiser.png',
    defender: 'ship.aegis.defender.png',
    battleship: 'ship.aegis.battleship.png',
    destroyer: 'ship.aegis.destroyer.png',
    bomber: 'ship.aegis.bomber.png',
    'death-star': 'ship.aegis.death-star.png',
  },
  synod: {
    'solar-satellite': 'ship.synod.solar-satellite.png',
    'spy-probe': 'ship.synod.spy-bot.png',
    transporter: 'ship.synod.cargo-bot.png',
    'mega-transporter': 'ship.synod.large-cargo-bot.png',
    colonizer: 'ship.synod.colonizer-bot.png',
    recycler: 'ship.synod.recycler.png',
    scout: 'ship.synod.fighter.png',
    cruiser: 'ship.synod.interceptor.png',
    defender: 'ship.synod.shield-bot.png',
    battleship: 'ship.synod.star-armada.png',
    destroyer: 'ship.synod.goliath.png',
    bomber: 'ship.synod.bomberbot.png',
    'death-star': 'ship.synod.titan.png',
  },
  veyra: {
    'solar-satellite': 'ship.veyra.organic-satellite.png',
    'spy-probe': 'ship.veyra.nox-mind.png',
    transporter: 'ship.veyra.transporter.png',
    'mega-transporter': 'ship.veyra.mega-transporter.png',
    colonizer: 'ship.veyra.settler.png',
    recycler: 'ship.veyra.recycler-drone.png',
    scout: 'ship.veyra.nox-dart.png',
    cruiser: 'ship.veyra.nemesis.png',
    defender: 'ship.veyra.absorber.png',
    battleship: 'ship.veyra.ghost.png',
    destroyer: 'ship.veyra.hornet.png',
    bomber: 'ship.veyra.bomber.png',
    'death-star': 'ship.veyra.nox-queen.png',
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
