"""Contact sheet of all planet looks by rubric -> docs/art/sheets/planet-skins-v2.jpg

    python assets/source/planets/skins-v2/contact-sheet.py

Uses the in-game 192 px thumbnails (what the editor grid shows), new looks marked «NEW»,
plus a strip at 48 px to check how the looks read small (map, Empire).
"""
import os
import re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
THUMBS = os.path.join(ROOT, 'src', 'assets', 'art', 'planets', 'skin-thumbs')
OUT = os.path.join(ROOT, 'docs', 'art', 'sheets', 'planet-skins-v2.jpg')
BG = (9, 13, 20)

catalogue = open(os.path.join(ROOT, 'src', 'domain', 'universe', 'planet-skins.ts'), encoding='utf8').read()
groups = re.findall(r"\{ id: '([a-z]+)', tier: '([a-z]+)', label: '([^']+)' \}", catalogue)
skins = re.findall(r"^\s*skin\('([^']+)', '([^']+)', '([a-z]+)'\)", catalogue, re.M)


def font(size, bold=False):
    for name in (('arialbd.ttf' if bold else 'arial.ttf'), 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


CELL, COLS, LABEL, HEAD = 150, 10, 34, 40
rows = []
for gid, tier, glabel in groups:
    items = [(sid, label) for sid, label, g in skins if g == gid]
    rows.append(('head', f'{glabel}  ·  {len(items)}', tier))
    for i in range(0, len(items), COLS):
        rows.append(('cells', items[i:i + COLS], tier))
strip_h = 48 + 24
height = 70 + sum(HEAD if kind == 'head' else CELL + LABEL for kind, _, _ in rows) + strip_h + 30
sheet = Image.new('RGB', (COLS * CELL + 40, height), BG)
draw = ImageDraw.Draw(sheet)
draw.text((20, 18), f'Облики планет: {len(skins)} (новых {sum(1 for s in skins if s[0].startswith(("ps-", "fan-", "ally-")))})', fill=(230, 246, 250), font=font(26, True))
colours = {'common': (143, 182, 192), 'rare': (201, 162, 255), 'fantasy': (255, 159, 122), 'alliance': (240, 201, 106)}
y = 70
for kind, payload, tier in rows:
    if kind == 'head':
        draw.text((20, y + 10), payload, fill=colours[tier], font=font(18, True))
        y += HEAD
        continue
    for i, (sid, label) in enumerate(payload):
        x = 20 + i * CELL
        im = Image.open(os.path.join(THUMBS, f'{sid}.webp')).convert('RGBA').resize((CELL - 22, CELL - 22), Image.LANCZOS)
        sheet.paste(im, (x + 11, y + 6), im)
        draw.text((x + 6, y + CELL - 6), label, fill=(232, 246, 250), font=font(13))
        if sid.startswith(('ps-', 'fan-', 'ally-')):
            draw.text((x + 6, y + CELL + 10), 'NEW', fill=colours[tier], font=font(11, True))
    y += CELL + LABEL
draw.text((20, y + 2), '48 px', fill=(127, 152, 160), font=font(13))
x = 70
for sid, _, _ in skins:
    if x + 48 > sheet.width - 10:
        break
    im = Image.open(os.path.join(THUMBS, f'{sid}.webp')).convert('RGBA').resize((22, 22), Image.LANCZOS)
    sheet.paste(im, (x, y + 2), im)
    x += 20
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT, quality=86)
print(OUT, sheet.size)
