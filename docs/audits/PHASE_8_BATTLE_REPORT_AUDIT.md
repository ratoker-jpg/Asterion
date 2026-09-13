# Phase 8: Battle report visual audit

Короткий аудит перед изменениями, зафиксированный для feature branch `codex/phase8-battle-report-visual`.

## Подтверждённые факты

- `src/domain/combat/report.ts` уже хранит участников, winner, население до/после, составы сил, rounds/events и опциональные `experience`, `debris`, `resources`.
- `CombatRoundSnapshot` и snapshots сил были опциональными; сохранённые demo-отчёты не давали стабильной визуальной модели каждого раунда.
- `src/domain/combat/resolver.ts` создаёт snapshots для результатов симулятора, но не формирует награды и не реализует реальные атаки.
- `src/BattleReportsView.tsx` показывал список и inline-detail без полноценной visual scene; карточки не показывали разбивку потерь.
- Faction catalogs уже содержат Asterion presentation names и art, но report participant сохраняет только `race`, без отдельного faction id.
- Approved background asset доступен вне репозитория в `artifacts/battle-report-visual/assets/battle-bg-approved-candidate.png`; для сборки он копируется в `src/assets/battle-report/`.

## Ограничения Phase 8

- Источники данных: три demo fixtures и reports, сохранённые SimulatorView.
- Отчёт открывается поверх Fleet Workspace в большом скроллируемом overlay; страницу и router не переписываем.
- Visual scene статична, строится только из сохранённых round snapshots; CombatEvent используется отдельным свёрнутым analysis panel.
- Немексовские формулы, реальные missions/attacks, repair workshop и combat priority в этот scope не входят.

## Реализационные решения

- Ввод report проходит через `createBattleReportViewModel`, который нормализует неизвестные/неполные данные и возвращает `Нет данных`, не вызывая catalog resolver из UI напрямую.
- Demo fixtures получили явные snapshots для каждого раунда; добавлен переход `spy-probe` в третьем отчёте, чтобы проверять отсутствие стека после его исчезновения из следующего snapshot.
- Для обратной совместимости в `BattleStackSnapshot` добавлено только опциональное историческое поле `level`; существующий combat meaning не меняется.
