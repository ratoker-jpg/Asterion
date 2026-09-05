# Science foundation v1

## Sources inspected

Pre-flight used live Asterion `main` at `881ee51c3d9db8f885ae076cf1995739d92184a5` and inspected current `src/domain/combat/technologies.ts` plus its tests/history. That contract records science names and `sourceScienceId` values extracted from the saved Nemexia simulator.

The source archive `ratoker-jpg/Nemexia_auto_v2` was also inspected at its current main commit `3def0fe38a4f2df4203ce57262ac7d5324b55edc` (`Add Nemexia safe page archive`). The archive contains saved Nemexia pages/resources. The inspected archive/search did not establish authoritative research costs, research times, maximum levels, prerequisite rules or exact battle coefficients beyond the science-field identity already preserved by current Asterion.

This distinction is deliberate: absence of a confirmed value is not filled with memory, a screenshot value or an inferred rule.

## Confirmed current Asterion science inputs

| CombatTechnologyId | Source science ID | Name |
| --- | ---: | --- |
| `laserScience` | 10 | Лазерная наука |
| `ionScience` | 11 | Ионная наука |
| `plasmaScience` | 12 | Плазменная наука |
| `piercingAttack` | 18 | Пробивающая атака |
| `lightArmor` | 21 | Лёгкая броня |
| `mediumArmor` | 22 | Средняя броня |
| `heavyArmor` | 23 | Тяжёлая броня |
| `shipArmor` | 7 | Броня кораблей |
| `maneuverDefense` | 19 | Маневренная защита |
| `criticalHit` | 20 | Критический удар |

These ten items are not duplicated as a second independent combat catalog. `src/domain/science/catalog.ts` derives names/IDs from `COMBAT_TECHNOLOGIES` and only adds Science-view presentation metadata.

## Sections

The user-facing Science screen groups the current ten sciences into three readable visual sections:

- `ОРУЖЕЙНЫЕ НАУКИ`
- `БРОНЕЗАЩИТА`
- `МАНЕВРЕННАЯ ЗАЩИТА`

These group labels and node x/y positions are explicitly `presentationOnly`. They organize the screen; they are not Nemexia/Asterion gameplay categories and do not create prerequisites.

## Dependencies and visual links

No prerequisite relation was confirmed by the inspected sources. Therefore every `confirmedPrerequisites` list is empty and `SCIENCE_VISUAL_LINKS` is empty. The UI intentionally does not draw progression lines that could be mistaken for research rules.

## Combat boundary

Current `src/domain/combat/technologies.ts` explicitly keeps unverified technology effects neutral in Combat Resolver v1. Science does not add:

- attack/life/armor multipliers;
- critical-hit behavior;
- max-level rules;
- unlock rules;
- research costs/times.

The Science domain exposes no combat multiplier/effect field. Its stable mapping is `ScienceCatalogItem.combatTechnologyId -> CombatTechnologyId`.

## Research runtime

There is no real research economy/runtime in this PR. The screen does not spend metal/minerals/gas, start research, enforce prerequisites, tick timers or alter combat. The queue region explicitly says `RUNTIME НЕ ПОДКЛЮЧЁН` and contains only empty preview slots with no countdown.

## Visual interpretation

The supplied Science screenshot is a visual/layout reference only. Its category names, node names, costs, timers and tree dependencies are not copied as data. The Asterion screen uses the real ten current science inputs above and separates them into presentation sections without adding gameplay semantics.

## Deferred

- Canonical research progression state.
- Research slots/queue lifecycle.
- Resource costs and research duration.
- Confirmed max levels and prerequisites.
- Confirmed battle coefficients/effects.
- Production unlocks and laboratories.
