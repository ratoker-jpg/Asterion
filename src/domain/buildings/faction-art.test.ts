import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { BUILDING_ROLES, getBuildingPresentation, localizeBuildingNames, type BuildingFaction } from './balance-v1.ts';
import { getBuildingDefinition, getBuildingsForZone } from './resource-zone.ts';

const FACTIONS: readonly BuildingFaction[] = ['aegis', 'synod', 'veyra'];
const SRC = fileURLToPath(new URL('../../', import.meta.url));

test('every building of every race resolves to that race\'s own art file on disk', () => {
  const seen = new Set<string>();
  for (const faction of FACTIONS) {
    for (const role of BUILDING_ROLES) {
      const art = getBuildingDefinition(role, faction).art;
      const file = fileURLToPath(art);
      assert.ok(existsSync(file), `${faction}/${role}: missing ${file}`);
      assert.match(art, new RegExp(`/buildings/${faction}/building\\.${faction}\\.${role}\\.png$`), `${faction}/${role}: ${art}`);
      assert.equal(getBuildingPresentation(role, faction).art, art);
      assert.ok(!seen.has(art), `${faction}/${role}: art shared with another race or role`);
      seen.add(art);
    }
    for (const zone of ['resource', 'industry', 'military'] as const) {
      for (const item of getBuildingsForZone(zone, faction)) assert.match(item.art, new RegExp(`building\\.${faction}\\.`));
    }
  }
});

test('race names differ from the Aster names wherever the art differs', () => {
  for (const faction of ['synod', 'veyra'] as const) {
    for (const role of BUILDING_ROLES) {
      assert.notEqual(getBuildingDefinition(role, faction).name, getBuildingDefinition(role, 'aegis').name, `${faction}/${role}`);
    }
  }
});

// Interior screens show the player's buildings. A call without a race falls
// back to the Aster art (the V6 bug in Production bots, Recycling and Trade):
// only calls that read race-independent fields (zone, max level) may omit it.
test('interior screens never resolve a building without the player\'s race', () => {
  const allowed = new Map<string, number>([
    ['ZoneView.tsx', 1], // stateFor: maxLevel only
    ['building-interior-navigation.ts', 1], // zone only
  ]);
  const files = readdirSync(SRC).filter((name) => /\.(tsx|ts)$/.test(name) && !name.endsWith('.test.ts'));
  for (const name of files) {
    const source = readFileSync(join(SRC, name), 'utf8');
    const bare = source.match(/getBuildingDefinition\([^,()]+\)/g) ?? [];
    assert.equal(bare.length, allowed.get(name) ?? 0, `${name}: ${bare.join(', ')}`);
    assert.doesNotMatch(source, /buildings\/aegis\/building\.aegis\./, `${name} imports an Aster building file directly`);
  }
});

test("requirement and reason text is shown with the player's race names", () => {
  for (const role of BUILDING_ROLES) {
    const aster = getBuildingDefinition(role, 'aegis').name;
    assert.equal(localizeBuildingNames(`Требуется: ${aster} — ур. 5; сейчас 0.`, 'aegis'), `Требуется: ${aster} — ур. 5; сейчас 0.`);
    for (const faction of ['synod', 'veyra'] as const) {
      const own = getBuildingDefinition(role, faction).name;
      assert.equal(localizeBuildingNames(`${aster} · уровень 3`, faction), `${own} · уровень 3`, `${faction}/${role}`);
    }
  }
});

// Building names written into interface copy never follow the player's race.
// Screens and src/ui read them from getBuildingDefinition(role, faction) or
// pass domain text through localizeBuildingNames instead.
test('interface copy does not hard-code Aster building names', () => {
  const names = BUILDING_ROLES.map((role) => getBuildingDefinition(role, 'aegis').name);
  const forms = [...names, ...names.map((name) => name.toUpperCase())].sort((a, b) => b.length - a.length);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx')) files.push(path);
    }
  };
  for (const name of readdirSync(SRC)) if (name.endsWith('.tsx')) files.push(join(SRC, name));
  walk(join(SRC, 'ui'));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // JSX text between tags and string or template literals.
    const copy = [...source.matchAll(/>([^<>{}]+)</g), ...source.matchAll(/(['"`])((?:(?!\1)[^\\n]|\.)*)\1/g)].map((match) => match[2] ?? match[1]);
    for (const text of copy) {
      for (const name of forms) {
        assert.ok(!new RegExp(`(^|[^А-Яа-яЁё])${name}([^А-Яа-яЁё]|$)`).test(text), `${file}: «${name}» in «${text.trim().slice(0, 80)}»`);
      }
    }
  }
});
