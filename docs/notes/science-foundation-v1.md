# Science foundation v1 — Nemexia-backed correction

## Source of truth

The Science screen is now based on the saved Nemexia laboratory pages supplied in:

- repository: `ratoker-jpg/Nemexia_auto_v2`
- directory: `saved_pages/наука`
- inspected page: `saved_pages/наука/page_2026-09-05_22-49-20.html`
- original page recorded by the save: `https://game.ares.nemexia.com/laboratory.php`

The previous PR revision incorrectly kept the old Stellar six-lane matrix and the Stellar-derived grouping. This correction removes that mismatch.

## Real Nemexia sections

The laboratory page exposes four actual science tabs:

1. `Основные науки` (`TabBasic`) — IDs 1, 2, 3, 4.
2. `Высокотехнологичные науки` (`TabAdvanced`) — IDs 5–13.
3. `Экспертные науки` (`TabMaster`) — IDs 14, 15, 17, 21, 22, 23.
4. `Дополнительные науки` (`TabAdditional`) — IDs 18, 19, 20.

The additional-science source page explicitly warns that only one direction from that list can be researched. Asterion displays this source rule but does not enforce it yet because research progression is not connected.

## Catalog

The screen contains the 22 sciences present in the saved Nemexia laboratory page:

- Физика
- Химия
- Математика
- Астрономия
- Шпионаж
- Компьютерные системы
- Броня кораблей
- Топливные элементы
- Реактивные двигатели
- Лазерная наука
- Ионная наука
- Плазменная наука
- Экология
- Гиперпространство
- Параллельные вселенные
- Улучшенное строительство
- Легкая Броня
- Средняя Броня
- Тяжелая Броня
- Пробивающая атака
- Маневренная защита
- Критический удар

Science ID 16 is not present in the saved laboratory catalog and is not invented.

## Source-backed fields

For each science the Asterion read model stores only data visible in the saved page:

- Nemexia science ID;
- section/tab;
- name;
- description/effect text;
- captured science level and next level;
- captured metal/mineral/gas/energy cost for the next level shown in that save;
- captured research time;
- required Experimental Center level;
- science prerequisites and required levels.

The captured level/cost/time are labelled as a **Nemexia saved-page snapshot**, not as current Asterion campaign state.

## Combat overlap

The existing Asterion Combat science contract remains authoritative for combat integration. Ten Nemexia science IDs are linked to their existing `CombatTechnologyId` without creating a parallel combat model:

- 7 — `shipArmor`
- 10 — `laserScience`
- 11 — `ionScience`
- 12 — `plasmaScience`
- 18 — `piercingAttack`
- 19 — `maneuverDefense`
- 20 — `criticalHit`
- 21 — `lightArmor`
- 22 — `mediumArmor`
- 23 — `heavyArmor`

## Visual correction

The old constellation/matrix presentation is removed. The screen now follows the actual Nemexia laboratory interaction pattern while staying inside the Asterion HUD language:

- compact laboratory/process strip;
- four source-backed section tabs;
- searchable research-card catalog;
- selected-science dossier with captured cost/time/requirements;
- explicit Additional Science warning;
- no decorative fake dependency graph;
- no fake research countdown or resource spending.

## Deferred

- Asterion research progression state.
- Research queue persistence/runtime.
- Resource spending.
- Applying science effects to economy/fleet/combat.
- Enforcing the one-of-three Additional Science rule.
EOF