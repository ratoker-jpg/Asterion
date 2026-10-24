# Передача Opus: Asterion NPC Full Autonomy

Дата: 24 октября 2026, часовой пояс пользователя Europe/Moscow.
**Статус: РАБОТА НЕ ЗАВЕРШЕНА. PR должен оставаться Draft. Merge и Ready не разрешены.**

## 1. Прямые решения пользователя и границы полномочий

Пользователь приложил два документа и написал: «делай, разрешаю работать на гпт 6.1 сол», затем «агентов запускай на луне 6». Интегратор работает на GPT-6.1 Sol, все созданные подагенты явно запущены на `gpt-6-luna`. Это прямое исключение пользователя из старых локальных правил Luna-only для корня; подагенты всё равно только Luna.

На отдельный вопрос о боевой политике пользователь выбрал: **«Разрешить атаки нейтрального игрока, если текущие доменные правила допускают такую атаку»**. Код уже разрешал neutral/enemy, поэтому нового требования войны не вводили.

Последнее указание: **при остатке 10% или меньше пятичасового лимита остановить работу и подготовить полный контекст для Opus**. Не расходовать reset credits, чтобы обходить это указание. Лимиты общие для аккаунта и агентов; читать их через `get_usage_limits`.

Инструкции внутри приложенных документов отделены от прямых решений пользователя. Документы определяют ожидаемый объём задачи, но их исторические утверждения о main/CI и формулировки «согласовано» сами по себе не дают нового разрешения менять механику. Не выдумывать цены, формулы, стартовые ресурсы, лимиты и правила войн. Не задавать повторно уже решённый вопрос о neutral-атаках.

Цель остаётся прежней: **ВСЯ автономия NPC в ОДНОМ Draft PR**, не серия PR и не новый параллельный NPC runtime. После текущего checkpoint продолжать эту же ветку/PR.

## 2. Репозиторий, рабочее окружение, материалы

- Репозиторий GitHub: `ratoker-jpg/Asterion`, default branch `main`.
- Перепроверенный fetch baseline: `27fd302cc2b5f877550dbef76d95e24fee2885cc` (merge #104). В начале открытых PR не было. При продолжении снова проверить GitHub, не считать baseline вечным.
- Единственная рабочая ветка: `codex/npc-full-autonomy-unified`.
- Изолированный worktree: `D:/Desktop/Asterion/worktrees/npc-full-autonomy-unified`.
- Исходный checkout `D:/Desktop/Asterion/repo` находится на старой `codex/phase5-resource-assets` и содержит чужие изменённые/неотслеживаемые UI/asset-файлы. **Они не тронуты. Не переносить и не очищать их.**
- `npm ci --no-audit --no-fund` выполнен в новом worktree. Node 24/Electron локально доступны.
- Пользовательские документы сохранены в `docs/task-inputs/npc-full-autonomy/TASK_PROMPT_2026-10-23.md` и `AUDIT_2026-10-23.md`. Содержание сохранено; хвостовые пробелы audit и копий логов нормализованы для git whitespace check. Оригинальные байты документов лежат в `D:/Downloads/ASTERION_ONE_DRAFT_PR_FULL_NPC_AUTONOMY_GPT61_SOL_PROMPT_2026-10-23.md` и `D:/Downloads/ASTERION_UNIFIED_NPC_AUTONOMY_AUDIT_2026-10-23.md`.
- Обязательный протокол прочитан из актуального main: `docs/process/ASTERION_AUDITOR_PROTOCOL.md`. Также прочитаны локальные `AGENTS.md`, `docs/ASTERION_SKILLS.md`, registry UI и глобальные orchestrator/graphify/planning/TypeScript/React/design-doctrine. Часть локальных registry/AGENTS в исходном checkout неотслеживаемая, поэтому в новом worktree их может не быть; прямые указания пользователя важнее.
- Свежий **структурный** graphify создан командой `graphify update src --no-cluster`: 379 файлов, 4481 узел, 16704 ребра, baseline SHA записан в игнорируемом `src/graphify-out/source-head.txt`. Старый `D:/Desktop/Asterion/graphify-out` от сентября непригоден для доказательств. После новых файлов свежий граф нужно обновить; семантический анализ не нужен, API-ключ не требуется. CLI 0.8.38 предупреждает о skill 0.9.92; установка не менялась.

## 3. Что уже изменено

Основная карта находится в `NPC_FULL_AUTONOMY_IMPLEMENTATION_REPORT.md`; здесь описаны контракты для продолжения.

### Один выбор NPC и стратегия

`src/application/npc-autonomy.ts` — владелец выбирает одно действие по всем своим реальным планетам. Кандидаты: стройки, наука, производство, миссии, пираты, дипломатия, помощь. Вес семейства нормируется по числу кандидатов, затем применяется trait/persisted goal. Wait участвует в том же seeded draw. Никакого второго календаря.

`npc-replay.ts` получил optional `world: SaveState` в context/result. Полный `reconcile.ts` передаёт world и использует unified path; старые чистые economy/science API остаются доступны без world. Курсор обновляется после ровно одной попытки. В emissions есть `selectedActionKind`, `planetId`, `economyActionId` (реальная квитанция, отличная от базового decision id). Сохранены 5–15 минут, максимум 36 попыток и frozen catch-up target.

`src/domain/npc/autonomy-policy.ts` — детерминированный выбор только из переданных кандидатов, trait-веса, влияние явных собственных исходов, bounded memory (64), goals (8), fact references и persisted reconsiderAt. Все значения соответствуют v1 profile [0,1]. Не вызывается LLM/API внутри игры.

### Производство и экономика

`npc-fleet-production.ts` использует `enqueueFleetProduction`/`reconcileFleetProductionState` для ships/defense/commanders. Платёж настоящий, фракция/наука/постройки/лимиты канонические. `SpyTargetState.fleetProduction?` хранит очереди. Здания shipyard/hangar/spaceport/planetary-government доступны AI по реальным prerequisite и цене; до science activation нельзя покупать research.

В `domain/fleet/production.ts` добавлены optional `durationScale` (не зависит от глобального выбранного слота) и `reservedFleetPopulation` (популяция физически отправленных кораблей для проверки ёмкости). Старые player callers не меняются. `npc-economy.ts` сдвигает fleet queues вместе со стройкой при блокировке.

`reconcile.ts` ищет точные production checkpoints, сначала завершает таймеры, потом прибытия и решения. Новый event `npc-fleet-production` содержит ownerId/planetId/at/completed.

### Миссии и настоящий бой

`npc-missions.ts` экспортирует:

```text
dispatchNpcMission(state, command, at, timeScale)
resolveNpcMissionArrival(state, flight, at, timeScale, requestReport = false)
settleNpcMissionReturn(state, flight, at)
getNpcMissionTarget(state, targetPlanetId)
getNpcMissionAvailableFleet(state, ownerId, originPlanetId)
```

На запуске корабли **физически вычитаются** из NPC origin и оплачивается газ. Поэтому повторно вычитать reservations из available нельзя (это уже исправлено). `FlightRecord.ownerId?` сохраняет владельца даже после потери origin; `npcReturnCreditedAt?` — возвратная квитанция. Request ID unified-пути начинается с `npc-autonomy:`. Валидация маршрута/слотов/топлива/скорости общая. NPC планеты остаются в `espionage.targets`, не в player `state.planets`.

Реальная player planet проецируется **только для исполнения** через `getNpcMissionTarget`, а не вставляется в NPC registry. Политика миссий читает публичные owner/id/coordinates и свои reports; не считывает вражеские fleet/wallet для выбора атаки. Player planets отдельно включены в публичный список целей политики (исправлено после первоначального адаптера).

`attack.ts`: NPC→NPC использует обобщённый `resolveAttackAtTarget`; NPC→player — `resolveNpcIncomingAttack`, общий внутренний код обороны с Bot 01. Сохранены `resolveCombat`, satellites, siege, repair, debris, loot, last-world protections. NPC атакующий garrison не списывается второй раз на прибытии: его корабли уже в пути, возврат восстанавливает реальные `countAfter` из отчёта. Реальная дипломатия/owner/coordinate проверяются снова при прибытии. Свои боевые исходы записываются в NPC memory.

Колонизация использует реальный колонизатор, канонический старт колонии (500/500/500), existing max seven planets. Вылет не считается занятым местом; разные NPC могут конкурировать, первая законная arrival материализует target, следующая возвращается. Target deletion не должна воскресать из seed.

У шпиона реальные owner-bound mission/report, качество/hunter/cooldown из канонического runtime. `SpyReportSnapshot.ownerId?` и `SpyHunterNotice.ownerId?` сохраняются при миграции и фильтруются для player UI. После независимого review добавлены **явные unified-кандидаты** повторного отчёта при ready cooldown и возврата orbiting probe. `requestReport=true` разрешает новый отчёт; обычный arrival повторно ничего не выдаёт. Это последнее изменение нужно дополнительно прогнать по acceptance tests; оно не создаёт отдельный таймер/попытку.

`flights.ts` маршрутизирует новые owner-bound NPC arrivals/returns до player веток; потеря или смена origin завершает рейс без передачи новому владельцу. Expedition и exploration recon используют общие контакты/claim engine; recon исправлен на flight owner, а не playerId. `exploration-npc.ts` предоставляет реальные owner sources; зарегистрированные personas не участвуют в старом risk-roll календаре второй раз. 24h legacy skipped window не отменяет settlement уже запущенных физических рейсов.

### Пираты, дипломатия, помощь

`npc-pirates.ts`: канонические recon/elimination snapshots, real gas/ship debit, actual combat, actual debris. Elimination использует временный owner-shaped structural `PlanetRuntime` для существующего player wrapper; обратно сливаются только отчёт, pirate ledger и debris. Home garrison не кредитуется на battle arrival. Возвращается survivor manifest.

**Решение интегратора:** не добавлять обязательную разведку перед pirate elimination, если текущий player domain её не требует. Один reviewer назвал отсутствие такой проверки блокером, но это опиралось на более раннюю формулировку задания агенту; после проверки существующего player-кода интегратор явно разрешил использовать текущую canonical availability. Не вводить новую игровую prerequisite для устранения этого ложного замечания.

`npc-diplomacy.ts`: owner-neutral create/apply/accept/reject/war/truce через общий CommandState, Management Hall, 15 members/cooldowns/roles. Игроком AI не управляет. NPC presence touch происходит в replay. Leadership absence checkpoint и guard player UI heartbeat добавлены в `reconcile.ts`/`App.tsx`; долгую офлайн-хронологию лидерства ещё проверить.

`npc-aid.ts`: candidates из открытых requests того же союза, реальные транспорты/газ/груз, capped accepted delivery once, cargo return helper. Уже подключён в unified policy и shared flights; `alliance-aid.isRequestPlanetAlive` распознаёт NPC target; persistence разрешает production owner-bound aid. Нужен shared pipeline acceptance test после этих hooks.

### Сохранения, приватность, производительность

Schema 28. `autonomy-save.ts` вызывается из raw save health **до** permissive migrations. Присутствующие malformed queues/owner-bound flights запрещают вход и перезапись. Отсутствующие очереди v26/v27 → empty, load не завершает future NPC производство. Present queues сохраняются без пересчёта paid snapshots.

В последнем validator pass исправлены finite positive **fractional** routeDistance/effectiveSpeed (каноническая скорость может быть float) и законные destroyed/captured origins: stable ownerId остаётся в рейсе, runtime решает его судьбу. **Оставшийся false reject найден и исправлен:** expedition без `attackSnapshot` законен, но guard требовал snapshot всегда. Теперь absent допустим, present валидируется строго. Изолированный exact firstSlice payload: все targets и пять owner-bound flights валидны. Validator suite 10/10. Frozen replay теперь проходит load, но падает позже с отдельной ошибкой `CombatInputValidationError: attacker empty-side` в `resolveNpcPirateArrival` → `resolvePirateFlightAtTarget` → `resolvePirateEliminationAtTarget` → `resolvePirateEliminationEncounter`/`resolveCombat`. Не добавляли speculative bypass.

UI: header/Fleet показывают входящие NPC attacks на игрока. Внутренние NPC flights/spy missions/NPC-v-NPC reports отфильтрованы. В dedicated BattleReportsView скрытие идёт через viewModels; убедиться, что counts/open direct ID не раскрывают чужие данные. Новых CSS/assets/layout нет.

`domain/fleet/requirements.ts`: bounded exact-string caches parser/normalization и static first-match science map; mutable science/fleet eligibility не кэшируется. `flights.ts` индексирует SpyMission по identity immutable array и не прогоняет легально orbiting NPC probe как due-event на каждом checkpoint.

## 4. Реальные проверки и ограничения доказательств

Прошли:

- baseline unchanged build и `test:repair-ui` на 1920×1080 / 1280×720;
- текущий `npx tsc --noEmit --pretty false` и `git diff --check`;
- `npm run build` (лог `npc-autonomy-build.log`);
- 47 новых focused tests в `npc-autonomy-all-focused.log` (адаптеры, политика, save guard, real flight pipeline);
- 5 production physical scenarios в `npc-autonomy-physical-scenarios.log`: NPC→neutral player attack/save/reload/arrival/return, NPC→NPC combat, changed live relations, competing colonies/reload, exploration recon;
- 47 regressions attack/espionage/science migration (`npc-autonomy-regressions.log`);
- 37 save safety/reports regressions (`npc-autonomy-save-reports.log`);
- agent runs: fleet 35/35; existing aid/domain selection 44/44; aid adapter 4/4;
- inventory: 124 test files, 24 logical scripts, no missing/doubled/outside-CI (может вырасти после последнего файла).

**Полный `npm run test:npc` НЕ проходит.** Последний законченный checkpoint run: **122 tests, 116 pass, 6 fail** (`npc-autonomy-npc-suite-final-checkpoint.log`). Он стартовал до финального validator pass; отдельный последующий focused frozen30day rerun тоже подтверждает malformed load (`npc-autonomy-replay-after-validator.log`). Список шести сценариев: full-world equivalence 1/3/7/30; old runtime equivalence 1/7/30; frozen30day reload; 100NPC30day; zeroNPC/campaign scale isolation; legacy v26 partial-month activation. Разделить load false rejects и остальные причины, не считать все шесть одной доказанной причиной.

Baseline historical CI `39987106414` падал во втором repair viewport. Локально unchanged baseline оба viewport прошли. Причина исторического сбоя **UNKNOWN**, тест не выключали, timeout не повышали и speculative fix не делали. Полный CI на финальном SHA обязателен.

После последних spy follow-up/aid/leadership hooks ещё нет полного регрессионного прогона. Post-change Electron QA, Windows packaging, полная domain matrix и финальный GitHub CI **не завершены**. PR не готов к merge.

## 5. Измеренные blockers производительности

1. Новый 1-NPC fixture с настоящими астероидами содержит 355 active asteroids. За 1000 bounded calls проходит около **3.106 дней** из запрошенных семи. Последний диагностический slice: 62 из 64 groups — различные asteroid timestamps, ещё 1 NPC replay и 1 economy/fleet. Медианный интервал переходов около 2.8s. Это не stationary cursor.
2. Старый 100-NPC test fixture **отключает asteroids**, поэтому не является требуемым full-world benchmark. Даже он до последних кэшей потребовал 1030 calls (1000 → ~29.267 суток); CPU-profile run завершился за **305.4s**. Это не Electron и не приёмочные <=120s.
3. Hotspots до кэширования: flight array filtering/sorting ~46.6s; spy lookup/key path ~24.5s; normalizeLabel ~33.9s; processFlightsAt ~32.5s; policy report scan ~11.2s. Кэши добавлены, но full-world gate после них не измерен.
4. Требуется **ограниченное хронологическое batching asteroid microsteps до ближайшего конкурирующего события**, с точным gas/debris/capture/exit и same-time asteroid-before-flight порядком. Не отключать asteroids, NPC, бои или PvE и не обрезать targetAt. Не увеличивать 1000-test guard/64-group cap, чтобы только сделать тест зелёным. Любая оптимизация должна измерять максимум synchronous slice и сохранять reload/equivalence.
5. Warm parser microbench: 100000 evaluations за 76.04ms, без новых lowercase после warmup — только локальное доказательство, не proof всего replay.

## 6. Точный порядок продолжения

1. Проверить текущие ветку/commit/status и PR; сохранить Draft. Прочитать этот handoff и два task reference; не начинать полный повторный аудит.
2. **Первый текущий blocker — pirate empty attacker после save/reload:** воспроизвести `campaign(1,'NPC-REPLAY-RELOAD')` и frozen30day test из `npc-runtime.integration.test.ts`. FirstSlice save health исправлен; далее получить точные `flight.selectedShips`, attackSnapshot/faction, origin, canonical combat input перед `resolveNpcPirateArrival`. Проверить survivor manifest, повтор battle arrival, пустой fleet и отсутствие report после миграции. Причина пока UNKNOWN; не маскировать исключение catch/победой/бесплатными кораблями. Raw health и private `isPersistedFlightRecord` должны согласованно сохранять законный wreck, а не silently drop. Требовать bad/newer byte preservation.
3. Прогнать новые focused tests и `npm run test:npc`, разобрать реальные оставшиеся ошибки. Не смягчать assertions; старые тесты уже обновлены на actual paying planet/canonical per-planet receipt и schema28.
4. Оптимизировать астероидную микрошкалу и flight scheduling с доказательством identical state at 1/3/7/30d continuous/slices/reload. Отдельно сохранять responsiveness и frozen cursor.
5. Заполнить S1–S11 из исходного prompt. Особенно: commander launch/survivors/snapshots; actual unique/anomaly claim and rewards/competition; pirate deaths+save; alliance aid через shared pipeline; leadership absence/offline replay; target destruction/no resurrection; memory learning from real observations; production/Test isolation.
6. Измерить save bytes/records на 7/30 днях. Сейчас terminal autonomous flights/requestIndex/spy reports не имеют полного нового retention-контракта; **не удалять active physical state или нужные receipts**. Логи можно ограничить лишь с доказанным high-water/idempotency контрактом.
7. Запустить affected domain suites, inventory/build, required Electron QA и Windows packaging. Полный unisolated 10 galaxies/100NPC/30days Electron benchmark <=120000ms с доказанными real launches/battle/colony/PvE/diplomacy, raw metrics и финальный GitHub CI.
8. Независимый review того же PR, обновить отчёт/body. Всё остаётся Draft; merge/Ready только после отдельного указания владельца.

Команды (PowerShell, из worktree):

```powershell
npx tsc --noEmit --pretty false
npm run test:inventory
node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs --test src/application/npc-missions.integration.test.ts
node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs --test --test-name-pattern 'frozen 30-day|NPC decisions run' src/application/npc-runtime.integration.test.ts
npm run test:npc
npm run build
npm run test:repair-ui
```

Для длинных логов использовать файл и bounded read-only агента. Не применять npm distill на Windows. В исходном checkout существует `tools/distill_local.py`, но не копировать его вслепую и не использовать для короткого patch source.

## 7. Состояние передачи

Финальный commit/PR/лимит записываются в конце этого файла перед остановкой. Отчёт честно сохраняет незавершённый статус; наличие Draft PR и проходящих focused tests не означает выполнения всей задачи.

### Уточнения последнего диагностического прохода

- Exact отвергавшийся рейс: `flight-npc-autonomy:["npc-gen-01","npc-replay:v1:decision:c96e50098b1813e9"]`, expedition к `unique:1:27:8333:1792538204655`, faction `veyra`, launchResourcePoints 105, `{scout:1}`, без attackSnapshot. Это было точным false-reject predicate; все изолированные targets и четыре других bound flights проходили.
- Последний законченный полный `test:npc` дал 116/122 до этого точечного исправления; его нельзя считать результатом финального HEAD. После него frozen test стал падать дальше на pirate empty-side; это прогресс диагностики, не успешная приёмка.
- Замечание reviewer об обязательной pirate recon отклонено как противоречащее проверенному текущему player domain и позднему решению интегратора не вводить новую prerequisite. Замечание о вечной orbiting probe принято: добавлены unified report/return choices; полный повторный acceptance ещё нужен.
- Batching астероидов в код **не реализован**. Не искать «готовую оптимизацию»: есть только измеренная причина и план. Последние кэши и spy event suppression не заменяют этого шага.

Финальный локальный checkpoint после последних hooks: `npm run build` PASS; новая focused selection **48/48 PASS**; `test:inventory` **125 файлов / 24 scripts / 0 missing / 0 doubled / 0 outside CI**; `git diff --check` PASS. Копии ключевых сырых логов сохранены как `.txt` в `docs/reports/npc-full-autonomy-evidence/`. Успех этих проверок не отменяет failing full NPC suite и незавершённый performance gate. Последний считываемый перед публикацией checkpoint лимит: 13% пятичасового окна оставалось; точный остаток на остановке сообщается отдельно.

### Финальная остановка по прямому указанию владельца

- Инструмент лимитов вернул **usedPercent=90** для windowDurationMins=300: **10% осталось**. Реализация остановлена; после этого обновлены только документы передачи. Reset credits не использованы.
- Единственный Draft PR: **https://github.com/ratoker-jpg/Asterion/pull/105**. Он прикреплён к этому чату. Merge/Ready не выполнялись.
- Реализация закоммичена и отправлена: **`9b926fa042a07615fd8f19a3cd748b0c7ca126e7`** (`feat: integrate owner-scoped NPC autonomy checkpoint`). Следующий коммит содержит только финализацию этого handoff/отчёта.
- Ветка: `codex/npc-full-autonomy-unified`, remote tracking `origin/codex/npc-full-autonomy-unified`.
- GitHub CI run при публикации: **40031999236**; Pages: **40031999235**. На момент последнего чтения все jobs были QUEUED, включая logical, Electron suites, NPC full-world measurement и Windows installer. Итоги неизвестны; проверить на продолжении, не считать зелёными. Новый docs-коммит может породить новый run.
- GitHub connector при создании PR вернул transport error. Проверено отсутствие дубликата, затем `gh pr create --draft --body-file` успешно создал #105. Никаких других PR не создавали.
- В worktree остались только неотслеживаемые локальные артефакты baseline repair QA (`artifacts-pass1/repair-workshop-qa/`) и `npc-autonomy-pr-body.txt`; это не незакоммиченный код. `.log`/Graphify/Node/build artifacts могут быть игнорируемыми. Ничего не очищать рекурсивно ради косметической чистоты.
- Все назначенные подагенты закончили работу. В новом сеансе не полагаться на их live-контекст: результаты, исходники, tests, raw evidence и решения сохранены в этом PR.

## 8. Продолжение Opus 5.5 (24.10.2026) — безопасная остановка по указанию владельца

Коммит кода: **`83b4bc1`** (`fix: NPC pirate composition, replay determinism and catch-up cost`), отправлен в ту же ветку и тот же Draft PR #105. Merge/Ready не выполнялись.

Исправлено (причины доказаны диагностикой, не маскировкой):

1. **Pirate empty-side.** Причина: NPC отбирал корабли для `pirate-elimination` предикатом `isAttackCombatShip` (любой корпус, кроме спутника), а канонический игровой закон допускает только категорию «Боевой корабль». Флот из гражданских/служебных корпусов долетал и падал в `resolveCombat`. Теперь общий `isPirateEliminationShip` в `pirates.ts` используется и игроком, и NPC (кандидаты и повторная проверка при запуске). Тест: `npc-pirates.test.ts` (гражданские не дают кандидата, подделанный состав отклоняется без изменения кошелька).
2. **Malformed после reload.** Точный рейс: `pirate-elimination`, `completed`, манифест выживших `{scout:0}` — полная гибель флота. Guard требовал корабли всегда; теперь только в фазе `outbound`. Тест в `autonomy-save.test.ts`. Частный `isPersistedFlightRecord` пустой манифест не отвергает — согласовано.
3. **Расхождение 30 дней (continuous vs нарезка).** Причина: после победы над пиратами `restartRaidSelection(checkpoint)` (код из main) переизбирал роллы раньше зафиксированного курсора; при победах NPC внутри догонки это давало налёт только в нарезанном варианте. Теперь `Math.max(pirateCursor, checkpoint)`, как у соседнего вызова. Reload на результат не влиял (chunked == reload проверено побайтно).
4. **Астероидный batching.** Подряд идущие чисто-астероидные моменты применяются тем же `applyAsteroidTransitionsAt(t)` по одному внутри одной группы до ближайшего конкурирующего события; при равенстве остаётся обычная группа (asteroid → flight). Построчно проверено, что asteroid-only группа ничего больше не делала.
5. **Кэш маршрутов астероидов** (`getUniverseAsteroidState`): для сейвов без `asteroidSimulation` маршрут продолжается из сохранённой точки вместо прохода от спавна. Ограничен 20 000 записей. Проверено: прямой и обратный порядок ~230 тыс. запросов дают одинаковый хэш. Это убрало 76% CPU (через `getNpcPirateCandidates → getCurrentPirateContact → createUniverseSystem`).

Проверки на рабочем дереве перед `83b4bc1`:

- `npx tsc --noEmit` PASS; `git diff --check` PASS.
- `npm run test:npc`: **124/125 PASS** (до этой сессии 116/122). Зелёные теперь: full-world 1/3/7/30 continuous/irregular/reload (~27 с), frozen 30-day reload, old runtime equivalence. Прогон был до пункта 5; после пункта 5 полный `test:npc` **не перезапускался**.
- После пункта 5: universe 42, pirates 73, pirate-operations 33, flights 137, attack 26, exploration 38, runtime 3, sun-raid 21 — все PASS.
- `npm run build`, `test:inventory`, Electron QA, Windows packaging на `83b4bc1` **не запускались**. CI на `83b4bc1` не проверен.

Единственный оставшийся красный тест: **100 NPC × 30 дней** (`npc-runtime.integration.test.ts:280`) — упирается в guard 1000 вызовов. Замеры (Node, 1 галактика, без астероидов): 2 дня = 66 вызовов; было 42 с, после кэша **6,8 с**, max вызов ~400 мс. Нагрузка реальная: в сутки ~1100 решений, ~460 построек, ~310 рейсовых событий, ~110 завершений производства → ~33 вызова по 64 группы в сутки, ≈1000 за 30 дней. Замер 30 дней был запущен и остановлен по указанию владельца — результата **нет**. Новый профиль ровный: ни одна функция не держит >0,5 с из 7 с; верхние — `getNpcMissionCandidates`, `createUniverseSystem` для пиратского контакта, `settleNpcEconomies`, `nextDueAt` производства.

Следующие шаги:

1. Перезапустить `npm run test:npc` на `83b4bc1`.
2. Сделать 30-дневный замер 100 NPC (скрипт: цикл `reconcileRuntime` до `targetAt` с подсчётом вызовов/мс/max вызова; временный файл удалён, восстановить по описанию).
3. Снизить цену группы: кэшировать `createUniverseSystem`/пиратский контакт по (система, cycle window, footprint); сократить полные проходы по `espionage.targets` на каждом чекпоинте в `reconcile.ts` (экономические и производственные чекпоинты пересчитываются по всем целям на каждой группе). Не поднимать guard 1000 и cap 64 без явного решения владельца: при реальной нагрузке ~2000 событий/сутки это продуктовый вопрос об отзывчивости против числа вызовов, а не косметика теста.
4. Затем build/inventory, CI, Electron 10 galaxies/100 NPC/30 days ≤120 000 мс, S1–S11 из раздела 6 выше, отчёт и тело PR.

## 9. Продолжение Opus 5.5 — после решения владельца о старте (24.10.2026)

Решение владельца: «NPC в новой кампании стартуют с тем же пакетом, что и игрок (по правилам своей расы), без бесплатного гарнизона. Старые сейвы не трогай.» Проверено: это **уже реализовано** с PR #103 (`generator.ts` использует `CANONICAL_STARTING_WALLET`, `createCanonicalStartingBuildingLevels`, `createCanonicalStartingFleet(raceId)`, пустую оборону; `createStubGarrison` вызывается только чтобы сохранить seeded-раскладку; тест `world.test.ts:57`). Исправлены только устаревшие комментарии (`f56f84f`).

Коммиты: `f5d73cf` (кэш побед над пиратами), `b8d0319` (хранение истории), `d83dd44` (без астероидов для чтения позиций), `c099b0e` (кэш блокировки перенаселения), `7a45992` (перестановочный тест игрок/NPC).

- **Сейв.** Сейв рос ~2,5 МБ/сутки. Квота `localStorage` Electron 44 для `file://` измерена: 32M символов проходит, 64M нет. Добавлено хранение: 200 новейших боёв NPC против NPC и NPC против пиратов (как у правила владельца для пиратских налётов), новейший шпионский отчёт NPC на пару (владелец, цель), завершённые рейсы NPC удаляются через 24 ч. Очистка выполняется после каждой группы внутри догонки, поэтому эквивалентность нарезок сохраняется. 4 дня: 11,2 → 7,2 МБ; 10 дней ≈ 9 МБ, рост замедлен (миссии шпионажа пока без предела, ~1 МБ/мес).
- **Скорость** (Node, 100 NPC, 1 галактика): 4 дня 24 → 15 с. Каждая оптимизация проверена сравнением полного игрового состояния с версией без неё (различаются только имена из случайной соли кампании).
- **Перестановка ownerId:** тест подтверждает, что игрок ранжируется ровно как эквивалентный NPC.
- Проверки на `c099b0e`: `build` PASS, `test:inventory` 125/24/0/0/0, `test:npc` **127/128**. Единственный красный — 100 NPC × 30 дней: 172 с (было 1128) и всё ещё упирается в guard 1000 вызовов, потому что 64 группы на вызов × ~2000 реальных событий в сутки ≈ 1000+ вызовов.

Открытый вопрос владельцу: контракт отзывчивости догонки (64 группы на вызов против бюджета времени на вызов). Electron QA, CI на новом HEAD и 10 галактик ≤120 с не проверены.
