#!/bin/sh
# usage: shoot.sh <html relative to concepts/v2> <out-name> [query]
# Edge headless viewport is window minus 24x93, so open a bigger window and crop.
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
D=$(cd "$(dirname "$0")" && pwd -W)
for s in 1280,720 2560,1080; do
  w=${s%,*}; h=${s#*,}; out="$D/shots/${w}x${h}/$2.png"
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 --window-size=$((w+24)),$((h+93)) --virtual-time-budget=5000 --screenshot="$out" "file:///$D/$1$3" >/dev/null 2>&1
  python -c "from PIL import Image; import sys; p=sys.argv[1]; Image.open(p).crop((0,0,$w,$h)).save(p)" "$out"
done
