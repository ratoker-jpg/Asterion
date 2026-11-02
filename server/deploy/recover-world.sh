#!/usr/bin/env bash
# Raises the living world of a campaign that stands still (failed, or waiting
# out the pause between automatic restarts) from its checkpoint: what used to
# be done by hand with a PUT of the checkpoint as a new revision. The server
# does it itself (POST /v1/campaigns/<slot>/recover); this script only reaches
# it with the access key on the server and never prints the key.
#
#   bash server/deploy/recover-world.sh                      # asterion-vps, the one world that stands
#   bash server/deploy/recover-world.sh slot-abc123          # that campaign
#   bash server/deploy/recover-world.sh --from=revision      # from the revision it started at, not from the checkpoint
#   ASTERION_HOST=my-host bash server/deploy/recover-world.sh
#   bash server/deploy/recover-world.sh --local              # on the server itself (or against a local test server:
#                                                            # ASTERION_URL=http://127.0.0.1:PORT ASTERION_KEY_FILE=key-file)
set -euo pipefail

HOST="${ASTERION_HOST:-asterion-vps}"
FROM=checkpoint
SLOT=""
LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --from=checkpoint|--from=revision) FROM="${arg#--from=}" ;;
    --local) LOCAL=1 ;;
    slot-*) SLOT="$arg" ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "recover-world: unknown argument $arg" >&2; exit 2 ;;
  esac
done

# Runs on the server. The key is read from its file into curl's config on stdin: not in the arguments, not in the output.
remote() {
  local from="$1" slot="$2"
  local key_file="${ASTERION_KEY_FILE:-/etc/asterion/access-key}" url="${ASTERION_URL:-http://127.0.0.1:8787}"
  [ -r "$key_file" ] || { echo "Нет доступа к файлу ключа ($key_file): запустите через sudo." >&2; return 1; }
  api() {
    printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\r\n' < "$key_file")" \
      | curl -sS -K - -X "$1" -H 'content-type: application/json' ${3:+--data "$3"} -w '\n%{http_code}' "$url$2"
  }
  local out code body
  if [ -z "$slot" ]; then
    out=$(api GET /v1/campaigns) || { echo "Сервер не отвечает на $url." >&2; return 1; }
    code="${out##*$'\n'}"; body="${out%$'\n'*}"
    [ "$code" = 200 ] || { echo "Список кампаний не получен (HTTP $code)." >&2; return 1; }
    local picked
    picked=$(printf '%s' "$body" | node -e '
      let text = ""; process.stdin.on("data", (c) => text += c).on("end", () => {
        const stuck = JSON.parse(text).campaigns.filter((c) => c.live && (c.live.status !== "running" || c.live.recovery?.nextAttemptAt));
        for (const c of stuck) console.log(`${c.id}\t${c.name}\t${c.live.status}`);
      });')
    if [ -z "$picked" ]; then echo "Ни один мир на сервере не стоит: поднимать нечего."; return 0; fi
    if [ "$(printf '%s\n' "$picked" | wc -l)" -gt 1 ]; then
      echo "Стоят несколько миров, укажите кампанию:" >&2; printf '%s\n' "$picked" >&2; return 2
    fi
    slot="${picked%%$'\t'*}"
  fi
  out=$(api POST "/v1/campaigns/$slot/recover" "{\"from\":\"$from\"}") || { echo "Сервер не отвечает на $url." >&2; return 1; }
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  printf '%s' "$body" | node -e '
    let text = ""; process.stdin.on("data", (c) => text += c).on("end", () => {
      const code = process.argv[1], slot = process.argv[2], reply = JSON.parse(text);
      if (code === "200") {
        const live = reply.campaign.live;
        console.log(`Мир ${slot} поднят (${reply.from === "checkpoint" ? "с контрольной точки" : "с ревизии, с которой он начался"}); состояние: ${live?.status ?? "?"}.`);
      } else {
        console.error(`Не удалось поднять ${slot} (HTTP ${code}): ${reply.message ?? reply.error ?? text}`);
        process.exit(1);
      }
    });' "$code" "$slot"
}

if [ "$LOCAL" = 1 ]; then
  remote "$FROM" "$SLOT"
else
  # sudo reads the key file (root:asterion 0640); the key stays on the server.
  { declare -f remote; printf 'remote %q %q\n' "$FROM" "$SLOT"; } \
    | ssh "$HOST" 'if [ "$(id -u)" -eq 0 ]; then bash -s; else sudo bash -s; fi'
fi
