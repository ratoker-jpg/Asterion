# PR91 balance evidence — reproducible real battles and explicitly modeled resource returns

> **STATUS: seeded combat DID RUN; complete balance acceptance is still open.** Previous [CI run 38801755663](https://github.com/ratoker-jpg/Asterion/actions/runs/38801755663) executed **324 real production-resolver battles** on the OLD flat-tier pirate technology model, with lost hull value, fuel and modeled recycling. [Download the retained evidence artifact](https://github.com/ratoker-jpg/Asterion/actions/runs/38801755663/artifacts/12005360940). It is historical pre-percentage evidence, **not** proof that the approved 90%/100% per-science technology scale is balanced. New matched-seed before/after simulations and a refreshed 324-case suite are attached to CI on the current PR. Only a passing job's artifact constitutes observed results; do not invent outcome numbers.

## Deterministic analytical raid-count estimates (NOT simulations)

Assumptions from approved design: ~18.8 active contact opportunities per system-day, one Bernoulli chance per owner-contact, independent systems, no daily throttle. Expected counts = 18.8 × days × systems × p.

| Per-base pRaid | Systems | Expected launches / 8h | Expected launches / 24h |
|---:|---:|---:|---:|
| 2.0% | 1 | 0.125 | 0.376 |
| 2.0% | 2 | 0.251 | 0.752 |
| 2.0% | 3 | 0.376 | 1.128 |
| 13.2% | 1 | 0.827 | 2.482 |
| 13.2% | 2 | 1.654 | 4.963 |
| 13.2% | 3 | 2.482 | 7.445 |
| 30.0% | 1 | 1.880 | 5.640 |
| 30.0% | 2 | 3.760 | 11.280 |
| 30.0% | 3 | 5.640 | 16.920 |

The numbers estimate launches, **not victories, casualties, resource loss or guaranteed observations**. Actual generator, successful owner contacts and destroyed bases change the number of checks.

## Recycling theoretical capacity (NOT measured jobs)

| New L10 concurrent jobs | Effective debris/sec | 16m debris | 160m debris |
|---:|---:|---:|---:|
| 1 | 980 | ≈4h32m | ≈45h21m |
| 10 | 9,800 | ≈27m13s | ≈4h32m |

These omit orbital collection, recycler cargo, flight and transport times. Recycling output efficiency remains 75–120% by existing levels; 10 parallel jobs must be separately scheduled. Job data captured before the rate update is not recomputed.

## Actual seeded runs, scripts, and completeness

- **Verified historical results (old technologies):** [CI 38801755663](https://github.com/ratoker-jpg/Asterion/actions/runs/38801755663), **324 combat executions**, 18 combinations of direction/faction/score ×18 observations each (three technology bands × six seeded cases). This code exercise includes real combat winner, destroyed hulls, orbital debris, cargo-limited recycling ledger, replacement costs and the canonical gas fuel formula. Recycler flight scheduling and physical availability of transport assets were modeled, not executed as in-game saved flights; reported `net75/net120` are optimistic full-recovery projections.
- **Updated approved pirate technology scale:** `npm run balance:pirates:pr91` re-executes the full seed corpus with levels scaled as `Math.round(maxLevel * tier / 10)` for the ten combat sciences. Its outputs are `artifacts/pr91-balance/seeded-results.json` and `seeded-report.md` in the corresponding CI artifact.
- **Controlled old/new comparison:** `npm run balance:pirates:pr91:approved` (script `tools/generate-pirate-pr91-approved-compare.mjs`) replays paired battles using the **same combat seed and same garrison**, changing **only pirate technology levels**. Dataset dimensions: three races × resource points 3m/3.5m × exact player population 25,090/25,112 × destroyer L0/L10 × 0/2 controlled Planet Breakers × old/approved scales = **96 actual combat resolver calls (48 pairs)**. The garrison is capped to its original approved 75–90% population budget; controlled two-breaker variants replace ordinary hulls rather than adding extra population. Destroyer-centric rosters have only tiny scout filler to hit exact requested population. All fights use 12-round ceilings and no commanders.
- **Per-pair evidence:** `artifacts/pr91-approved-tech-compare/comparison.json` and `comparison.md` contain attacker/pirate remaining population, rounds, effective pirate attack/life, victory, produced orbital debris, destroyed-hull replacement cost, outbound and recycler fuel, modeled recycled metal/minerals at 75% and 120%, modeled net and old→new deltas.
- **Limitation:** a paired controlled battle is **not** a measured production win rate, nor does it apply actual 10% special-ship probability. Neither source models every calendar event or storage cap, and nominal full-collection profit is **not** guaranteed spendable resources. Normal/counter raid probabilities must be weighted separately for expected incoming losses; raw paired cases are not weighted EV.

## Verified matched-seed old vs approved combat — [CI 38816770354](https://github.com/ratoker-jpg/Asterion/actions/runs/38816770354)

The **PR91 approved matched-seed comparison job passed** on commit `06976b26`, before this evidence-file update. The full CI run did **not** pass: an unrelated legacy attack test's hard-coded resource assumption failed and is under correction. Results below come from the completed comparison job, **not** inferred from a successful full workflow.

| Observed statistic | Old flat-tier technology | Approved %-of-max technology |
|---|---:|---:|
| Paired scenario wins, 48 each | 45 | 31 |
| Mean optimistic net at 75% recycling, resource-equivalent | +39,733,750.31 | −9,492,494.79 |
| Mean optimistic net at 120% recycling, resource-equivalent | +105,533,091.98 | +48,709,057.00 |

All 48 paired seeds share the same faction, population, no-commanders attacking composition, pirate garrison, ship levels, fixed controlled zero/two Planet Breakers, and max 12 rounds. The only before/after change was the NPC technology vector. This supports a significant balance effect **in these scenarios only**. The outcomes are not population-weighted likelihoods for spontaneous pirates and cannot establish an overall encounter expected value. Requested attack/life details, losses, debris, modeled collection, and per-case net are serialized in `artifacts/pr91-approved-tech-compare/comparison.json` and `comparison.md` in the corresponding CI artifact. These are **model upper bounds** given full debris availability. No garrison coefficient was changed in that *historical technology-only experiment*; the subsequent owner-approved 85–105% garrison patch is documented below.

## Owner-approved 85–105% pirate-elimination garrison — real paired evidence

[CI 38820098930](https://github.com/ratoker-jpg/Asterion/actions/runs/38820098930) **passed** `npm run balance:pirates:pr91:garrison`: **768 matched seed pairs, 1,536 production resolver calls**, before/after only the size of pirate *outgoing elimination base defense*. The full run failed on a separate incoming-pirate UI fixture timeout. The study uses one shared quantile draw `pirate-garrison-v2:seed`, real current pirate technologies for BOTH cohorts, 12 rounds, three races, 3/3.5m resource score, no commanders, 25,090/25,112 player population, destroyer L0/L10. 24 ordinary seeds and eight extra 2-forced-Planet-Breaker seeds per faction/score/population/level cell. The forced special case is not weighted by the 10% game chance.

| Outcome among 768 pairs | Old 75–90% | Approved 85–105% |
|---|---:|---:|
| Player wins | 543 (70.70%) | 335 (43.62%) |
| Draws | 35 (4.56%) | 28 (3.65%) |
| Pirate wins | 190 (24.74%) | 405 (52.73%) |
| Mean own population lost | 63.86% | 79.79% |
| Mean pirate hull debris | 54.29 million | 52.76 million |
| Mean own hull debris | 28.59 million | 35.72 million |
| Mean additional pirate debris bonus | 52.11 million | 37.16 million |
| Mean player lost-hull replacement costs | 100.33 million | 125.35 million |
| Mean optimistic net at recycler 75% | +0.60 million | −31.42 million |
| Mean optimistic net at recycler 120% | +61.35 million | +25.12 million |

In the winner-only multiplier ledger, old 274 cases ×2 and 269 cases ×2.5 become 170 ×2 and 165 ×2.5; remaining 225→433 cases receive ×1. This is the unchanged reward rule, not an edited coefficient.

**No invented profit:** the per-seed JSON includes actual winner/draw/loss, round count, fleet loss population distribution, wreckage by owner, multiplier, destroyed player hull value, canonical battle-flight fuel, modeled recycler flight gas and 75/120% conversion. The optimistic economic projection assumes all orbital wreckage is picked up, enough 10-recycler cargo trips and refinery storage/time; that is not a measured playable-wallet profit. It is **not** a population-weighted production likelihood. Low sample counts for the forced two-breaker condition are exploratory. Full individual case data and group means in `artifacts/pr91-garrison-85-105/comparison.json` and `comparison.md` under the CI artifact.

**Compatibility evidence:** real tests in `catalog-profile.test.ts` assert coefficient 0.85–1.05, both below/above 100% for 25,090/25,112 dispatches, deterministic ship populations and fixed 90% unseeded fallback. `pirate-combat.integration.test.ts` runs serialise→load→real arrival battle→report/reward→replay for both pre-patch 0.78 and new budgets. Mission validator takes [0.75,1.05] as the union of old [0.75,0.90] and new [0.85,1.05]. Narrow production validation permits a legitimate pirate-elimination defender above the former 35,000 population limit only within 105% of the actual attacker. Incoming raids remain at 90–95%, other coefficients unchanged.

## Still outstanding for final balance sign-off

- Confirm latest CI success and inspect current artifacts for all 96 pairwise combat results and 324 refreshed mixed encounters.
- Assess cases with high losses and 12-round stalemates without silently retuning combat, raid, salvage or technology coefficients.
- Verify actual 16m/160m orbital debris collection logistics in persisted flight circuits and mobile narrow-screen layout. Real saved recycling-job operations were covered by the general seeded run, but real fleet travel is still modeled here.
- Independent code audit of migration, old incoming 8-round raids, old outgoing 5/8 attack snapshots and anti-replay.

## Risk note

A ×2.5 multiplier applied to 60–80% base pirate salvage can produce salvage with a nominal value 150–200% of destroyed pirate metal+mineral costs **before** recycling, possibly making high-capacity victories inflationary. Net outcomes cannot be concluded without actual hull losses, flight gas and collection expenses. Approved balancing numbers were not silently changed.


## C follow-up: reduced pirate salvage and hidden adaptive population (supersedes prior reward estimates)

The earlier ×2.5 prize / fixed 85–105% garrison estimates above are **historical** and must not be treated as measured profitability of the current C balancing rules. The updated owner-approved live rules are:

| Sent vs historical max hangar | New victory multiplier | 120%-recycling gross return with living Corsair L40 (before own losses) |
|---|---:|---:|
| under 50% | ×0.7 | 67.2% of killed pirate metal+mineral costs |
| 50–84.99% | ×0.9 | 86.4% |
| 85–94.99% | ×1.0 | 96.0% |
| 95–99.99% | ×1.3 | 124.8% |
| exactly 100% | ×1.5 | 144.0% |
| draw, any size | ×0.75 | 72.0% |
| defeat, any size | ×0.5 | 48.0% |

Corsair L40 grants at most 80% ordinary pirate metal+mineral wreckage, and 120% recycling converts recovered debris into resource-equivalent metal/minerals. **All own hull losses and travel/recycling fuel still must be subtracted.** Old dispatched elimination fights keep the rewards frozen when they left; old 5/8-round fights are not retuned.

Adaptive `Q` is hidden from production UI and updates only after economically significant resolved battle; full-fleet win increases Q by up to 0.054, full-fleet loss lowers it by up to 0.066, with q clipped 0–1. Ten scouts at 25,112 population cap carry negligible weight and cannot be used for practical cooldown abuse. Q=0 gives randomly 90–95%, Q=0.5 gives 97.5–102.5%, Q=1 gives 105–110% of sent population. This **does not** enforce 55% wins; a perfect matchup may still beat every garrison.

**New conditional combat evidence:** `tools/generate-pirate-pr91-adaptive.mjs` executes 864 reproducible real resolver cases under fixed Q=0, 0.5 and 1. It writes `artifacts/pr91-adaptive-c/results.json` and `summary.md` with win/loss/draw counts and *optimistic* net resources under full debris collection. CI artifact is linked from the [current PR checks](https://github.com/ratoker-jpg/Asterion/pull/91/checks). Numerical outcomes should only be taken from the actual successful CI artifact, not extrapolated from the former ×2.5 study or confused with a simulated closed-loop 55% win-rate controller.

## Аудит v2 (2026-10-21): новая база обломков — до / после

Решение владельца (аудит v2, п. 2.1): обломки боя = `floor(u × базовая жизнь всех уничтоженных юнитов обеих сторон)`, где `u ∈ [0,25; 0,35)` — один детерминированный множитель на бой (`battleDebrisRoll(id отчёта)`, `src/domain/combat/debris.ts`). Щиты обломков не дают. Пиратские корпуса стоят на той же базе и сохраняют прежнюю относительную долю: `u × жизнь × share / PIRATE_ORDINARY_DEBRIS_SHARE` (PvE ×2, Корсар до ×2,67). Множители награды (0,7/0,9/1,0/1,3/1,5), ничьей (×0,75) и поражения (×0,5) не менялись.

Цифры ниже — **медианы** по реальным прогонам резолвера, локально на `795bb35` («до») и на ветке аудита. Колонка «после 2.1» — только смена базы обломков; «после всех правок» — дополнительно правки инструмента из блока 3 (штрафы ничьей/поражения больше не обнуляются, множитель поражения ×0,5 и ничьей ×0,75 применяются как в продакшне). `net75`/`net120` — оптимистичная чистая выгода при переработке 75% / 120% (полный сбор, минус потери корпусов, топливо атаки и сбора).

| Метрика (медиана) | до | после 2.1 | после всех правок |
|---|---:|---:|---:|
| pr91-balance, зачистка: обломки всего | 20 175 780 | 8 509 264 | 6 866 886 |
| pr91-balance, зачистка: пиратские обломки | 5 525 010 | 2 217 292 | 2 217 292 |
| pr91-balance, зачистка: net75 | −16 483 520 | −26 893 466 | −28 243 898 |
| pr91-balance, зачистка: net120 | −4 761 454 | −21 782 470 | −24 500 128 |
| pr91-balance, только полные победы: net75 | −41 986 | −1 041 842 | −1 202 063 |
| pr91-balance, только полные победы: net120 | 1 131 424 | −597 964 | −897 632 |
| pr91-balance, входящий рейд: обломки всего | 22 799 910 | 10 276 553 | 10 276 553 |
| pr91-balance, входящий рейд: net75 | −36 043 872 | −45 247 033 | −45 247 033 |
| pr91-balance, входящий рейд: net120 | −25 389 955 | −41 522 934 | −41 522 934 |
| approved-compare: обломки | 98 956 929 | 36 326 932 | 36 326 932 |
| approved-compare: net75 | −82 571 534 | −128 777 594 | −128 777 594 |
| approved-compare: net120 | −37 723 238 | −111 681 516 | −111 681 516 |
| garrison 85–105: обломки | 94 379 655 | 34 282 298 | 34 282 298 |
| garrison 85–105: net75 | −85 877 285 | −130 717 374 | −130 717 374 |
| garrison 85–105: net120 | −43 040 658 | −114 818 844 | −114 818 844 |
| adaptive C: орбитальные обломки | 68 549 895 | 24 343 436 | 24 343 436 |
| adaptive C: оптимистичный net120 | −75 120 820 | −128 146 858 | −128 146 858 |

Вывод: у боевых корпусов базовая жизнь заметно меньше стоимости металл+минералы, поэтому обломков в медиане становится в ~2,4–2,8 раза меньше, и зачистка пиратов при текущих множителях в медиане перестаёт окупаться даже при переработке 120%. Это ожидаемое следствие правила; **ретюн множителей пиратской награды — решение владельца**, константы баланса в этом PR не менялись. `balance:pirates` (`docs/evidence/pirate-combat-balance.md`) перегенерирован: симуляция теперь строит гарнизон с тем же сид-коэффициентом, что и продакшн (90–95% для нового владельца, Q = 0), а не фиксированные 90%.

### Ретюн владельца: вариант A ×2,5 (2026-10-21)

После замеров выше владелец выбрал вариант A: доля пиратских обломков в PvE 0,6 → 1,5 (×5 к обычной базе, то есть 125–175% жизни уничтоженных пиратов). Корсар: +0,0125 за уровень, потолок 2,0 (те же +33,3% на 40 уровне, что и раньше). Множители награды (0,7/0,9/1,0/1,3/1,5), ничьей и поражения не менялись. Цифры ниже — **реальные перегенерированные прогоны** (медианы).

| Метрика (медиана) | до аудита | новая база без ретюна | ретюн A ×2,5 |
|---|---:|---:|---:|
| pr91-balance, зачистка: пиратские обломки | 5 525 010 | 2 217 292 | 5 543 232 |
| pr91-balance, зачистка: обломки всего | 20 175 780 | 6 866 886 | 9 342 528 |
| pr91-balance, зачистка: net75 | −16 483 520 | −28 243 898 | −22 744 906 |
| pr91-balance, зачистка: net120 | −4 761 454 | −24 500 128 | −13 616 932 |
| pr91-balance, полные победы: net75 | −41 986 | −1 202 063 | −556 037 |
| pr91-balance, полные победы: net120 | 1 131 424 | −897 632 | 766 167 |
| pr91-balance, полные победы в плюсе при 120% | 78 / 88 | 25 / 88 | 58 / 88 |
| pr91-balance, входящий рейд: пиратские обломки | 5 136 120 | 1 959 712 | 4 899 280 |
| pr91-balance, входящий рейд: net120 | −25 389 955 | −41 522 934 | −34 964 776 |
| approved-compare: net120 | −37 723 238 | −111 681 516 | −71 976 333 |
| garrison 85–105: net120 | −43 040 658 | −114 818 844 | −80 572 331 |
| adaptive C, все бои: оптимистичный net120 | −75 120 820 | −128 146 858 | −112 646 442 |
| adaptive C, полные победы: оптимистичный net120 | +51 350 000 | −42 700 000 | +22 700 000 |
| adaptive C, полные победы в плюсе | 293 / 293 | 4 / 293 | 249 / 293 |

Пиратские обломки вернулись к уровню до аудита. Общий итог ниже прежнего, потому что обломки собственных потерянных кораблей стоят на новой базе (25–35% жизни) и ретюн их не касается.
