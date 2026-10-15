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
