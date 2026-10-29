# Производительность поздней игры — handoff (безопасная остановка 29.10)

Итог и цифры — `LATE_GAME_PERFORMANCE_2026-10-28.md` (+ JSON). Всё закоммичено и запушено в PR #116.

## Сделано в последнем заходе
- Проверки на HEAD: 24 логических набора, `test:inventory`, long-horizon `test:npc` 176/176, дайджесты
  паритета без изменений; Electron: save-store, save-safety, npc-replay-ui-6h, late-game-fps (дни 1–3),
  новый `test:late-save-ui` (миграция, перезапуск, закрытие посреди прогона дня 3 и во время асинхронной
  записи) — ок.
- Мир, возвращённый воркером, сохраняется кусками (убран фриз 0,67 с после прогона на дне 3).
- Отчёт, JSON и план «максимум» обновлены.

## Не сделано
- **Замеры дня 5 и 7.** Генерация мира дня 5 с дня 3 шла в фоне и к остановке дошла до 32 из 48 часов
  (`D:/Temp/claude/fixtures-late`, лог `gen.log`); если процесс остановился, файла нет. В отчёте — оценка
  по тренду дней 1–3. Как продолжить:

```bash
npm run benchmark:late-game -- generate --from=DIR/late-game-day-3.json --days=5,7 --out=DIR --max-groups=2048
npm run benchmark:late-game -- measure --fixture=DIR/late-game-day-5.json --hours=1 --max-groups=2048
npx electron electron/late-game-fps-qa.cjs --fixture=DIR/late-game-day-5.json --catchup-hours=1 --seconds=8
```

  Мир дня 5 будет ~95 млн символов: в FPS QA он засевается через файловое хранилище, как день 3.
- Описание PR: строка дня 5 в таблице отсутствует (оценка по тренду в тексте).
