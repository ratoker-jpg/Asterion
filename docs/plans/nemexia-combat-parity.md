# Nemexia combat mechanics parity — implementation plan

## Objective

Implement report-confirmed Nemexia round behavior in Asterion's shared combat resolver and validate it on the full saved-input archive. This is a mechanics task: do not tune win-rate or change points, rewards, loot, ship statistics, or balance coefficients.

## Evidence contract

The source of truth is docs/evidence/nemexia-combat-archive-analysis.md plus the row-level docs/evidence/nemexia-target-transitions.csv. The 1,472 JSONL records are partitioned by capture errors, verified reports, structurally valid older reports, and summary-only reports. Harness manifest fields are grouping factors, not game rules. Nemexia seed is absent, so compare structural invariants and series behavior, never a particular stochastic winner.

## Implementation slices

| Slice | Decision and implementation | Status |
| --- | --- | --- |
| 1. Full archive audit | Parse all 6,052 same-round target transitions with target rosters, order/counts, actor class/faction, previous-target death event, and source references. Group by campaign/control block and validate target_priority separately from 6,000 held-out transitions. | Complete |
| 2. Side phases and defender counts | Keep attacker phase before defender phase. For defender ships, report-confirmed actions use the round-opening count after partial or complete same-round losses. A destroyed commander or defense may respond at its round-opening count only in the observed full-destruction case with a living target. Persist real losses into the next round. | Implemented in shared resolver |
| 3. Target lock | Corpus evidence: all 6,052 extracted within-round switches occur only after the previous target is destroyed. User-directed Asterion policy: retain a selected live target across rounds until it is destroyed, then use the existing Asterion selector. The archive does not independently establish Nemexia's cross-round lock behavior. Do not infer the target selector from the harness priority field. | Implemented in shared resolver |
| 4. Extra actions | The archive confirms repeated action rows from one stack, including groups of 2–5, but cannot identify cause/cadence or per-action formula. Keep Asterion's current action count as previously directed; do not add attacks or an ability. | Preserved / documented gap |
| 5. Abilities and defenses | Keep existing commander formulas. Add the confirmed full-destruction response for commander/defense. Separate commander Reanimator from ordinary Destroyer Revival. Implement the official Destroyer chance/amount only for Aegis/Confederation; 641/641 archive amounts match round-half-up of per-target casualties × Destroyers-after-round bonus. Per-target-stack chance is the best-supported model (641/7,643 opportunities vs 622.15 expected); exact RNG granularity remains explicit approximation. Keep Goliath/Synod and Hornet/Veyra out of Revival. | Implemented / documented boundary |
| 6. Draw and completion | Preserve Asterion draw on mutual destruction and configured round limit. Archive shows both kinds of draw but round limits 5/8/12 come from the harness, not a universal Nemexia cap. | Existing behavior retained |
| 7. Within-side action order | The 19 valid identical-profile repeats have 19 different first-round ordinary ship sequences. Across 192 adjacent-round comparisons with at least two common actors, no ordinary-stack relative-order inversion occurred. Shuffle only ordinary ship-stack slots once at battle start with the battle seed; keep that order across rounds. Keep commanders, defense, and non-ordinary ships in their existing slots/order. This seeded shuffle is an Asterion approximation, not Nemexia’s recovered RNG algorithm. | Implemented in shared resolver |
| 8. Seed provenance | Preserve explicit flight/raid seeds. Generate and record a unique seed whenever a new resolver battle omits one; the saved report seed must reproduce the same report with the same input and engine version. | Implemented in shared resolver |
| 9. Validation and review | Run the full domain suite, requested integration checks, simulator and battle-report Electron QA at the scripted 1920×1080 / 1280×720 viewports, Windows packaging, full archive Asterion playback, diff audit, and independent read-only review. Create only a Draft PR; do not merge or mark Ready. | Complete |

## Checks

Required commands:

- npm run test:combat
- npm run test:attack
- npm run test:application
- npm run test:flights
- npm run build
- git diff --check

Archive playback uses clean recorded Nemexia forms and three independent Asterion seeds per source case. The final sweep replayed all 1,363 clean cases three times (4,089 battles); all 12 support-order cases from the prior runner's omission are now included, with zero skipped cases and zero input-validation failures. Across 24,402 rounds with both sides acting, phase order passed every check; all 93,990 defender round-start count checks passed; Asterion recorded 10,604 destroyed-defender responses. Outcomes (1,661 attacker wins, 2,085 defender wins, 343 draws) are descriptive diagnostics only, not Nemexia parity targets. The previous 4,053-battle playback omitted the 12 support-order cases because its runner/filter was unavailable and its “service-only” label was inaccurate. Asterion catalog differences and absent Nemexia seeds mean no single random winner is expected to match.

## Scope guard

Do not edit score/reward, loot, fleet, technology, or ship-stat coefficients. Do not promote an inferred weighted target selector, multi-action cadence, or exact within-side shuffle to confirmed Nemexia rules. Preserve all user-owned work outside this isolated worktree.
