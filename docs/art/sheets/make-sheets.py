import os, sys, glob
from PIL import Image, ImageDraw
root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
groups = {
 'planets-skins': ['assets/source/planets/skins/*','assets/source/starter/planets/*'],
 'planets-nav': ['assets/source/universe-navigation/planets/*'],
 'planets-unique-pirate': ['assets/source/planets/unique/*','assets/source/planets/pirate/*'],
 'stars-objects': ['assets/source/universe-navigation/system-stars/*','assets/source/universe-navigation/stellar-remnants/*','assets/source/universe-navigation/asteroids/*','assets/source/debris/*','public/assets/generated/asterion/universe/anomalies/*'],
 'ships-aegis-synod-veyra': ['assets/source/New assets/ship/aegis/*','assets/source/New assets/ship/synod/*','assets/source/New assets/ship/veyra/*'],
 'ships-commander-pirate': ['assets/source/New assets/comander_ship/*','assets/source/ships/pirates/*','assets/source/characters/pirates/*'],
 'defence': ['assets/source/New assets/defenses/*/*'],
 'buildings-aegis': ['assets/source/New assets/buildings/aegis/*'],
 'buildings-synod': ['assets/source/New assets/buildings/synod/*'],
 'buildings-veyra': ['assets/source/New assets/buildings/veyra/*'],
 'technologies': ['assets/source/New assets/technologies/*'],
 'mission-icons-used': ['assets/source/mission-icons-v1/0*','assets/source/mission-icons-v1/10*','assets/source/mission-icons-v1/18*','assets/source/mission-icons-v1/2[034]*','assets/source/mission-icons-v1/3[136]*','public/assets/generated/sun-raid/mission-sun-raid.webp','public/assets/generated/sun-raid/debris-finder.webp'],
 'ui-actions-header-icons': ['src/assets/ui/actions/*.webp','src/assets/ui/header-icons/*','public/assets/generated/asterion/ui/*/*','src/assets/ui/settings/*','src/assets/ui/rating/medal*','public/assets/generated/asterion/factions/battle-icons/*'],
 'banners-empty-backdrops': ['src/assets/ui/missions/*','src/assets/ui/empty/*','src/assets/ui/rating/rating-backdrop.webp','src/assets/ui/atlas/*','src/assets/ui/actions/atlas/*','src/assets/battle-report/*','assets/source/battle-report-v2/*','assets/source/faction-delivery-v1/territories/*','assets/source/starter/backgrounds/system_background.png'],
 'factions-race-art': ['assets/source/generated-factions-v1/factions/*','assets/source/starter/factions/*','assets/source/factions/battle-icons/*'],
 'sun-raid': ['public/assets/generated/sun-raid/*'],
 'heraldry': ['src/assets/command/orbital-heraldry/*.webp','src/assets/command/orbital-heraldry/*.png'],
 'operations-public': ['public/assets/generated/asterion/operations/*/*'],
}
T=150; LBL=14
def checker(w,h):
    c=Image.new('RGB',(w,h),(28,32,40)); d=ImageDraw.Draw(c)
    for y in range(0,h,12):
        for x in range(0,w,12):
            if (x//12+y//12)%2: d.rectangle([x,y,x+11,y+11],fill=(60,66,78))
    return c
for name,pats in groups.items():
    files=[]
    for p in pats: files+=sorted(f for f in glob.glob(os.path.join(root,p)) if f.lower().endswith(('.png','.webp','.jpg')))
    if not files: continue
    cols=8 if len(files)>16 else min(len(files),6)
    rows=(len(files)+cols-1)//cols
    sheet=Image.new('RGB',(cols*T,rows*(T+LBL)),(10,12,16)); d=ImageDraw.Draw(sheet)
    for i,f in enumerate(files):
        im=Image.open(f); im.draft('RGB',(T*2,T*2)); im=im.convert('RGBA'); im.thumbnail((T-4,T-4))
        cell=checker(T,T); cell.paste(im,((T-im.width)//2,(T-im.height)//2),im)
        x,y=(i%cols)*T,(i//cols)*(T+LBL); sheet.paste(cell,(x,y))
        d.text((x+2,y+T+1),os.path.basename(f)[:24],fill=(200,210,220))
        im.close()
    sheet.save(os.path.join(out,name+'.jpg'),quality=80); print(name,len(files),sheet.size)
