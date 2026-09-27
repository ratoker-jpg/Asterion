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
| 5. Abilities and defenses | Keep existing Asterion ability formulas. Add the confirmed full-destruction response for commander/defense. Archive places all 648 repair events after the round's last combat action; defer existing Reanimator processing to round end without changing its chance/cap/target formula. Repairs also occur without Reanimator, so source is unknown. Partial-loss count behavior for commander/defense and other ability markers remain uncalibrated. | Implemented / documented gap |
| 6. Draw and completion | Preserve Asterion draw on mutual destruction and configured round limit. Archive shows both kinds of draw but round limits 5/8/12 come from the harness, not a universal Nemexia cap. | Existing behavior retained |
| 7. Within-side action order | Archive shows 19 valid identical-profile repeats with 19 different first-round action sequences. It confirms variability but not the ordering/RNG algorithm. Asterion currently retains its fixed within-side order. The implementation choice between preserving that behavior and adding a seeded shuffle approximation is pending user input. | User decision pending |
| 8. Validation and review | Run the full domain suite, requested integration checks, simulator and battle-report Electron QA at the scripted 1920×1080 / 1280×720 viewports, Windows packaging, full archive Asterion playback, diff audit, and independent read-only review. Create only a Draft PR; do not merge or mark Ready. | Checks complete; Draft PR pending |

## Checks

Required commands:

- npm run test:combat
- npm run test:attack
- npm run test:application
- npm run test:flights
- npm run build
- git diff --check

Archive playback uses clean recorded Nemexia forms and multiple independent Asterion seeds. It validates input mapping, side phase order, defender round-start counts and full-destruction responses. Asterion catalog differences and absent Nemexia seeds mean outcome counts are descriptive diagnostics only.

## Scope guard

Do not edit score/reward, loot, fleet, technology, or ship-stat coefficients. Do not promote an inferred weighted target selector, multi-action cadence, or exact within-side shuffle to confirmed Nemexia rules. Preserve all user-owned work outside this isolated worktree.
