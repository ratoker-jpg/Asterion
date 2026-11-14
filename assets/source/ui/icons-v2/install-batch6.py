# Icons batch 6: actions medallions (192 px) and settings plates (96 px) from icons-v2 sources.
# Usage: python install-batch6.py   (sources a-*.png / st-*.png are the chosen 1024 Codex PNGs)
import sys, os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
ACT = os.path.join(ROOT, 'src', 'assets', 'ui', 'actions'); SET = os.path.join(ROOT, 'src', 'assets', 'ui', 'settings')
# action file -> icons-v2 source (one meaning = one icon across the game)
ACTIONS = {
  'aid': 'm-aid', 'attack': 'm-attack', 'colonize': 'm-colonize', 'deployment': 'm-deployment',
  'espionage': 'm-espionage', 'expedition': 'm-expedition', 'gas': 'm-gas', 'recycle': 'm-recycle',
  'space-flight': 'm-space-flight', 'sun-support': 'm-sun-support', 'transport': 'm-transport',
  'pirate-raid': 'm-pirate-elimination', 'profile': 'r-profile',
  'object-attack': 'a-object-attack', 'object-card': 'a-object-card', 'pirate-report': 'a-pirate-report',
  'pirate-scout': 'a-pirate-scout', 'probe-explore': 'a-probe-explore', 'show-on-map': 'a-show-on-map',
}
SETTINGS = ['screen', 'interface', 'controls', 'sound', 'notifications', 'save', 'journal']
def trimmed(path):
  im = Image.open(path).convert('RGBA')
  a = im.getchannel('A').point(lambda v: 0 if v < 4 else v); im.putalpha(a)
  c = im.crop(a.point(lambda v: 255 if v > 8 else 0).getbbox()); s = int(max(c.size) * 1.06)
  cv = Image.new('RGBA', (s, s), (0, 0, 0, 0)); cv.alpha_composite(c, ((s - c.width) // 2, (s - c.height) // 2)); return im, cv
def write(cv, path, size): cv.resize((size, size), Image.LANCZOS).save(path, 'WEBP', quality=90, method=6, alpha_quality=100)
for name, src in ACTIONS.items():
  write(trimmed(os.path.join(HERE, src + '.png'))[1], os.path.join(ACT, name + '.webp'), 192)
for name in SETTINGS:
  write(trimmed(os.path.join(HERE, 'st-' + name + '.png'))[1], os.path.join(SET, name + '.webp'), 96)
print('ok', len(ACTIONS), len(SETTINGS))
