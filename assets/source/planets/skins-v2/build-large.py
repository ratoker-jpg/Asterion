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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--size', type=int, default=1024)
    args = parser.parse_args()

    ba = load_build_art()
    catalogue = open(CATALOGUE, encoding='utf8').read()
    ids = re.findall(r"^\s*skin\('([^']+)'", catalogue, re.M)
    os.makedirs(OUT, exist_ok=True)

    missing = []
    total = 0
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
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
