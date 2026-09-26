import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const scope = 'asterion-asset-integration-2026-09-25';
const archiveName = 'ASTERION_ALL_GENERATED_ASSETS_2026-09-12/named_assets';
const taskManifestPath = 'assets/manifests/asterion-asset-integration.manifest.json';
const taskAuditPath = 'assets/manifests/asterion-asset-integration.audit.json';
const typeScriptManifestPath = 'src/assets/generated/asterionAssetIntegrationManifest.generated.ts';
const runtimeRoot = 'public/assets/generated/asterion';
const obsoleteSources = [
  'assets/source/universe-navigation/stellar-remnants/stellar-remnant.variant-01.png',
  'assets/source/universe-navigation/stellar-remnants/stellar-remnant.variant-02.png',
];
const obsoleteOutputs = [
  'public/assets/generated/universe/suns/detail/collapsed-01.webp',
  'public/assets/generated/universe/suns/detail/collapsed-02.webp',
  'public/assets/generated/universe/suns/thumb/collapsed-01.webp',
  'public/assets/generated/universe/suns/thumb/collapsed-02.webp',
];

function defineGroup({ group, semanticPrefix, sourceDirectory, archiveDirectory, family, mode = 'runtime', runtime = null, items }) {
  return items.map((item) => {
    const sourcePath = item.sourcePath ?? `${sourceDirectory}/${item.sourceFile ?? item.file}`;
    const outputPath = item.outputFile && runtime
      ? path.posix.normalize(`public/assets/generated/${runtime.directory}/${item.outputFile}`)
      : null;
    return {
      group,
      key: item.key,
      id: item.id ?? item.key,
      label: item.label ?? null,
      semanticId: `${semanticPrefix}.${item.id ?? item.key}`,
      archiveFile: `${archiveDirectory}/${item.archiveFile ?? item.file}`,
      sourcePath,
      disposition: item.disposition ?? mode,
      family,
      runtime: outputPath ? {
        outputPath,
        width: runtime.width,
        height: runtime.height,
        format: 'webp',
        quality: runtime.quality,
        fit: 'contain',
        withoutEnlargement: true,
      } : null,
      mapPreview: item.mapPreviewFile ? {
        outputPath: path.posix.normalize(`public/assets/generated/asterion/universe/planet-previews/${item.mapPreviewFile}`),
        width: 128,
        height: 128,
        format: 'webp',
        quality: 90,
        fit: 'contain',
        withoutEnlargement: true,
      } : null,
      duplicateGroup: item.duplicateGroup ?? null,
      expectedSha256: item.expectedSha256 ?? null,
    };
  });
}

const definitions = [
  ...defineGroup({
    group: 'reportIcons', semanticPrefix: 'ui.report',
    sourceDirectory: 'assets/source/ui/asterion-integration/report-icons',
    archiveDirectory: '01_ui/report_icons', family: 'runtime-other',
    runtime: { directory: 'asterion/ui/report-icons', width: 96, height: 96, quality: 88 },
    items: [
      { key: 'system', file: 'system.png', outputFile: 'system.webp' },
      { key: 'battle', file: 'reports.png', outputFile: 'reports.webp' },
      { key: 'command', file: 'command_reports.png', outputFile: 'command-reports.webp' },
      { key: 'arena', file: 'arena.png', outputFile: 'arena.webp' },
      { key: 'flights', file: 'flights.png', outputFile: 'flights.webp' },
      { key: 'alliances', file: 'alliances.png', outputFile: 'alliances.webp' },
      { key: 'achievements', file: 'achievements.png', outputFile: 'achievements.webp' },
      { key: 'profile', file: 'profile.png', outputFile: 'profile.webp' },
    ],
  }),
  ...defineGroup({
    group: 'scoreIcons', semanticPrefix: 'ui.score',
    sourceDirectory: 'assets/source/ui/asterion-integration/score-icons',
    archiveDirectory: '01_ui/score_icons', family: 'runtime-other',
    runtime: { directory: 'asterion/ui/score-icons', width: 96, height: 96, quality: 88 },
    items: [
      { key: 'resourcePoints', file: 'resource-crystal.png', archiveFile: 'score_resource_crystal.png', outputFile: 'resource-crystal.webp' },
      { key: 'battlePoints', file: 'battle.png', archiveFile: 'боевые.png', outputFile: 'battle.webp' },
      { key: 'totalPoints', file: 'overall-star.png', archiveFile: 'score_overall_star.png', outputFile: 'overall-star.webp' },
      { key: 'achievementPoints', file: 'achievement-trophy.png', archiveFile: 'score_achievement_trophy.png', outputFile: 'achievement-trophy.webp' },
    ],
  }),
  ...defineGroup({
    group: 'generalPortraits', semanticPrefix: 'faction.general',
    sourceDirectory: 'assets/source/generated-factions-v1/factions',
    archiveDirectory: '02_characters/race_generals', family: 'runtime-other', mode: 'reuse-existing',
    items: [
      { key: 'aegis', file: 'aegis_general.png', expectedSha256: 'a2d1f807672aff9f4a182f304aba3f0818d683c3a34ece1150fc0930917b04c8' },
      { key: 'synod', file: 'synod_general.png', expectedSha256: '5f447349c4a9610d616e5ae22147040c0bbc672f379f7504454415191a79911e' },
      { key: 'veyra', file: 'veyra_general.png', expectedSha256: '94f1061b2b78f707638f322b79ca8d7c722bf114db8425fbcf8a2c3acac024ac' },
    ],
  }),
  ...defineGroup({
    group: 'piratePortrait', semanticPrefix: 'pirate.character',
    sourceDirectory: 'assets/source/characters/pirates', archiveDirectory: '02_characters/pirates',
    family: 'runtime-other', mode: 'source-only',
    items: [{ key: 'warlord', file: 'pirate_warlord.png' }],
  }),
  ...defineGroup({
    group: 'pirateShips', semanticPrefix: 'pirate.ship',
    sourceDirectory: 'assets/source/ships/pirates', archiveDirectory: '03_ships_pirate',
    family: 'ship', mode: 'source-only',
    items: [
      { key: 'ashfang', file: 'ashfang.png' },
      { key: 'black_harrow', file: 'black_harrow.png' },
      { key: 'chainjack', file: 'chainjack.png' },
      { key: 'crown_eater', file: 'crown_eater.png' },
      { key: 'gutterstar', file: 'gutterstar.png' },
      { key: 'red_wraith', file: 'red_wraith.png' },
      { key: 'void_butcher', file: 'void_butcher.png' },
    ],
  }),
  ...defineGroup({
    group: 'regularPlanetSkins', semanticPrefix: 'planet.skin',
    sourceDirectory: 'assets/source/planets/skins', archiveDirectory: '04_planets/regular',
    family: 'universe-planet',
    runtime: { directory: 'asterion/universe/planet-skins', width: 1024, height: 1024, quality: 90 },
    items: [
      { key: 'skin-asterion-01', id: 'asterion-01', label: 'Облик A-01', file: 'skin-asterion-01.png', archiveFile: 'a_detailed_sci_fi_concept_art_scene_a_single_larg_3_batch_3.png', outputFile: 'skin-asterion-01.webp', mapPreviewFile: 'skin-asterion-01.webp', duplicateGroup: 'orbital-forge' },
      { key: 'skin-asterion-02', id: 'asterion-02', label: 'Облик A-02', file: 'skin-asterion-02.png', archiveFile: 'a_dramatic_high_detail_sci_fi_space_planet_concep_4_batch_4.png', outputFile: 'skin-asterion-02.webp', mapPreviewFile: 'skin-asterion-02.webp' },
      { key: 'skin-asterion-03', id: 'asterion-03', label: 'Облик A-03', file: 'skin-asterion-03.png', archiveFile: 'a_high_detail_sci_fi_fantasy_concept_art_render_of_5_batch_5.png', outputFile: 'skin-asterion-03.webp', mapPreviewFile: 'skin-asterion-03.webp' },
      { key: 'skin-asterion-04', id: 'asterion-04', label: 'Облик A-04', file: 'skin-asterion-04.png', archiveFile: 'bioluminescent_giant_trees_world.png', outputFile: 'skin-asterion-04.webp', mapPreviewFile: 'skin-asterion-04.webp' },
      { key: 'skin-asterion-05', id: 'asterion-05', label: 'Облик A-05', file: 'skin-asterion-05.png', archiveFile: 'crystal_depths_world.png', outputFile: 'skin-asterion-05.webp', mapPreviewFile: 'skin-asterion-05.webp' },
      { key: 'skin-asterion-06', id: 'asterion-06', label: 'Облик A-06', file: 'skin-asterion-06.png', archiveFile: 'desert_canyons_world.png', outputFile: 'skin-asterion-06.webp', mapPreviewFile: 'skin-asterion-06.webp' },
      { key: 'skin-asterion-07', id: 'asterion-07', label: 'Облик A-07', file: 'skin-asterion-07.png', archiveFile: 'earthlike_blue_world.png', outputFile: 'skin-asterion-07.webp', mapPreviewFile: 'skin-asterion-07.webp' },
      { key: 'skin-asterion-08', id: 'asterion-08', label: 'Облик A-08', file: 'skin-asterion-08.png', archiveFile: 'ice_cloud_mountains_world.png', outputFile: 'skin-asterion-08.webp', mapPreviewFile: 'skin-asterion-08.webp' },
      { key: 'skin-asterion-09', id: 'asterion-09', label: 'Облик A-09', file: 'skin-asterion-09.png', archiveFile: 'ice_fire_world.png', outputFile: 'skin-asterion-09.webp', mapPreviewFile: 'skin-asterion-09.webp' },
    ],
  }),
  ...defineGroup({
    group: 'piratePlanetArts', semanticPrefix: 'universe.pirate-planet',
    sourceDirectory: 'assets/source/planets/pirate', archiveDirectory: '04_planets/pirate',
    family: 'universe-object',
    runtime: { directory: 'asterion/universe/pirate-planets', width: 256, height: 256, quality: 90 },
    items: [
      { key: 'pirate-planet-01', id: 'variant-01', file: 'pirate-planet-01.png', archiveFile: '9298830f-2107-4e9f-919a-18e6c7b684fb.png', outputFile: 'pirate-planet-01.webp' },
      { key: 'pirate-planet-02', id: 'variant-02', file: 'pirate-planet-02.png', archiveFile: 'pirate_debris_fortress_world.png', outputFile: 'pirate-planet-02.webp' },
      { key: 'pirate-planet-03', id: 'variant-03', file: 'pirate-planet-03.png', archiveFile: 'pirate_ice_fortress_world.png', outputFile: 'pirate-planet-03.webp' },
      { key: 'pirate-planet-04', id: 'variant-04', file: 'pirate-planet-04.png', archiveFile: 'pirate_industrial_void_world.png', outputFile: 'pirate-planet-04.webp' },
      { key: 'pirate-planet-05', id: 'variant-05', file: 'pirate-planet-05.png', archiveFile: 'pirate_lava_forge_world.png', outputFile: 'pirate-planet-05.webp' },
      { key: 'pirate-planet-06', id: 'variant-06', file: 'pirate-planet-06.png', archiveFile: 'pirate_mines_fortress_world.png', outputFile: 'pirate-planet-06.webp' },
      { key: 'pirate-planet-07', id: 'variant-07', file: 'pirate-planet-07.png', archiveFile: 'pirate_orbital_forge_world.png', outputFile: '../planet-variants/orbital-forge.webp', duplicateGroup: 'orbital-forge' },
      { key: 'pirate-planet-08', id: 'variant-08', file: 'pirate-planet-08.png', archiveFile: 'pirate_orbital_junk_world.png', outputFile: 'pirate-planet-08.webp' },
      { key: 'pirate-planet-09', id: 'variant-09', file: 'pirate-planet-09.png', archiveFile: 'pirate_scrapyard_world.png', outputFile: 'pirate-planet-09.webp' },
      { key: 'pirate-planet-10', id: 'variant-10', file: 'pirate-planet-10.png', archiveFile: 'pirate_storm_station_world.png', outputFile: 'pirate-planet-10.webp' },
    ],
  }),
  ...defineGroup({
    group: 'uniquePlanetArts', semanticPrefix: 'universe.unique',
    sourceDirectory: 'assets/source/planets/unique', archiveDirectory: '04_planets/unique',
    family: 'universe-object',
    runtime: { directory: 'asterion/universe/unique-objects', width: 192, height: 192, quality: 88 },
    items: [
      { key: 'unique-variant-01', id: 'variant-01', file: 'unique-variant-01.png', archiveFile: 'a_detailed_high_resolution_sci_fi_fantasy_concept_10_batch_4.png', outputFile: 'unique-variant-01.webp' },
      { key: 'unique-variant-02', id: 'variant-02', file: 'unique-variant-02.png', archiveFile: 'a_dramatic_high_detail_sci_fi_fantasy_concept_art_4_batch_3.png', outputFile: 'unique-variant-02.webp' },
      { key: 'unique-variant-03', id: 'variant-03', file: 'unique-variant-03.png', archiveFile: 'a_high_detail_fantasy_sci_fi_digital_artwork_of_a_11_batch_5.png', outputFile: 'unique-variant-03.webp' },
      { key: 'unique-variant-04', id: 'variant-04', file: 'unique-variant-04.png', archiveFile: 'a_high_detail_sci_fi_concept_art_digital_matte_p_6_batch_6.png', outputFile: 'unique-variant-04.webp' },
      { key: 'unique-variant-05', id: 'variant-05', file: 'unique-variant-05.png', archiveFile: 'a_high_detail_sci_fi_fantasy_concept_art_digital_9_batch_3.png', outputFile: 'unique-variant-05.webp' },
      { key: 'unique-variant-06', id: 'variant-06', file: 'unique-variant-06.png', archiveFile: 'a_high_detail_sci_fi_fantasy_digital_illustration_2_batch_1.png', outputFile: 'unique-variant-06.webp' },
      { key: 'unique-variant-07', id: 'variant-07', file: 'unique-variant-07.png', archiveFile: 'a_high_detail_sci_fi_fantasy_digital_illustration_3_batch_2.png', outputFile: 'unique-variant-07.webp' },
      { key: 'unique-variant-08', id: 'variant-08', file: 'unique-variant-08.png', archiveFile: 'a_high_detail_sci_fi_fantasy_digital_illustration_7_batch_6.png', outputFile: 'unique-variant-08.webp' },
      { key: 'unique-variant-09', id: 'variant-09', file: 'unique-variant-09.png', archiveFile: 'a_highly_detailed_fantasy_sci_fi_concept_art_scene_5_batch_4.png', outputFile: 'unique-variant-09.webp' },
      { key: 'unique-variant-10', id: 'variant-10', file: 'unique-variant-10.png', archiveFile: 'a_highly_detailed_fantasy_sci_fi_digital_illustrat_6_batch_5.png', outputFile: 'unique-variant-10.webp' },
      { key: 'unique-variant-11', id: 'variant-11', file: 'unique-variant-11.png', archiveFile: 'a_highly_detailed_sci_fi_digital_illustration_of_a_8_batch_2.png', outputFile: 'unique-variant-11.webp' },
      { key: 'unique-variant-12', id: 'variant-12', file: 'unique-variant-12.png', archiveFile: 'a_highly_detailed_sci_fi_fantasy_concept_art_of_a_7_batch_1.png', outputFile: 'unique-variant-12.webp' },
      { key: 'unique-variant-13', id: 'variant-13', file: 'unique-variant-13.png', archiveFile: 'asterion_shards_core_world.png', outputFile: 'unique-variant-13.webp' },
      { key: 'unique-variant-14', id: 'variant-14', file: 'unique-variant-14.png', archiveFile: 'obsidian_runes_world.png', outputFile: 'unique-variant-14.webp' },
      { key: 'unique-variant-15', id: 'variant-15', file: 'unique-variant-15.png', archiveFile: 'ocean_vortex_world.png', outputFile: 'unique-variant-15.webp' },
      { key: 'unique-variant-16', id: 'variant-16', file: 'unique-variant-16.png', archiveFile: 'shattered_magma_core_world.png', outputFile: 'unique-variant-16.webp' },
    ],
  }),
  ...defineGroup({
    group: 'anomalyArts', semanticPrefix: 'universe.anomaly',
    sourceDirectory: 'assets/source/universe-navigation/stellar-remnants', archiveDirectory: '05_space/anomalies',
    family: 'universe-object',
    runtime: { directory: 'asterion/universe/anomalies', width: 192, height: 192, quality: 88 },
    items: [
      { key: 'asterion-anomaly-01', id: 'asterion-01', file: 'asterion-anomaly-01.png', archiveFile: 'bipolar_butterfly_nebula.png', outputFile: 'anomaly-01.webp' },
      { key: 'asterion-anomaly-02', id: 'asterion-02', file: 'asterion-anomaly-02.png', archiveFile: 'black_hole_abyss.png', outputFile: 'anomaly-02.webp' },
      { key: 'asterion-anomaly-03', id: 'asterion-03', file: 'asterion-anomaly-03.png', archiveFile: 'black_hole_lensing.png', outputFile: 'anomaly-03.webp' },
      { key: 'asterion-anomaly-04', id: 'asterion-04', file: 'asterion-anomaly-04.png', archiveFile: 'broken_ring_core.png', outputFile: 'anomaly-04.webp' },
      { key: 'asterion-anomaly-05', id: 'asterion-05', file: 'asterion-anomaly-05.png', archiveFile: 'dark_nebula.png', outputFile: 'anomaly-05.webp' },
      { key: 'asterion-anomaly-06', id: 'asterion-06', file: 'asterion-anomaly-06.png', archiveFile: 'magnetar_jets.png', outputFile: 'anomaly-06.webp' },
      { key: 'asterion-anomaly-07', id: 'asterion-07', file: 'asterion-anomaly-07.png', archiveFile: 'neutron_star_merger.png', outputFile: 'anomaly-07.webp' },
      { key: 'asterion-anomaly-08', id: 'asterion-08', file: 'asterion-anomaly-08.png', archiveFile: 'protostar_bipolar_jets.png', outputFile: 'anomaly-08.webp' },
      { key: 'asterion-anomaly-09', id: 'asterion-09', file: 'asterion-anomaly-09.png', archiveFile: 'supernova_fragment.png', outputFile: 'anomaly-09.webp' },
      { key: 'asterion-anomaly-10', id: 'asterion-10', file: 'asterion-anomaly-10.png', archiveFile: 'wormhole_vortex.png', outputFile: 'anomaly-10.webp' },
    ],
  }),
  ...defineGroup({
    group: 'battleFactionIcons', semanticPrefix: 'ui.battle-faction',
    sourceDirectory: 'assets/source/factions/battle-icons', archiveDirectory: 'generated-assets/asterion-faction-battle-icons-20260925',
    family: 'runtime-other',
    runtime: { directory: 'asterion/factions/battle-icons', width: 128, height: 128, quality: 90 },
    items: [
      { key: 'aegis', file: 'aegis_battle_icon.png', outputFile: 'aegis.webp' },
      { key: 'synod', file: 'synod_battle_icon.png', outputFile: 'synod.webp' },
      { key: 'veyra', file: 'veyra_battle_icon.png', outputFile: 'veyra.webp' },
      { key: 'pirates', file: 'pirates_battle_icon.png', outputFile: 'pirates.webp' },
    ],
  }),
];

const pirateShipSourcePaths = new Set(
  definitions.filter((entry) => entry.group === 'pirateShips').map((entry) => entry.sourcePath),
);

const expectedCounts = {
  reportIcons: 8, scoreIcons: 4, generalPortraits: 3, piratePortrait: 1, pirateShips: 7,
  regularPlanetSkins: 9, piratePlanetArts: 10, uniquePlanetArts: 16, anomalyArts: 10,
  battleFactionIcons: 4,
};

function runtimeOutputs(entry) {
  return [
    ...(entry.runtime ? [{ entry, runtime: entry.runtime, semanticId: entry.semanticId }] : []),
    ...(entry.mapPreview ? [{ entry, runtime: entry.mapPreview, semanticId: `${entry.semanticId}.map-preview` }] : []),
  ];
}

function runtimeOutputsFor(entries) {
  return entries.flatMap(runtimeOutputs);
}

function absolute(relativePath) {
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes repository root: ${relativePath}`);
  return full;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(absolute(relativePath), 'utf8'));
}

async function writeJson(relativePath, value) {
  const file = absolute(relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if ((await fs.readFile(file, 'utf8').catch(() => null)) !== next) await fs.writeFile(file, next, 'utf8');
}

async function writeText(relativePath, value) {
  const file = absolute(relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if ((await fs.readFile(file, 'utf8').catch(() => null)) !== value) await fs.writeFile(file, value, 'utf8');
}

async function fileInfo(entry) {
  const file = absolute(entry.sourcePath);
  const bytes = await fs.readFile(file);
  const image = sharp(bytes, { failOn: 'error' });
  const metadata = await image.metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new Error(`Expected a decodable PNG: ${entry.sourcePath}`);
  return {
    bytes: bytes.byteLength,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels ?? 4,
    hasAlpha: Boolean(metadata.hasAlpha),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function summarize(assets) {
  const byClassification = {};
  const byFamily = {};
  for (const asset of assets) {
    byClassification[asset.classification] = (byClassification[asset.classification] ?? 0) + 1;
    byFamily[asset.family] = (byFamily[asset.family] ?? 0) + 1;
  }
  return {
    totalFiles: assets.length,
    totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    totalDecodedBytes: assets.reduce((sum, asset) => sum + asset.decodedBytes, 0),
    byClassification,
    byFamily,
  };
}

function sourceAuditRecord(entry, info) {
  return {
    path: entry.sourcePath,
    classification: entry.sourcePath.startsWith('assets/source/universe-navigation/') ? 'source-intake' : 'source',
    family: entry.family,
    semanticId: entry.semanticId,
    extension: '.png', format: 'png',
    width: info.width, height: info.height, channels: info.channels, hasAlpha: info.hasAlpha,
    alphaBounds: null, inspectionError: null,
    bytes: info.bytes, decodedBytes: info.width * info.height * info.channels, sha256: info.sha256,
  };
}

function runtimeAuditRecord(output, info, metadata) {
  const { entry, runtime, semanticId } = output;
  return {
    path: runtime.outputPath,
    classification: 'generated-runtime',
    family: entry.family,
    semanticId,
    extension: '.webp', format: 'webp',
    width: metadata.width, height: metadata.height,
    channels: metadata.channels ?? 4, hasAlpha: Boolean(metadata.hasAlpha),
    alphaBounds: null, inspectionError: null,
    bytes: info.length, decodedBytes: metadata.width * metadata.height * (metadata.channels ?? 4),
    sha256: createHash('sha256').update(info).digest('hex'),
  };
}

function asRuntimePlan(output) {
  const { entry, runtime, semanticId } = output;
  return {
    semanticId,
    family: entry.family,
    sourcePath: entry.sourcePath,
    outputPath: runtime.outputPath,
    width: runtime.width,
    height: runtime.height,
    format: 'webp',
    quality: runtime.quality,
    trim: false,
    fit: runtime.fit,
    position: 'centre',
    withoutEnlargement: runtime.withoutEnlargement,
  };
}

function taskSourceManifest(entries) {
  return {
    schemaVersion: 1,
    scope,
    archiveRoot: archiveName,
    note: 'The archive and prepared battle icons are represented by their repository copies. Existing general portraits are reused by verified SHA-256.',
    userDecisions: {
      scoreIcons: ['score_resource_crystal.png', 'боевые.png', 'score_overall_star.png', 'score_achievement_trophy.png'],
      overallScoreIcon: 'score_overall_star.png',
      alternateOverallIcon: 'excluded: absent from source and explicitly rejected by the user',
      pirateCombatMechanics: 'unchanged',
    },
    intakeCount: entries.length,
    copiedSourceCount: entries.filter((entry) => entry.disposition !== 'reuse-existing').length,
    reusedSourceCount: entries.filter((entry) => entry.disposition === 'reuse-existing').length,
    entries,
  };
}

function tsLiteral(value) {
  return JSON.stringify(value, null, 2);
}

function renderTypeScript(entries) {
  const byGroup = (group) => entries.filter((entry) => entry.group === group && entry.runtime);
  const url = (runtime) => `./${runtime.outputPath.slice('public/'.length)}`;
  const object = (group) => Object.fromEntries(byGroup(group).map((entry) => [entry.key, url(entry.runtime)]));
  const skins = byGroup('regularPlanetSkins').map((entry) => ({ id: entry.key, label: entry.label, art: url(entry.runtime), mapArt: url(entry.mapPreview) }));
  const lines = [
    '// Generated by tools/asterion-asset-integration.mjs. Do not edit by hand.',
    `export const asterionAssetIntegrationAssets = ${tsLiteral({
      reportIcons: object('reportIcons'),
      scoreIcons: object('scoreIcons'),
      regularPlanetSkins: skins,
      piratePlanetArts: byGroup('piratePlanetArts').map((entry) => url(entry.runtime)),
      uniquePlanetArts: byGroup('uniquePlanetArts').map((entry) => url(entry.runtime)),
      anomalyArts: byGroup('anomalyArts').map((entry) => url(entry.runtime)),
      battleFactionIcons: object('battleFactionIcons'),
    })} as const;`,
    '',
  ];
  return lines.join('\n');
}

function oldAnomalyOutputSet() {
  return new Set(obsoleteOutputs);
}

async function upsertSpaceMapBindings(bindings, entries, sourceInfos) {
  const oldPaths = new Set(obsoleteSources);
  const anomalyEntries = entries.filter((candidate) => candidate.group === 'anomalyArts');
  const taskAnomalySources = new Set(anomalyEntries.map((entry) => entry.sourcePath));
  const skinPreviewSources = new Set(entries.filter((entry) => entry.mapPreview).map((entry) => entry.sourcePath));
  bindings.entries = bindings.entries.filter((entry) => !oldPaths.has(entry.sourcePath) && !taskAnomalySources.has(entry.sourcePath) && !skinPreviewSources.has(entry.sourcePath));
  for (const entry of anomalyEntries) {
    const info = sourceInfos.get(entry.sourcePath);
    bindings.entries.push({
      sourceSemanticId: entry.semanticId,
      sourcePath: entry.sourcePath,
      sourceSha256: info.sha256,
      sourceBytes: info.bytes,
      runtimeSemanticId: entry.semanticId,
      outputPath: entry.runtime.outputPath,
      textureKey: `space.${entry.semanticId}`,
      family: 'universe-object',
      viewGroup: 'universe',
      width: entry.runtime.width,
      height: entry.runtime.height,
    });
  }
  for (const entry of entries.filter((candidate) => candidate.mapPreview)) {
    const info = sourceInfos.get(entry.sourcePath);
    const semanticId = `${entry.semanticId}.map-preview`;
    bindings.entries.push({
      sourceSemanticId: entry.semanticId,
      sourcePath: entry.sourcePath,
      sourceSha256: info.sha256,
      sourceBytes: info.bytes,
      runtimeSemanticId: semanticId,
      outputPath: entry.mapPreview.outputPath,
      textureKey: `space.${semanticId}`,
      family: 'universe-planet',
      viewGroup: 'universe',
      width: entry.mapPreview.width,
      height: entry.mapPreview.height,
    });
  }
  bindings.sourceFileCount = new Set(bindings.entries.map((entry) => entry.sourcePath)).size;
  bindings.runtimeTextureCount = bindings.entries.length;
  return bindings;
}

async function countSourcePngs(directory) {
  let count = 0;
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, item.name);
    if (item.isDirectory()) count += await countSourcePngs(fullPath);
    else if (item.isFile() && path.extname(item.name).toLowerCase() === '.png') count++;
  }
  return count;
}

function addOrReplaceTaskAudit(audit, entries, sourceInfos, runtimeRecords) {
  const taskPaths = new Set([
    ...entries.filter((entry) => entry.disposition !== 'reuse-existing').map((entry) => entry.sourcePath),
    ...runtimeOutputsFor(entries).map((output) => output.runtime.outputPath),
    ...obsoleteSources,
    ...obsoleteOutputs,
  ]);
  audit.assets = audit.assets.filter((entry) => !taskPaths.has(entry.path));
  for (const entry of entries.filter((candidate) => candidate.disposition !== 'reuse-existing')) {
    audit.assets.push(sourceAuditRecord(entry, sourceInfos.get(entry.sourcePath)));
  }
  audit.assets.push(...runtimeRecords);
  audit.summary = summarize(audit.assets);
  return audit;
}

function updateProcessingPlan(plan, entries) {
  const oldPaths = oldAnomalyOutputSet();
  const outputs = runtimeOutputsFor(entries);
  const taskOutputs = new Set(outputs.map((output) => output.runtime.outputPath));
  plan.entries = plan.entries.filter((entry) => !oldPaths.has(entry.outputPath) && !taskOutputs.has(entry.outputPath));
  const uniqueByPath = new Map();
  for (const output of outputs) {
    if (!uniqueByPath.has(output.runtime.outputPath)) uniqueByPath.set(output.runtime.outputPath, asRuntimePlan(output));
  }
  plan.entries.push(...uniqueByPath.values());
  return plan;
}

function updateInventory(text, entries, sourceInfos) {
  const lines = text.trimEnd().split(/\r?\n/);
  const header = lines.shift();
  const existingRows = lines.filter((line) => line.length > 0);
  const removedPaths = new Set(obsoleteSources.map((item) => item.slice('assets/source/'.length)));
  const taskPaths = new Set(entries.filter((entry) => entry.disposition !== 'reuse-existing').map((entry) => entry.sourcePath.slice('assets/source/'.length)));
  const keptRows = existingRows.filter((line) => {
    const sourcePath = line.split('\t', 1)[0];
    return !removedPaths.has(sourcePath) && !taskPaths.has(sourcePath);
  });
  const newRows = entries.filter((entry) => entry.disposition !== 'reuse-existing').map((entry) => {
    const info = sourceInfos.get(entry.sourcePath);
    const inventoryPath = entry.sourcePath.slice('assets/source/'.length);
    const segments = inventoryPath.split('/');
    const bytes = info.bytes;
    const size = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
    return `${inventoryPath}\t${segments[0]}\t${segments[1] ?? ''}\t.png\t${bytes}\t${size}`;
  });
  return `${header}\n${[...keptRows, ...newRows].join('\n')}\n`;
}

async function writeAuditReport(manifest, sourceInfos, runtimeRecords, config, spaceMap) {
  const taskRuntimeBytes = runtimeRecords.reduce((sum, record) => sum + record.bytes, 0);
  const taskDecodedBytes = runtimeRecords.reduce((sum, record) => sum + record.decodedBytes, 0);
  const taskAudit = {
    schemaVersion: 1,
    scope,
    manifestPath: taskManifestPath,
    summary: {
      intakeCount: manifest.entries.length,
      copiedSourceCount: manifest.copiedSourceCount,
      reusedSourceCount: manifest.reusedSourceCount,
      runtimeTextureCount: runtimeRecords.length,
      transferBytes: taskRuntimeBytes,
      decodedBytes: taskDecodedBytes,
      sourceCounts: Object.fromEntries(Object.entries(expectedCounts).map(([key, expected]) => [key, expected])),
    },
    budgets: {
      generatedRuntimeTotalBytes: config.budgets.generatedRuntimeTotalBytes,
      generatedRuntimeDecodedBytes: config.budgets.generatedRuntimeDecodedBytes,
      generatedRuntimeTextureCount: config.budgets.generatedRuntimeTextureCount,
      singleRuntimeTexturePixels: config.budgets.singleRuntimeTexturePixels,
      spaceMapTransferBytes: spaceMap.budgets.transferBytes,
      spaceMapDecodedBytes: spaceMap.budgets.decodedBytes,
      spaceMapSourceFiles: spaceMap.sourceFileCount,
      spaceMapRuntimeTextures: spaceMap.runtimeTextureCount,
    },
    entries: manifest.entries.map((entry) => {
      const runtimeRecord = (runtime) => runtime ? {
        ...runtime,
        bytes: runtimeRecords.find((record) => record.path === runtime.outputPath)?.bytes,
        sha256: runtimeRecords.find((record) => record.path === runtime.outputPath)?.sha256,
      } : null;
      return ({
      semanticId: entry.semanticId,
      group: entry.group,
      archiveFile: entry.archiveFile,
      disposition: entry.disposition,
      sourcePath: entry.sourcePath,
      source: sourceInfos.has(entry.sourcePath) ? sourceInfos.get(entry.sourcePath) : null,
      runtime: runtimeRecord(entry.runtime),
      mapPreview: runtimeRecord(entry.mapPreview),
    });
    }),
  };
  await writeJson(taskAuditPath, taskAudit);
}

async function removeObsoleteFiles() {
  for (const relativePath of [...obsoleteSources, ...obsoleteOutputs]) {
    const file = absolute(relativePath);
    if (await fs.lstat(file).then(() => true).catch(() => false)) await fs.unlink(file);
  }
}

function assertCounts(entries) {
  const counts = Object.fromEntries(Object.keys(expectedCounts).map((group) => [group, entries.filter((entry) => entry.group === group).length]));
  for (const [group, expected] of Object.entries(expectedCounts)) {
    if (counts[group] !== expected) throw new Error(`${group} intake count ${counts[group]} does not match expected ${expected}`);
  }
  if (entries.length !== 72) throw new Error(`Expected 72 intake rows, received ${entries.length}`);
  if (entries.filter((entry) => entry.disposition !== 'reuse-existing').length !== 69) throw new Error('Expected exactly 69 copied source files.');
}

async function scanForObsoleteReferences() {
  const names = ['stellar-remnant.variant-01.png', 'stellar-remnant.variant-02.png'];
  const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  for (const relativePath of candidates) {
    if (relativePath === 'tools/asterion-asset-integration.mjs' || relativePath.startsWith('node_modules/') || relativePath.startsWith('.git/')) continue;
    const extension = path.extname(relativePath).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.json', '.md', '.tsv'].includes(extension)) continue;
    const data = await fs.readFile(absolute(relativePath), 'utf8').catch(() => '');
    const found = names.find((name) => data.includes(name));
    if (found) throw new Error(`Obsolete anomaly reference remains in ${relativePath}: ${found}`);
  }
}

async function verifyBudgets(config, audit, bindings) {
  const generated = audit.assets.filter((entry) => entry.classification === 'generated-runtime');
  const genBytes = generated.reduce((sum, entry) => sum + entry.bytes, 0);
  const genDecoded = generated.reduce((sum, entry) => sum + entry.decodedBytes, 0);
  if (genBytes > config.budgets.generatedRuntimeTotalBytes) throw new Error(`Generated runtime transfer ${genBytes} exceeds ${config.budgets.generatedRuntimeTotalBytes}`);
  if (genDecoded > config.budgets.generatedRuntimeDecodedBytes) throw new Error(`Generated runtime decode ${genDecoded} exceeds ${config.budgets.generatedRuntimeDecodedBytes}`);
  if (generated.length > config.budgets.generatedRuntimeTextureCount) throw new Error(`Generated runtime texture count ${generated.length} exceeds ${config.budgets.generatedRuntimeTextureCount}`);
  for (const entry of generated) {
    if (entry.width * entry.height > config.budgets.singleRuntimeTexturePixels) throw new Error(`Texture exceeds the single image pixel cap: ${entry.path}`);
  }
  if (bindings.sourceFileCount !== new Set(bindings.entries.map((entry) => entry.sourcePath)).size) throw new Error('Space map source count is stale.');
  if (bindings.runtimeTextureCount !== bindings.entries.length) throw new Error('Space map runtime texture count is stale.');
  const auditByPath = new Map(audit.assets.map((entry) => [entry.path, entry]));
  let mapTransfer = 0;
  let mapDecoded = 0;
  const viewDecoded = {};
  for (const binding of bindings.entries) {
    const runtime = auditByPath.get(binding.outputPath);
    if (!runtime) throw new Error(`Missing runtime audit record for ${binding.outputPath}`);
    mapTransfer += runtime.bytes;
    mapDecoded += runtime.decodedBytes;
    viewDecoded[binding.viewGroup] = (viewDecoded[binding.viewGroup] ?? 0) + runtime.decodedBytes;
  }
  if (mapTransfer > bindings.budgets.transferBytes) throw new Error(`Space map transfer ${mapTransfer} exceeds ${bindings.budgets.transferBytes}`);
  if (mapDecoded > bindings.budgets.decodedBytes) throw new Error(`Space map decoded size ${mapDecoded} exceeds ${bindings.budgets.decodedBytes}`);
  const viewBudget = { 'universe': 'universeViewDecodedBytes', 'galaxy': 'galaxyViewDecodedBytes', 'solar-system': 'solarSystemViewDecodedBytes' };
  for (const [view, key] of Object.entries(viewBudget)) {
    if ((viewDecoded[view] ?? 0) > bindings.budgets[key]) throw new Error(`${view} decoded size ${viewDecoded[view]} exceeds ${bindings.budgets[key]}`);
  }
  return { generatedTransferBytes: genBytes, generatedDecodedBytes: genDecoded, generatedTextures: generated.length, mapTransferBytes: mapTransfer, mapDecodedBytes: mapDecoded, mapViewDecodedBytes: viewDecoded };
}

async function verifyRuntimeFiles(manifest, auditAssets) {
  const expected = new Map();
  const auditByPath = new Map(auditAssets.map((entry) => [entry.path, entry]));
  for (const entry of manifest.entries) {
    const current = await fileInfo(entry);
    if (entry.source?.sha256 && entry.source.sha256 !== current.sha256) throw new Error(`Source SHA-256 changed after manifest generation: ${entry.sourcePath}`);
    if (entry.expectedSha256 && entry.expectedSha256 !== current.sha256) throw new Error(`Reusable source SHA-256 differs from pinned provenance: ${entry.sourcePath}`);
    const sourceAudit = auditByPath.get(entry.sourcePath);
    if (sourceAudit && sourceAudit.sha256 !== current.sha256) throw new Error(`Source SHA-256 differs from global asset audit: ${entry.sourcePath}`);
    for (const output of runtimeOutputs(entry)) {
      const { runtime } = output;
      const previous = expected.get(runtime.outputPath);
      if (previous && previous.sha256 !== current.sha256) throw new Error(`Shared runtime path points to different sources: ${runtime.outputPath}`);
      expected.set(runtime.outputPath, current);
      const file = absolute(runtime.outputPath);
      const data = await fs.readFile(file);
      const outputAudit = auditByPath.get(runtime.outputPath);
      if (outputAudit && outputAudit.sha256 !== createHash('sha256').update(data).digest('hex')) throw new Error(`Runtime output SHA-256 differs from asset audit: ${runtime.outputPath}`);
      const metadata = await sharp(data).metadata();
      if (metadata.format !== 'webp') throw new Error(`Runtime output is not WebP: ${runtime.outputPath}`);
      if (!metadata.width || !metadata.height || metadata.width > runtime.width || metadata.height > runtime.height) throw new Error(`Runtime dimensions exceed target: ${runtime.outputPath}`);
    }
  }
  const actualFiles = [];
  async function visit(directory) {
    if (!(await fs.lstat(directory).then(() => true).catch(() => false))) return;
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile()) actualFiles.push(path.relative(root, file).replaceAll('\\', '/'));
    }
  }
  await visit(absolute(runtimeRoot));
  const expectedPaths = [...expected.keys()].sort();
  const actualPaths = actualFiles.sort();
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) throw new Error(`Task runtime file set differs. Expected ${expectedPaths.length}, found ${actualPaths.length}.`);
}

async function generate({ allowedSourceHashChanges = new Set() } = {}) {
  const entries = definitions;
  assertCounts(entries);
  const previousManifest = await readJson(taskManifestPath).catch(() => null);
  const previousAssetAudit = await readJson('assets/manifests/source-asset-audit.json').catch(() => null);
  const previousByOutput = new Map();
  const previousBySource = new Map();
  for (const entry of previousManifest?.entries ?? []) {
    for (const output of runtimeOutputs(entry)) {
      if (!previousByOutput.has(output.runtime.outputPath)) previousByOutput.set(output.runtime.outputPath, { entry, runtime: output.runtime });
    }
    if (!previousBySource.has(entry.sourcePath)) previousBySource.set(entry.sourcePath, entry);
  }
  const previousAuditByPath = new Map((previousAssetAudit?.assets ?? []).map((entry) => [entry.path, entry]));
  const sourceInfos = new Map();
  const rebasedSourcePaths = new Set();
  for (const entry of entries) {
    const info = await fileInfo(entry);
    if (entry.expectedSha256 && info.sha256 !== entry.expectedSha256) throw new Error(`Reused source checksum changed: ${entry.sourcePath}`);
    const previousSource = previousBySource.get(entry.sourcePath);
    if (previousSource?.source?.sha256 && previousSource.source.sha256 !== info.sha256) {
      if (!allowedSourceHashChanges.has(entry.sourcePath)) throw new Error(`Source SHA-256 changed since the last generated manifest: ${entry.sourcePath}`);
      rebasedSourcePaths.add(entry.sourcePath);
    }
    sourceInfos.set(entry.sourcePath, info);
  }
  for (const sourcePath of allowedSourceHashChanges) {
    if (!pirateShipSourcePaths.has(sourcePath) || !previousBySource.has(sourcePath)) {
      throw new Error(`Only previously manifested pirate ship sources can be rebaselined: ${sourcePath}`);
    }
  }
  const actualCopyCount = entries.filter((entry) => entry.disposition !== 'reuse-existing').length;
  const outputs = new Map();
  for (const output of runtimeOutputsFor(entries)) {
    const { entry, runtime } = output;
    const previous = outputs.get(runtime.outputPath);
    const info = sourceInfos.get(entry.sourcePath);
    if (previous && previous.info.sha256 !== info.sha256) throw new Error(`Output collision between ${previous.entry.sourcePath} (${previous.info.sha256}) and ${entry.sourcePath} (${info.sha256}): ${runtime.outputPath}`);
    if (!previous) outputs.set(runtime.outputPath, { ...output, info });
  }

  for (const output of outputs.values()) {
    const { entry, runtime } = output;
    const outputPath = absolute(runtime.outputPath);
    const source = absolute(entry.sourcePath);
    const previous = previousByOutput.get(runtime.outputPath);
    const currentInfo = sourceInfos.get(entry.sourcePath);
    const reusable = previous?.entry.source?.sha256 === currentInfo.sha256
      && JSON.stringify(previous.runtime) === JSON.stringify(runtime)
      && await fs.readFile(outputPath).then(async (bytes) => {
        const metadata = await sharp(bytes).metadata();
        const priorAudit = previousAuditByPath.get(runtime.outputPath);
        const outputSha256 = createHash('sha256').update(bytes).digest('hex');
        return metadata.format === 'webp'
          && Boolean(metadata.width && metadata.height)
          && metadata.width <= runtime.width
          && metadata.height <= runtime.height
          && priorAudit?.sha256 === outputSha256;
      }).catch(() => false);
    if (reusable) continue;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await sharp(source, { failOn: 'error' })
      .resize(runtime.width, runtime.height, {
        fit: runtime.fit,
        withoutEnlargement: runtime.withoutEnlargement,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: runtime.quality, alphaQuality: 100, effort: 6 })
      .toFile(outputPath);
  }

  const outputMetas = new Map();
  const runtimeRecords = [];
  for (const [outputPath, output] of outputs) {
    const bytes = await fs.readFile(absolute(outputPath));
    const metadata = await sharp(bytes).metadata();
    const record = runtimeAuditRecord(output, bytes, metadata);
    runtimeRecords.push(record);
    outputMetas.set(outputPath, metadata);
  }
  await removeObsoleteFiles();

  const manifestEntries = entries.map((entry) => ({
    ...entry,
    source: sourceInfos.get(entry.sourcePath),
    runtimeUrl: entry.runtime ? `./${entry.runtime.outputPath.slice('public/'.length)}` : null,
    mapPreviewUrl: entry.mapPreview ? `./${entry.mapPreview.outputPath.slice('public/'.length)}` : null,
  }));
  const manifest = taskSourceManifest(manifestEntries);
  const config = await readJson('assets/manifests/asset-pipeline.config.json');
  let spaceMap = await readJson(config.spaceMapBindingsPath);
  spaceMap = await upsertSpaceMapBindings(spaceMap, entries, sourceInfos);
  config.spaceMapBudgets.sourceFiles = spaceMap.sourceFileCount;
  config.spaceMapBudgets.runtimeTextures = spaceMap.runtimeTextureCount;
  config.taskIntegration = {
    manifestPath: taskManifestPath,
    auditPath: taskAuditPath,
    scriptPath: 'tools/asterion-asset-integration.mjs',
    runtimeRoot,
    runtimeTypeScriptManifestPath: typeScriptManifestPath,
    scope,
    copiedSourceCount: actualCopyCount,
    reusedSourceCount: entries.length - actualCopyCount,
    runtimeTextureCount: runtimeRecords.length,
  };

  let plan = await readJson(config.processingPlanPath);
  plan = updateProcessingPlan(plan, entries);
  const audit = await readJson(config.auditManifestPath);
  const updatedAudit = addOrReplaceTaskAudit(audit, entries, sourceInfos, runtimeRecords);
  await writeJson(config.spaceMapBindingsPath, spaceMap);
  await writeJson(config.processingPlanPath, plan);
  await writeJson(config.auditManifestPath, updatedAudit);
  await writeJson('assets/manifests/asset-pipeline.config.json', config);
  await writeJson(taskManifestPath, manifest);
  await writeText(typeScriptManifestPath, renderTypeScript(manifestEntries));
  const inventoryPath = absolute('docs/assets-inventory.tsv');
  const inventory = await fs.readFile(inventoryPath, 'utf8');
  await writeText('docs/assets-inventory.tsv', updateInventory(inventory, entries, sourceInfos));
  await writeAuditReport(manifest, sourceInfos, runtimeRecords, config, spaceMap);
  await scanForObsoleteReferences();
  const budgets = await verifyBudgets(config, updatedAudit, spaceMap);
  await verifyRuntimeFiles(manifest, updatedAudit.assets);
  return { copied: manifest.copiedSourceCount, reused: manifest.reusedSourceCount, intake: manifest.intakeCount, runtime: runtimeRecords.length, rebasedSources: [...rebasedSourcePaths].sort(), budgets };
}

async function audit() {
  const [manifest, config, sourceAudit, bindings, processingPlan] = await Promise.all([
    readJson(taskManifestPath),
    readJson('assets/manifests/asset-pipeline.config.json'),
    readJson('assets/manifests/source-asset-audit.json'),
    readJson('assets/manifests/space-map-runtime-bindings.json'),
    readJson('assets/manifests/runtime-processing-plan.json'),
  ]);
  assertCounts(manifest.entries);
  await scanForObsoleteReferences();
  await verifyRuntimeFiles(manifest, sourceAudit.assets);
  const budgetSummary = await verifyBudgets(config, sourceAudit, bindings);
  const taskRuntime = sourceAudit.assets.filter((entry) => entry.path.startsWith(`${runtimeRoot}/`));
  const expectedOutputPaths = new Set(runtimeOutputsFor(manifest.entries).map((output) => output.runtime.outputPath));
  if (taskRuntime.length !== expectedOutputPaths.size) throw new Error(`Task audit has ${taskRuntime.length} runtime entries but manifest has ${expectedOutputPaths.size} outputs.`);
  const planPaths = new Set(processingPlan.entries.map((entry) => entry.outputPath));
  for (const outputPath of expectedOutputPaths) if (!planPaths.has(outputPath)) throw new Error(`Processing plan omits ${outputPath}`);
  return { intake: manifest.intakeCount, runtime: taskRuntime.length, budgetSummary };
}

const command = process.argv[2] ?? 'generate';
try {
  const result = command === 'generate'
    ? await generate()
    : command === 'rebaseline-pirate-ships'
      ? await generate({ allowedSourceHashChanges: pirateShipSourcePaths })
      : command === 'audit' ? await audit() : null;
  if (!result) throw new Error(`Unknown command: ${command}. Use generate, rebaseline-pirate-ships, or audit.`);
  console.log(JSON.stringify({ command, ...result }, null, 2));
} catch (error) {
  console.error(`[asterion-asset-integration] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
