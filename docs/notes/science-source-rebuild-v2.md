# Science — source rebuild v2

## Saved Nemexia source

Canonical structural reference for this rebuild:

`ratoker-jpg/Nemexia_auto_v2/saved_pages/наука/page_2026-09-05_22-49-20.html`

The saved page records `laboratory.php` and exposes four actual laboratory sections:

- Основные науки — IDs `1, 2, 3, 4`;
- Высокотехнологичные науки — IDs `5, 6, 7, 8, 9, 10, 11, 12, 13`;
- Экспертные науки — IDs `14, 15, 17, 21, 22, 23`;
- Дополнительные науки — IDs `18, 19, 20`.

Science `16` is not present in the saved Laboratory catalog and is not invented.

## 22-entry catalog

The display catalog contains exactly the 22 sciences visible in the saved page:

1. Физика
2. Химия
3. Математика
4. Астрономия
5. Шпионаж
6. Компьютерные системы
7. Броня кораблей
8. Топливные элементы
9. Реактивные двигатели
10. Лазерная наука
11. Ионная наука
12. Плазменная наука
13. Экология
14. Гиперпространство
15. Параллельные вселенные
17. Улучшенное строительство
21. Лёгкая броня
22. Средняя броня
23. Тяжёлая броня
18. Пробивающая атака
19. Маневренная защита
20. Критический удар

Captured saved-page values include current/next level, next-level resource cost, captured research time, Experimental Center requirement and science prerequisites where the page exposes them. These are presentation/snapshot values, not live Asterion campaign progression.

## Asterion technology art mapping

Every catalog entry maps to one existing asset under:

`assets/source/New assets/technologies/`

All 22 rows use their corresponding `technology.shared.*.png` art as a large visual area. Generic atom/SVG placeholders are not used.

## Existing Combat overlap

The Science catalog does not create a second combat technology model. Ten source science IDs map to existing `CombatTechnologyId` values:

- 7 → `shipArmor`
- 10 → `laserScience`
- 11 → `ionScience`
- 12 → `plasmaScience`
- 18 → `piercingAttack`
- 19 → `maneuverDefense`
- 20 → `criticalHit`
- 21 → `lightArmor`
- 22 → `mediumArmor`
- 23 → `heavyArmor`

No combat coefficient, max-level formula or resolver behavior is added by this rebuild.

## Laboratory structure

The UI follows the saved Laboratory information hierarchy rather than a tree/constellation:

- fixed left laboratory sidebar;
- four source-backed sections;
- compact research queue;
- large science rows in the main panel;
- row art, level, effect, costs, time, lab requirement and prerequisites;
- disabled research action with a small in-game hint.

The main catalog is the only Science vertical scroll region. Sidebar and queue remain fixed inside the existing Asterion workspace.

## Additional Science rule

The saved page explicitly warns that only one direction from Additional Science may be researched. The warning is shown as an in-game hint, but no gameplay enforcement is implemented because real research progression is deferred.

## Deferred

- persistent research queue;
- real research countdown;
- campaign resource spending;
- science progression;
- applying unconfirmed modifiers to combat/economy/fleet systems.
