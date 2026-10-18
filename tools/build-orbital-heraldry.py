"""Builds the runtime set of the «Орбитальные дома» alliance crest constructor.

Source: the ASTERION_ORBITAL_HOUSES_V2 package (92 PNG at 1254 px + manifest.json).
The 80 MB source PNGs are not committed; this script verifies the package and
writes what the game ships:

  src/assets/command/orbital-heraldry/*.webp      every module at 512 px
  src/assets/command/orbital-heraldry/mask-*.png  frame interiors rasterised from the
                                                  manifest `interior.runs` (exact mask)
  src/domain/command/orbital-crest-catalog.generated.ts   ids, names, geometry

Usage:  python -I tools/build-orbital-heraldry.py <package-dir>
"""

import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

SIZE = 512
ROOT = Path(__file__).resolve().parent.parent
OUT_ASSETS = ROOT / 'src' / 'assets' / 'command' / 'orbital-heraldry'
OUT_CATALOG = ROOT / 'src' / 'domain' / 'command' / 'orbital-crest-catalog.generated.ts'


def fail(message):
    print(f'error: {message}', file=sys.stderr)
    sys.exit(1)


def r6(value):
    return round(float(value), 6)


def main():
    if len(sys.argv) != 2:
        fail('usage: build-orbital-heraldry.py <package-dir>')
    source = Path(sys.argv[1]).resolve()
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    plan = manifest['plan']
    assets = {entry['id']: entry for entry in manifest['assets']}

    expected = (
        [f"frame-{item['id']}" for item in plan['frames']]
        + [f"field-{item['id']}" for item in plan['fields']]
        + [f"pattern-{item['id']}" for item in plan['patterns']]
        + [f"glyph-{glyph['id']}-{color['id']}" for glyph in plan['glyphs'] for color in plan['palette']]
    )
    if len(expected) != plan['expected']['total']:
        fail(f"plan lists {len(expected)} modules, expected {plan['expected']['total']}")
    missing = [asset_id for asset_id in expected if asset_id not in assets]
    if missing:
        fail(f'manifest misses {missing}')

    OUT_ASSETS.mkdir(parents=True, exist_ok=True)
    for stale in OUT_ASSETS.iterdir():
        stale.unlink()

    for asset_id in expected:
        entry = assets[asset_id]
        path = source / entry['file']
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry['sha256']:
            fail(f'{path.name}: sha256 differs from manifest')
        image = Image.open(path)
        geometry = entry['geometry']
        if image.size != (geometry['width'], geometry['height']) or image.width != image.height:
            fail(f'{path.name}: size {image.size} does not match manifest geometry')
        image = image.convert('RGB' if entry['kind'] == 'field' else 'RGBA').resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        image.save(OUT_ASSETS / f'{asset_id}.webp', 'WEBP', quality=88, method=6, alpha_quality=100)

        if entry['kind'] == 'frame':
            interior = geometry['interior']
            if interior.get('leaks'):
                fail(f'{asset_id}: interior leaks to the edge')
            width, height = geometry['width'], geometry['height']
            mask = Image.new('L', (width, height), 0)
            pixels = mask.load()
            for y, x0, x1 in interior['runs']:
                if y in (0, height - 1) or x0 <= 0 or x1 >= width:
                    fail(f'{asset_id}: interior run touches the canvas edge')
                for x in range(x0, x1):
                    pixels[x, y] = 255
            mask = mask.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
            rgba = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 0))
            rgba.putalpha(mask)
            rgba.save(OUT_ASSETS / f'mask-{entry["id"][len("frame-"):]}.png', optimize=True)

    def placed(entry):
        geometry = entry['geometry']
        return {'pivot': [r6(v) for v in geometry['pivot']], 'radius': r6(geometry['radius'])}

    catalog = {
        'frames': [
            {'id': item['id'], 'name': item['name'],
             'interior': {'pivot': [r6(v) for v in assets[f"frame-{item['id']}"]['geometry']['interior']['pivot']],
                          'radius': r6(assets[f"frame-{item['id']}"]['geometry']['interior']['radius'])}}
            for item in plan['frames']
        ],
        'fields': [{'id': item['id'], 'name': item['name'], 'hex': item['hex']} for item in plan['fields']],
        'patterns': [
            {'id': item['id'], 'name': item['name'], 'layout': item['layout'], **placed(assets[f"pattern-{item['id']}"])}
            for item in plan['patterns']
        ],
        'glyphs': [
            {'id': glyph['id'], 'name': glyph['name'],
             'placement': {color['id']: placed(assets[f"glyph-{glyph['id']}-{color['id']}"]) for color in plan['palette']}}
            for glyph in plan['glyphs']
        ],
        'colors': [{'id': item['id'], 'name': item['name'], 'hex': item['hex']} for item in plan['palette']],
        'geometry': plan['geometry'],
    }

    body = json.dumps(catalog, ensure_ascii=False, indent=2)
    OUT_CATALOG.write_text(
        '// Generated by tools/build-orbital-heraldry.py from the ORBITAL_HOUSES_V2 manifest. Do not edit.\n'
        f'export const ORBITAL_CREST_CATALOG = {body} as const;\n',
        encoding='utf-8', newline='\n')

    total = sum(path.stat().st_size for path in OUT_ASSETS.iterdir())
    print(f'{len(expected)} modules + {len(plan["frames"])} masks -> {OUT_ASSETS} ({total / 1e6:.1f} MB)')


main()
