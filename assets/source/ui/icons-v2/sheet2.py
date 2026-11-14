import sys
from PIL import Image
# sheet2.py out.png bg(dark|magenta) files... : 128/48/24 per icon, trimmed like the game files
out,bgname=sys.argv[1],sys.argv[2]; files=sys.argv[3:]
bg=(9,13,20,255) if bgname=='dark' else (200,60,200,255)
def trim(f):
  im=Image.open(f).convert('RGBA'); bb=im.getchannel('A').point(lambda v:255 if v>8 else 0).getbbox()
  c=im.crop(bb); s=int(max(c.size)*1.06); cv=Image.new('RGBA',(s,s),(0,0,0,0)); cv.alpha_composite(c,((s-c.width)//2,(s-c.height)//2)); return cv
sizes=[128,48,24]; cell=144; per=6; rows=(len(files)+per-1)//per; rh=128+48+24+40
img=Image.new('RGBA',(per*cell,rows*rh),bg)
for i,f in enumerate(files):
  t=trim(f); x=(i%per)*cell; y=(i//per)*rh
  for s in sizes:
    img.alpha_composite(t.resize((s,s),Image.LANCZOS),(x+(cell-s)//2,y)); y+=s+10
img.convert('RGB').save(out)
