# Облачный сервер Asterion

Подробно (как устроено, цифры, ограничения): `docs/reports/CLOUD_WORLD_2026-10-30.md`;
переход версии и ожидание догонки — `docs/reports/SERVER_CATCHUP_2026-10-31.md`.

**Обновление не сбрасывает живой мир.** `asterion-update` ставит новый релиз и перезапускает службу:
старый сервер пишет контрольную точку мира (раннер его версии), новый при запуске переносит мир в свой
релиз (`migrateLive`: загрузчик новой версии читает старую схему) и продолжает его. В журнале:
`live <slot>: moved from game X to Y`. Если новый раннер не смог загрузить мир, мир продолжает жить в
старом релизе (`back to X`). Игра новее сервера просит обновление сама (`POST /v1/update-request`).

**Упавший раннер мира поднимается сам.** Если расчёт мира упал (ошибка, нехватка памяти), сервер
возобновляет мир с последней контрольной точки (нет её — с ревизии, с которой мир начался) через паузу
5 с → 15 с → 45 с → 2 мин → 5 мин → 10 мин; пока пауза идёт, игра видит мир «догоняющим». Результат не
меняется: мир после падения побайтно равен миру без падения (тест `server.test.ts`). Сервер **не крутится
вечно**: та же ошибка дважды на одном месте мира (в пределах 30 игровых минут) или 6 падений подряд — и мир
получает `live.status: 'failed'` с причиной в `live.error`. Рядом с кампанией остаются:

| Файл | Что |
|---|---|
| `campaigns/<slot>/crash.json` | последние 20 падений: время, игровое время, ошибка со стеком, решение |
| `campaigns/<slot>/crash-checkpoint.json.gz` | контрольная точка мира в момент, когда сервер сдался |

Мир, на котором сервер сдался под одним релизом, при запуске **нового релиза** пробует снова
(обновление может нести исправление); перезагрузка того же релиза его не трогает.
В журнале: `runner crashed (...); attempt N/6 in S s`, `giving up (same-spot|too-many)`.

## Поднять мир вручную

Вместо ручной выгрузки контрольной точки новой ревизией:

```bash
bash server/deploy/recover-world.sh                    # asterion-vps: единственный стоящий мир
bash server/deploy/recover-world.sh slot-abc123        # конкретная кампания
bash server/deploy/recover-world.sh --from=revision    # с ревизии, с которой мир начался (контрольная точка не удаляется,
                                                       # а переименовывается в checkpoint-before-restart-<время>.json.gz)
ASTERION_HOST=my-host bash server/deploy/recover-world.sh
```

Скрипт заходит по ssh (`sudo`), читает ключ из `/etc/asterion/access-key` на самом сервере и передаёт его в
`curl` через stdin: ключ не попадает ни в аргументы, ни в вывод, ни в журнал. Под капотом это
`POST /v1/campaigns/<slot>/recover` (`{"from":"checkpoint"|"revision"}`); мир, который уже считается, не
перезапускается (`409 already-running`). Без имени кампании берётся единственная, у которой мир не `running` либо ждёт
паузы между попытками; если таких несколько, скрипт перечислит их и попросит указать.

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
