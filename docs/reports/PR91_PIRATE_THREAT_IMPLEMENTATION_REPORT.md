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
| §4 counter fleet | **Partial** | Seeded conditional chance and greedy existing-matchup optimizer; comprehensive game-balance validation outstanding. |
| §5 actual incoming raid | **Partial** | Real persisted flight, player/Bot01 resolution, losses, loot, no-siege path; reload, concurrency and prolonged offline stress require QA. |
| §6 elimination garrison / salvage | **Partial** | 75–90% frozen launch budget, 1–2.5× pirate debris, orbital reward ledger; economy EV unverified. |
| §7 defensive planet breaker | **Partial** | Seeded 10% special base guard >=3m, up to ten 615-population hulls, no planet breaker on raid. Seed and boundary tests need wider coverage. |
| §8 recycling x10 | **Implemented in code** | Ten new canonical speeds [70,120,180,250,330,420,520,630,850,980], efficiency unchanged. |
| §9 operations UI | **Partial** | Live threat, post-roll state, rewards integrated; full incoming notification / mobile visual QA not yet evidenced. |
| §10 persistence / anti-replay | **Partial** | Versioned pirate-owner threat, historical hangar, roll ledger, flight snapshot and report; malicious-save and long-offline cases require more tests. |
| §11 acceptance scenarios | **Partial** | Unit/integration tests added for threat, budget, reload and no-siege. Not all scenarios proven. |
| §12 seeded balance / economics | **NOT DONE** | No verified full multi-race seeded sim/EV results. No unverified win rates or profit figures claimed. |

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
- Counter optimizer is greedy by production 6×6 class matchup, deterministic tie breakers, no invented class modifiers.
- For nearly empty planets: threshold `defendingPopulation < max(100, floor(0.05 * ownerHistoricalCapacity))`. If a nominal 90–95% fleet cannot carry meaningful loot, additional cargo-capable ships are selected up to 95% historical capacity. This threshold is an explicitly disclosed implementation choice, **not a separately approved balance parameter**.
- Approximate expected raids per day per system assuming 18.8 present cycles/day and no cooldown: at 2% ≈0.38, at 13.2% ≈2.48, at 30% ≈5.64; 3 systems at 30% ≈16.9 raids/day. These are **analytical expectations, not simulations**.
- Processing of missing target does not retarget to a live colony. Recalculation of historical profile after a flight's launch never changes frozen attacker.

## Tests and QA status

- Earlier PR91 GitHub Actions CI runs reported failed tests because legacy recycling assertions and fake repeating-raid checks asserted obsolete behavior. Source tests were updated.
- **Do not infer CI PASS from this report.** Check the current PR-head [GitHub Actions checks](https://github.com/ratoker-jpg/Asterion/pull/91/checks) and any failed-job logs. A local clone/Node execution environment was unavailable in this session; local script execution must be marked **NOT RUN**.
- New tests: `src/domain/pirates/threat.test.ts`, `src/domain/pirates/raid.test.ts`, `src/application/pirate-raids.integration.test.ts`. New code must pass full CI and the 14 targeted npm scripts in the original task before merge.
- Visual screenshot review (desktop/mobile) and heavy offline multi-cycle 10+ replay: **NOT VERIFIED**.
- Full seeded 3-race win/loss/EV study, including losing and drawn battles and resource losses/fuel: **NOT RUN**. Do not treat the older 90%-garrison study as new evidence.

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
