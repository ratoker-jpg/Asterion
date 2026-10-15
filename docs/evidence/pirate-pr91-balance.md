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
