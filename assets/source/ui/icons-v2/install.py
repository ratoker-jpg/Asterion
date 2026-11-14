import sys, os, re
from PIL import Image
W=r'D:\Desktop\Asterion\worktrees\icons-batch-1'
SRC=os.path.join(W,'assets','source','ui','icons-v2'); HI=os.path.join(W,'src','assets','ui','header-icons'); MI=os.path.join(W,'src','assets','ui','mission-icons'); SR=os.path.join(W,'public','assets','generated','sun-raid')
for d in (SRC,HI,MI): os.makedirs(d,exist_ok=True)
def prep(f):
  im=Image.open(f).convert('RGBA')
  px=im.load()
  r,g,b,a=im.split(); a2=a.point(lambda v:0 if v<4 else v); im=Image.merge('RGBA',(r,g,b,a2))
  bb=a2.point(lambda v:255 if v>8 else 0).getbbox(); c=im.crop(bb); s=int(max(c.size)*1.06)
  cv=Image.new('RGBA',(s,s),(0,0,0,0)); cv.alpha_composite(c,((s-c.width)//2,(s-c.height)//2)); return im,cv
for name in sys.argv[1:]:
  base=re.sub(r'-r\d+$','',name)
  im,cv=prep(os.path.join('out',name+'.png'))
  im.resize((1024,1024),Image.LANCZOS).save(os.path.join(SRC,base+'.png'),optimize=True)
  def w(path,size): cv.resize((size,size),Image.LANCZOS).save(path,'WEBP',quality=90,method=6,alpha_quality=100)
  if base=='m-sun-raid': w(os.path.join(SR,'mission-sun-raid.webp'),256)
  elif base=='m-debris-finder': w(os.path.join(SR,'debris-finder.webp'),96)
  elif base.startswith('m-'): w(os.path.join(MI,base[2:]+'.webp'),128)
  else: w(os.path.join(HI,base+'.webp'),128)
  print('ok',base)
