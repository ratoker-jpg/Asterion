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
  Code required: inspect all 648 structured repair entries, including entries with Reanimator and negative controls without it, then compare races and post-round Destroyer counts.
  Taken: seven entries in four reports are commander Reanimator; all remaining 641 entries are ordinary Destroyer Revival on Aegis/Confederation, and all match the official chance/amount formula using Destroyers functioning after the round. No entry revives a Destroyer. Asterion implements the separate Revival ability only for Aegis, and Reanimator remains a separate commander ability. The per-target-stack seeded chance is the best-supported approximation; the exact Nemexia RNG granularity is undocumented.

- Plan said: target-order variability and exact within-side ordering had not been audited.
  Code required: compare clean identical-profile controls without treating a missing seed or manifest priority as source rules.
  Taken: 19 valid repeats show 19 distinct first-round ordinary-ship sequences, while 192 adjacent-round comparisons preserve relative order. Each Asterion battle now seeded-shuffles ordinary ship stacks once, then uses that order throughout the fight; commanders, defenses, and non-ordinary ships are not mixed into the shuffle because the controls contain no evidence for them. Exact Nemexia shuffle/RNG remains unknown.

- Plan said: unseeded resolver runs were non-replayable.
  Code required: make a new seed available to every new battle and preserve it in the report.
  Taken: each resolver battle without a supplied seed gets a generated seed; reports carry seeded RNG provenance, and identical inputs with the same saved seed replay identically. Existing player/Bot 01 flight seed sources remain unchanged.

- Plan said: preserve the non-combat siege/destruction formula while changing round resolution.
  Code required: rerun Bot 01 arrival integration after the additional defender action event changes report sequencing.
  Taken: the same siege chance (1,050 bps) now gets a different seeded roll because the existing siege seed incorporates eventSequence. The roll changes from 0.0247 on base PR #82 to 0.9033 with confirmed counterfire. The planet survives in this exact seeded fixture and the related flight completes instead of failing. Updated only these integration expectations; no siege formula, RNG implementation, loot formula, or balance value changed.

## Validation

- npm run test:combat — 148 passed after adding seeded ordinary-order and Destroyer Revival coverage.
- npm run test:attack — 16 passed, 2 failures; clean base commit 35574967298a8a55b170e2b9c64d4b3b018de9af has the same two loot assertions failing at attack.test.ts:281 and :307. Bot 01 integration expectations affected by the new seeded combat event now pass.
- npm run test:application — 52 passed.
- npm run test:flights — 98 passed.
- Remaining domain scripts passed: buildings 121, espionage 29, repair 24, operations 13, command 17, reports 28, settings 6, rating 8, runtime 3, resources 6, energy 10, fleet 33, science 33, universe 36.
- Electron simulator QA passed at 1920×1080 and 1280×720; battle-report QA passed at those sizes and its additional mobile viewport. The simulator QA first collided with Electron's binary install when both UI checks ran concurrently, then passed when rerun serially.
- npm run build — passed after the resolver and report changes; Vite emitted only its existing large-chunk advisory.
- npm run dist:win — passed after moving Reanimator to round end; electron-builder reports the existing missing package description/author and default icon advisories.
- git diff --check — passed.
- Full archive playback — passed after seeded ordering and Destroyer Revival changes: 1,363 clean source cases × 3 Asterion seeds = 4,089 battles; all 12 previously omitted support-order cases included; 0 input validation failures; 24,402 phase-order checks and 93,990 defender-start-count checks passed; 10,604 destroyed-defender responses observed. Asterion outcomes (1,661 attacker wins / 2,085 defender wins / 343 draws) are descriptive only because Nemexia seed is absent.

## How the run ended

Confirmed round mechanics are implemented in the shared resolver, documented with row-level evidence and archive-derived fixtures. Remaining limits include exact next-target choice, additional-action cadence, cross-round target persistence in Nemexia, the exact shuffle algorithm and eligible non-ordinary actors, plus Revival's exact RNG granularity. The two test:attack failures were confirmed on the clean base commit and concern existing loot assertions. Full archive playback and build are complete. Changes are recorded on branch `codex/combat-parity-prompt` and Draft PR [#83](https://github.com/ratoker-jpg/Asterion/pull/83); it remains a draft and no merge or Ready transition is authorized.
