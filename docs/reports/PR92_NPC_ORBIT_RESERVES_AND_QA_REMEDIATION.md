# PR #92 — follow-up audit remediation (2026-10-17)

**Repository:** `ratoker-jpg/Asterion` · **Existing Draft PR:** https://github.com/ratoker-jpg/Asterion/pull/92 · **Branch:** `codex/pr92-exploration-fields`.

**Start HEAD verified before edits:** `5d3b48ea9a9595d08f56017773e7e81c1bbf82a2`. The final HEAD must be read from PR after this report commit. Neither merge nor Ready for review was performed.

## Implemented

### 1. Test Mode UI / Electron QA

- `electron/test-mode-qa.cjs`: expected exactly **three** actual buttons: ШПИОНСКИЕ ОТЧЁТЫ, ЗАПУСТИТЬ АТАКУ BOT 01, BOT 01 · ЗАХВАТИТЬ ОБЪЕКТ (ТЕСТ).
- Every button must remain within the enclosing panel **horizontally and vertically**, have nonzero dimensions, no truncated text via scrollWidth, and have **no overlapping rectangles**. Existing QA executes at **1920×1080 and 1280×720**.
- `src/fleet-workspace.css`: responsive width-constrained grid wraps controls with multiline labels; this addresses layout rather than merely incrementing the expected count. There was no separate manual visual browser check.

### 2. Physical recyclable combat debris

- `src/application/exploration-combat.ts`: combat wreckage `calculateAttackDebris` is now credited to `state.espionage.orbitalDebris` at the actual object coordinate, with a stable ledger key and saturating `addDebris`.
- Existing `getOrbitalDebrisAtCoordinate` / `collectOrbitalDebrisAtCoordinate` and canonical Recycler mission resolve this record. No duplicate allocation on repeated resolved battle: the BattleReport ID check guards this transaction.
- Integration suite asserts the report's wreckage exists at orbit, can be consumed once, and remains unchanged after battle replay.

### 3. Shared object reserves cannot depend on first visitor

- `src/domain/exploration/ledger.ts`: finite initial reserves no longer use the resource score of the owner who materializes the operation. All users derive the same reserve for a given contact identity/variant/duration from the **already existing** `EXPLORATION_RULES.resourcePointsBase` (100,000). Formula q, weights, per-minute coefficients and finite-stock mechanics **unchanged**.
- Existing already-materialized contacts and depleted amounts remain persisted; do not rewrite them on capture.
- Caveat: this guarantees visitor-independence, **not** the more ambitious historic, dynamic galaxy-world-score-at-exact-spawn mechanic. That requires a separate authoritative historical world-snapshot scheduler and must not be silently simulated from the first observer.

### 4. Independent NPC competition — conditional on actual worlds

- `src/application/exploration-npc.ts` and `src/application/reconcile.ts`: production-only seeded attempt slots using existing `npcAttemptChance[risk]` and `riskSlotMs=180,000`, persisted progression cursor. On a qualifying attempt, chooses only an **existing registered NPC colony in the same galaxy** with actual available ships; cannot read the hidden composition of the player's fleet to size or dispatch.
- Reused and generalized `dispatchBot01Exploration` to dispatch ordinary production-owned `npc` expeditions or `attack` flights with real ships deducted from a real source world, canonical route/duration, frozen faction/technology snapshots, and no invented ships.
- The same `resolveCombat` handles an NPC attack on a player expedition; draw/defender win retains claim, eligible meaningful defense grants the existing one-time +10% for up to 2 minutes, attacker win captures **at most 30%** under survivor cargo capacity. Existing 30-second recall applies.
- Beginner protection compares real recorded resource high-water values, not covert ship quantities. Future player claims cannot become past targets during offline reconciliation.
- Production saves have a distinct, validated `ownerSide: 'npc'` flight (unlike the Bot 01 test fixture). A real NPC must **already exist** in `espionage.targets`. An empty production target registry results in **no NPC raids**, deliberately: no phantom ships or free NPC planets are minted.

### 5. Exactly-once NPC returns and resource conservation

- `src/application/exploration-bot01.ts` and `src/application/flights.ts`: on real return, `completeExplorationReturn` settles the original escrow once; capped newly delivered metal/minerals/gas are credited to the NPC source planet, debris to its own field; remaining surviving hulls are restored once to the real NPC hangar. Displaced NPC fleets carry zero escrow after loss.
- Replayed or completed flights cannot credit a second time; stable release/completion events and transition guard are used.
- Discovered and fixed a real regression: existing NPC test planets can already hold more resources than their currently constructed storage capacity. Delivery must **never burn that preexisting wealth**. Effective delivery caps preserve current balances while rejecting additional overflow.
- The successful return after an actual battle is covered by domain paths; exhaustive mixed production NPC return/combat/expiry matrices remain open.

### 6. Deterministic tests

- `src/domain/exploration/exploration.test.ts`: visitor-invariant finite stock, three explicit settlement outcomes attacker/defender/draw and the existing meaningful +10% / 2min once-only protection, 30-second recall, rare reward, 70% recon and 120-second cooldown.
- `src/application/exploration.integration.test.ts`: real resolver against occupied field, 30% cargo on arrival, orbital debris availability/consumption/replay, Bot 01 finite fleet/real wallet return and repeated-load invariants, strict production NPC flight serialization without converting ownership to player.
- `electron/test-mode-qa.cjs`: responsive geometric controls at two resolutions.

## Evidence, without claiming uncompleted checks

- [CI `38975035133`](https://github.com/ratoker-jpg/Asterion/actions/runs/38975035133) at SHA `1824da0e`: **PR92 exploration domain tests SUCCESS**, **Build renderer SUCCESS**; other steps still running when last checked.
- [CI `38975192195`](https://github.com/ratoker-jpg/Asterion/actions/runs/38975192195) at SHA `29ede971`: **PR92 exploration domain tests SUCCESS**, later generic suites still running when checked.
- [Pages `38974881262`](https://github.com/ratoker-jpg/Asterion/actions/runs/38974881262): **SUCCESS** on intermediate SHA `00ace1f7`. Pages for latest HEAD is triggered automatically by each push; verify latest run before treating preview as current.
- Test preview: https://ratoker-jpg.github.io/Asterion/pr/92/ . The deployed **exact latest HEAD was not confirmed** via `preview-sha.txt` or browser screenshot.
- Full end-to-end Test Mode Electron QA may still be pending on latest CI; never infer green status from successful TypeScript/build.

## Explicitly not yet covered / reviewer blockers

1. **Initial ordinary-game NPC population:** existing production save may have no genuine NPC worlds at all; no fleets are invented. In that case automated competition is dormant, although its scheduler exists. Seeding persistent NPC homeworlds with approved starting assets is a **separate product/balance decision** and was not done.
2. **True appearance-time world score:** dynamic immutable galaxy-wide score at the exact spawn tick is not available; existing shared baseline is deterministic and unbiased, but differs from a future historical score snapshot.
3. **Exhaustive live battle matrix:** real resolver tested on canonical contested attack, while deterministic attacker/defender/draw invariant cases are tested at territory settlement level; automatic NPC attacks under every mix of ship composition, physical ship return on defeat, exact tie-arrival ordering and multi-day offline replay still need an explicit extended corpus.
4. **Full visual inspection:** Electron layout bounds at two viewports are asserted; an independent manual screenshot review was not performed.
5. **Full recycler flight E2E after field battle:** the exact orbit API used by recycler arrival is covered, but separate dispatched Recycler flight + report + return tested against the fresh combat field is still not in the dedicated PR92 test corpus.
6. **Production performance and NPC density:** no large population load/performance measurements or confirmed nonempty production NPC target registry; do not claim live PvE competition already appears in every account.

## Preserved design constants

No adjustments to `EXPLORATION_RULES`: capture 0.30; defense mining multiplier 1.10, 120,000ms and one use; recall 30,000ms; recon success 0.70 and cooldown 120,000ms; lifespan still assigned by existing universe schedule (15–20 minutes); risk and hazard probabilities unchanged. No code outside the existing PR branch was modified.

**Merge decision remains exclusively with the owner.**

## Follow-up after resume (17 Oct 2026)

The branch was verified again after an interrupted step. Actual repository HEAD had advanced to `d05dcbcd`; that complete CI failed **only** at `Universe planet interaction Electron QA`, while `PR92 exploration domain tests`, `Reports domain tests`, `Build renderer`, `Reports Electron QA` and `Test Mode Electron QA` all passed.

**Fixed the inspector QA regression** (`electron/universe-planet-qa.cjs`): an older assertion still demanded disabled exploration controls and the retired copy `Владелец отсутствует`. The game now correctly exposes clickable reconnaissance and expedition actions on free unique/anomaly objects. The new assertions check both enabled actions, real object/art rendering and expiry text; they do NOT disable UI just to pass CI. The old controls count/layout check remains active in `electron/test-mode-qa.cjs` at 1920×1080 and 1280×720.

**Extended the recycler regression** (`src/application/exploration.integration.test.ts`): not only the existing orbit-stock collector API, but the full actual `dispatchFlight(missionId='recycle')` path on a freshly contested object, real arrival report, exact orbital decrease and no duplicate report/collection on replay. This case is guarded on positive generated battle debris, and verifies the original report's amount.

Latest CI/Pages runs for the final HEAD must be looked up on the PR; a successful earlier Pages deploy alone does not certify the final change. Outstanding product design limitation still holds: autonomous competition requires already registered real production NPC colonies, and dynamic world score at the exact historic spawn moment is not available. Do not claim these are solved by test fixtures or the shared baseline. **No merge or Ready for review.**
