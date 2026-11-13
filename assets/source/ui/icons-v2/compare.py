from PIL import Image, ImageDraw
import os
W=r'D:\Desktop\Asterion\worktrees\icons-batch-1'
OLDH=r'D:\Desktop\Asterion\worktrees\quick-upgrade\src\assets\ui\header-icons'
OLDM=os.path.join(W,'assets','source','mission-icons-v1')
NEWH=os.path.join(W,'src','assets','ui','header-icons'); NEWM=os.path.join(W,'src','assets','ui','mission-icons'); SR=os.path.join(W,'public','assets','generated','sun-raid')
import subprocess
oldsr=r'D:\Desktop\Asterion\worktrees\quick-upgrade\public\assets\generated\sun-raid'
H=['planet','universe','fleets','operations','command','reports','settings','rating','science','alerts','zone-resource','zone-industry','zone-military','metal','mineral','gas','energy','population','debris']
rows=[(n,os.path.join(OLDH,n+'.png'),os.path.join(NEWH,n+'.webp')) for n in H]
rows+=[('ops-available',os.path.join(OLDM,'23_deep_scan.png'),os.path.join(NEWH,'ops-available.webp')),('ops-active',os.path.join(OLDM,'31_expedition.png'),os.path.join(NEWH,'ops-active.webp'))]
M=[('transport','01_transport'),('espionage','02_espionage'),('attack','03_attack'),('deployment','04_deployment'),('colonize','05_colonize'),('recycle','06_recycle'),('gas','07_gas_harvest'),('sun-support','08_sun_support'),('space-flight','09_space_flight'),('pirate-elimination','10_pirate_elimination'),('expedition','31_expedition'),('aid','33_trade_convoy'),('gate','29_wormhole_expedition')]
rows+=[('m '+n,os.path.join(OLDM,o+'.png'),os.path.join(NEWM,n+'.webp')) for n,o in M]
rows+=[('sun-raid',os.path.join(oldsr,'mission-sun-raid.webp'),os.path.join(SR,'mission-sun-raid.webp')),('debris-finder',os.path.join(oldsr,'debris-finder.webp'),os.path.join(SR,'debris-finder.webp'))]
def strip(path):
  im=Image.open(path).convert('RGBA'); cell=Image.new('RGBA',(96+48+24+40,100),(0,0,0,0)); x=0
  for s in (96,48,24): cell.alpha_composite(im.resize((s,s),Image.LANCZOS),(x,(100-s)//2)); x+=s+12
  return cell
cols=3; cw=2*210+130; per=(len(rows)+cols-1)//cols
img=Image.new('RGBA',(cols*cw,per*104+30),(9,13,20,255)); d=ImageDraw.Draw(img)
for c in range(cols): d.text((c*cw+130,8),'old',fill=(150,160,170)); d.text((c*cw+340,8),'new',fill=(150,160,170))
for i,(n,o,nw) in enumerate(rows):
  c,r=i//per,i%per; x=c*cw; y=30+r*104
  d.text((x+4,y+44),n,fill=(200,210,220))
  img.alpha_composite(strip(o),(x+130,y)); img.alpha_composite(strip(nw),(x+340,y))
os.makedirs(os.path.join(W,'docs','art','sheets'),exist_ok=True)
img.convert('RGB').save(os.path.join(W,'docs','art','sheets','icons-batch-1-old-new.jpg'),quality=88)
print(len(rows))
