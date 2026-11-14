"""Planet looks -> game WebP files (run locally after adding or regenerating a look).

    python assets/source/planets/skins-v2/build-art.py

Reads the catalogue ids from src/domain/universe/planet-skins.ts.
  * every look: a 192 px thumbnail for the editor grid and the map
    -> public/assets/generated/asterion/universe/planet-skin-thumbs/<id>.webp
  * looks from 14.11.2026 (sources here, <id>.png): a 512 px preview
    -> public/assets/generated/asterion/universe/planet-skins-v2/<id>.webp
Old looks keep their own art files; only their thumbnail is new.
Margins are cropped to the planet so every look has the same size in the grid.
"""
import os
import re
import sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'source', 'planets', 'skins-v2')
PUB = os.path.join(ROOT, 'public', 'assets', 'generated', 'asterion', 'universe')
THUMBS = os.path.join(PUB, 'planet-skin-thumbs')
PREVIEWS = os.path.join(PUB, 'planet-skins-v2')

STARTER = {k: f'assets/source/starter/planets/planet_{v}.png' for k, v in {
    'colonized': 'colonized', 'terran': 'terran', 'oceanic': 'oceanic', 'desert': 'desert', 'ice': 'ice',
    'volcanic': 'volcanic', 'toxic': 'toxic', 'barren': 'barren_rocky', 'gas': 'gas_giant'}.items()}


def legacy_source(skin_id: str):
    if skin_id in STARTER:
        return os.path.join(ROOT, STARTER[skin_id])
    m = re.fullmatch(r'skin-(\d{3})', skin_id)
    if m:
        return os.path.join(ROOT, 'assets', 'source', 'planets', 'skins', f'planet-{m.group(1)}.png')
    if skin_id.startswith('skin-asterion-'):
        return os.path.join(PUB, 'planet-skins', f'{skin_id}.webp')
    return None


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
    catalogue = open(os.path.join(ROOT, 'src', 'domain', 'universe', 'planet-skins.ts'), encoding='utf8').read()
    ids = re.findall(r"^\s*skin\('([^']+)'", catalogue, re.M)
    os.makedirs(THUMBS, exist_ok=True)
    os.makedirs(PREVIEWS, exist_ok=True)
    missing = []
    for skin_id in ids:
        new_src = os.path.join(SRC, f'{skin_id}.png')
        src = new_src if os.path.exists(new_src) else legacy_source(skin_id)
        if not src or not os.path.exists(src):
            missing.append(skin_id)
            continue
        im = Image.open(src)
        crop_square(im, 0.03).resize((192, 192), Image.LANCZOS).save(os.path.join(THUMBS, f'{skin_id}.webp'), 'WEBP', quality=82, method=6)
        if src == new_src:
            crop_square(im, 0.05).resize((512, 512), Image.LANCZOS).save(os.path.join(PREVIEWS, f'{skin_id}.webp'), 'WEBP', quality=84, method=6)
    print(f'{len(ids) - len(missing)} looks built, missing sources: {missing or "none"}')
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
