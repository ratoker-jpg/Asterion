# PR91 — Pirate Threat Implementation Report

> Independent audit required. This is a **Draft PR**, not a recommendation to merge. Snapshot: base `cefec361852d776af4bf3787691212ae279a3ab8`, branch `codex/pr91-pirate-threat-rewards`; current HEAD and CI are visible on [Draft PR #91](https://github.com/ratoker-jpg/Asterion/pull/91). Do not mark Ready or merge without owner approval.

## Summary of intended implementation

- Owner-wide 2–30% mathematical raid threat curve, conditional counter-fleet percentage, virtual elapsed time, seeded deterministic draws and unique owner/contact decision.
- Due checks only after a 15-minute contact delay, or 1.8 seconds in Test ×500 without speeding the global object lifetime. Calendar checkpoint reconciliation generates persisted pirate-owned flights.
- Raid composition at 90–95% of defenders by population, with a cargo floor *only* for near-empty targets (below max(100, 5% of historical owner hangar capacity)), at most 95% historical capacity for the added floor. 6 ordinary pirate classes; no planet breakers on raids. Counter fleets greedily select the strongest existing class matchup by population budget.
- Arrival uses shared `resolveCombat`, actual owner fleet and defenses, survivor pirate cargo, up-to-75%-per-resource PvP-compatible loot, orbital debris and reports. Pirate mission deliberately bypasses `resolvePlanetSiege`; raids do not damage buildings or destroy planets. Missing target returns without combat, loot or report.
- Outbound player elimination snapshots 75–90% seeded pirate garrison and occasionally 1–10 base-defending planet breakers above owner score 3m; original piracy tier shares, levels and technology preserved. Exact launch population / historical hangar basis for 1× / 1.25× / 1.5× / 2× / 2.5× orbit-debris tiers, victory-only, own debris unmultiplied. Successful full victory reduces owner threat age.
- Recycling debris-per-second at all levels increases ×10; cost, efficiency and concurrency unchanged. Existing jobs retain their recorded completion timestamp.
- Compact responsive threat panel and recorded one-shot contact check status in Operations, plus base-victory salvage breakdown. Historical owner hangar highs retained on completed building upgrades and downgrades.

## Requirement matrix and outstanding work

| Scope | Status | Notes |
|---|---|---|
| §3 exact threat / full victory reduction | **Partial** | Pure equations and snapshots implemented. Offline chronology needs additional large-gap and same-timestamp regression. |
| §4 counter fleet | **Implemented; QA in CI** | Actual built defenses, ship matchups, armor and population; test coverage for ship/tower/mixed across all 3 races. Seeded EV study added. |
| §5 actual incoming raid | **Partial** | Real persisted flight, player/Bot01 resolution, losses, loot, no-siege path; reload, concurrency and prolonged offline stress require QA. |
| §6 elimination garrison / salvage | **Partial** | 75–90% frozen launch budget, 1–2.5× pirate debris, orbital reward ledger; economy EV unverified. |
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
- New seeded 3-race win/loss/net-EV study is implemented in `tools/generate-pirate-pr91-balance.mjs` and was executed successfully by CI step at run 38801755663 (per GitHub step status). It writes `artifacts/pr91-balance/seeded-results.json` and `seeded-report.md`, and models recycler flight availability using real cargo/fuel rather than a full persisted recycler-flight simulation. The script runs seeded base battles at 75–90%, incoming raids at 90–95%, turret defense, technology 0/5/10, max 25,112 population, and calculates net at 75%/120%. The numbers are measured in the CI artifacts; **do not extrapolate them as universal balance**.

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
