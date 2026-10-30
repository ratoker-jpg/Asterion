#!/usr/bin/env bash
# /usr/local/sbin/asterion-update (asterion-update.service, every 30 min and on
# request): installs the asterion-server-X.Y.Z.tgz of the latest GitHub Release
# next to the installed ones and restarts the supervisor. A living world keeps
# its own release: the supervisor checkpoints it on stop and resumes it with
# the runner of the version it was left with (kept until no world needs it).
#   asterion-update [--file=bundle.tgz]   (deploy.sh installs a local build this way)
set -euo pipefail

REPO="ratoker-jpg/Asterion"
ROOT=/opt/asterion
RELEASES="$ROOT/releases"
DATA=/var/lib/asterion
KEEP=3
log() { echo "asterion-update: $*"; }

rm -f "$DATA/update-request"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

file=""
for arg in "$@"; do
  case "$arg" in --file=*) file="${arg#--file=}" ;; esac
done

if [ -z "$file" ]; then
  release=$(curl -fsSL --max-time 30 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest") || { log "GitHub is not reachable"; exit 0; }
  asset=$(printf '%s' "$release" | jq -c '[.assets[] | select(.name | test("^asterion-server-[0-9]+[.][0-9]+[.][0-9]+[.]tgz$"))][0] // empty')
  if [ -z "$asset" ]; then log "the latest release has no server bundle"; exit 0; fi
  name=$(printf '%s' "$asset" | jq -r .name)
  version=${name#asterion-server-}; version=${version%.tgz}
  if [ -f "$RELEASES/$version/server.mjs" ] && [ "$(readlink -f "$ROOT/current")" = "$RELEASES/$version" ]; then exit 0; fi
  url=$(printf '%s' "$asset" | jq -r .browser_download_url)
  digest=$(printf '%s' "$asset" | jq -r '.digest // empty')
  curl -fsSL --max-time 300 -o "$work/bundle.tgz" "$url"
  if [ -n "$digest" ]; then
    echo "${digest#sha256:}  $work/bundle.tgz" | sha256sum -c --quiet - || { log "checksum mismatch for $name"; exit 1; }
  fi
  file="$work/bundle.tgz"
fi

mkdir -p "$work/x"
tar -xzf "$file" -C "$work/x"
for need in server.mjs runner.mjs package.json; do
  [ -f "$work/x/$need" ] || { log "bundle has no $need"; exit 1; }
done
version=$(jq -r .version "$work/x/package.json")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || { log "bad version $version"; exit 1; }

mkdir -p "$RELEASES"
if [ ! -f "$RELEASES/$version/server.mjs" ] || [ -n "${FORCE:-}" ]; then
  rm -rf "$RELEASES/.new-$version"
  mv "$work/x" "$RELEASES/.new-$version"
  chown -R root:root "$RELEASES/.new-$version"
  chmod -R a+rX,go-w "$RELEASES/.new-$version"
  rm -rf "$RELEASES/$version"
  mv "$RELEASES/.new-$version" "$RELEASES/$version"
  log "installed $version"
fi
previous=$(readlink -f "$ROOT/current" 2>/dev/null || true)
ln -sfn "$RELEASES/$version" "$ROOT/current.new"
mv -T "$ROOT/current.new" "$ROOT/current"
if [ "$previous" != "$RELEASES/$version" ] || [ -n "${FORCE:-}" ]; then
  systemctl restart asterion.service
  log "asterion.service now runs $version"
fi

# Old releases: keep the newest $KEEP, the current one and every version a world still lives in.
needed=$(cat "$DATA"/campaigns/*/campaign.json 2>/dev/null | jq -r 'select(.live != null) | .live.gameVersion' 2>/dev/null | sort -u || true)
mapfile -t installed < <(ls -1 "$RELEASES" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+' | sort -V)
count=${#installed[@]}
for index in "${!installed[@]}"; do
  candidate=${installed[$index]}
  [ $((count - index)) -le $KEEP ] && continue
  [ "$RELEASES/$candidate" = "$(readlink -f "$ROOT/current")" ] && continue
  grep -qxF "$candidate" <<<"$needed" && continue
  rm -rf "${RELEASES:?}/$candidate"
  log "removed old release $candidate"
done
