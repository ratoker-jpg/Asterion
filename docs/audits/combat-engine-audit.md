# Аудит боевого движка Asterion

Дата аудита: 2026-09-21  
Проверенный commit: **a97f397acb9e6c4f5c83d738678ab17651b17285**  
Ветка с отчётом: **audit/combat-engine-2026-09-21**  
Боевой движок: **asterion-combat-engine-v3**  
Режим аудита: read-only по исходному коду, тестам, fixtures, Git history/CI и документации текущего репозитория. Исходный код, тесты, UI и игровые механики не изменялись.

## 1. Краткий вывод

### Итог

**Текущему CombatResolver можно частично доверять как внутреннему Asterion-симулятору, но нельзя считать его подтверждённо правильной полной боевой системой и нельзя считать доказанной Nemexia-паритетность.**

Причины разделяются на два слоя:

1. **Сам resolver**
   - порядок раунда, уровни обычных кораблей, технологии, броня, matchup, seeded RNG, snapshots и базовые winner/draw переходы реализованы последовательно;
   - штатный combat-suite на проверенном commit проходит: **122/122 tests, 0 failed**;
   - при этом часть ключевых правил помечена самим репозиторием как inferred/not-calibrated, а первичный implementation brief отсутствует в текущем репозитории.

2. **Полный игровой боевой цикл**
   - production flight runtime сейчас не поддерживает attack/raid;
   - потери атакующего и возврат выжившего флота не подключены;
   - CombatResolver не рассчитывает debris, stolen resources и experience;
   - spy-report handoff теряет часть боевой информации;
   - поэтому цепочка «вылет → бой → потери обеих сторон → возврат → обломки/лут → отчёт» **не является законченной production-механикой**.

### Подтверждённые P0

**P0 не найдено.**

Нет подтверждённого дефекта, который доказывает, что базовая арифметика каждого обычного залпа принципиально сломана. Однако отсутствие P0 не означает, что вся система готова к production: найдено несколько P1.

### Главные P1

1. **Priority ведущего командира фактически игнорируется fallback-логикой resolver.**
2. **Combat validation допускает service/civil ships в бой, хотя evidence ledger утверждает, что они должны отклоняться.**
3. **Полный production attack/raid flight flow не подключён.**
4. **Spy report → simulator жёстко удаляет defender Hunter из состава.**
5. **Generic production spy handoff не имеет корректного источника defender combat technologies.**
6. **Resolver не рассчитывает debris/resources, следовательно правила 30%, исключения газа и loot сейчас проверить невозможно.**
7. **Application boundary применяет только defender losses; attacker losses/return survivors не реализованы в текущем production-flow.**

---

## 2. Вердикт по подсистемам

| Подсистема | Вердикт | Основание |
| --- | --- | --- |
| Combat input validation | работает частично | Сильная проверка типов, caps, levels, rounds; но service/civil eligibility противоречит evidence ledger |
| Уровни обычных кораблей | работает правильно в рамках текущей формулы | level coefficient применяется к attack и life до group scaling |
| Уровни service/civil ships | работает неправильно/неопределённо | их можно отправить в бой, но ordinaryClass coefficient отсутствует; level практически не влияет |
| Уровни командиров | работает частично | уровень сохраняется и влияет на active ability; active selection fallback сломан |
| Уровни обороны | работает правильно по текущему правилу | production принимает только level 0 |
| Технологии внутри resolver | работает правильно в рамках текущей спецификации | additive attack/life, armor p.p., critical; тесты подтверждают |
| Технологии spy-report handoff | работает частично | attacker sciences берутся из SaveState; defender sciences корректны только для Bot 01 test profile |
| Командирские корабли как боевые стеки | работает частично | участвуют в бою и имеют базовые stats; Hunter теряется в spy handoff |
| Commander priority | работает неправильно | resolver получает priority, но не использует |
| Выбор целей | работает структурно, но правило не калибровано | threat/population/catalog deterministic retarget |
| Damage / armor | работает по внутренней формуле | formula прозрачна; provenance самого repo = inferred |
| Matchup matrix | работает по внутренней таблице | 6×6 matrix; provenance = inferred |
| RNG / seed | работает правильно | xorshift32 deterministic; без seed = Math.random/non-replayable |
| Critical hit | работает по Asterion approximation | science + Viper chance, ×2; provenance частично inferred |
| Phantom / Scorpion / Reanimator | работает частично | код активен; Phantom/Reanimator inferred, Reanimator не фильтрует defense |
| 5/8/12 rounds | работает | validation и loop используют выбранный лимит |
| Победа/поражение/ничья | работает | golden fixtures и CI подтверждают три результата |
| Одновременное уничтожение | невозможно подтвердить | последовательный attacker-first resolver не создаёт нормальный путь к simultaneous kill |
| Empty side | отклоняется | validation возвращает empty-side |
| Defender losses | работает | application/repair снимает реальные потери и защищён report-id idempotency |
| Attacker losses / return | не реализовано в production flight flow | attack/raid flight mission не поддержаны |
| Defensive repair | работает по текущему правилу | 50% Math.round per stack; report-id idempotent |
| Battle points | работает по реализованной формуле | считает стоимость metal+minerals+gas / 1000, solar satellite excluded |
| Debris | невозможно подтвердить / не реализовано resolver | поле существует, formula generation отсутствует |
| Stolen resources | невозможно подтвердить / не реализовано resolver | поле существует, resolver его не заполняет |
| Battle report core | работает частично | winner/losses/rounds/stats совпадают с resolver snapshots |
| Battle report special armor bonus display | работает неправильно | UI analysis показывает armor amount в 100 раз меньше применённого p.p. |
| Идемпотентность defender result/repair | работает | report.id + claimedBattleIds |
| Полный production combat lifecycle | работает неправильно / не завершён | нет attack/raid runtime и attacker transition |

---

## 3. Полная схема боевого расчёта

### 3.1 Simulator / direct resolver path

Основная цепочка:

1. SimulatorScenario
2. scenarioToCombatInput()
   - src/domain/combat/simulator.ts: 486-528
3. validateCombatInput()
   - src/domain/combat/simulator.ts: 318-482
4. normalizeCombatInput()
   - src/domain/combat/simulator.ts: 211-249
5. resolveCombat()
   - src/domain/combat/resolver.ts: 932-1090
6. runtimeFromInput()
   - src/domain/combat/resolver.ts: 225-264
7. chooseActiveCommander()
   - src/domain/combat/resolver.ts: 918-926
8. applyRoundModifiers()
   - src/domain/combat/resolver.ts: 389-418
9. round loop
10. resolveSideActions(attacker)
11. resolveReanimator(attacker)
12. determineWinner()
13. если победитель ещё не определён:
    - resolveSideActions(defender)
    - resolveReanimator(defender)
14. determineWinner()
15. snapshots + events + summary
16. после maxRounds без победителя → draw
17. BattleReport

### 3.2 Production application boundary

В репозитории существует:

- resolveAndApplyCombat()
  - src/application/combat.ts
- bindCombatResolutionEventBridge()
  - src/application/combat.ts
- bindCombatResultEventBridge()
  - src/application/repair.ts
- App wiring:
  - src/App.tsx: 522-539

Но flight runtime:

- src/application/flights.ts: 724-730

разрешает только:

- colonize
- transport
- espionage

Любая другая missionId, включая attack/raid, возвращает mission-not-supported.

**Вывод:** production combat event boundary существует, но flight producer боевого вылета в текущем commit не подключён.

### 3.3 Spy report → simulator

- createSpyReport()
  - src/application/flights.ts: 519-575
- createSimulatorScenarioFromSpyReport()
  - src/application/simulator-handoff.ts: 44-79

Передаются:

- attacker ships;
- attacker commander stacks;
- attacker owner ship/commander levels из общей spaceportUpgrades.shipLevels map;
- attacker science → combat technologies;
- defender fleet + fleetLevels;
- defender defenses;
- часть defender commanders.

Проблемы:
- defender Hunter удаляется;
- spy-probe удаляется;
- defender technologies берутся не из report snapshot, а из state.espionage.bot01Profile либо становятся нулевыми.

---

## 4. Псевдокод одного боя

    validate(input)
    normalized = normalize(input)

    attackerTech = normalized.attackerTechnologies
    defenderTech =
      shared ? attackerTech : normalized.defenderTechnologies

    rng =
      seed ? xorshift32(seed) : Math.random

    attacker = ships + commanders
    defender = ships + commanders + defenses

    activeAttackerCommander =
      requested-valid ? requested : availableCommanders[0]

    activeDefenderCommander =
      requested-valid ? requested : availableCommanders[0]

    build per-unit runtime stats:
      attack = floor(baseAttack * (
        1
        + shipLevelCoefficient * level
        + technologyAttackBonus
      ))

      life = floor(baseLife * (
        1
        + shipLevelCoefficient * level
        + technologyLifeBonus
      ))

      armor = clamp(baseArmor + armorSciencePoints, 0, 80)

    apply round-start commander/special bonuses

    for round = 1..maxRounds while no winner:
      recompute round modifiers from base stats

      attacker acts in deterministic stack order:
        optional Phantom cancellation
        deterministic target selection
        optional critical
        apply attack
        optional Scorpion proc

      attacker Reanimator phase

      if defender is dead:
        winner = attacker
      else:
        defender acts in deterministic stack order
        defender Reanimator phase

      determine winner
      save round snapshots/events

    if no winner:
      winner = draw

    return BattleReport

---

## 5. Точные формулы

### 5.1 Level + technology attack

Источник:
- src/domain/combat/resolver.ts: 225-244
- src/domain/combat/technologies.ts: 109-154

Для ordinary ship class:

**attackPerUnit = floor(baseAttack × (1 + classCoeff × level + technologyAttackBonus))**

Level и technology складываются **аддитивно от исходной базы**, а не перемножаются друг на друга.

### 5.2 Level + technology life

**lifePerUnit = floor(baseLife × (1 + classCoeff × level + technologyLifeBonus))**

### 5.3 Group attack

src/domain/combat/resolver.ts: createAttackEvent, около 706-768

**baseAttack = floor(livingCount × attackPerUnit)**

### 5.4 Matchup

**rawDamageBeforeArmor = floor(baseAttack × matchupMultiplier)**

Доступные multiplier ordinary classes:

- 0.70
- 1.00
- 1.70

Commander и defense matchup сейчас neutral 1.0 / not-calibrated.

### 5.5 Critical

**criticalChance = clamp(scienceCriticalChance + activeViperBonus, 0, 1)**

Если draw < chance:

**rawDamage = floor(rawDamageBeforeArmor × 2)**

Иначе multiplier = 1.

### 5.6 Armor

src/domain/combat/resolver.ts: 184-188

Для positive rawDamage:

**effectiveDamage = max(1, floor(rawDamage × (100 - clamp(armor, 0, 80)) / 100))**

При rawDamage <= 0 → 0.

Следствие:
- броня выше 80% не даёт дополнительной защиты;
- positive volley всегда наносит минимум 1 effective damage.

### 5.7 HP pool → count

src/domain/combat/resolver.ts: 296-298

**count = hpPool <= 0 ? 0 : ceil(hpPool / lifePerUnit)**

Частично повреждённая последняя единица считается живой.

### 5.8 Repair

src/domain/repair/workshop.ts: 198-200

**recoverable = Math.round(max(0, destroyed) × 0.5)**

Округление выполняется **per entity stack**, half-up для положительных .5.

Примеры:
- 1 destroyed → 1 repairable;
- 2 → 1;
- 3 → 2;
- 5 → 3.

Это подтверждённое текущее правило, не автоматически объявляемая ошибка.

### 5.9 Resource points lost

src/domain/combat/battle-points.ts: 31-51

**resourcePointsLost = destroyed × (metal + minerals + gas) / 1000**

Solar satellite исключается.

Это формула **battle points cost**, а не debris.

### 5.10 Battle points

Winner:

**BPwinner = round(loserLoss × sqrt((loserLoss + winnerLoss/2) / (loserLoss - winnerLoss/2)))**

при положительном denominator, иначе 0.

Loser:

**BPloser = round(winnerLoss × sqrt(max(0,(loserLoss - winnerLoss/2)/(loserLoss + winnerLoss/2))))**

На draw сторона с меньшими resource losses временно считается formulaWinner; при равенстве attacker.

### 5.11 Debris

**Формула не найдена.**

CombatResolver намеренно возвращает:

- experience = undefined
- debris = undefined
- resources = undefined
- repairEligibility = undefined

Подтверждение:
- src/domain/combat/resolver.test.ts: 313-333

Поэтому проверить:
- 30%;
- округление 30%;
- исключение gas;
- debris от ships;
- debris от defense;
- debris от commanders;
- double-counting recycling

**невозможно по текущей реализации — generation механики нет.**

---

## 6. Ship levels

Источник:
- src/domain/combat/config.ts: 6-13
- src/domain/combat/resolver.ts: 225-264
- src/domain/combat/combat-v3.test.ts: 30-63

| Ordinary class | coeff / level | lvl 10 multiplier без tech |
| --- | ---: | ---: |
| scout | 0.05 | 1.50× |
| cruiser | 0.08 | 1.80× |
| defender | 0.08 | 1.80× |
| battleship | 0.08 | 1.80× |
| destroyer | 0.11 | 2.10× |
| bomber | 0.10 | 2.00× |

Level влияет на:
- attack;
- life.

Level **не влияет** в CombatResolver на:
- armor;
- accuracy;
- speed;
- cargo;
- fuel;
- target priority.

Проверенный пример из штатного test:
- Aegis scout lvl 0, count 10:
  - attackPerUnit 800
  - totalAttack 8000
- Aegis scout lvl 10:
  - attackPerUnit 1200
  - totalAttack 12000
  - lifePerUnit 3600

### Все расы

src/domain/combat/factions.ts:
- aegis → Астеры
- synod → Илары
- veyra → Рой

Level coefficient определяется canonical ordinary class и одинаков по правилу для трёх рас, но base stats faction-specific.

Примеры из faction tests:
- Aegis scout base attack = 800
- Synod scout base attack = 800
- Veyra scout base attack = 400
- Synod destroyer base attack = 18200

Следовательно один и тот же level multiplier даёт разный absolute stat.

### Service/civil level anomaly

Service/civil ships проходят validation как kind=ship, но не имеют ordinaryClass level coefficient.

То есть сейчас возможна странная комбинация:
- корабль участвует в бою;
- level можно хранить в ship stack;
- level combat coefficient = 0.

Это усиливает конфликт eligibility, описанный ниже.

---

## 7. Bot 01 levels

Источник:
- src/domain/espionage/fixtures.ts: 20-47
- src/domain/espionage/runtime.test.ts: 49-93

Bot 01:
- faction: veyra;
- transporter level 5;
- mega-transporter level 6;
- cruiser level 4;
- battleship level 2;
- остальные upgradable hull levels детерминированно seeded в диапазоне 0..10;
- Hunter level 20;
- Judge level 1;
- остальные commander levels 0.

Owner-wide ship/science/commander profile единый для всех Bot 01 planets.

---

## 8. Technologies

Источник:
- src/domain/combat/technologies.ts: 5-154
- src/domain/science/catalog.ts: science 7, 10-12, 18-23

| Tech | Science | max | Реальный эффект |
| --- | ---: | ---: | --- |
| shipArmor | 7 | 20 | +10% base life / level |
| laserScience | 10 | 15 | +15% base attack / matching laser level |
| ionScience | 11 | 15 | +15% base attack / matching ion level |
| plasmaScience | 12 | 15 | +15% base attack / matching plasma level |
| piercingAttack | 18 | 10 | +5% base attack / level |
| maneuverDefense | 19 | 10 | +5% base life / level |
| criticalHit | 20 | 10 | +1 p.p. crit / level, crit ×2 |
| lightArmor | 21 | 10 | +1 armor p.p. / level |
| mediumArmor | 22 | 10 | +2 armor p.p. / level |
| heavyArmor | 23 | 10 | +3 armor p.p. / level |

### Порядок

Attack:
- base;
- ship level additive bonus;
- weapon/additional science additive bonus;
- floor per unit;
- затем round-start special/commander multiplier;
- floor снова;
- затем living count.

Life аналогично.

Armor:
- catalog armorStrength;
- matching armor science p.p.;
- special armor p.p.;
- enemy Judge debuff p.p.;
- clamp 0..80.

### Additional science exclusivity

Validation запрещает одновременно более одного:
- piercingAttack;
- maneuverDefense;
- criticalHit.

### Production vs calibration

Функции getTechnologyAttackMultiplier/getTechnologyLifeMultiplier/getTechnologyArmorPercent принимают mode, но mode в текущей формуле не меняет результат.

Это соответствует текущему evidence ledger, где source-backed и documented inferred rules активны в обоих execution modes.

---

## 9. Commanders

Источник:
- src/domain/combat/commanders.ts
- src/domain/combat/resolver.ts: 324-418, 810-926

### Боевые эффекты

| Commander | Combat effect | rate / lvl | lvl 40 | Status |
| --- | --- | ---: | ---: | --- |
| Executioner | own side attack | 0.15% | +6% | confirmed |
| Juggernaut | own side life | 0.15% | +6% | confirmed |
| Judge | enemy armor debuff | 0.15 p.p. | -6 p.p. | confirmed |
| Viper | crit chance | 0.075 p.p. | +3 p.p. | confirmed |
| Scorpion | paralyze | 0.1% | 4% | confirmed |
| Phantom | cancel attack | 0.75% | 30% | inferred |
| Reanimator | recovery proc | 0.4% | 16% | inferred, cap 15 |

Catalog-only / no active combat effect:
- Corsair
- Hunter
- Typhoon
- Annihilator
- Argo
- Polias

Они всё равно могут быть combat stacks и имеют базовые commander combat stats.

### P1: commander priority ignored

Правильный helper существует:

- src/domain/combat/priority.ts: 64-70
- selectActiveCommander(priority, presentCommanderIds)

Но resolver использует другое:

- src/domain/combat/resolver.ts: 918-926

Фактически:

    if requested valid:
      requested
    else:
      available[0]

Параметр priority называется _priority и не используется.

#### Минимальный пример

Priority:
- Judge
- Executioner
- Juggernaut

Available:
- [Executioner, Judge]

Ожидаемый fallback по priority:
- Judge

Фактический:
- Executioner

Если поменять только порядок массива:
- [Judge, Executioner]

фактический active commander меняется на Judge.

**Результат зависит от порядка объектов в input array**, хотя для этой задачи существует отдельная priority-модель.

### Почему тест не поймал

resolver.test проверяет «independent priority», но в сценарии на каждой стороне присутствует только по одному commander; priority ничего не выбирает.

Нужен test с минимум двумя живыми commander types и activeCommanderId = null/undefined.

---

## 10. Special bonuses

Источник:
- src/domain/combat/faction-catalog.ts: 69-113
- src/domain/combat/resolver.ts: 324-418

| Faction/entity | Effect | rate per living donor | cap | status |
| --- | --- | ---: | ---: | --- |
| aegis defender | life | 0.05% | 30% | confirmed |
| aegis battleship | armor | 0.038% | unknown | inferred |
| synod defender | life | 0.075% | 30% | confirmed |
| synod battleship | armor | 0.025% | 30% | confirmed |
| synod destroyer | attack | 0.09% | 80% | confirmed |
| veyra cruiser | life | 0.05% | 30% | inferred |
| veyra battleship | armor | 0.018% | unknown | inferred |

Правило:
- bonus фиксируется по living count в начале раунда;
- donor не получает свой bonus;
- остальные living allied stacks получают;
- recompute каждый раунд;
- неизвестный cap остаётся infinite в runtime.

Primary source этих записей указывает на отсутствующий ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md, поэтому source-level независимая верификация невозможна.

---

## 11. Расчёт одного раунда и порядок операций

1. Пересчёт round-start modifiers от base stats.
2. Снимок counts/hp в начале round.
3. Special bonus telemetry events.
4. Attacker phase.
5. Для каждого attacker stack в sortRuntime order:
   - ship;
   - commander;
   - defense;
   - дальше catalog order.
6. Если stack уничтожен до своей очереди → skipped status.
7. Если Scorpion paralysis pending → пропуск ближайшей атаки.
8. Если enemy active Phantom → RNG draw перед атакой каждого living actor stack.
9. Если attackPerUnit <= 0 → no-attack.
10. Deterministic target selection.
11. Attack:
    - baseAttack;
    - matchup;
    - critical draw;
    - armor;
    - hpPool;
    - count via ceil.
12. Если own active Scorpion → RNG draw после каждой выполненной атаки.
13. Reanimator phase.
14. determineWinner.
15. Если defender ещё жив → полностью аналогичная defender phase.
16. determineWinner.
17. Round snapshots / summary.

### Существенное следствие

Attacker действует первым. Если он полностью уничтожил defender в своей фазе:
- defender phase не происходит;
- уничтоженные defender stacks не отвечают.

Это подтверждено тестами.

---

## 12. Target selection

src/domain/combat/resolver.ts: 195-222

### threat

1. current threat desc;
2. population desc;
3. catalog order;
4. entityId lexical.

Threat передаётся как:

**currentCount × attackPerUnit**

То есть меняется после потерь.

### population

1. current population desc;
2. threat desc;
3. catalog order.

### catalog

1. catalog order;
2. threat;
3. fallback.

Target выбирается заново перед каждой атакой, поэтому есть dynamic retarget.

Provenance repo: **not-calibrated**.

---

## 13. RNG

src/domain/combat/resolver.ts: 107-150

Seed:
- hash: FNV-like 32-bit;
- stream: xorshift32;
- algorithmVersion: asterion-xorshift32-v1.

Без seed:
- Math.random;
- mode = non-replayable.

RNG используется для:
- critical;
- Phantom;
- Scorpion;
- Reanimator.

RNG **не используется** для:
- target choice;
- base random damage range;
- independent destruction roll.

### Независимый audit sweep

Временный read-only script был запущен вне репозитория:

    python /mnt/data/combat_audit_sweep.py

Он повторил опубликованные формулы, не импортируя код репозитория.

Проверено:
- 54 комбинации class × level × technology bonus;
- 36 matchup pairs;
- 8 armor boundary cases;
- 11 repair rounding cases;
- 500000 RNG draws по chance boundaries;
- 2 commander fallback order cases.

RNG results:

| chance | trials | hits | observed |
| ---: | ---: | ---: | ---: |
| 0% | 100000 | 0 | 0.000% |
| 1% | 100000 | 1011 | 1.011% |
| 50% | 100000 | 50322 | 50.322% |
| 99% | 100000 | 98977 | 98.977% |
| 100% | 100000 | 100000 | 100.000% |

Две последовательности по 20 draws с одинаковым seed полностью совпали.

Примечание:
- при critical chance = 0 resolver вообще не делает critical RNG draw;
- 100% после clamp всегда proc.

### P3: stale RNG provenance note

createNonReplayableCombatRng() содержит note, что current baseline random mechanics inactive, но в v3 RNG реально используется critical/commander effects.

Это telemetry/documentation defect, не damage defect.

---

## 14. Раунды и завершение боя

Supported:
- 5
- 8
- 12

Validation:
- src/domain/combat/simulator.ts: 368-371

Loop:
- src/domain/combat/resolver.ts: 990+

Правила:
- одна сторона уничтожена → бой прекращается досрочно;
- обе живы после maxRounds → draw;
- attacker zero → defender;
- defender zero → attacker;
- обе zero → determineWinner вернул бы draw.

### Но empty sides

validateCombatInput запрещает запуск, если:
- attacker не имеет ни одного ship/commander stack;
- defender не имеет ни ship/commander/defense stack.

Поэтому нормальный resolveCombat не стартует с пустой стороной.

### Simultaneous destruction

В текущем resolver:
- sequential attacker-first;
- нет self-damage;
- нет simultaneous exchange.

Поэтому обе стороны не могут естественно стать zero от одного и того же combat action.

**Сценарий «уничтожение обеих сторон» текущей механикой практически недостижим.**

---

## 15. Все типы результатов

Фактически подтверждены actual resolver golden fixtures:

- attacker victory;
- defender victory;
- draw.

Источник:
- src/domain/combat/combat-golden-fixtures.ts
- src/domain/combat/combat-v2.test.ts: 327+

Golden cases:
- Death Star vs Scout → attacker;
- Scout vs Death Star → defender;
- Corsair vs Corsair при лимите → draw.

Также тесты покрывают:
- defense как отдельный bucket;
- commander/no commander;
- three factions;
- level effect;
- independent/shared sciences;
- attacker-first destroyed stack skip.

Не покрыты отдельным meaningful outcome test:
- 8 vs 12 rounds на одинаковом входе;
- simultaneous destruction;
- empty side resolution, потому что validation запрещает;
- Reanimator + defense-only losses;
- multi-commander fallback priority;
- full Bot 01 main planet с Hunter+Judge через handoff.

---

## 16. P1: Service/civil eligibility противоречит спецификации репозитория

Evidence ledger:

- docs/evidence/combat-evidence-ledger.md, строка Combat eligibility

утверждает:

**service/civil ships должны отклоняться combat validation.**

Но current test:

- src/domain/combat/combat-v3.test.ts: 65-83

прямо фиксирует:

**service and civil ships remain selectable and participate in combat**

Список:
- solar-satellite
- spy-probe
- transporter
- mega-transporter
- colonizer
- recycler

Test проверяет:
- validation.ok = true;
- каждый делает attack;
- attackPerUnit > 0.

### Вердикт

Это **подтверждённое внутреннее противоречие** между документацией/evidence и current code/test.

Без отсутствующего implementation brief нельзя честно выбрать, какой вариант является каноническим. Но состояние «оба одновременно правильны» невозможно.

---

## 17. P1: Spy report handoff теряет Hunter

Источник:
- src/application/flights.ts: 530-567
- src/application/simulator-handoff.ts: 24-27, 55, 73-76
- src/domain/espionage/fixtures.ts: 118-125

Полный spy report сохраняет targetCommanders.

Для Bot 01 main planet:
- Hunter level 20, count 1;
- Judge level 1, count 1.

Но commandersFromReport():

    entityId === 'hunter' ? []

жёстко удаляет Hunter.

Итог:
- spy report: Hunter + Judge;
- simulator scenario: только Judge.

### Почему это влияет на бой

Hunter как commander catalog entity имеет:
- attack 2000;
- life 20000;
- medium armor;
- count 1.

Даже если ability Hunter catalog-only и не даёт combat modifier, сам commander ship является living combat stack и стреляет.

### Тестовый пробел

Existing handoff test проверяет:
- attacker Hunter level сохранён;
- defender Judge level сохранён.

Но не проверяет defender Hunter.

---

## 18. P1: Defender technologies при spy handoff

src/application/simulator-handoff.ts: 50-53

Defender technologies:

    state.espionage?.bot01Profile
      ? technologiesFromLevels(bot01Profile.scienceLevels)
      : default zero technologies

SpyReportSnapshot не содержит defender science snapshot:
- src/domain/espionage/types.ts: 85-109

bot01Profile помечен как test-only:
- src/domain/espionage/types.ts: 157-158

### Следствие

Для Bot 01 Test Mode:
- technologies корректно восстанавливаются из известного fixture owner profile.

Для generic production spy target:
- report не хранит science levels;
- bot01Profile отсутствует;
- defender получает **нулевые combat technologies**.

Следовательно simulator handoff не может воспроизвести реальную defender science конфигурацию production target.

---

## 19. P2: Reanimator может восстановить defense

Описание ability:
- «восстановить потерянные корабли».

Но resolveReanimator():

- src/domain/combat/resolver.ts: 810-839

получает весь side RuntimeStack[] и выбирает:

    first stack where
      count > 0
      startingCount > count

Фильтра по:
- kind === ship;
- bucket === stacks

нет.

На defender стороне RuntimeStack[] содержит:
- ships;
- commanders;
- defenses.

Следовательно damaged defense stack может стать target Reanimator.

Поскольку Reanimator effect помечен inferred и primary brief отсутствует, это классифицировано как **P2 + требуется решение владельца**, а не как доказанный P1 parity defect.

---

## 20. Потери и repair

### Defender losses

src/application/repair.ts: 223-304

Применяются:
- defender ordinary ships;
- solar satellites;
- defenses.

Commander kind в applyDestroyed отдельно не обрабатывается.

### Repair eligibility

Только:
- missionType = defense;
- local player = defender.

В repair pool попадают:
- destroyed ordinary ships;
- repairable defenses.

Не попадают:
- commanders;
- non-repairable shields.

### Idempotency

applyBattleResult:
- ищет report.id в state.combat.reports;
- если отчёт уже есть, defender losses повторно не снимаются.

claimDefensiveBattleRepair:
- хранит claimedBattleIds;
- второй claim того же report.id ничего не добавляет.

Это подтверждено tests.

### Ограничение idempotency

Идемпотентность опирается на **report.id**.

Если один физический бой ошибочно породит два разных reportId, текущая защита не сможет понять, что это один бой.

Production producer, который гарантирует один stable battle/report id, в текущем flight flow отсутствует.

---

## 21. P1: Attacker losses и возврат выживших не применяются

applyBattleResult() применяет только:

**applyOwnedDefenderLosses**

Нет симметричной transition-функции для attacker flight inventory.

Одновременно:
- attack/raid flight runtime не поддержан.

Следовательно сейчас нельзя подтвердить:
- снятие attacker destroyed ships из отправленного флота;
- возврат survivors;
- возврат surviving commanders;
- возврат cargo;
- повторное применение/неприменение attacker losses.

Это не проблема snapshot внутри resolver; это отсутствующий production integration layer.

---

## 22. Debris, loot, resource outcome

BattleReport type допускает:
- debris;
- resources;
- experience.

Но resolver их не создаёт.

Demo fixtures имеют такие значения как presentation/test data и не являются evidence формулы.

### Ответы на обязательные вопросы

| Проверка | Результат |
| --- | --- |
| 30% debris | формула не найдена |
| rounding 30% | невозможно подтвердить |
| gas excluded from debris | невозможно подтвердить |
| ship debris | не реализовано resolver |
| defense debris | не реализовано resolver |
| commander debris | не реализовано resolver |
| zero losses → zero debris | не вычисляется |
| stolen resources | не вычисляется |
| duplicate debris fields | production generation отсутствует, поэтому double-count сейчас не доказан |

Важно:
battle-points cost **включает gas**. Это нормально только потому, что battle points ≠ debris.

---

## 23. Battle report vs resolver

Совпадают / source-backed runtime snapshot:
- winner;
- roundCount;
- stack countBefore/countAfter;
- destroyed;
- effective stats;
- technologies;
- activeCommander;
- RNG provenance;
- rounds/events.

Не создаются resolver:
- experience;
- debris;
- resources;
- repairEligibility до application layer.

### P3: armor special bonus display ×100

Runtime special armor bonus:

src/domain/combat/resolver.ts:
- stored specialBonusAmount = fractional ratio;
- applied armor bonus = amount × 100 percentage points.

Resolver note корректно форматирует amount × 100 p.p.

Но:
- src/domain/combat/battle-report-view-model.ts: 627-633

для armor выводит:

    specialBonusAmount p.p.

без ×100.

Пример:
- amount = 0.01;
- реально применяется +1 p.p.;
- analysis UI показывает 0.01 p.p.

Это **display/report analysis defect**, не ошибка combat math.

---

## 24. Commander/application order dependence

Для ordinary stacks:
- sortRuntime нормализует action order;
- target selection deterministic.

Но active commander fallback:
- зависит от input commander array order.

Это подтверждено независимым structural sweep:

Same priority:
- Judge > Executioner > Juggernaut

Input:
- [Executioner, Judge] → chosen Executioner
- [Judge, Executioner] → chosen Judge

То есть одинаковый набор commander IDs с разным порядком массива способен изменить combat modifier и outcome.

---

## 25. Большая серия вариаций

### 25.1 Реальный repository test suite

На audited commit GitHub Actions run:
- run id: **35599178002**
- event: push
- conclusion: success

Combat domain tests:
- tests: 122
- pass: 122
- fail: 0
- skipped: 0

Команда:

    npm run test:combat

Это подтверждает отсутствие регрессии относительно **существующих assertions**, но не доказывает правильность самих правил.

### 25.2 Independent formula sweep

Вне репозитория:
- 54 level/tech cases;
- 36 matchup cases;
- 8 armor boundary cases;
- 11 repair rounding cases;
- 500000 seeded RNG boundary draws;
- commander fallback order cases.

Итого deterministic arithmetic cases без RNG trials:
- **111+ структурных/числовых комбинаций**.

### 25.3 Что sweep подтвердил

- level curve монотонна по текущей формуле;
- level и technology additive;
- all 36 matchup entries дают только 0.7/1/1.7;
- armor clamp работает до 80;
- same seed replay identical;
- percentage threshold draw < chance ведёт себя ожидаемо;
- repair half-up даёт 1→1;
- commander fallback order-dependent.

### Ограничение

Через GitHub connector нельзя было запустить новый временный TS script внутри checkout без коммита.

Поэтому custom mass sweep не импортировал реальный resolver module; он **независимо повторял формулы из проверенного source**. Реальный module execution подтверждён существующим CI suite и golden fixtures.

---

## 26. Минимальные воспроизводимые примеры проблем

### P1-01 Commander priority ignored

**Файлы**
- src/domain/combat/priority.ts: 64-70
- src/domain/combat/resolver.ts: 918-926, 965-966

**Причина**
- resolver игнорирует _priority.

**Repro**
- 2 commanders;
- activeCommanderId null;
- priority ставит второго первым;
- поменять array order.

**Expected**
- active commander = first present ID из priority.

**Actual**
- active commander = available[0].

**Рекомендуемое исправление**
- использовать существующий selectActiveCommander(priority, available) для fallback.

---

### P1-02 Civil/service eligibility conflict

**Файлы**
- docs/evidence/combat-evidence-ledger.md
- src/domain/combat/combat-v3.test.ts: 65-83
- src/domain/combat/simulator.ts: 270-335

**Причина**
- validation проверяет только kind=ship и не имеет combat eligibility gate.

**Expected по ledger**
- service/civil rejected.

**Actual**
- участвуют и стреляют.

**Рекомендуемое исправление**
- сначала владелец игры должен подтвердить канон;
- затем либо вернуть combatEligible filter, либо обновить ledger/spec и осознанно оставить участие.

---

### P1-03 Attack/raid runtime не подключён

**Файл**
- src/application/flights.ts: 724-730

**Actual**
- mission-not-supported.

**Expected для полного production combat**
- dispatch → arrival → resolver → apply losses → return survivors.

**Рекомендуемое исправление**
- отдельная production battle mission state machine, не patch внутри resolver.

---

### P1-04 Defender Hunter теряется в spy handoff

**Файл**
- src/application/simulator-handoff.ts: 24-27

**Actual**
- Hunter принудительно excluded.

**Expected**
- если commander ship присутствует в full report и является combat stack, он должен сохраниться.

**Рекомендуемое исправление**
- не фильтровать Hunter как commander combat entity, если game design явно не требует обратного;
- добавить test Bot 01 Hunter + Judge.

---

### P1-05 Generic defender sciences теряются в spy handoff

**Файлы**
- src/application/simulator-handoff.ts: 50-53
- src/domain/espionage/types.ts: 85-109, 157-158

**Actual**
- Bot01 fixture sciences либо zero defaults.

**Expected**
- owner-specific science snapshot, если simulator должен воспроизводить реальный spy target.

**Рекомендуемое исправление**
- добавить permitted combat science snapshot в full spy report либо другой authoritative owner-profile lookup.

---

### P1-06 Debris/loot отсутствуют

**Файлы**
- src/domain/combat/report.ts
- src/domain/combat/resolver.test.ts: generated report without fake outcomes

**Actual**
- undefined.

**Expected**
- требуется отдельное game-design/source решение по 30%, gas exclusion, defense/commander scope и loot.

**Рекомендуемое исправление**
- не добавлять формулу до появления подтверждённого правила;
- после решения сделать отдельный pure outcome module + tests.

---

### P1-07 Attacker state transition отсутствует

**Файл**
- src/application/repair.ts: 223-345

**Actual**
- применяется только defender ownership transition.

**Expected**
- destroyed attacker units не возвращаются; survivors возвращаются ровно один раз.

**Рекомендуемое исправление**
- реализовать вместе с attack/raid flight state machine и stable battle id.

---

### P2-01 Reanimator может выбрать defense

**Файл**
- src/domain/combat/resolver.ts: 810-839

**Причина**
- target filter не ограничивает kind.

**Рекомендуемое исправление**
- после подтверждения механики фильтровать допустимые target kinds.

---

### P3-01 Armor special bonus отображается в неверном масштабе

**Файлы**
- src/domain/combat/resolver.ts: special bonus apply/event
- src/domain/combat/battle-report-view-model.ts: 627-633

**Expected**
- amount × 100 p.p.

**Actual UI analysis**
- amount p.p.

**Рекомендуемое исправление**
- armor branch formatter должен умножать fractional amount на 100.

---

### P3-02 Non-replayable RNG note устарел

**Файл**
- src/domain/combat/resolver.ts: createNonReplayableCombatRng

**Actual**
- note сообщает, что random mechanics baseline inactive.

**Но**
- critical/Phantom/Scorpion/Reanimator реально consume RNG.

**Рекомендуемое исправление**
- обновить telemetry note.

---

## 27. Expected vs actual

| Тема | Expected / repo contract | Actual |
| --- | --- | --- |
| Commander fallback | priority order | first item in array |
| Civil/service | ledger: reject | validation accepts, combat attacks |
| Hunter from full spy report | preserve combat composition | removed |
| Defender sciences from generic spy | owner-specific | Bot01 fixture or zero |
| Attack/raid | production battle flow | mission-not-supported |
| Attacker losses | apply once and return survivors | no production transition |
| Debris | confirmed formula needed | no formula |
| Loot | confirmed formula needed | no formula |
| Reanimator target | wording says lost ships | any damaged runtime stack incl defense |
| Armor bonus analysis | ratio ×100 p.p. | ratio shown directly p.p. |

---

## 28. Отсутствующие тесты

Минимально нужны:

1. Multi-commander fallback respects CombatPriorityState.
2. Same commander set in different array order produces same active commander.
3. Explicit test deciding service/civil combat eligibility against canonical spec.
4. Spy handoff preserves defender Hunter if Hunter is combat-eligible.
5. Generic non-Bot spy handoff preserves defender sciences.
6. Reanimator cannot/can restore defense — explicit owner-approved assertion.
7. Reanimator target selection across ship/commander/defense losses.
8. Critical boundaries 0%, 1%, 50%, 99%, 100%.
9. Seeded full-battle replay equality with active RNG effects, not only RNG generator equality.
10. 5/8/12 same input comparison.
11. All three races × all six ordinary classes × level 0/1/max.
12. All technology max boundaries.
13. All implemented commanders at 0/1/40.
14. Input-order invariance for stacks and commanders.
15. Debris generation tests после утверждения formula.
16. Gas exclusion debris test после утверждения formula.
17. Commander/defense debris scope tests.
18. Attack/raid application idempotency.
19. Attacker survivor return exactly once.
20. Stable battle id prevents duplicated losses/loot/debris.
21. UI analysis armor special-bonus scale.
22. Repair edge 1 destroyed explicitly documented, если half-up остаётся каноном.

---

## 29. Вопросы, которые требуют решения владельца игры

1. Service/civil ships должны участвовать в combat или ledger прав?
2. Hunter как commander ship должен оставаться в боевом составе после spy report?
3. Reanimator восстанавливает только ordinary ships, любые ships+commanders или ещё defense?
4. Должны ли commander ships попадать в defensive repair pool?
5. 50% repair считается per stack с Math.round, включая 1→1, или нужен aggregate/floor?
6. Какова точная debris formula?
7. Даёт ли defense debris?
8. Даёт ли commander debris?
9. Газ точно исключается из debris и на каком этапе округление?
10. Как считается raid/attack loot и caps?
11. Что должно происходить при theoretical simultaneous destruction?
12. Должен ли maxRounds draw зависеть от remaining power/population или всегда draw?
13. Должны ли production/calibration реально различаться математически?
14. Как трактовать inferred matchup matrix и special bonus caps после появления первичного calibration corpus?

---

## 30. Источники, недоступные в текущем репозитории

### 30.1 ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md

Множество provenance записей ссылается на:

**ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md**

Файл запрошен по audited commit через GitHub и получил 404.

**Источник недоступен в текущем репозитории.**

### 30.2 Nemexia external archive

docs/evidence/combat-evidence-ledger.md прямо пишет, что Nemexia archive остаётся external read-only evidence.

По ограничению этого аудита внешние репозитории/папки не использовались.

**Источник недоступен в текущем репозитории.**

### 30.3 D:\Desktop\Nemexia\simulation-battles

В текущем репозитории такого источника нет.

**Источник недоступен в текущем репозитории.**

### 30.4 simulation-battles corpus

В recursive tree текущего Asterion не найден отдельный simulation-battles corpus с внешними Nemexia прогонами.

Есть:
- simulator code;
- combat fixtures;
- golden fixtures;
- QA artifacts.

Но это не заменяет внешний calibration corpus.

---

## 31. Проверенные файлы

Основные source:
- src/domain/combat/resolver.ts — RNG, target selection, stats, modifiers, attacks, abilities, rounds, report
- src/domain/combat/simulator.ts — input model, normalization, validation, scenario handoff
- src/domain/combat/config.ts — coefficients, caps, rounds, provenance
- src/domain/combat/technologies.ts — all combat technology formulas
- src/domain/combat/commanders.ts — commander catalog/effects
- src/domain/combat/priority.ts — commander priority
- src/domain/combat/catalog.ts — canonical combat entities
- src/domain/combat/faction-catalog.ts — faction mechanics/special bonuses
- src/domain/combat/faction-ship-data.ts — faction ship mechanics source registry
- src/domain/combat/factions.ts — 3 races
- src/domain/combat/report.ts — BattleReport schema
- src/domain/combat/battle-points.ts — resource loss / battle points
- src/domain/combat/battle-report-view-model.ts — report display calculations
- src/domain/combat/battle-repository.ts — report persistence/id de-dup
- src/domain/combat/simulator-repository.ts — simulator persistence/migration
- src/domain/combat/combat-golden-fixtures.ts
- src/domain/combat/battle-fixtures.ts

Application:
- src/application/combat.ts
- src/application/repair.ts
- src/application/flights.ts
- src/application/simulator-handoff.ts
- src/App.tsx

Repair:
- src/domain/repair/workshop.ts

Espionage:
- src/domain/espionage/fixtures.ts
- src/domain/espionage/types.ts
- src/domain/espionage/runtime.ts

Science/upgrades:
- src/domain/science/catalog.ts
- src/domain/buildings/spaceport-upgrades.ts

Tests:
- src/domain/combat/resolver.test.ts
- src/domain/combat/combat-v2.test.ts
- src/domain/combat/combat-v3.test.ts
- src/domain/combat/factions.test.ts
- src/domain/combat/priority.test.ts
- src/domain/combat/report.test.ts
- src/domain/combat/battle-points.test.ts
- src/domain/combat/battle-report-view-model.test.ts
- src/domain/combat/technologies.test.ts
- src/domain/combat/technology-resolver.test.ts
- src/domain/repair/workshop.test.ts
- src/application/espionage.test.ts
- src/domain/espionage/runtime.test.ts

Docs/CI:
- docs/evidence/combat-evidence-ledger.md
- docs/audits/PHASE_8_BATTLE_REPORT_AUDIT.md
- package.json
- .github/workflows/ci.yml

---

## 32. Команды и проверки

### GitHub Actions на audited commit

Run:
- **35599178002**
- conclusion: success

Ключевая команда:

    npm run test:combat

Результат:
- 122 tests
- 122 pass
- 0 fail
- 0 skipped

CI также успешно прошёл build и остальные QA jobs/steps этого run.

### Independent audit calculation

Временный script вне repo:

    python /mnt/data/combat_audit_sweep.py

Использовался только для независимой перепроверки извлечённых формул и RNG boundary behavior.

Script не добавлялся в repository.

### Что не запускалось

Полный local checkout Asterion в auditor sandbox не использовался для npm execution; фактическое выполнение repository tests подтверждено exact GitHub Actions run для audited commit.

---

## 33. Финальный список проблем по приоритету

### P0

Нет подтверждённых.

### P1

1. Commander priority fallback игнорируется resolver.
2. Service/civil combat eligibility противоречит repository evidence contract.
3. Attack/raid не подключены к flight runtime.
4. Spy handoff удаляет defender Hunter.
5. Generic production spy handoff не имеет defender science snapshot.
6. Debris/loot outcomes отсутствуют.
7. Attacker loss/return production transition отсутствует.

### P2

1. Reanimator может target defense несмотря на формулировку про ships.
2. Repair 50% half-up даёт 1→1; это нужно явно подтвердить как design rule, а не исправлять автоматически.
3. Simultaneous destruction semantics фактически недостижимы и не зафиксированы.

### P3

1. Armor special bonus в analysis view показан в 100 раз меньшем p.p. масштабе.
2. Non-replayable RNG provenance note устарел.

---

## 34. Что можно считать надёжно подтверждённым

По текущему коду и тестам можно уверенно утверждать:

- ordinary ship level влияет на attack/life по опубликованным coefficients;
- group count масштабирует per-unit stats;
- technologies реально меняют combat stats, а не только report;
- active implemented commanders реально меняют бой;
- armor mitigation clamp/floor работает как описано;
- target selection deterministic;
- seeded RNG replayable;
- attacker acts before defender;
- destroyed stack не стреляет;
- 5/8/12 принимаются как round limits;
- victory/defeat/draw формируются;
- defender repair/application защищены report-id idempotency;
- battle points считаются отдельной реализованной формулой.

Нельзя подтверждать:

- полную Nemexia parity;
- корректность inferred matchup/special/commander rules против первичного calibration source;
- debris 30%;
- gas exclusion in debris;
- loot;
- full attack/raid lifecycle;
- attacker survivor return;
- production defender sciences from generic spy report.

---

## 35. Финальный вердикт

**Для симулятора:** использовать можно, но с оговоркой, что несколько правил являются Asterion reconstruction/inferred и есть подтверждённые composition/priority defects.

**Для production боя:** считать систему законченной нельзя. Resolver сам по себе значительно готовее, чем окружающий lifecycle.

Перед реализацией следующего слоя приоритет исправлений разумно такой:

1. P1 commander priority.
2. Решение владельца по service/civil eligibility.
3. Исправление spy handoff: Hunter + defender science source.
4. Подключение attack/raid flight lifecycle с stable battle id.
5. Attacker loss/survivor return.
6. Отдельно после подтверждения правил — debris/loot.
7. Затем Reanimator edge cases и P3 report issues.

Решение о merge/изменении механик этим аудитом **не принималось**.
