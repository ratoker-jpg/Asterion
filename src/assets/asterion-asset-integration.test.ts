import assert from 'node:assert/strict';
import test from 'node:test';
import { asterionAssetIntegrationAssets } from './generated/asterionAssetIntegrationManifest.generated.ts';

test('task asset manifest maps every requested visual family to optimized runtime art', () => {
  const assets = asterionAssetIntegrationAssets;
  assert.deepEqual(Object.keys(assets.reportIcons).sort(), ['achievements', 'alliances', 'arena', 'battle', 'command', 'flights', 'profile', 'system']);
  assert.deepEqual(Object.keys(assets.scoreIcons).sort(), ['achievementPoints', 'battlePoints', 'resourcePoints', 'totalPoints']);
  assert.equal(assets.regularPlanetSkins.length, 9);
  assert.deepEqual(assets.regularPlanetSkins.map((skin) => skin.id), [
    'skin-asterion-01', 'skin-asterion-02', 'skin-asterion-03', 'skin-asterion-04', 'skin-asterion-05',
    'skin-asterion-06', 'skin-asterion-07', 'skin-asterion-08', 'skin-asterion-09',
  ]);
  assert.equal(assets.piratePlanetArts.length, 10);
  assert.equal(assets.uniquePlanetArts.length, 16);
  assert.equal(assets.anomalyArts.length, 10);
  assert.deepEqual(Object.keys(assets.battleFactionIcons).sort(), ['aegis', 'pirates', 'synod', 'veyra']);
  assert.notEqual(assets.regularPlanetSkins[0].art, assets.piratePlanetArts[6]);
  assert.ok(assets.regularPlanetSkins.every((skin) => skin.art.includes('/planet-skins/') && skin.mapArt.includes('/planet-previews/')));
  for (const url of [
    ...Object.values(assets.reportIcons), ...Object.values(assets.scoreIcons),
    ...assets.regularPlanetSkins.flatMap((skin) => [skin.art, skin.mapArt]), ...assets.piratePlanetArts,
    ...assets.uniquePlanetArts, ...assets.anomalyArts, ...Object.values(assets.battleFactionIcons),
  ]) {
    assert.match(url, /^\.\/assets\/generated\/asterion\//);
    assert.match(url, /\.webp$/);
  }
});
