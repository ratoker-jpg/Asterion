#!/usr/bin/env bash
# Runs on the server as root (deploy.sh copies this directory to /root/asterion-deploy
# and starts it). Idempotent: every step checks before it changes anything.
#   setup.sh <domain> <bundle.tgz>
set -euo pipefail
DOMAIN="$1"
BUNDLE="$2"
HERE=$(cd "$(dirname "$0")" && pwd)
log() { echo "== $*"; }
export DEBIAN_FRONTEND=noninteractive
# needrestart would restart services (and drop this SSH session) after each install.
export NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l

log "packages"
need=()
for pkg in curl ca-certificates gnupg jq ufw fail2ban unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https; do
  dpkg -s "$pkg" >/dev/null 2>&1 || need+=("$pkg")
done
if [ ${#need[@]} -gt 0 ]; then apt-get update -q; apt-get install -y -q "${need[@]}"; fi

if ! command -v node >/dev/null || [[ "$(node --version)" != v24.* ]]; then
  log "Node.js 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y -q nodejs
fi
node --version

if ! command -v caddy >/dev/null; then
  log "Caddy (official repository)"
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi
caddy version

log "swap 2 GB"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-asterion.conf
sysctl -q -p /etc/sysctl.d/90-asterion.conf

log "user and directories"
id asterion >/dev/null 2>&1 || useradd --system --home-dir /var/lib/asterion --shell /usr/sbin/nologin asterion
install -d -o asterion -g asterion -m 0750 /var/lib/asterion /var/lib/asterion/campaigns
install -d -o root -g asterion -m 0750 /etc/asterion
install -d -o root -g root -m 0755 /opt/asterion /opt/asterion/releases

log "access key"
if [ ! -s /etc/asterion/access-key ]; then
  umask 077
  head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > /etc/asterion/access-key
  umask 022
  echo "generated a new access key"
fi
chown root:asterion /etc/asterion/access-key
chmod 0640 /etc/asterion/access-key

log "update script and units"
install -m 0755 "$HERE/update.sh" /usr/local/sbin/asterion-update
for unit in asterion.service asterion-update.service asterion-update.timer asterion-update.path; do
  install -m 0644 "$HERE/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload

log "server bundle"
/usr/local/sbin/asterion-update --file="$BUNDLE" || true
systemctl enable --now asterion.service asterion-update.timer asterion-update.path
systemctl restart asterion.service
for attempt in $(seq 1 30); do
  curl -fsS --max-time 2 http://127.0.0.1:8787/v1/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:8787/v1/health; echo

log "Caddy (HTTPS for $DOMAIN)"
sed "s/__DOMAIN__/$DOMAIN/" "$HERE/Caddyfile.template" > /etc/caddy/Caddyfile.new
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

log "firewall"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose | sed -n '1,20p'

log "fail2ban"
install -m 0644 "$HERE/fail2ban-asterion.conf" /etc/fail2ban/filter.d/asterion.conf
install -m 0644 "$HERE/fail2ban-jail.local" /etc/fail2ban/jail.d/asterion.local
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban
sleep 2
fail2ban-client status | sed -n '1,5p'

log "unattended-upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
systemctl enable --now unattended-upgrades >/dev/null

log "SSH: keys only"
# deploy.sh connected with a key (BatchMode) before this step, and root has authorized keys.
[ -s /root/.ssh/authorized_keys ] || { echo "root has no authorized_keys: password login stays on"; exit 1; }
cat > /etc/ssh/sshd_config.d/00-asterion-hardening.conf <<'CONF'
# server/deploy/setup.sh: SSH by key only (checked to work before this file was written).
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 4
CONF
sshd -t
systemctl reload ssh
sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractiveauthentication) '
log "done"
