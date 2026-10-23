# NPC science — implementation report, 2026-10-23

## Revision and status

- Base `main`: `34000847794156ec912439fd23e510e8accec1b6` (PR103), verified by fetch.
- Draft PR: https://github.com/ratoker-jpg/Asterion/pull/104
- Branch: `codex/npc-science-pr104`.
- Final executable-code HEAD tested locally: `2d06ace169fe0323a4f91111967600ae9bedb2dc`. Subsequent evidence/report commits do not change executable code.
- Implementation commits: `3e50e5c` (paid owner science, migration, chronology and tests), `2d06ace` (measured replay optimization and QA compatibility).
- The user explicitly authorized GPT-6.1 Sol coordination with GPT-6 Luna workers. Independent workers investigated contracts, implemented bounded disjoint changes/tests, and reviewed timing/cache correctness. Root integrated changes and ran final validation.
- PR remains Draft. No merge and no Ready transition were performed. Latest-head CI is available on the PR; its final status is reported separately after the report commit finishes CI.

## Result for the player

NPCs can build a research laboratory using ordinary paid construction, then start and finish real research from their own resources. Research, laboratories, economic buildings and waiting compete for one existing scheduled decision. Science focus raises research/laboratory preference; economy focus raises economic-building preference. The 5–15 minute calendar and 36-attempt session bound remain unchanged.

NPCs use the unchanged 21-science catalogue, shared previews, research start and reconciliation. No free laboratory, resource grant, science level or new technology ID was added. The generated zero-lab production campaign test completes the laboratory → payment → research → finish → effect path within 30 days.

### Canonical ownership and payment

`SaveState.npcScience` is a version-1 ledger containing one `ScienceState { levels, queue }` per owner, plus a persisted `activatedAt`. Each paid task stores its payer `planetId`, exact cost, start, duration and finish. All that owner's NPC planets receive the same completed levels through `ownerProfile.scienceLevels`; existing defense/espionage consumers therefore observe completed science. Player science, other owners and Bot 01 remain separate.

Research start previews the real planetary wallet/laboratory, charges its resources and one-time energy atomically, and records a stable decision-derived task/transaction ID. Repeated replay is rejected by the persisted owner decision cursor; active-task and paid-action IDs also suppress duplicate execution. Failed previews/blocked planets leave wallet and queue unchanged. The shared science runtime enforces queue capacity 3, levels, prerequisites and direction exclusion.

Destroyed payer tasks are discarded without refund through the existing player-domain destruction transition. Invalid surviving-payer successors follow that transition's existing refund rules and credit only their surviving payer, with warehouse caps. If no NPC planets remain for an owner, its scientific ledger row is removed; orphan queues cannot continue forever. NPC persona/cursor retention is unchanged.

### Legacy saves

Schema advances from 26 to 27; NPC persona state remains version 1. Existing owner-profile levels are merged by owner, taking maxima across that owner's planets; legacy queues begin empty. No task or free level is synthesized. Missing owner profiles mean zero knowledge.

The activation baseline is `max(saved resourceClock.lastReconciledAt, saved npcReplay.targetAt)`. An already partially committed v26 month catch-up therefore finishes under the old decision policy before science can start. Reloads preserve this baseline, queue snapshots, resources and cursors. An actual one-NPC v26 prefix through day 1 plus a frozen day-30 target is exercised through migration, catch-up and repeated persistence round trips.

Schema27 requires a valid ledger. Strict guards check its version, owner rows, level bounds, known numeric IDs, queue capacity, task IDs/payers, FIFO, exact duration arithmetic, sequential levels and additional-direction exclusion. Malformed/future saves are refused by the existing load/write health gates; regression tests verify original bytes remain unchanged.

### Exact timeline and effects

Only the nearest owner queue-head completion is added to checkpoint selection; catalogue previews run only during decisions. Before science completion, affected planets settle income at old rates to that exact millisecond. Completed owner levels are projected atomically, then subsequent intervals use new rates. Physics transitions existing energy sources without resetting consumption or restoring spent energy. Saved active durations/costs are not recalculated.

At a shared checkpoint, current `reconcile.ts` orders: old-rate NPC settlement and due construction/science → existing asteroid/orbit transition → fleet arrivals/battles in their stable order → due pirate rolls (including re-selection after arrivals) → exploration NPC events → post-combat settlement/payer cleanup → NPC session boundaries → NPC decisions. An automatic pirate roll dispatches a flight; it is not itself an immediate battle. A pirate battle occurs when that flight arrives in the fleet-arrival stage. Existing asteroid/combat micro-order is retained.

The real combat regression proves science finishing at a player-fleet arrival changes the defender's actual combat technology while the attacker retains its immutable launch snapshot. Event-priority and source-path checks verify the broader ordering. **One combined runtime fixture with an actual pirate battle, player arrival, generated NPC decision and science completion all on the same millisecond was not executed**; the exact generalized ordering above is verified from the current orchestration code rather than claimed as a four-way integration-test result.

Overpopulation pauses FIFO research only while the paying task is actually active/blocked. Tests cover irregular chunks, reload, distinct payer planets, due-before-lock work and a no-eligible-units lock persisting beyond the nominal burn window, including the final interval before actual unlock.

## File map

| Files | Purpose |
|---|---|
| `src/domain/npc/science-state.ts`, `application/contracts.ts`, `persistence.ts`, `domain/session/save-health.ts` | Canonical ledger, schema27 migration, immediate load projection, strict preservation guards |
| `src/application/npc-science.ts`, `npc-economy.ts` | Paid science adapter, effects, energy, pauses, destroyed payers |
| `src/domain/npc/economy-policy.ts`, `application/npc-replay.ts` | Shared deterministic building/science/wait choice within existing attempts |
| `src/application/reconcile.ts` | Precise completion checkpoints, ordering, bounded catch-up |
| `src/domain/science/runtime.ts` | Explicit duration scale; unchanged formula and legacy caller behavior |
| `src/domain/rating/scoring.ts` | Canonical science levels and paid queue counted once per owner; single-owner lookup avoids unrelated registrations |
| `src/domain/universe/asteroid-simulation.ts`, `asteroid-gas.ts` | Profile-driven, behavior-preserving replay optimizations |
| `src/application/npc-science*.test.ts`, related domain tests | Real-engine progression, payment, migration, isolation, combat, pause and replay regressions |
| `electron/production-test-isolation-qa.cjs`, `electron/npc-replay-qa.cjs` | QA reads current active save slots; optional 1/7-day measurement with unchanged default 30 days and 120-second timeout |
| `.github/workflows/ci.yml` | Retains raw Electron full-world evidence in the existing measurement artifact alongside Node output; no check or budget is removed |

## Executed checks

Node v24.16.0, Windows 10.0.19045 x64, AMD Ryzen 5 5600 (12 logical CPUs). `npm ci --no-audit --no-fund` succeeded. Local logs are under `artifacts/npc-science-validation/` in the feature checkout; report JSON evidence is committed beside this file.

| Command | Actual result |
|---|---|
| `npm run test:science` | 35 passed |
| `npm run test:npc` | 73 passed on final executable-code HEAD, including the Sun-cache regression |
| `npm run test:buildings` | 123 passed |
| `npm run test:energy` | 10 passed |
| `npm run test:application` | 73 passed |
| `npm run test:espionage` | 39 passed |
| `npm run test:attack` | 26 passed |
| `npm run test:rating` | 21 passed |
| `npm run test:new-game` | 31 passed |
| `npm run test:combat` / `test:pirates` / `test:pirate-operations` | 169 / 73 / 33 passed |
| `npm run test:flights` / `test:exploration` / `test:fleet` | 137 / 38 / 35 passed |
| `npm run test:command` / `test:reports` / `test:settings` | 73 / 33 / 6 passed |
| `npm run test:operations` / `test:runtime` / `test:repair` / `test:resources` / `test:sun-raid` | 7 / 3 / 24 / 6 / 21 passed |
| `npm run test:universe` | 42 passed, including serialized/cold cache branching and exact BigInt-reference gas comparisons |
| `npm run test:inventory` / `npm run assets:asterion:audit` | Passed; test assignment and asset inventory retained |
| `npx tsc --noEmit` / `npm run build` / `git diff --check` | Passed |
| `npm run test:science-ui` | Passed, both existing viewports |
| `npm run test:production-test-isolation-ui` | Passed after repairing the pre-existing QA assumption that Production always used the legacy key |
| `npm run test:npc-replay-ui` | Passed, scoped economy scenario; distinct from full-world evidence below |
| `npm run benchmark:npc-replay` | Passed 3 repeats at each 1/7/30-day horizon; reported parity matches |
| `npm run dist:win` | Passed again on final executable-code HEAD; Windows installer CI also passed |

The science replay tests compare canonical owner science, target state and completion events at exact 1/3/7/30-day horizons, continuous/irregular partitions and persistence round trips, with separate seed/speed scenarios. Slow/standard/fast science duration parity is also checked directly against the player runtime.

## Full-world performance

The unchanged scenario has 10 galaxies, 100 real NPC owners, and active asteroid, pirate and exploration timelines. The 120,000 ms limit was not raised and the fixture was not reduced. Node commands: `npm run --silent benchmark:npc-full-world -- 1 7 30 --repeats=1`; final replay also used `--fixture=artifacts/npc-science-validation/full-world-fixture.json`. Electron: `npx electron electron/npc-replay-qa.cjs --full-world --days=1|7|30` with isolated profiles/output paths. Default `test:npc-replay-full-world-ui` still means 30 days.

| Horizon | Base Node compute ms | Final Node compute ms | Base Electron wall ms | Final isolated Electron wall ms |
|---:|---:|---:|---:|---:|
| 1 day | 1,947.208 | 1,388.315 | 6,960 | 2,019 |
| 7 days | 14,960.606 | 12,379.377 | 25,591 (retry) | 14,382 |
| 30 days | 123,722.042 | 116,567.209 | 120,050, timeout with pending work | 67,729, complete |

These are measured local samples, not a guarantee on every host. The first 7-day baseline Electron attempt failed its initial pending-state wait and emitted no timing; its fresh-profile retry passed. Base and feature Electron start times are recorded independently in the JSON evidence. Intermediate feature runs exceeded the budget (including a 120-second Electron timeout and Node 192.6/178.1-second samples); the issue was investigated rather than hidden. A first successful but concurrently loaded Electron repeat took 112,940 ms; the final isolated repeat above took 67,729 ms.

Windows Actions on executable-code HEAD `2d06ace` also passed the full-world job: Node 1/7/30-day compute was 1,485.270 / 13,534.194 / 99,278.305 ms; Electron completed all 30 days in 101,755 ms with pending=false. Host: Intel Xeon Platinum 8370C @ 2.80 GHz. Actual job: https://github.com/ratoker-jpg/Asterion/actions/runs/39980238111/job/120505322646 . Node and Electron source evidence is retained in `NPC_SCIENCE_PR104_CI_CODE_HEAD_NODE.json` and `NPC_SCIENCE_PR104_CI_CODE_HEAD_ELECTRON.json`. Latest report/evidence/QA-artifact-path changes trigger a further unchanged-scenario CI run; consult its final result on the PR.

The late-horizon CPU profile attributed 27.68 s of own samples to asteroid timestamp processing and 19.16 s to energy-ledger hydration. Optimizations reuse immutable building/income/energy derivations, include dynamic Sun brightness in energy invalidation, retain a consumed transient occupancy index without modifying old replay branches, and use exact bounded gas arithmetic before saturation. A Sun dim/restore regression closed a cache invalidation defect found by independent review.

For the same saved fixture, full state digests **and** normalized game-state digests match at 1/7/30 days before and after the last optimization pass. See `NPC_SCIENCE_PR104_PERF_PARITY_BEFORE.json` versus `NPC_SCIENCE_PR104_FULL_WORLD_AFTER.json`. Base-versus-feature states are intentionally different because NPCs now pay for and learn science.

Final Node save sizes are 1,864,121 / 4,820,718 / 8,726,620 JSON characters at 1/7/30 days; baseline sizes are 1,811,642 / 4,671,132 / 8,449,465. These are characters, not claimed UTF-8 bytes. Final Electron persisted sizes are recorded in `NPC_SCIENCE_PR104_ELECTRON_FULL_WORLD.json`; 30 days is 8,408,823 characters with no persistence notice.

## Limits for independent review

- Consult latest-head GitHub checks, especially the actual full-world artifact; an older green run or an informational label is not evidence for a later SHA.
- Local final Electron 30-day Long Task p95/max was 81/85 ms. Its separate timer-gap probe recorded p95 417.1 ms and one 19,133.5 ms gap despite completion within budget. Cause of that isolated scheduling gap is not established; this report does not claim a complete UI responsiveness audit. Raw before/after probes are retained.
- Exact all-four simultaneous combat/decision ordering has source verification and the real timer/arrival regression, with the combined-fixture limitation stated above.
- No fleet construction, new NPC-initiated attacks/flights, colonization, diplomacy, UI tabs, catalogue rebalance or merge was added.

Committed evidence: `NPC_SCIENCE_PR104_FULL_WORLD_BEFORE.json`, `NPC_SCIENCE_PR104_FULL_WORLD_AFTER.json`, `NPC_SCIENCE_PR104_PERF_PARITY_BEFORE.json`, `NPC_SCIENCE_PR104_ELECTRON_FULL_WORLD.json`. PR remains **Draft**; merge and Ready remain owner decisions.
