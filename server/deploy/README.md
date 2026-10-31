# Облачный сервер Asterion

Подробно (как устроено, цифры, ограничения): `docs/reports/CLOUD_WORLD_2026-10-30.md`;
переход версии и ожидание догонки — `docs/reports/SERVER_CATCHUP_2026-10-31.md`.

**Обновление не сбрасывает живой мир.** `asterion-update` ставит новый релиз и перезапускает службу:
старый сервер пишет контрольную точку мира (раннер его версии), новый при запуске переносит мир в свой
релиз (`migrateLive`: загрузчик новой версии читает старую схему) и продолжает его. В журнале:
`live <slot>: moved from game X to Y`. Если новый раннер не смог загрузить мир, мир продолжает жить в
старом релизе (`back to X`). Игра новее сервера просит обновление сама (`POST /v1/update-request`).

## Установка и обновление вручную

```bash
bash server/deploy/deploy.sh                  # asterion-vps, abstract-latent-blaze.majordomo-client.ru
bash server/deploy/deploy.sh my-host my.domain
```

Скрипт идемпотентный: повторный запуск ничего не ломает и ставит бандл из текущей ветки.
Он сам проверяет вход по SSH-ключу до и после отключения паролей и кладёт ключ доступа
в профиль установленной игры (`%APPDATA%\Asterion\cloud-key.txt`), не печатая его.
`ASTERION_SKIP_LOCAL_KEY=1` — не трогать локальный профиль.

## Что где лежит на сервере

| Путь | Что |
|---|---|
| `/opt/asterion/releases/X.Y.Z/` | серверные бандлы (`server.mjs`, `runner.mjs`, `package.json`) |
| `/opt/asterion/current` | ссылка на бандл, который запущен |
| `/var/lib/asterion/campaigns/<slot>/campaign.json` | ревизии, резервные копии, живой мир кампании |
| `/var/lib/asterion/campaigns/<slot>/snap-N.json.gz` | сохранение (точный текст клиента, gzip) |
| `/var/lib/asterion/campaigns/<slot>/live-checkpoint.json.gz` | контрольная точка живого мира |
| `/etc/asterion/access-key` | ключ доступа (root:asterion 0640) |
| `/usr/local/sbin/asterion-update` | самообновление (`update.sh`) |
| `/etc/systemd/system/asterion*.{service,timer,path}` | службы |
| `/etc/caddy/Caddyfile` | HTTPS (Let's Encrypt, Caddy продлевает сам) |

## Полезные команды

```bash
ssh asterion-vps systemctl status asterion           # сервер и раннер мира
ssh asterion-vps journalctl -u asterion -n 100       # журнал (ключ туда не пишется)
ssh asterion-vps systemctl start asterion-update     # проверить релиз на GitHub сейчас
ssh asterion-vps cat /etc/asterion/access-key        # ключ для второго компьютера
```

Новый ключ: удалить `/etc/asterion/access-key`, запустить `deploy.sh` (сгенерирует новый и
положит его в профиль игры этого компьютера), на остальных компьютерах ввести его в
«Настройки → Облачный мир».
