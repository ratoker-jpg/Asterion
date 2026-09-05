# Отчёты — foundation v1

## Статус визуала

Композиция Reports Center принята пользователем: три колонки `каналы → список → dossier`, плотный dark/cyan sci-fi HUD и подробный просмотр боевого доклада.

Визуальный слой не является источником игровых данных. Числа, названия и показатели отображаются только тогда, когда они существуют в текущих доменах Asterion.

## Канонические каналы

Reports Center использует только следующие каналы:

### Система

Информационный канал.

Сейчас сюда попадает реально раскрытая информация из `OperationsState`, например результат классификации неизвестного сигнала. В будущем сюда же должны попадать реальные шпионские отчёты, когда Fleet dispatch начнёт генерировать espionage runtime events.

Reports не создаёт отдельную категорию `Разведка` и не генерирует fake spy history.

### Доклады

Только реальные боевые `BattleReport`.

Источник истины:

```text
BattleHistoryState.reports
        ↓
battleReportToReportItem()
        ↓
ReportsView
```

`src/domain/combat` остаётся единственным источником истины для результата боя, сторон, population before/after, потерь, раундов, rewards, debris, experience, metadata и repair eligibility.

Если `OperationInstance.battleReportId` ссылается на существующий `BattleReport`, тот же бой показывается как доклад операции. Второй BattleReport и отдельная история боя не создаются.

`simulation` и `arena` не попадают в обычный канал `Доклады`.

Подробности боя в Reports используют существующий `BattleReportDetailBody` из `Флоты → Битвы`.

### Командные доклады

Зарезервированы для:

- атак на союзников;
- результатов атак на Солнце / Sun Raid.

Пока combat domain не содержит надёжной классификации таких событий, канал остаётся пустым. Reports не определяет эти события по строкам, именам игроков или другим эвристикам.

### Арена

Пока пусто.

Отчёты и очки Арены появятся только вместе с реализацией Arena runtime.

### Полёты

Пока пусто до появления реального Fleet dispatch / arrival / return runtime.

В будущем здесь должны сохраняться завершённые полёты, прибытия и возвраты флотов на планеты игрока. Fake flight fixtures не используются.

### Союзы

Показывает доступные совместные операции из актуального `CommandState.jointOperations`.

Доступные `preparing` / `mustering` / `awaiting` операции, в которые игрок ещё не вступил, могут появляться как приглашения. Из приглашения Reports вызывает переданный из `App` callback перехода к корню `Флоты`, где игрок выбирает состав.

Reports не ищет кнопку `Флоты` через DOM и не выполняет автоматическую отправку флота.

### Достижения

Пока пусто до появления achievements runtime.

## Live cross-domain state

`ReportsView` не читает `OperationsState` или `CommandState` из `localStorage` самостоятельно.

Актуальные состояния передаются из `App.tsx` через React props:

```tsx
<ReportsView
  battleReports={state.combat.reports}
  operations={state.operations}
  command={state.command}
  state={state.reports}
  ...
/>
```

Feed строится из текущих props:

```text
buildReportsFeed(battleReports, operations, command)
```

Поэтому reveal/join/reset отражаются в Reports без remount и без замороженного cross-domain snapshot.

## Persistence

Reports-owned persistence содержит только:

```text
reports.readIds
```

В `reports` не хранятся:

- копии `BattleReport`;
- saved battle ids;
- favorite metadata;
- archive metadata.

Сохранённые бои принадлежат combat domain:

```text
BattleHistoryState.savedReportIds
```

Именно этот массив используют и `Флоты → Битвы`, и Reports. Состояние сохранённого боя не дублируется в Reports metadata.

Legacy `favoriteIds` / `archivedIds` игнорируются миграцией Reports state.

## Non-combat fixtures

```text
NON_COMBAT_REPORT_FIXTURES = []
```

Reports больше не содержит presentation fixtures для:

- Экономики;
- Строительства;
- Дипломатии;
- Входящих;
- отдельной Разведки;
- Полётов.

Эти каналы/события могут появиться только после появления соответствующего runtime и только там, где это соответствует текущей продуктовой структуре Reports.

## Что реально работает в PR

- семь канонических каналов;
- счётчики `непрочитанные / всего`;
- явное read/unread состояние;
- `ОТМЕТИТЬ ВСЕ ПРОЧИТАННЫМИ`;
- поиск;
- фильтры `Все / Непрочитанные`;
- `СОХРАНЁННЫЕ БОИ` только в `Доклады`;
- pagination;
- previous / next по текущему отфильтрованному списку;
- боевые доклады из `BattleHistoryState.reports`;
- reuse существующего battle detail renderer;
- сохранение/удаление сохранения боя через `BattleHistoryState.savedReportIds`;
- Operations intel из актуального `OperationsState`;
- Alliance invitations из актуального `CommandState`;
- переход из `Союзы` к `Флоты` через callback из `App`;
- Prototype Reset возвращает Reports к актуальному default cross-domain state.

## Deferred

Отдельными будущими задачами остаются:

- реальный Fleet dispatch / return runtime для `Полёты`;
- реальные espionage flight events для `Система`;
- явная combat-классификация атак на союзников и Sun Raid для `Командные доклады`;
- Arena runtime;
- achievements runtime;
- backend mailbox / retention / multiplayer notifications.
