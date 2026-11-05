#!/usr/bin/env bash
# Runs on the server as root, from a copy of this directory (idempotent):
#   bash install-mirror.sh [domain]
# Installs the installer mirror (mirror-installer.sh + asterion-mirror.timer), the
# /updates/ route in Caddy, and fetches the first copy. Never touches the game
# server, its world, saves or the access key. setup.sh calls this on a new server.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ] && [ -f /etc/caddy/Caddyfile ]; then
  DOMAIN=$(grep -m1 -E '^[A-Za-z0-9.-]+ \{' /etc/caddy/Caddyfile | cut -d' ' -f1)
fi
[ -n "$DOMAIN" ] || { echo "install-mirror: no domain (pass it as the argument)"; exit 1; }
for tool in curl jq openssl flock; do command -v "$tool" >/dev/null || { echo "install-mirror: $tool is missing"; exit 1; }; done

echo "== mirror script and timer"
install -m 0755 "$HERE/mirror-installer.sh" /usr/local/sbin/asterion-mirror
for unit in asterion-mirror.service asterion-mirror.timer; do
  install -m 0644 "$HERE/$unit" "/etc/systemd/system/$unit"
done
mkdir -p /srv/asterion-updates
chmod 755 /srv/asterion-updates
systemctl daemon-reload

echo "== Caddy: /updates/ for $DOMAIN"
cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-updates.$(date +%s)" 2>/dev/null || true
sed "s/__DOMAIN__/$DOMAIN/" "$HERE/Caddyfile.template" > /etc/caddy/Caddyfile.new
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
systemctl reload-or-restart caddy

echo "== first copy (in the background: the installer is ~640 MB)"
systemctl enable --now asterion-mirror.timer
systemctl start --no-block asterion-mirror.service
echo "install-mirror: done. Progress: journalctl -u asterion-mirror -f ; files: ls -la /srv/asterion-updates"
