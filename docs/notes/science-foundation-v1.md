# Science foundation v1

## Current source of truth

The Science screen now mirrors the complete current research catalog from:

- repository: `ratoker-jpg/stellar-empires`
- main commit inspected: `466ec55f1751d36fd4a30175f7669f89ebe9a6a6`
- source file: `src/simulation/research/completeResearchCatalog.ts`

That file defines one shared 22-technology template set and materializes it for Aegis, Synod and Veyra. The Asterion Science screen therefore uses the 22 universal research templates rather than the earlier incomplete 10-item Combat-only subset.

## Six source-backed sections

The sections are the actual Stellar `ResearchCategory` values:

- `energy` — Энергетика
- `infrastructure` — Инфраструктура
- `navigation` — Навигация
- `intelligence` — Разведка
- `defense` — Оборона
- `weapons` — Вооружение

They are not presentation inventions.

## Full current catalog

1. Физика
2. Химия
3. Математика
4. Астрономия
5. Шпионаж
6. Компьютерные системы
7. Корабельная броня
8. Топливные элементы
9. Реактивные двигатели
10. Лазерная технология
11. Ионная технология
12. Плазменная технология
13. Экология
14. Гиперпространство
15. Параллельные вселенные
16. Улучшенное строительство
17. Пробивающая атака
18. Маневренная защита
19. Критический удар
20. Лёгкая броня
21. Средняя броня
22. Тяжёлая броня

## Source-backed metadata

For every item the Asterion Science catalog snapshots the verified Stellar fields:

- category;
- description;
- max level;
- base metal / crystal / gas cost;
- base research seconds;
- required laboratory level;
- prerequisite technology + required level;
- declared research effect metadata.

The constellation links are built from actual Stellar prerequisites. They are no longer decorative/presentation-only relations.

## Asterion Combat overlap

Ten of the 22 sciences overlap the current `src/domain/combat/technologies.ts` contract. Those nodes retain an explicit `CombatTechnologyId` / `sourceScienceId` mapping without replacing the Combat catalog:

- laser / ion / plasma;
- piercing attack;
- light / medium / heavy armor;
- ship armor;
- maneuver defense;
- critical hit.

The Stellar-facing names are used on the Science screen (`Лазерная технология`, `Ионная технология`, `Плазменная технология`, `Корабельная броня`), while the existing Combat identifiers remain stable.

## Visual system

Science was rebuilt as a six-lane research constellation:

- left rail: real science sections + catalog search + source provenance;
- center: full 22-node dependency matrix with source-backed links;
- focus mode: one category or the full matrix;
- selected and directly linked nodes receive stronger visual emphasis;
- right dossier: verified source metadata, requirements, dependents and optional Combat link;
- bottom: explicit empty research queue foundation.

The screen uses the Asterion dark/cyan HUD language but gives each science section a distinct accent to make the tree readable.

## Runtime boundary

This PR does **not** start a new Asterion research economy. Displaying Stellar research metadata does not mean the Asterion campaign currently spends resources, advances timers or mutates Combat from this screen.

The bottom queue explicitly remains `runtime not connected`; there is no fake countdown and no fake resource spending.

## Deferred

- Asterion research progression state.
- Research queue lifecycle and persistence.
- Resource spending integration.
- Runtime unlock application.
- Combat/economy effect application from research levels.
