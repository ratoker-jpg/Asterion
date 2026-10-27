# UI polish v2 (PR 4/4) — передача работы (27.10.2026, безопасная остановка на 95% лимита)

Ветка `claude/ui-polish-v2`, worktree `D:\Desktop\Asterion\worktrees\ui-polish-v2`.
Черновик описания PR (по пунктам 1–8) — в описании PR; там же список правок сохранения для кадров.

## Сделано в коде (пункты 1–8)
- 1 V1: `src/ui/selection-guard.ts` + блок 1 в `src/ui/ui-polish.css`.
- 2 V2/V3: `src/rating.css` переписан целиком, правила рейтинга удалены из других CSS; `RatingView.tsx`.
- 3 V4: редактор планеты, шапка плана перелёта, единый крест `[data-asterion-close]`, «Продолжить», поле количества, круглые номера слотов, навигация без рамки, окно здания, спутники — `src/ui/ui-polish.css`.
- 4 V5: `.universe-modal-backdrop` с определённой строкой сетки (проба: main 1280×720 — окно 104…744, ветка 24…696).
- 5 V6: фракция в ProductionBots/Recycling/Trade/Science, названия по расе; тест `src/domain/buildings/faction-art.test.ts`.
- 6: `getUniverseNodeCaption` (чужая колония игрока → ник), подпись не обрезается; тест в `map-transport.test.ts`.
- 7: итоги прогона, отказ атаки, метки состава входящей атаки.
- 8: профиль (ник 24), «ФЛОТ · АСТЕРЫ», «БАЗОВОЕ ВРЕМЯ», подписи зданий на карте зоны.

## Проверено
- `npm run build` — ок; `test:inventory`, `test:buildings`, `test:universe`, `test:flights`, `test:application`,
  `test:command`, `test:reports`, `test:rating`, `test:settings`, `test:science`, `test:npc` — все зелёные.
- Кадры до/после сняты скриптом `electron/ui-polish-screenshots.cjs` (scratchpad, не в репо).

## Осталось (точный список)
1. Electron UI QA НЕ прогнаны: `npm run qa:visual`, `test:universe-ui`, `test:fleet-ui`, `test:reports-ui`,
   `test:space-flight-ui`, `test:command-ui`, `test:header-ui`, `test:science-ui`, `test:new-game-ui`,
   `test:npc-replay-ui-6h`. Риски: `visual-capture.cjs` (геометрия рейтинга), `fleet-production-qa`
   (высота плана перелёта — состав ≤3 типов теперь в одну колонку), `universe-planet-qa` (подписи карты).
   После прогона: `git checkout -- artifacts artifacts-pass1`, не коммитить `visual-qa/`.
2. Финальная серия кадров не досмотрена и не выложена: запустить
   `npx electron electron/ui-polish-screenshots.cjs --out=visual-qa/ui-polish/after` (+ `--incoming`,
   `--race=synod|veyra --only=race-interiors`) и то же с `--dist=<сборка origin/main>`; сложить пары
   до/после в `docs/reports/img/2026-10-27-ui-polish/` и вставить в описание PR.
3. Последние правки (крест закрытия через grid, подписи зданий, состав флота в одну колонку,
   закрытие диалогов «Командования») собраны, но визуально не проверены кадром.
4. Не проверено: клавиатура/фокус после правок навигации и рейтинга вручную; окно прогона в
   процессе (кадр «прогресс» снимается без ожидания — прогон 12 ч заканчивается за секунды).
