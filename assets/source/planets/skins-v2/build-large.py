"""Big planet pictures (1024 px) for the planet screen -> src/assets/art/planets/large/<id>.webp

    python assets/source/planets/skins-v2/build-large.py            # all looks
    python assets/source/planets/skins-v2/build-large.py --size 768  # smaller set

Why: the planet screen draws the planet up to ~780 CSS px (planet-screens.css,
--orbit-size). The 512 px pictures from #238 were upscaled there and looked soft.
The 1024 px set is used ONLY by the planet screen (src/planet-skin-large.ts loads
each file on demand). Map, fleets, Empire, the editor grid keep the 512 / 192 px art.

Every look goes through the same framing: the planet is cropped to its alpha box
with the same 5 % margin, so all looks have the same field around the sphere.
Sources are the largest PNG/WebP available for each look (the same rules as
build-art.py for legacy ids). Quality 88 (WebP, method 6).
"""
import argparse
import importlib.util
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'art', 'planets', 'large')
ART_ROOT = os.path.join(ROOT, 'src', 'assets', 'art')
PUB = os.path.join(ROOT, 'public', 'assets', 'generated', 'asterion', 'universe')
PREVIEWS = os.path.join(ART_ROOT, 'planets', 'skins-v2')
GENERATED = os.path.join(ROOT, 'src', 'planet-skin-large.generated.ts')
CATALOGUE = os.path.join(ROOT, 'src', 'domain', 'universe', 'planet-skins.ts')
MARGIN = 0.05
QUALITY = 88


def load_build_art():
    spec = importlib.util.spec_from_file_location('build_art', os.path.join(HERE, 'build-art.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def crop_square(im: Image.Image, margin: float) -> Image.Image:
    im = im.convert('RGBA')
    alpha = im.getchannel('A').point(lambda a: 255 if a > 10 else 0)
    box = alpha.getbbox() or (0, 0, im.width, im.height)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    side = max(box[2] - box[0], box[3] - box[1]) * (1 + 2 * margin)
    half = side / 2
    canvas = Image.new('RGBA', (int(side), int(side)), (0, 0, 0, 0))
    canvas.paste(im.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half))), (0, 0))
    return canvas


# The 512 px (or, for the owner's 1024 px looks, public) picture each look showed before this batch.
# Same mapping as src/planet-skin-art.ts (legacyArt, manifest, skins-v2).
STARTER_FILES = {'colonized': 'planet_colonized', 'terran': 'planet_terran', 'oceanic': 'planet_oceanic',
                 'desert': 'planet_desert', 'ice': 'planet_ice', 'volcanic': 'planet_volcanic',
                 'toxic': 'planet_toxic', 'barren': 'planet_barren_rocky', 'gas': 'planet_gas_giant'}
SHIPPED_512 = {'skin-002', 'skin-003', 'skin-005', 'skin-011', 'skin-012', 'skin-015', 'skin-016', 'skin-026',
               'skin-027', 'skin-028', 'skin-030', 'skin-032'}


def before_art(skin_id: str):
    if skin_id in STARTER_FILES:
        return os.path.join(ART_ROOT, 'starter', 'planets', f'{STARTER_FILES[skin_id]}.webp')
    if skin_id in SHIPPED_512:
        return os.path.join(ART_ROOT, 'planets', 'skins', f'planet-{skin_id[-3:]}.webp')
    if skin_id.startswith('skin-asterion-'):
        return os.path.join(PUB, 'planet-skins', f'{skin_id}.webp')
    return os.path.join(PREVIEWS, f'{skin_id}.webp')


def sphere_share(path: str) -> float:
    """Share of the picture's side that the planet's alpha box takes."""
    im = Image.open(path).convert('RGBA')
    alpha = im.getchannel('A').point(lambda a: 255 if a > 10 else 0)
    box = alpha.getbbox() or (0, 0, im.width, im.height)
    return max(box[2] - box[0], box[3] - box[1]) / im.width


def visible_box(path: str):
    """Half width and half height of the visible part (alpha bbox), as shares of the picture side.

    The 1024 px frames are centred on that box (crop_square), so the box is centred too.
    """
    im = Image.open(path).convert('RGBA')
    alpha = im.getchannel('A').point(lambda a: 255 if a > 10 else 0)
    x0, y0, x1, y1 = alpha.getbbox() or (0, 0, im.width, im.height)
    return round((x1 - x0) / 2 / im.width, 4), round((y1 - y0) / 2 / im.height, 4)


def write_scales(ids, skipped):
    """src/planet-skin-large.generated.ts: per look, the CSS scale that keeps the planet as big on screen as before.

    The 1024 px frames all carry the same margin (MARGIN), so the planet fills the same share of
    every frame. Before this batch the share differed by look (0.65 for «Терран», 1.0 for some
    shipped looks), so scale = share before / share now keeps each look's size on screen unchanged.
    """
    scales = {}
    boxes = {}
    for skin_id in ids:
        if skin_id in skipped:
            continue
        before = before_art(skin_id)
        after = os.path.join(OUT, f'{skin_id}.webp')
        if not os.path.exists(before) or not os.path.exists(after):
            continue
        scales[skin_id] = sphere_share(before) / sphere_share(after)
        boxes[skin_id] = visible_box(after)
    lines = ['// Generated by assets/source/planets/skins-v2/build-large.py. Do not edit by hand.',
             '/** CSS scale of the 1024 px planet per look: the planet keeps its size on screen from before. */',
             'export const LARGE_PLANET_SCALE: Readonly<Record<string, number>> = {']
    lines += [f"  '{k}': {v:.4f}," for k, v in scales.items()]
    lines += ['};', '',
              '/** Half width and half height of the visible part of each look (shares of the picture side). */',
              'export const LARGE_PLANET_BOX: Readonly<Record<string, readonly [number, number]>> = {']
    lines += [f"  '{k}': [{w}, {h}]," for k, (w, h) in boxes.items()]
    lines += ['};', '']
    with open(GENERATED, 'w', encoding='utf8', newline='\n') as out:
        out.write('\n'.join(lines))
    return scales


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--size', type=int, default=1024)
    parser.add_argument('--scale-only', action='store_true', help='rewrite the scale table from the existing pictures')
    args = parser.parse_args()

    ba = load_build_art()
    catalogue = open(CATALOGUE, encoding='utf8').read()
    ids = re.findall(r"^\s*skin\('([^']+)'", catalogue, re.M)
    os.makedirs(OUT, exist_ok=True)

    missing = []
    total = 0
    if not args.scale_only:
        for skin_id in ids:
            new_src = os.path.join(ba.SRC, f'{skin_id}.png')
            src = new_src if os.path.exists(new_src) else ba.legacy_source(skin_id)
            if not src or not os.path.exists(src):
                missing.append(skin_id)
                continue
            im = Image.open(src)
            out = os.path.join(OUT, f'{skin_id}.webp')
            crop_square(im, MARGIN).resize((args.size, args.size), Image.LANCZOS).save(out, 'WEBP', quality=QUALITY, method=6)
            total += os.path.getsize(out)
        print(f'{len(ids) - len(missing)} looks at {args.size} px, {total / 1e6:.1f} MB, missing sources: {missing or "none"}')
    scales = write_scales(ids, set(missing))
    print(f'scales for {len(scales)} looks, range {min(scales.values()):.3f}..{max(scales.values()):.3f}')
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
