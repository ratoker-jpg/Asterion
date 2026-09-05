# Отчёты — foundation v1

## Visual direction

Экран `Отчёты` использует пользовательский mockup только как композиционный и визуальный ориентир: три колонки `категории → список → dossier`, плотный dark/cyan sci-fi HUD и отдельно проработанный боевой отчёт.

Числа, названия, награды и боевые показатели из image reference не считаются каноническими данными игры.

## Источник истины для боёв

Боевые отчёты Reports Center не имеют собственного BattleHistory.

Поток данных:

```text
BattleHistoryState.reports
        ↓
battleReportToReportItem()
        ↓
ReportsView
```

`src/domain/combat` остаётся единственным источником истины для результата боя, сторон, population before/after, потерь, раундов, rewards, debris, experience, metadata и repair eligibility.

Новый `BattleReport`, добавленный существующим combat runtime в `state.combat.reports`, автоматически попадает в категорию `Боевые отчёты` без ручного создания второго report item.

## Что Reports state хранит отдельно

В существующем save envelope `asterion.vertical-slice.v1` добавляется только presentation metadata:

```text
reports.readIds
reports.favoriteIds
reports.archivedIds
```

BattleReport туда не копируются.

## Что реально работает в PR

- категории и динамические счётчики;
- unread indicators;
- открытие отчёта помечает его прочитанным;
- `ОТМЕТИТЬ ВСЕ ПРОЧИТАННЫМИ`;
- поиск по title/body/participant/planet/coordinates;
- фильтры `Все / Непрочитанные / Избранные`;
- реальная pagination;
- favorite toggle;
- archive / restore;
- previous / next по текущему отфильтрованному списку;
- battle dossier на основе существующего `BattleReport`;
- реальные потери через `destroyed` и canonical combat catalog;
- только реально присутствующие rewards: metal/minerals/gas/experience/debris;
- procedural CSS tactical battle banner без third-party artwork;
- сохранение Reports metadata и общий Prototype Reset.

## Что является fixture

Пока полноценного общего event/report runtime нет, категории ниже наполнены небольшим deterministic presentation catalog:

- Полёты;
- Разведка;
- Экономика;
- Строительство;
- Дипломатия;
- Системные;
- Входящие.

Эти записи демонстрируют Reports UX и domain boundary. Они не утверждают, что соответствующая игровая система уже генерирует runtime events.

## Что сознательно не выдумано

Если поле отсутствует в `BattleReport`, Reports Center не создаёт его ради сходства с mockup.

В частности:

- нет выдуманной `боевой мощи`;
- нет выдуманной продолжительности боя;
- нет energy reward, потому что `BattleResourceOutcome` сейчас содержит только metal/minerals/gas;
- нет fake delete action;
- нет второго combat catalog;
- нет второго BattleHistory.

Вместо `БОЕВАЯ МОЩЬ` интерфейс показывает реально существующий показатель `СОСТАВ ДО БОЯ` и population before/after/loss.

## Deferred

Отдельными будущими задачами остаются:

- единый runtime event/report bus для Economy / Construction / Flights / Recon / Diplomacy;
- backend mailbox;
- multiplayer notifications;
- server retention;
- push notifications;
- правила удаления/retention, если они вообще понадобятся.
