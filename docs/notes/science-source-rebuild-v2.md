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

Captured saved-page values include current/next level, next-level resource cost, captured research time, laboratory requirement and science prerequisites where the page exposes them. These are presentation/snapshot values, not live Asterion campaign progression.

## Asterion canon and assets

The project building canon is committed as:

`docs/asterion_buildings_canon_v1.md`

For the current Asters presentation, the canonical research building is **Лаборатория**, role `research`, using the existing asset:

`assets/source/New assets/buildings/aegis/building.aegis.research.png`

The old player-facing label `Экспериментальный центр` is not used on the current Asters Science screen.

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

- left laboratory sidebar;
- real Asterion Laboratory building art in the sidebar;
- four source-backed sections;
- compact research queue;
- large science rows in the main panel;
- row art, level, effect, costs and time;
- compact requirement icons below each science, matching the Nemexia pattern;
- each requirement icon exposes its name/current level/required level through a tooltip;
- fulfilled requirements remain colored;
- missing requirements are desaturated/dimmed;
- blocked sciences show a red missing-requirement banner and no upgrade CTA;
- sciences whose captured requirements are satisfied keep the visual `Повысить уровень` CTA, but the button remains non-functional until real research runtime exists.

After visual review, Science follows the shared Asterion document-scroll model rather than owning a nested catalog scrollbar. The laboratory content contributes its natural height to `GlobalPageScrollController`; if it exceeds the available workspace, the common game scrollbar moves the whole page. This keeps Science consistent with other long Asterion screens and avoids a second vertical scroll channel inside the catalog.

## Additional Science rule

The saved page explicitly warns that only one direction from Additional Science may be researched. The warning is shown as an in-game hint, but no gameplay enforcement is implemented because real research progression is deferred.

## QA contract

Visual QA verifies all four target viewports and rejects a nested Science vertical scrollbar. If the laboratory content is taller than the workspace, document scrolling must be owned by `GlobalPageScrollController`.

## Science cancellation refund

The confirmed Nemexia source is [saved Science page (2026-09-05 22:49:40)](https://github.com/ratoker-jpg/Nemexia_auto_v2/blob/main/saved_pages/%D0%BD%D0%B0%D1%83%D0%BA%D0%B0/page_2026-09-05_22-49-40.html). Its text specifies a **60–80%** return range and does not specify one fixed percentage. Asterion therefore rolls one injectable random integer in that inclusive range for each successful science cancellation, floors each saved-cost resource independently, and never recalculates a refund from the current catalog.

## Deferred

- persistent research queue;
- real research countdown;
- campaign resource spending;
- science progression;
- applying unconfirmed modifiers to combat/economy/fleet systems.
