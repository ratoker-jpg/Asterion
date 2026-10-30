#!/usr/bin/env bash
# Installs or updates the Asterion cloud server from this checkout (idempotent):
#   bash server/deploy/deploy.sh [ssh-host=asterion-vps] [domain]
# Builds the server bundle, copies it with this directory to the server, runs
# setup.sh there as root, checks HTTPS, and stores the access key on this
# computer in the game profile (%APPDATA%/Asterion/cloud-key.txt) without
# printing it. Never touches any other host.
set -euo pipefail
HOST="${1:-asterion-vps}"
DOMAIN="${2:-abstract-latent-blaze.majordomo-client.ru}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

echo "== key login to $HOST"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" true

echo "== server bundle"
npm run --silent package:server
VERSION=$(node -p "process.env.ASTERION_VERSION || require('./package.json').version")
BUNDLE="release/asterion-server-$VERSION.tgz"

echo "== copy to $HOST"
ssh -o BatchMode=yes "$HOST" 'rm -rf /root/asterion-deploy && mkdir -p /root/asterion-deploy'
scp -q -o BatchMode=yes server/deploy/* "$BUNDLE" "$HOST:/root/asterion-deploy/"
ssh -o BatchMode=yes "$HOST" "sed -i 's/\r\$//' /root/asterion-deploy/*.sh /root/asterion-deploy/*.service /root/asterion-deploy/*.timer /root/asterion-deploy/*.path /root/asterion-deploy/*.conf /root/asterion-deploy/*.local /root/asterion-deploy/Caddyfile.template && bash /root/asterion-deploy/setup.sh '$DOMAIN' /root/asterion-deploy/$(basename "$BUNDLE")"

echo "== key login still works after the SSH change"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" true

echo "== HTTPS"
for attempt in $(seq 1 30); do
  curl -fsS --max-time 10 "https://$DOMAIN/v1/health" && break
  sleep 4
done
echo

PROFILE="${ASTERION_PROFILE_DIR:-${APPDATA:-$HOME/.config}/Asterion}"
if [ -z "${ASTERION_SKIP_LOCAL_KEY:-}" ]; then
  echo "== access key → $PROFILE/cloud-key.txt"
  mkdir -p "$PROFILE"
  umask 077
  ssh -o BatchMode=yes "$HOST" 'cat /etc/asterion/access-key' > "$PROFILE/cloud-key.txt.new"
  [ -s "$PROFILE/cloud-key.txt.new" ] && mv "$PROFILE/cloud-key.txt.new" "$PROFILE/cloud-key.txt"
  # The installed game's cloud settings: address and «on»; this computer's device id is kept.
  PROFILE="$PROFILE" URL="https://$DOMAIN" node -e "
    const fs = require('fs'); const path = require('path');
    const file = path.join(process.env.PROFILE, 'cloud.json');
    let current = {}; try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    fs.writeFileSync(file, JSON.stringify({ ...current, url: process.env.URL, enabled: true }, null, 1));
  "
  echo "stored (not printed)"
fi
echo "== deployed $VERSION to $HOST ($DOMAIN)"
