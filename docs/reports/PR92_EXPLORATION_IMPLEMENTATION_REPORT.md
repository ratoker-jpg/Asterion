# PR92 — отчёт реализации исследовательских операций

**Статус: ЧАСТИЧНО. Draft PR; НЕ MERGE / НЕ READY.**

База: main SHA 86863283b118de2520784cf3dbd847bc91a3e49e. Ветка: codex/pr92-exploration-fields.

Дополнение владельца: единая миссия «Экспедиция» для аномалий и уникальных объектов в радиусе ±5 солнечных систем от колоний, иконка 31_expedition.png. Занятый объект нельзя занять экспедицией; для захвата нужна обычная «Атака».

## Реализовано

- Новая миссия Expedition в существующих «Флотах» с иконкой из assets/source/mission-icons-v1/31_expedition.png, без повторной загрузки существующих ассетов.
- Канонический selector реальных объектов из существующего расписания Вселенной, максимум 5 доступных, в системах ±5 от собственных планет. Общий для «Флотов», «Операций» и проверки рейса. Без фейковых контактов.
- Карточки уникальных объектов и аномалий в «Операциях» с названием, риском, статусом и временем жизни. Свободные контакты предлагают «Подготовить экспедицию»; занятые запрещают экспедицию.
- На карте Вселенной действие «Подготовить экспедицию» заменило «Исследовать · скоро» для соответствующих активных объектов с проверкой доступа и статуса.
- Реальные экспедиционные полёты используют текущий flight runtime: расход газа, корабли, бронь состава, ETA, подтверждение точного ID цикла при отправке и прилёте. Если объект исчез или занят — автоматический возврат без добычи. Если свободен — флот остаётся на орбите и добывает из общего конечного запаса объекта.
- Отзыв после прибытия: 30 секунд подготовки, остановка добычи, существующий маршрут возвращения, единственный release receipt и начисление после возвращения. Истечение срока объекта также завершает добычу. Ресурсы проходят лимиты складов, обломки — в переработку, случайный редкий жетон — в мастерскую.
- 26 профилей аномалий и уникальных объектов, детерминированные ID жизненных циклов, ограничение добычи вместимостью кораблей, математический балансовый ledger. Значение профиля не зависит от того, вызывается Universe с реальными ассетами или headless runtime.
- Сохранение нового ledger в прежний SaveState. Интеграционные тесты реальных отправок/прибытия/отзыва/возврата, stale target, одноразовой награды и save/load включены в npm run test:exploration и CI.

## Фактические проверки

- Один промежуточный CI подтвердил 19/19 тестов экспедиции, успешный npm run test:flights и npm run build.
- Следующий прогон 38946722530 показал 19/20: дополнительный тест save/load передавал число вместо функции времени и упал с ошибкой «now is not a function». Тестовый вызов исправлен в коммите eea41a92. До завершения новой CI это **не считается успешной проверкой**.
- Предыдущие Pages preview собирались успешно. Финальный CI, новый preview и ручная проверка пользовательских экранов всё ещё требуют отдельного подтверждения.
- Баланс-скрипт — аналитический. Настоящие PvE бои и чистая прибыль этим не проверялись.

## Блокеры до merge

1. **Обычная «Атака» занятого объекта всё ещё не подключена.** Текущая обычная Attack рассчитана на планетарный target; запрещено делать ложную имитацию боевого исхода. Требуется snapshot флота защитника, технологий и уровней, применение существующего resolveCombat, запись отчётов и потерь двух сторон, 30% переносимого cargo при победе, нормальное возвращение.
2. NPC-конкуренция, защита новичков и опасности аномалий пока только в правилах domain, а не в сквозном боевом и полётном runtime.
3. Реальная разведка зондом, 70%-й шанс разведки и cooldown в save, отчёты и архив Completed пока не подключены.
4. Источник мировых очков на момент появления объекта не зафиксирован авторитетно: сейчас общий запас материализуется при первой отправке.
5. Требуются полный CI, регрессии обычных атак и пиратских рейдов, offline catch-up, восстановление pending recall из save, визуальный прогон и реальное сравнение экономики.

**Нельзя мержить до закрытия блокеров.** Не менять main, не делать Ready. Пользователь — единственный, кто разрешает merge.

## Следующий этап в том же Draft PR

Соединить обычную миссию «Атака» с занятым уникальным объектом/аномалией через существующий combat resolver, а не новый бой. Проверить обе стороны, потери, 30% груз, разовые выплаты, отчёты, NPC-логіку и офлайн повторы. После — разведка, hazard, баланс и визуальная проверка.
## UI corrections from QuickShot 2026-10-16_215602 (6 screenshots)

- 01/02: operation feed now displays the actual unique/anomaly artwork rather than the generic Expedition icon. There is a distinct free/occupied/own/completed color-coded badge instead of meaningless Intel pips and reward question marks.
- 03/04: exploration dossier rebuilt with actual full-size art, coordinates, lifetime, occupation, accepted status, Russian-language labels, resource assets and explicit action footer. Resource composition and risk are concealed before successful reconnaissance.
- 04: accepted operations are persisted under the existing SaveState.exploration.acceptedContactIds and shown in the Active tab. Actual completed returns and expired accepted contact cycles appear in Completed; archive snapshots preserve the exact old cycle, not a newly spawned contact.
- 05/06: Universe map has colored object status markers, and both anomaly and unique object inspectors offer 'Исследовать зондом' and 'Подготовить экспедицию'. Starting probe reconnaissance from the atlas also accepts the operation.
- Research: exploration-recon uses a real one-spy-probe flight, existing fuel and fleet reservation, ETA, canonical arrival, seeded 70% success, 120s cooldown and durable reconReports. Profiles appear after success, failure is a real report. The probe flies back.
- Added integration test covering accepted/cancelled operations, concurrent spy-probe rejection, report at real arrival, cooldown, replay and archive.

Remaining blockers unchanged: combat-based Attack of occupied exploration contacts, NPC contests, hazards, end-to-end manual browser/device visual review. Never present these as implemented. Current HEAD CI and Pages must be separately verified, no merge.
