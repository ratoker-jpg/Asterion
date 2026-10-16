# PR91 — Pirate Threat Implementation Report

> Independent audit required. This is a **Draft PR**, not a recommendation to merge. Snapshot: base `cefec361852d776af4bf3787691212ae279a3ab8`, branch `codex/pr91-pirate-threat-rewards`; current HEAD and CI are visible on [Draft PR #91](https://github.com/ratoker-jpg/Asterion/pull/91). Do not mark Ready or merge without owner approval.

## Summary of intended implementation

- Owner-wide 2–30% mathematical raid threat curve, conditional counter-fleet percentage, virtual elapsed time, seeded deterministic draws and unique owner/contact decision.
- Due checks only after a 15-minute contact delay, or 1.8 seconds in Test ×500 without speeding the global object lifetime. Calendar checkpoint reconciliation generates persisted pirate-owned flights.
- Raid composition at 90–95% of defenders by population, with a cargo floor *only* for near-empty targets (below max(100, 5% of historical owner hangar capacity)), at most 95% historical capacity for the added floor. 6 ordinary pirate classes; no planet breakers on raids. Counter fleets greedily select the strongest existing class matchup by population budget.
- Arrival uses shared `resolveCombat`, actual owner fleet and defenses, survivor pirate cargo, up-to-75%-per-resource PvP-compatible loot, orbital debris and reports. Pirate mission deliberately bypasses `resolvePlanetSiege`; raids do not damage buildings or destroy planets. Missing target returns without combat, loot or report.
- Outbound player elimination snapshots 85–105% seeded pirate garrison (pre-patch 75–90% frozen flights preserved) and occasionally 1–10 base-defending planet breakers above owner score 3m; original piracy tier shares, levels and technology preserved. Exact launch population / historical hangar basis for 1× / 1.25× / 1.5× / 2× / 2.5× orbit-debris tiers, victory-only, own debris unmultiplied. Successful full victory reduces owner threat age.
- Recycling debris-per-second at all levels increases ×10; cost, efficiency and concurrency unchanged. Existing jobs retain their recorded completion timestamp.
- Compact responsive threat panel and recorded one-shot contact check status in Operations, plus base-victory salvage breakdown. Historical owner hangar highs retained on completed building upgrades and downgrades.

## Requirement matrix and outstanding work

| Scope | Status | Notes |
|---|---|---|
| §3 exact threat / full victory reduction | **Partial** | Pure equations and snapshots implemented. Offline chronology needs additional large-gap and same-timestamp regression. |
| §4 counter fleet | **Implemented; QA in CI** | Actual built defenses, ship matchups, armor and population; test coverage for ship/tower/mixed across all 3 races. Seeded EV study added. |
| §5 actual incoming raid | **Partial** | Real persisted flight, player/Bot01 resolution, losses, loot, no-siege path; reload, concurrency and prolonged offline stress require QA. |
| §6 elimination garrison / salvage | **Implemented; audit pending** | New 85–105% frozen launch budget; 75–90% legacy budgets retained; rewards 1–2.5× unchanged. Controlled seeded economics measured below. |
| §7 defensive planet breaker | **Partial** | Seeded 10% special base guard >=3m, up to ten 615-population hulls, no planet breaker on raid. Seed and boundary tests need wider coverage. |
| §8 recycling x10 | **Implemented in code** | Ten new canonical speeds [70,120,180,250,330,420,520,630,850,980], efficiency unchanged. |
| §9 operations UI | **Implemented; mobile QA outstanding** | Fleet incoming pirate warning, Russian label/icon, origin/target/ETA, manifest/population, no hostile recall; new 1920/1280 Electron assertions. 390px mobile evidence still pending. |
| §10 persistence / anti-replay | **Partial** | Versioned pirate-owner threat, historical hangar, roll ledger, flight snapshot and report; malicious-save and long-offline cases require more tests. |
| §11 acceptance scenarios | **Partial** | Unit/integration tests added for threat, budget, reload and no-siege. Not all scenarios proven. |
| §12 seeded balance / economics | **Script executed in CI; acceptance pending** | `npm run balance:pirates:pr91`: real combat, actual domain orbital pickup and recycling transitions, lost-hull costs and game fuel formulas, with *modeled availability of recycler trips*. Per-seed JSON and Markdown emitted into retained CI artifacts; full collection remains an optimistic economic bound. |

## Persisted fields and migration behavior

- `pirate.ownerThreats[ownerId]` — `{version:1,ageHours,integratedAt}` calibrated in saved virtual elapsed time.
- `pirate.ownerMaxHangarLevel[ownerId]` — monotonic completed historical level; legacy save initializes from maximum currently available hangars, without inventing older history.
- `pirate.raidProcessedAt` — highest processed raid-check timestamp, initialized at save creation/migration; prevents ancient epoch replay on first load.
- `pirate.raidRolls[JSON.stringify([ownerId,contactCycleKey])]` — single stored `checkAt`, deterministic `seed`, optional `flightId`. Each owner has one roll across all colonies in the same system.
- `FlightRecord.ownerSide='pirate'`, `missionId='pirate-raid'`, and `pirateRaidSnapshot` — validated contact/target, counter type, profile and ordinary pirate ship composition, plus immutable flight timestamps. `selectedShips` stays empty because those are *pirate* IDs, not player ShipIds.
- Outbound elimination `pirateSnapshot` optionally includes `eliminationBudget`, `sentCombatPopulation`, `historicalHangarCapacity`, `rewardMultiplier`. Old in-flight missions omit these and do **not** get a retroactive multiplier.
- Reports optionally add `pirateReward` (base salvage, bonus, own salvage, multiplier, threat reduction). Older reports remain readable.

## Determinism / engineering decisions

- Deterministic seeds include owner, contact-cycle key, purpose and algorithm version. Counter roll is independent from raid roll.
- Stable chronological owner/cycle sorting. Fight outcomes identified by `battle-pirate-raid-${flight.id}`, with no second combat when report already exists.
- Counter optimizer ranks by the production 6×6 ship class matchup and actual defense/ship armor mitigation, population-weighted, deterministic tie breakers. Defensive installations carry no ordinary matchup class and therefore use the combat engine's neutral ×1; no invented class modifiers.
- For nearly empty planets: threshold `defendingPopulation < max(100, floor(0.05 * ownerHistoricalCapacity))`. If a nominal 90–95% fleet cannot carry meaningful loot, additional cargo-capable ships are selected up to 95% historical capacity. This threshold is an explicitly disclosed implementation choice, **not a separately approved balance parameter**.
- Approximate expected raids per day per system assuming 18.8 present cycles/day and no cooldown: at 2% ≈0.38, at 13.2% ≈2.48, at 30% ≈5.64; 3 systems at 30% ≈16.9 raids/day. These are **analytical expectations, not simulations**.
- Processing of missing target does not retarget to a live colony. Recalculation of historical profile after a flight's launch never changes frozen attacker.

## Tests and QA status

- Earlier PR91 GitHub Actions CI runs reported failed tests because legacy recycling assertions and fake repeating-raid checks asserted obsolete behavior. Source tests were updated.
- **Do not infer CI PASS from this report.** Check the current PR-head [GitHub Actions checks](https://github.com/ratoker-jpg/Asterion/pull/91/checks) and any failed-job logs. A local clone/Node execution environment was unavailable in this session; local script execution must be marked **NOT RUN**.
- New tests: `src/domain/pirates/threat.test.ts`, `src/domain/pirates/raid.test.ts`, `src/application/pirate-raids.integration.test.ts`. New code must pass full CI and the 14 targeted npm scripts in the original task before merge.
- Desktop 1920/1280 incoming-flight UI assertions passed at CI run 38800154581. **Mobile 390px not verified.** Offline 48h comparison and 10+ cycles added to `src/application/pirate-raids.integration.test.ts`; earlier CI runs passed integration tests; inspect current HEAD CI for final acceptance.
- Historical (before 85–105% patch) seeded 3-race win/loss/net-EV study is implemented in `tools/generate-pirate-pr91-balance.mjs` and was executed successfully by CI step at run 38801755663 (per GitHub step status). It writes `artifacts/pr91-balance/seeded-results.json` and `seeded-report.md`, and models recycler flight availability using real cargo/fuel rather than a full persisted recycler-flight simulation. The script runs seeded base battles at 75–90%, incoming raids at 90–95%, turret defense, technology 0/5/10, max 25,112 population, and calculates net at 75%/120%. The numbers are measured in the CI artifacts; **do not extrapolate them as universal balance**.

## Risks requiring independent audit

1. Large clock jumps, multiple due systems at the same checkpoint, and defeat-shifted calendar may require further replay and performance fixes.
2. Bot01 current targeting and update of authoritative espionage state need save/reload and resource-lifecycle tests; no bot autonomous PvE hunting was added.
3. Reward multipliers can exceed replacement-cost value and 100% destroyed pirate cost when combined with 60–80% baseline; possible resource inflation. No hidden cap or global raid cooldown added.
4. Attack reporting, fleet UI and narrow mobile viewport may need more work.
5. Malformed legacy and adversarial pirate flight snapshots need more verification.
6. **No merge** until fresh CI is green, test/scenario matrix is complete and independent reviewer checks all mission paths.

## Manual Test Mode verification outline

Start Test Mode; in settings select time multiplier ×500. Go to Operations to see the owner threat percentage and countdown on currently active pirate bases. Each contact checks only once; inspect whether it says raid sent or none. Check Flights for an incoming pirate flight and Reports for the battle. Attack a pirate base with a 95% or exactly 100%-hangar manifest and inspect `pirateReward` plus orbital debris; recycle using a new job at level 10 and verify 980 debris/sec/process. Tests that require 48 virtual hours of accumulated threat must **explicitly control test timestamps**, not expect ×500 to accelerate threat growth.

**Merge decision: owner only. Keep PR as Draft.**

## Independent audit follow-up — October 15, 2026

Audit basis: `ASTERION_PR91_INDEPENDENT_AUDIT_e18d847.md`, HEAD `e18d847`, and [the audit CI run](https://github.com/ratoker-jpg/Asterion/actions/runs/38792168671). This section records changes after that HEAD; check the [current PR HEAD](https://github.com/ratoker-jpg/Asterion/pull/91) for freshness.

### Fixes made

1. **Incoming pirate flight UI:** `src/FleetWorkspacePortal.tsx` now treats ownerSide pirate as hostile; warns of arrival, shows mission label/icon, source, colony, countdown, manifest and threat population, and blocks impossible recall controls. `electron/pirate-operations-qa.cjs` injects a validated pirate flight into its Test Mode save and asserts the UI at 1920×1080 and 1280×720 before restoring the save and continuing real reconnaissance/elimination. Older [CI 38800154581](https://github.com/ratoker-jpg/Asterion/actions/runs/38800154581) passed the pirate UI step.
2. **Counterraid defenses:** `src/application/pirate-raids.ts` now includes the authoritative player/NPC defense installations; `src/domain/pirates/raid.ts` scores ship matchup and tower armor using the existing production calculations, with no invented 6×6 class for defensive buildings. `src/domain/pirates/raid.test.ts` covers only-ship, only-turret and mixed setups for Aegis/Synod/Veyra.
3. **Resource test:** `electron/test-mode-qa.cjs` logs the loaded save and waits up to 3 seconds for a *real* resource-clock write after seeding a past clock (at both resource accrual and cap checks), retaining the original actual-resource assertions. `src/domain/universe/runtime.ts` avoids scanning every past contact in normal daily reconciles.
4. **Recycling:** `electron/visual-recycling-center.cjs` now checks the approved level-3 180 debris/sec throughput (10,000 debris = 56 seconds rather than old 9m16s). `src/domain/buildings/recycling.ts` preserves already-persisted legacy job finishAt while new jobs use ×10 speed, plus regression test.
5. **Offline and replay:** `src/application/pirate-raids.integration.test.ts` tests 8→24→48h staged vs single 48h catch-up on 3 systems (2 planets in one), seed uniqueness, replay, no duplicate reports, missing colony and malformed manifests; Test ×500 check delay remains 1.8s, without accelerating threat aging.
6. **Measured combat/economy:** reproducible `tools/generate-pirate-pr91-balance.mjs` in CI. Per-seed real battle outcome, pirate/player debris, losses and replacement costs, 75% loot and the exact game fuel function. Orbital pickup uses the domain ledger; recycler output uses actual domain start/collect. **Collection flights remain an explicit model**, using standard recycler cargo capacity and fuel per trip. Profit is an optimistic bound, not guaranteed spendable in game.

### Remaining gates (not hidden)

- **Final PR-HEAD CI must pass** `npm run build`, `test:test-mode-ui`, `test:pirate-operations-ui`, `qa:visual`, packaging and all domain suites. A passing intermediate run is not sufficient to authorize merge.
- Mobile 390px view, a fully persisted recycler collection fleet circuit and a field-like long-session balancing review remain outside the verified evidence. Individual simulations cannot alone establish a safe inflationary equilibrium.
- Independent audit §P2 asks whether reconnaissance should show the rare base-only Planet Breaker. **Not changed:** revealing a hidden special threat is a product decision for the owner, not an implicit test fix. Existing reconnaissance chance/cooldown unchanged.

**Merge and Ready for review remain prohibited. Only the owner approves a merge.**

## Owner-approved technology/round patch — October 16, 2026

**Source:** `ASTERION_PR91_APPROVED_TECH_PERCENT_AND_12_ROUNDS.md` (owner-approved attachment). Work is limited to existing branch `codex/pr91-pirate-threat-rewards`; PR #91 stays Draft, with no merge/Ready for review.

### What changed and why

1. `src/domain/pirates/profile.ts`: preserved score tier thresholds and immutable 0–10 `profile.technologyLevel`, but new `profile.technologies[id]` use `Math.round(COMBAT_TECHNOLOGIES[id].maxLevel * tier / 10)`, capped within the source science's `maxLevel`. The three exclusive technologies remain mutually exclusive with only the seeded chosen one active. No hull cost, spawn, damage, fleet-shares, or tech coefficients were edited.
2. `src/domain/pirates/contact.ts`: frozen owner/cycle profiles from before the formula change are now validated against the exact historical *flat tier* profile in addition to the new canonical percent profile. All other frozen properties must still match deterministic seed and score, so forged snapshots are still rejected. Old mission and raid normalizers retain their original `profile.technologies`.
3. `src/domain/combat/simulator.ts`: removed score-based recalculation of NPC technology **during combat input validation**; this recalculation was overwriting an old flight's frozen levels and initially made controlled before/after battle simulations identical. Validated snapshots now transfer exactly their existing old/new vector into the established shared resolver. Changed no combat formula or `resolveCombat`. Added `frozenPirateTechnologyLevels` validation to reject tampered technology vectors.
4. `src/FleetWorkspacePortal.tsx`: three new-mission reset points and initial selector default `8 → 12`; manual selector remains `[5,8,12]`, dispatched selection frozen.
5. `src/application/attack.ts`: new attack with missing/invalid limit defaults 12; explicit saved 5/8/12 remain unchanged. New Bot01 automatic attack snapshot is 12. Incoming pirate resolver reads frozen `pirateRaidSnapshot.maxRounds ?? 8` so old legacy flights remain at 8 while newly created raids run at max 12. Combat may end before its ceiling.
6. `src/domain/pirates/mission.ts` / `src/application/pirate-raids.ts`: optional `maxRounds?: 12` on the existing version-1 pirate raid snapshot; new dispatch persists 12; valid legacy absence stays absent through normalization/JSON save/reload, and rejects unsupported injected values. No second flight format.
7. `src/domain/pirates/catalog-profile.test.ts`, `src/domain/pirates/contact.test.ts`, `src/application/pirate-raids.integration.test.ts`, `src/application/attack.test.ts`: all ten sciences, thresholds and lower boundaries, chosen exclusive direction and 100%-max science, snapshot old/new acceptance and malformed rejection, Test Mode and old 5/8, new incoming 12, canonical resource-cap assertions. Existing unrelated attack tests used a stale fixed-10m/-2.5k wallet expectation despite real NPC passive income during flight; changed those checks to use actual live wallet and 75% cap, leaving the gameplay unchanged.
8. `tools/generate-pirate-pr91-approved-compare.mjs`, `package.json` and `.github/workflows/ci.yml`: 48 old/new matched-seed pairs (96 resolver executions) on all 3 factions, 3.0m and 3.5m resource points, 25,090 and 25,112 population, destroyer levels 0/10, no commanders, 12 rounds and controlled 0/2 defensive Planet Breakers. Mixed-fleet seed sweep retained. Computed net includes real destroyed hull cost and game fuel, with **modeled full debris collection and recycling** at 75/120%; it must not be advertised as guaranteed profit. CI now also runs `test:attack` and `test:flights` rather than omitting those regressions.
9. `src/domain/pirates/balance-simulation.ts`: the 0–10 `technologyLevel` reporting column is explicitly labeled **tier T**, not the real science-level value.

### Approved control values

| Resource points | Progress tier T | Science max 10 | Science max 15 | Ship armor max 20 |
|---:|---:|---:|---:|---:|
| 800,000 | 7 | 7 | 11 | 14 |
| 1,500,000 | 8 | 8 | 12 | 16 |
| 3,000,000 | 9 | 9 | 14 | 18 |
| 3,500,000 | 9 | 9 | 14 | 18 |
| 6,000,000 | 10 | 10 | 15 | 20 |

One randomly selected exclusive science is scaled against its own maximum; the other two remain zero. The technology seed and all pirate garrison/population coefficient seeds remain unchanged.

### Verified comparison so far

[Run 38816770354](https://github.com/ratoker-jpg/Asterion/actions/runs/38816770354), patch HEAD `06976b26`: **both** seeded combat steps passed, including 324 mixed real combat executions plus 48 old/new pairs (96 executions). In controlled pairs old tech won 45/48, approved new tech won 31/48. Mean nominal net at 75% recycler conversion changed +39.73m → −9.49m; at 120% changed +105.53m → +48.71m. These are full-salvage upper bounds, **not** production-wide expected profit. This **run failed overall**, due to two legacy attack tests assuming a static NPC wallet; the unrelated test fixture now explicitly allows actual accrual and asserts the 75% cap. Newer CI must independently confirm all paths.

### Remaining risks, limits and final gates

- Full final HEAD CI including Windows package and Electron visual checks must complete and pass; **do not infer green from previous intermediate jobs**. See [PR checks](https://github.com/ratoker-jpg/Asterion/pull/91/checks).
- Full production balance and actual probability-weighted incoming economic loss are not established by selected matched cases. Rare Planet Breakers were deliberately forced to 0/2 to compare behavior under control; their actual encounter chance was not estimated by this experiment.
- Real saved recycler flights/transport concurrency and all storage limits are **not** simulated by the net model; recovered debris remains an optimistic assumption.
- Approval for any further balance changes (threat chance, ships, garrison %, salvage multiplier, resolver combat formula) is not granted. Any rebalance must return to the owner first.
- **No merge, no Ready for review; independent auditor examines changes and CI before owner decision.**

## Owner-approved pirate-elimination garrison 85–105% — October 16, 2026

**Approved task:** `ASTERION_PR91_PIRATE_GARRISON_85_105_PATCH_PROMPT.md`. No new PR; working branch `codex/pr91-pirate-threat-rewards`, PR #91 remains Draft.

### Scoped production patch and compatibility

- `src/domain/pirates/profile.ts`: **only new seeded outgoing `pirate-elimination`** now computes `0.85+0.20*pirateSeededDraw('pirate-garrison-v2:'+launchSeed)`. The seed stream stays identical to the historical draw to retain a comparable quantile; the coefficient range is 85–105% (105% upper bound excluded by RNG). `targetPopulation=Math.round(sentCombatPopulation*coefficient)`; unchanged seeded floor/ceil composition routine forbids actual population > target, even when target >100% of sent. Unseeded historical fallback remains **fixed 90%**.
- `src/domain/pirates/mission.ts`: accepts the union of old [0.75,0.90] and new [0.85,1.05] stored coefficient ranges = [0.75,1.05]. Already launched fleets retain their `eliminationBudget.ships` and `coefficient` byte-for-byte after normalization/reload; no mutation or replacement.
- `src/domain/combat/simulator.ts`: **validation-only** exception for a `pirate-elimination` pirate defender above the generic 35,000 defender-population limit, provided it does **not** exceed `Math.round(attackerCombatPopulation*1.05)`. The general attacker limit and all non-pirate combat population limits remain unchanged. This avoids falsely rejecting approved 105% large-base garrisons. No changes to `resolveCombat` or battle formulas.
- `src/application/pirates.ts` and `src/domain/pirates/encounter.ts` continue freezing the full population budget **at dispatch** and using it verbatim at arrival. New/old serialized-and-reloaded flight tests assert frozen pirate/player profiles, technology, composition, population coefficient, reward multiplier, report identity, and no second reward/casualty on replay.
- The spontaneous **incoming pirate raid** fleet remains 90–95%; the existing economy multipliers ×1 / ×1.25 / ×1.5 / ×2 / ×2.5, base 60% pirate salvage, technologies, hulls, abilities, Planet Breaker roll, counterraid threat and construction/recycling coefficients were **not changed**. Additional test diagnostics in Electron do not weaken the UI assertion.

### Measured real battle/optimistic net comparison

CI [run 38820098930](https://github.com/ratoker-jpg/Asterion/actions/runs/38820098930) successfully executed the **new garrison comparison job**, `test:pirates`, `test:pirate-operations`, `test:attack`, `test:flights`, `npm run build` and the original PR91 balance sweep; **the overall run was red** due to an Electron QA timeout waiting for a seeded incoming pirate UI row. The fixture and its reload are instrumented in this follow-up; final HEAD CI must be checked independently.

**Samples:** 768 paired deterministic scenarios ×2 = **1,536 real production combat-resolver executions**. Three races, 3m and 3.5m resource points, exact player populations 25,090/25,112, destroyer upgrades L0/L10, 12-round ceiling, no commanders, near-max player sciences; minimal scout filler only where destroyer population cannot reach the exact total. For each condition, 24 seeds without specials and 8 seeds with two *forced* base-only Planet Breakers (controlled, NOT 10% population-weighted real spawn). Both sides receive the same seed/ship-science profile and the same `u` draw; the **only paired change** is old 75–90 vs new 85–105% pirate fleet size. Grouped figures are conditional sample rates, not a proven server-wide win probability.

| Statistic | Old 75–90% | New 85–105% |
|---|---:|---:|
| Player wins / 768 | 543 (70.70%) | 335 (43.62%) |
| Draws | 35 (4.56%) | 28 (3.65%) |
| Pirate wins | 190 (24.74%) | 405 (52.73%) |
| Mean pirate garrison population | 20,685 | 23,817 |
| Mean own population destroyed | 63.86% | 79.79% |
| Mean pirate wreckage (base, before extra multiplier) | 54.29m | 52.76m |
| Mean own wreckage | 28.59m | 35.72m |
| Mean extra pirate wreckage from multipliers | 52.11m | 37.16m |
| Full win rewards at ×2 / ×2.5 | 274 / 269 | 170 / 165 |
| Mean destroyed player-hull cost | 100.33m | 125.35m |
| Mean estimated full-collection net at 75% recycling | **+0.60m** | **−31.42m** |
| Mean estimated full-collection net at 120% recycling | **+61.35m** | **+25.12m** |

Units of net are total metal+minerals+gas as resource-equivalent, not currency. The model uses real resolved damaged hull counts, canonical hull costs, canonical attack and recycler fuel, actual damaged-ship debris and 75/120% recycler conversion; it **assumes all orbital wreckage can be collected with as many 10-recycler flights as necessary**, and does not model time, storage, resource availability or persisted transporter trips. Therefore the net is a modeled *optimistic upper bound*, not spendable actual profit. Losses and ties are included in means; the high-ship-forced cases are not weighted by live encounter probabilities.

**By race:** player wins old → new: Aegis 177/256 (69.1%) → 123/256 (48.0%); Synod 169/256 (66.0%) → 82/256 (32.0%); Veyra 197/256 (77.0%) → 130/256 (50.8%). Mean optimistic net at 75%: Aegis +2.51m → −25.00m, Synod −15.20m → −54.31m, Veyra +14.50m → −14.94m. Strong fleet wins remain possible, but regular farming is materially harder.

**Evidence:** `npm run balance:pirates:pr91:garrison`, `tools/generate-pirate-pr91-garrison-compare.mjs`, retained CI artifacts `artifacts/pr91-garrison-85-105/comparison.json` (all pairs, losses, coefficient, multipliers, gas and net) and `comparison.md` (per-faction/tech/breaker tables). The base `npm run balance:pirates:pr91` remains executed and incoming raids are outside this balance change.

### Remaining acceptance gates

1. Green CI and Pages preview on the **final HEAD**, including mandatory Electron pirate-operation UI and Windows installer artifact.
2. Independent audit of all diff, especially mission snapshot validation, legacy flights and 105% defender exception; owner visually approves UI and decides whether to merge.
3. Net economy findings are conditional and assume ideal collection; real on-map long-horizon refinery logistics, rare Planet Breaker frequency and mobile 390px QA are not established by the paired study.

**Do not merge or mark Ready. Owner is sole merge approver.**


## Owner-approved C: hidden adaptive pirate farming, Test Mode diagnostics — 16 October 2026

**Scope:** Follow-up in the existing Draft PR #91, branch `codex/pr91-pirate-threat-rewards`. Never merge or mark Ready without owner approval.

### Product behavior and mathematics

- `src/domain/pirates/adaptive.ts`: a per-owner private continuous adaptive index `Q∈[0,1]`, starting at zero in new/legacy saves. The target of **55% meaningful wins is a feedback reference only**, **not** a forced battle outcome or a guaranteed observed win rate. For each qualifying completed pirate-elimination battle,
  `Q'=clamp(Q+0.12×W×(S−0.55),0,1)`; `S=1` for a complete pirate base wipe, `0.5` for draw, `0` for loss.
- Weight `W=clamp(sentPopulation/historicalMaxHangar,0,1)^2 × min(1,launchHullCost/(sentPopulation×destroyerHullCostPerPopulation))`. Hull costs are read from canonical race catalog (metal+minerals+gas); the destroyer is a stable canonical per-race reference. `W<0.05` does **not** change Q or the meaningful-battle counter. This makes intentional losses with 10 scouts ineffective, whereas losing a valuable full-size fleet significantly lowers Q. No 24h reset, no base-count reset, and no linkage between different owners.
- New `pirate-elimination` dispatches freeze `coefficient=0.90+0.15×Q+0.05×seededDraw`, hence **90–95%** at Q=0 and **105–110%** at Q=1, with a continuous intermediate range. The same stable prior RNG stream and the prior exact ship allocator remain. Special Planet Breaker spawn and technologies untouched. The combat validator permits only actual pirate elimination defenders up to **110% of attacker population**; ordinary player/PvP fleet caps unchanged.
- The index is recorded **once**, only from an actual new-version elimination combat report, and stored in `PirateState.ownerAdaptations[ownerId]` with a per-flight dedupe ledger, weighted numerator/denominator and most recent realized garrison roll. The index is unchanged at *dispatch*, by fake replay, by recon, and by an insignificant defeat. All new flight coefficients, weighting and reward modifiers are frozen at dispatch and survive save/reload. Pre-C flights retain their older 75–90% or 85–105% frozen garrisons and their prior reward behavior.
- New victory pirate-wreckage multipliers by sent population relative to the **owner's historical maximum hangar**: **under 50% ×0.7, 50–84.99% ×0.9, 85–94.99% ×1.0, 95–99.99% ×1.3, exactly 100% ×1.5**. New draws use ×0.75, new losses ×0.5, all independent of the winning chance. Only *pirate hull debris* is multiplied; ordinary own destroyed-hull debris remains unchanged, including after defeat. Important bug fixed: `addDebris` sanitizes negative operands, therefore a penalty must first scale pirate debris and only then add the unmodified own debris. Legacy losses/draws lack frozen penalties and remain ×1.
- `src/OperationsView.tsx`, `src/App.tsx`, `src/operations.css`: an extra **Test Mode-only** read-only diagnostic section shows (a) wins / significant fight count and simple %, (b) economically weighted outcome %, (c) hidden Q as a percentage, (d) the next predicted population ratio range, and (e) the most recently frozen actual rolled coefficient and dispatched population. In production the props are not passed and the widget is absent. No visible "pirate alertness" mechanic in the normal game.

### Evidence and QA

- `src/domain/pirates/adaptive.test.ts`: Q 0→1 across full wins and declines across large losses; no repeat count; 100 intentional scout losses have no influence; deterministic 90–110% roll, 0/0.5/1 boundaries; actor-isolated save migration and forged field rejection.
- `src/application/pirate-combat.integration.test.ts`: actual new launch snapshot/strength/Q; complete win attribution and persisted replay; actual penalty ×0.5 or ×0.75 with own hull salvage unaffected. Legacy 0.75–1.05 snapshots still accepted and new 1.10 cap accepted.
- `electron/pirate-operations-qa.cjs`: at 1920×1080 and 1280×720 verifies that initial Test Mode widgets show Q=0% and 90–95% next-garrison band before normal recon/elimination flow. Do not disable or relax UI assertions.
- `tools/generate-pirate-pr91-adaptive.mjs`, `npm run balance:pirates:pr91:adaptive`: **864 production resolver battles** across 3 races × 2 point scores × 2 population caps × 2 destroyer upgrades × Q=0/0.5/1 × 12 seeded contacts. Real canonical 10% special roll; 120% recycler optimistic net includes destroyed own ship cost, standard travel gas, modeled ten-recycler collection fuel and full salvage. JSON per seed and Markdown group summary live in CI artifacts `artifacts/pr91-adaptive-c/`. **This Q-grid is conditional, not a 50-battle adaptive feedback trajectory** and may show 100% victories even at the hardest band.
- Full CI and Windows build remain an acceptance gate; see [PR #91 checks](https://github.com/ratoker-jpg/Asterion/pull/91/checks). As of this document modification, no claim of a green final HEAD.

### Explicitly remaining risks

1. **55% cannot be guaranteed.** Against an ideal counter-fleet, 110% pirate population may still lose 100% of the time. The algorithm never cheats the shared combat engine.
2. The sampled combat economy assumes physically collecting all orbital debris, infinite trips/time/storage, and no PvE opportunity-cost valuation. Actual sustainable farm EV needs repeated in-game player testing; **no further balance coefficient was changed without approval**.
3. Client-side Test Mode and local saves are inspectable/editable by technically capable players. No genuine server-side secrecy or anti-cheat exists in an offline local game.
4. Bot 01's independent **incoming** pirate raids are a separate already-existing mechanic. They do not use player-initiated `pirate-elimination` launches, so this iteration does not pretend to adapt Bot 01's raids or guarantee an NPC 55% win rate.
5. Unresolved prior issue: NPC-vs-pirate battle reports in the player's feed is outside this scoped adaptive balance task. Owner retains sole control of merge.

**Do not merge. PR must remain Draft.**
