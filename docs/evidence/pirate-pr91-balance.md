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

## Still outstanding for final balance sign-off

- Confirm latest CI success and inspect current artifacts for all 96 pairwise combat results and 324 refreshed mixed encounters.
- Assess cases with high losses and 12-round stalemates without silently retuning combat, raid, salvage or technology coefficients.
- Verify actual 16m/160m orbital debris collection logistics in persisted flight circuits and mobile narrow-screen layout. Real saved recycling-job operations were covered by the general seeded run, but real fleet travel is still modeled here.
- Independent code audit of migration, old incoming 8-round raids, old outgoing 5/8 attack snapshots and anti-replay.

## Risk note

A ×2.5 multiplier applied to 60–80% base pirate salvage can produce salvage with a nominal value 150–200% of destroyed pirate metal+mineral costs **before** recycling, possibly making high-capacity victories inflationary. Net outcomes cannot be concluded without actual hull losses, flight gas and collection expenses. Approved balancing numbers were not silently changed.
