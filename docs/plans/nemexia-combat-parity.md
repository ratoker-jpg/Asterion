# Nemexia combat mechanics parity — implementation plan

## Objective

Implement report-confirmed Nemexia round behavior and source-backed combat catalog data in Asterion's shared combat system, then validate against the full saved-input archive. Do not tune win-rate or change points, rewards, loot, ship statistics, or balance coefficients; source-backed defense-stat corrections are in scope.

## Evidence contract

The source of truth is docs/evidence/nemexia-combat-archive-analysis.md plus the row-level docs/evidence/nemexia-target-transitions.csv. The 1,472 JSONL records are partitioned by capture errors, verified reports, structurally valid older reports, and summary-only reports. Harness manifest fields are grouping factors, not game rules. Nemexia seed is absent, so compare structural invariants and series behavior, never a particular stochastic winner.

## Implementation slices

| Slice | Decision and implementation | Status |
| --- | --- | --- |
| 1. Full archive audit | Parse all 6,052 same-round target transitions with target rosters, order/counts, actor class/faction, previous-target death event, and source references. Group by campaign/control block and validate target_priority separately from 6,000 held-out transitions. | Complete |
| 2. Side phases and defender counts | Keep attacker phase before defender phase. For defender ships, report-confirmed actions use the round-opening count after partial or complete same-round losses. A destroyed commander or defense may respond at its round-opening count only in the observed full-destruction case with a living target. Persist real losses into the next round. | Implemented in shared resolver |
| 3. Target lock | Corpus evidence: all 6,052 extracted within-round switches occur only after the previous target is destroyed. User-directed Asterion policy: retain a selected live target across rounds until it is destroyed, then use the existing Asterion selector. The archive does not independently establish Nemexia's cross-round lock behavior. Do not infer the target selector from the harness priority field. | Implemented in shared resolver |
| 4. Extra actions | The archive confirms repeated action rows from one stack, including groups of 2–5, but cannot identify cause/cadence or per-action formula. The supplied detailed profile demonstrates up to five diminishing volleys after target destruction. Implement this evidenced 100/80/60/40/20 sequence for ship stacks only; keep its universal cause/cadence as an inference. | Implemented / inferred rule documented |
| 5. Abilities and defenses | Keep existing commander formulas. Add the confirmed full-destruction response for commander/defense. Separate commander Reanimator from ordinary Destroyer Revival. Implement the official Destroyer chance/amount only for Aegis/Confederation; 641/641 archive amounts match round-half-up of per-target casualties × Destroyers-after-round bonus. Implement Veyra Shmel freezing from the saved tooltip (0.04% per ship, capped at 20%) and skip the target's next action; seeded random target selection is explicitly an Asterion approximation because Nemexia's selector/RNG timing is undocumented. Keep Goliath/Synod and Hornet/Veyra out of Revival. | Implemented / documented boundary |
| 6. Draw and completion | Preserve Asterion draw on mutual destruction and configured round limit. Archive shows both kinds of draw but round limits 5/8/12 come from the harness, not a universal Nemexia cap. | Existing behavior retained |
| 7. Within-side action order | The 19 valid identical-profile repeats have 19 different first-round ordinary ship sequences. Across 192 adjacent-round comparisons with at least two common actors, no ordinary-stack relative-order inversion occurred. The supplied 15k Aegis-vs-Veyra report interleaves Death Star with ordinary combat ships. Shuffle all combat-ship stack slots once at battle start with the battle seed; keep that order across rounds. Keep commanders, defense, and non-combat support hulls in their existing slots/order. This seeded shuffle is an Asterion approximation, not Nemexia’s recovered RNG algorithm. | Implemented in shared resolver |
| 8. Seed provenance | Preserve explicit flight/raid seeds. Generate and record a unique seed whenever a new resolver battle omits one; the saved report seed must reproduce the same report with the same input and engine version. | Implemented in shared resolver |
| 9. Validation and review | Run the full domain suite, requested integration checks, simulator and battle-report Electron QA at the scripted 1920×1080 / 1280×720 viewports, Windows packaging, full archive Asterion playback, diff audit, and independent read-only review. Create only a Draft PR; do not merge or mark Ready. | Previous full implementation passed its CI/QA; the current defense-stat delta was separately rechecked with combat/application/flights/build, archive playback, and read-only review. `test:attack` still has the two previously reported baseline loot assertions. |
| 10. Defense catalog parity | Apply the 27 saved faction defense combat profiles to the runtime catalog; use later in-game Ion-Plasma values where available: Synod current tooltip (42,000/524,000/9%) and Veyra calibration report (20,300/247,600/9%), instead of the older July help-page rows. Add a golden assertion for all 27 rows and replay all clean archive cases. | Implemented; golden catalog test, 4,089-trial archive playback, build, and independent review pass; winner totals unchanged and the Synod r2-d2-n100 duration remains 2 rounds longer than the Nemexia report |

## Checks

Required commands:

- npm run test:combat
- npm run test:attack
- npm run test:application
- npm run test:flights
- npm run build
- git diff --check

Archive playback after the defense catalog correction used three independent Asterion seeds per source case: all 1,363 clean cases ran (4,089 battles), with zero skips and zero input-validation failures. Across 25,780 rounds, all 25,747 attacker→defender order checks and 102,540 defender round-start count checks passed; there were 12,432 destroyed-defender response events. Outcomes were A1,600 / D1,675 / X814. The 1,363 Nemexia source reports were A562 / D739 / X62. Asterion's excess draws remain large and global outcome-distribution distance did not improve from the immediately prior playback. The defense-doses and n100 slices move locally toward defender wins, but this phase does not establish overall parity. Nemexia seeds are absent, and exact first-target/proc cadence remain unresolved.

## Scope guard

Do not edit score/reward, loot, fleet, technology, ship-stat coefficients, or outcome-balancing coefficients. Source-backed defense-stat corrections are allowed. Do not promote an inferred target selector, ability-proc cadence, multi-action cadence, or exact within-side shuffle to confirmed Nemexia rules. Preserve all user-owned work outside this isolated worktree.

## Follow-up: 15,000-population Aegis vs Veyra control profile (2026-09-28)

The latest user instruction supersedes Slice 4's earlier decision to preserve one action per stack: make this exact zero-technology, zero-level, no-commander/no-defense profile produce outcomes close to the supplied Nemexia report, without hardcoding a winner. The Asterion screenshot's attacker win with about 6,800 population after seven rounds is materially unlike the Nemexia report's defender win in round two with 5,873 remaining population.

### Evidence and bounded decisions

- The supplied report and saved Auto v2 pages show class-specific primary target sets and +70%/-30% matchups, including Death Star / Nox Queen interactions. Apply the saved-page tables to all three races; do not use the conflicting public Help target table as this profile's authority.
- In the supplied report, a ship stack starts another action only after its current target is destroyed. Attack power for the demonstrated follow-up sequence is 100%, 80%, 60%, 40%, then 20% of that stack's full volley, with the matchup modifier applied to each volley. Treat the decrement as an evidence-backed inference from the detailed profile, not a fully proven universal rule.
- Archive transitions prove that target changes follow prior-target destruction, but do not identify the complete fallback selector. Apply a class-priority target when present; leave the current Asterion selector as the explicitly labeled fallback until stronger evidence establishes more.
- Preserve attacker-first phase order, seeded one-time combat-ship action shuffle (including Death Star), defender round-start counterfire, ship data, points, rewards, and repair rules. Apply the tooltip-documented Shmel freeze chance and mark its unknown target selector/RNG timing as approximation.

### Implementation / acceptance

1. Extend combat target classes/matchups and implement per-ship priority sets from the saved pages, including death-star.
2. Let ship stacks (not commanders or defenses) continue a volley sequence only while each prior target is destroyed and their side still has targets; apply the report-derived linear 20% per-follow-up falloff. Stop when a target survives. Keep all state/attacks deterministic under the saved battle seed.
3. Add the exact profile as a regression fixture. Assert report-matched round-one survivors, primary targets, matchup modifiers, same-stack retarget sequence, falloff, seeded replayability, and the fixed seed's round-two defender outcome. Do not special-case the winner in resolver logic. Record winner/round/survivor distributions for a fixed Asterion seed sweep; do not claim a Nemexia win-rate comparison from one Nemexia report.
4. Replay the clean Nemexia archive after implementation and report which invariants improve, while keeping unresolved fallback selector, multi-attack cause, and RNG equivalence explicit.

### Known comparison limit

Nemexia seed is absent and the exact 15,000-vs-15,000 profile has one supplied detailed report, not a Nemexia repeat series. Acceptance is therefore close mechanic/round/survivor behavior for the recorded profile plus deterministic Asterion seed sweeps; it cannot require identical stochastic winners seed-for-seed or estimate Nemexia win frequency.

### 15,000-profile comparison measured on 2026-09-28

The deterministic Asterion seed `nemexia-15k-control` reproduces the supplied Nemexia report's entire round-one survivor counts: Aegis ends the round with 93 Defenders, 2 Cruisers, 38 Battleships, 70 Destroyers, 95 Bombers, and 4 Death Stars; Veyra has 100 Defenders, 42 Destroyers, 89 Bombers, and 17 Death Stars, with its other three stacks destroyed. Both reports then end with a defender win in round two. Asterion's fixed-seed survivor population is 4,519 versus Nemexia's reported 5,873 (difference 1,354, or 23.1% of the Nemexia total); the Asterion fixed-seed survivors are 100 Defenders, 79 Bombers, and 8 Death Stars. The comparison is deliberately recorded as measured, not claimed as exact parity.

A 500-seed sweep (`control-0` through `control-499`) of that same Asterion profile produced 500 defender wins: 123 ended in round two, 299 in round three, and 78 in round four. Defender survivor population ranged from 3,459 to 5,873 (median 4,519); two seeds reached exactly 5,873, both in round three. Thus the observed winner matches the one Nemexia report in every Asterion seed, but round count and surviving population vary with Asterion's seeded action order and ability rolls. This sweep is not a Nemexia win-rate estimate because Nemexia has only one report for this exact profile and its random seed is unavailable.

The seeded report regression in `src/domain/combat/resolver.test.ts` now locks the matching round-one survivor counts and this named seed's round-two defender win. It also keeps the 4,519-vs-5,873 residual visible; the other 500-seed results are documented as diagnostics rather than passing criteria against an unknown Nemexia distribution.
