# Полировка интерфейса (PR 4/4, #115) — отчёт

Ветка `claude/ui-polish-v2`. Только визуал; механики и правила не менялись. Подробности по пунктам,
кадры до/после и правки сохранения — в описании PR #115; пары кадров лежат в
`docs/reports/img/2026-10-27-ui-polish/`.

## Где что лежит
- Глобальное поведение и правки старых поверхностей: `src/ui/ui-polish.css` (подключён последним),
  запрет выделения и Ctrl+A: `src/ui/selection-guard.ts`.
- Рейтинг: целиком `src/rating.css` (правила рейтинга из других файлов удалены).
- Здания по расе: `ProductionBotsView`, `RecyclingCenterView`, `TradeCenterView`, `ScienceView`
  получают фракцию; шапки и «Назад: {здание}» — из `getBuildingDefinition(role, faction).name`;
  требования и причины из домена (там названия Астеров, по ним сверяется логика) выводятся через
  `localizeBuildingNames` (`balance-v1.ts`). Тест `src/domain/buildings/faction-art.test.ts`,
  в том числе проверка, что в тексте `src/*.tsx` и `src/ui/**/*.tsx` нет зашитых названий зданий.
- Подписи карты: `getUniverseNodeCaption` (`src/domain/universe/runtime.ts`), тест в
  `src/application/map-transport.test.ts`.
- Кадры: `electron/ui-polish-screenshots.cjs` (новая игра через мастер; `--dist`, `--out`, `--race`,
  `--only`, `--incoming`). Правки сохранения делаются вместе с перезагрузкой в одной задаче
  рендерера — иначе ежесекундное сохранение игры могло их затереть (так однажды пропали
  интерьеры Астеров на main).

## Проверки (28.10.2026)
- `npm run build`, `test:inventory` и логические наборы — зелёные.
- Electron QA на ветке: `qa:visual`, `test:universe-ui`, `test:fleet-ui`, `test:reports-ui`,
  `test:space-flight-ui`, `test:command-ui`, `test:header-ui`, `test:science-ui`, `test:new-game-ui`,
  `test:npc-replay-ui-6h` — все прошли без правок скриптов (разметка и `data-qa` сохранены).
- После правок названий: `qa:visual`, `test:fleet-ui`, `test:command-ui`, `test:pirate-operations-ui`,
  `test:universe-ui`, `test:spaceport-ui` — прошли; `test:science-ui` падает на шаге «Escape … restore
  focus» одинаково на ветке и на `origin/main` 7019c07 (днём проходил) — не регрессия PR.
- Клавиатура (реальные `sendInputEvent`): Tab до вкладки навигации — видимый фокус, Enter открывает
  экран; в рейтинге Tab по заголовкам, Enter меняет сортировку и раскрывает строку; Ctrl+A в поле
  поиска выделяет его текст, по экрану рейтинга — 0 символов (main — 1176), в тексте отчёта — только
  текст отчёта (main — весь документ).

## Известные ограничения
- Не переведены (домен): «постройте Палату» (`src/domain/command/aid.ts`) и название здания в отчёте
  осады (`src/domain/combat/planet-siege.ts`, нужна раса защитника).
- Пара карты снята на одном сохранении в обеих сборках (`--export-save` / `--import-save`); у NPC-колоний
  ник владельца был и на main, правка подписи касается колоний других игроков (покрыта тестом).
- Мир после «12 ч офлайн» не детерминирован между запусками (число боёв, союзов), поэтому кадры
  до/после одного пункта могут показывать разные NPC-данные; сравнивать следует оформление.
- Окно обломков со списком снято в тестовом режиме (2 строки); случай из аудита (9 строк) проверен
  замером геометрии, без кадра.
