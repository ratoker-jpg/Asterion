#!/usr/bin/env bash
# /usr/local/sbin/asterion-mirror (asterion-mirror.timer, every 30 min): copies the
# Windows installer of the latest GitHub Release to /srv/asterion-updates, from where
# Caddy serves it at https://<domain>/updates/ as the game's update feed
# (electron-updater «generic»). Players in Russia download from here, not from GitHub.
# Only three public kinds of files live there: latest.yml, Asterion-Setup-X.Y.Z.exe
# and its .blockmap. The newest KEEP versions stay. latest.yml is written last, so a
# player never sees a version whose installer is not complete yet.
set -euo pipefail

REPO="ratoker-jpg/Asterion"
DIR=/srv/asterion-updates
WORK=/srv/.asterion-updates-work
KEEP=3
log() { echo "asterion-mirror: $*"; }

exec 9>/run/asterion-mirror.lock
flock -n 9 || { log "already running"; exit 0; }

mkdir -p "$DIR" "$WORK"
chmod 755 "$DIR"

release=$(curl -fsSL --max-time 30 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest") || { log "GitHub is not reachable"; exit 0; }
exe=$(printf '%s' "$release" | jq -r '[.assets[] | select(.name | test("^Asterion-Setup-[0-9]+[.][0-9]+[.][0-9]+[.]exe$"))][0].name // empty')
if [ -z "$exe" ]; then log "the latest release has no installer"; exit 0; fi
version=${exe#Asterion-Setup-}; version=${version%.exe}
url_of() { printf '%s' "$release" | jq -r --arg n "$1" '[.assets[] | select(.name == $n)][0].browser_download_url // empty'; }

if [ -f "$DIR/$exe" ] && [ -f "$DIR/$exe.blockmap" ] && grep -qx "version: $version" "$DIR/latest.yml" 2>/dev/null; then
  exit 0
fi

fetch() { # name → $WORK/name; the big installer resumes after a break
  local url; url=$(url_of "$1")
  [ -n "$url" ] || { log "the release has no $1"; exit 1; }
  curl -fL --retry 8 --retry-delay 15 --retry-all-errors --connect-timeout 20 -C - -o "$WORK/$1" "$url"
}
rm -f "$WORK/latest.yml" "$WORK/$exe.blockmap"
fetch latest.yml
fetch "$exe.blockmap"
grep -qx "version: $version" "$WORK/latest.yml" || { log "latest.yml is not for $version"; exit 1; }
want=$(awk '/^sha512:/ { print $2; exit }' "$WORK/latest.yml")
[ -n "$want" ] || { log "latest.yml has no sha512"; exit 1; }
fetch "$exe"
have=$(openssl dgst -sha512 -binary "$WORK/$exe" | base64 -w0)
if [ "$have" != "$want" ]; then
  log "checksum mismatch for $exe, downloading again next time"
  rm -f "$WORK/$exe"
  exit 1
fi

chmod 644 "$WORK/$exe" "$WORK/$exe.blockmap" "$WORK/latest.yml"
mv -f "$WORK/$exe" "$DIR/$exe"
mv -f "$WORK/$exe.blockmap" "$DIR/$exe.blockmap"
mv -f "$WORK/latest.yml" "$DIR/latest.yml"
log "published $version"

mapfile -t installed < <(ls -1 "$DIR" | grep -E '^Asterion-Setup-[0-9]+[.][0-9]+[.][0-9]+[.]exe$' | sed -e 's/^Asterion-Setup-//' -e 's/[.]exe$//' | sort -V)
count=${#installed[@]}
for index in "${!installed[@]}"; do
  [ $((count - index)) -le $KEEP ] && continue
  rm -f "$DIR/Asterion-Setup-${installed[$index]}.exe" "$DIR/Asterion-Setup-${installed[$index]}.exe.blockmap"
  log "removed old installer ${installed[$index]}"
done
