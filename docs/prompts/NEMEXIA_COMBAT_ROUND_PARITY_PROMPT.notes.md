## Deviations

- Plan said: calibrate the round resolver from the provided one-battle example and leave full-stack behavior, target locking, target choice, and repeated actions open until supported.
  Code required: inspect the complete archive because the user asked for all 6,052 target transitions, all series/repeats, and cross-report validation.
  Taken: parsed the full corpus into docs/evidence/nemexia-target-transitions.csv and grouped verified plus older valid rows separately. All 6,052 intra-round transitions follow destruction of the previous target; retain-target-until-destruction is implemented. Exact next-target selector remains Asterion's existing heuristic per user direction.

- Plan said: the initial handoff did not establish destroyed defender counterfire.
  Code required: search all detailed reports for destroyed-before-response events before changing winner checks.
  Taken: implement observed defender ship count-at-round-start behavior after partial/full same-round losses, plus full-destruction responses for commander/defense only in the evidenced case. Partial-loss behavior for commander/defense stays unchanged.

- Plan said: repeated entries may be a single volley, separate same-class stacks, or abilities.
  Code required: compare all repeated rows with planned/effective ship dictionaries, actors, target sequences, ability markers, and controlled repeats.
  Taken: 11,674 attack rows in 5,622 multi-action actor-stack groups are recorded; planned inputs have one stack per class, but trigger/cadence/formula remain unestablished. Existing Asterion action count is preserved. No points, rewards, ship stats, or balance values changed.

- Plan said: keep Asterion's existing Reanimator call timing because ability events were initially unaudited.
  Code required: inspect every valid structured repair event, including cases with Reanimator and negative controls without it.
  Taken: all 648 repair entries across 273 valid reports follow the last combat action in their displayed round. The existing Asterion Reanimator effect is now resolved after both action phases, without changing chance, cap, or target selection. Repairs also appear in reports without Reanimator, so the other repair source remains unknown. The archive does not establish which side resolves a simultaneous successful repair first; Asterion keeps attacker-before-defender RNG order as its local policy.

- Plan said: target-order variability and exact within-side ordering had not been audited.
  Code required: compare clean identical-profile controls without treating a missing seed or manifest priority as source rules.
  Taken: 19 valid repeats show 19 distinct first-round sequences. Asterion fixed ordering remains as-is; the exact Nemexia ordering mechanism is explicitly listed as a decision point.

- Plan said: preserve the non-combat siege/destruction formula while changing round resolution.
  Code required: rerun Bot 01 arrival integration after the additional defender action event changes report sequencing.
  Taken: the same siege chance (1,050 bps) now gets a different seeded roll because the existing siege seed incorporates eventSequence. The roll changes from 0.0247 on base PR #82 to 0.9033 with confirmed counterfire. The planet survives in this exact seeded fixture and the related flight completes instead of failing. Updated only these integration expectations; no siege formula, RNG implementation, loot formula, or balance value changed.

## Validation

- npm run test:combat — 145 passed after adding target-lock, archived repair timing, and dual-Reanimator end-of-round assertions.
- npm run test:attack — 16 passed, 2 failures; clean base commit 35574967298a8a55b170e2b9c64d4b3b018de9af has the same two loot assertions failing at attack.test.ts:281 and :307. Bot 01 integration expectations affected by the new seeded combat event now pass.
- npm run test:application — 52 passed.
- npm run test:flights — 98 passed.
- Remaining domain scripts passed: buildings 121, espionage 29, repair 24, operations 13, command 17, reports 28, settings 6, rating 8, runtime 3, resources 6, energy 10, fleet 33, science 33, universe 36.
- Electron simulator QA passed at 1920×1080 and 1280×720; battle-report QA passed at those sizes and its additional mobile viewport. The simulator QA first collided with Electron's binary install when both UI checks ran concurrently, then passed when rerun serially.
- npm run build — passed after final resolver changes; Vite reports the existing large-chunk advisory.
- npm run dist:win — passed after moving Reanimator to round end; electron-builder reports the existing missing package description/author and default icon advisories.
- git diff --check — passed.
- Full archive playback — 4,053 Asterion runs from 1,351 supported clean inputs × 3 seeds; 12 service-only compositions skipped; 0 input-validation failures; 0 phase-order failures over 30,979 checks; 0 defender-start-count failures over 115,347 checks; 10,590 destroyed-defender responses. This playback used the final round-end Reanimator timing.

## How the run ended

Confirmed round mechanics are implemented in the shared resolver, documented with row-level evidence and archive-derived fixtures, and checked against full clean-input Asterion playback. Remaining limits, the repair-source gap, and the within-side ordering question are listed in docs/evidence/nemexia-combat-archive-analysis.md and in the Draft PR. The two remaining test:attack failures are confirmed on the clean base commit and concern existing loot assertions. No merge or Ready transition is authorized.
