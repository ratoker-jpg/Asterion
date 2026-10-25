# NPC full autonomy — implementation in progress

Status: INCOMPLETE. This report is a checkpoint, not an acceptance claim.

## Authorized scope and decisions

- Full autonomy in one Draft PR targeting main, following the supplied 2026-10-23 prompt and audit. No merge or Ready action authorized.
- Integrator: GPT-6.1 Sol; all delegated agents: GPT-6 Luna, explicitly requested by the owner.
- Owner decision on 2026-10-24: NPC attacks on a neutral player are permitted when existing canonical domain rules permit them. No new war requirement or combat formula.
- Existing domain rules remain authoritative for prices, starting resources, colony limits, membership and mission eligibility. Unknown product rules must be referred to the owner before implementation.

## Baseline evidence

- Fetched origin/main: `27fd302cc2b5f877550dbef76d95e24fee2885cc`; GitHub open PR query returned none.
- Isolated branch: `codex/npc-full-autonomy-unified`; unrelated original checkout changes preserved.
- `npm ci --no-audit --no-fund`: passed.
- Unchanged baseline `npm run build`: passed.
- Unchanged baseline `npm run test:repair-ui`: passed at 1920x1080 and 1280x720. Raw result: `artifacts-pass1/repair-workshop-qa/results.json`.
- Historical main CI run 39987106414 failed the second viewport's defensive repair predicate. Inspection and one local reproduction attempt did not establish the cause. No timeout increase, test bypass or speculative behavior change was made. Final full CI remains required.
- Fresh Graphify structural graph: 379 files, 4,481 nodes, 16,704 edges; generated from baseline SHA under ignored `src/graphify-out`, with source-head.txt. Older workspace graph is stale and not used as current evidence.

## Integration order

1. Owner-scoped canonical production and prerequisite buildings; persisted queue validation and exact completion chronology.
2. Owner-bound physical mission kernel, probe observations and returns; combat and colony settlement.
3. Production PvE sources/real fleet competition, diplomacy through existing owner commands, remembered strategy.
4. Replay/save migrations, same-time ordering, large-world measurement, full domain/build/Electron/package checks and final independent review.

The existing decision calendar, 5–15 minute delays, maximum 36 attempts per session and frozen catch-up target are retained. All new choices must compete in that one attempt. Active physical state must never be pruned as history.

## Implemented checkpoint

- `npc-autonomy.ts` supplies one owner-wide weighted choice across legal building/science/production/mission/diplomacy/aid candidates from all real owner planets. The original schedule, cursor and attempt count are retained. Actual paying planet and canonical economy receipt are emitted separately from the decision ID.
- `npc-fleet-production.ts` reuses canonical enqueue/reconcile for all three queues and faction catalog requirements. Production context supports explicit persisted duration scale and travelling fleet population for capacity checks. Completion is a chronological NPC timer; queues pause alongside construction during blocked intervals.
- `npc-missions.ts` physically debits ships/gas, persists `ownerId`, reuses route/fuel/slots, resolves player targets without inserting them into the NPC registry, generates owner-scoped spy reports/knowledge, creates real colonies under the existing seven-planet limit, and restores battle survivors/cargo once at return. Competing colonizers resolve by real arrival order.
- `attack.ts` shares the existing combat, satellite, siege, repair, loot and destruction engines for NPC→NPC and NPC→player; loss observations update private memory. Live relations and target identity are revalidated at execution.
- `npc-pirates.ts` supplies real pirate recon/elimination through canonical snapshots and resolver. Its isolated ephemeral owner adapter uses a player runtime only as a structural template; no shadow player state is merged back. This boundary needs final adversarial review.
- `npc-diplomacy.ts` calls owner-neutral membership/diplomacy commands with the acting NPC. `npc-aid.ts` debits real transports/cargo and credits actual accepted delivery once. Player invitations/applications/truce decisions are never executed by the AI as the player.
- `autonomy-policy.ts` uses deterministic trait weights, explicit observed outcomes, bounded memory/goals and persisted replanning. Mission policy uses public identities/map and the acting owner's own observations; it does not use enemy force or wallet to choose attacks.
- Schema 28 and a strict raw-payload health guard are added. Absent legacy queues default empty without settling future units at load. Spy report ownership survives migration. Player report/flight views filter private NPC activity and expose incoming NPC attacks.
- NPC leadership presence and absence checkpoints are integrated; the player UI presence heartbeat waits for catch-up.
- Requirements parsing caches static strings only; mutable eligibility stays uncached. Spy mission lookup is indexed by immutable mission-array identity.

## Verification at checkpoint

| Check | Result |
|---|---|
| TypeScript (`npx tsc --noEmit --pretty false`) | PASS at checkpoint |
| Production build (`npm run build`) | PASS; `npc-autonomy-build.log` |
| New focused adapters/policies/raw-save/physical scenarios | 47/47 PASS; `npc-autonomy-all-focused.log` |
| Real shared-flight production scenarios | 5/5 PASS: neutral player attack, NPC combat, changed relations, competing colonies/reload, exploration recon |
| Existing attack/espionage/science migration regression selection | 47/47 PASS; `npc-autonomy-regressions.log` |
| Save-safety and report regressions | 37/37 PASS; `npc-autonomy-save-reports.log` |
| Existing fleet suite after requirement caching | 35/35 PASS (agent run) |
| Existing aid/domain selection | 44/44 PASS (agent run) |
| Test inventory | PASS: 124 files, no missing/doubled/outside-CI entries at that checkpoint |
| `git diff --check` | PASS |
| Full `test:npc` | FAILING / latest checkpoint rerun pending; see handoff |
| 1/3/7/30-day full-state equivalence | NOT ACCEPTED |
| 100 NPC / 10 galaxies / 30 days / real actions / Electron <=120000ms | NOT ACCEPTED |
| Full affected domain suites, post-change Electron QA, Windows packaging, final GitHub CI | NOT YET COMPLETE |

Focused checks above are subsets and do not imply full acceptance. Final SHA, latest suite result and PR link must be taken from the handoff and GitHub rather than inferred from this table.

Final checkpoint refresh: build passed again after the last hooks; focused selection **48/48** passed including the exact expedition guard regression; inventory **125 files / 24 logical scripts**, no gaps or duplicates. Raw selected logs are preserved as `.txt` under `docs/reports/npc-full-autonomy-evidence/` so they survive outside this workstation. Full acceptance remains blocked.

## Known blockers and measured performance

1. The integrated save rejection was localized: a legitimate expedition record omitted `attackSnapshot`, while the new guard required it unconditionally. The guard now validates that snapshot only when present. Fractional speeds/distances and destroyed/captured origins are also covered. The exact first-slice payload now validates; the frozen replay proceeds further and hits a distinct `CombatInputValidationError: attacker empty-side` in pirate elimination (`resolveNpcPirateArrival` → canonical resolver). This remains a blocker; no guessed bypass was added.
2. The full asteroid-active 1-NPC replay reaches about 3.106 days after 1,000 bounded calls, short of a seven-day target. A diagnostic slice attributed 62/64 groups to distinct asteroid transitions (355 active asteroids; median transition gap about 2.8s). No cursor stall was found. Asteroid microsteps need bounded chronological batching while preserving gas, captured debris and same-time flight ordering; disabling asteroids is not an acceptable fix.
3. A separate 100-NPC/30-day diagnostic fixture disables asteroids and required 1,030 calls (1,000 reached about 29.267 days). Under CPU profiling it took 305.4s before the last caching changes. This is NOT the required unisolated Electron benchmark. The unchanged 1,000-drain test guard still fails; do not raise it to claim success.
4. The profile identified repeated flight filtering/sorting/spy lookups and requirement string normalization. Caching changes have focused correctness checks, but the final 120s gate has not been measured afterward. Requirement warm microbench: 100,000 repeated evaluations in 76.04ms; zero repeated lowercase calls after warmup. This does not prove end-to-end performance.
5. Strategy, commander dispatch, complete PvE claim/reward competition, long-term save growth/retention, leadership chronology and production aid need the remaining acceptance matrix and independent review. No final all-phases claim is made.

## User-supplied task references

Exact reference copies are preserved in `docs/task-inputs/npc-full-autonomy/TASK_PROMPT_2026-10-23.md` and `AUDIT_2026-10-23.md`. Their instructions are task materials; direct owner decisions in this report and the handoff take precedence. Do not reinterpret historical SHA/CI claims as current state.

Final stop: owner-requested five-hour threshold reached (90% used / 10% remaining). Implementation checkpoint `9b926fa042a07615fd8f19a3cd748b0c7ca126e7` is pushed in **Draft PR #105**, https://github.com/ratoker-jpg/Asterion/pull/105. CI 40031999236 was queued when last inspected; its result is unknown. Only handoff documents were finalized after the threshold. Continue from `NPC_FULL_AUTONOMY_OPUS_HANDOFF_2026-10-24.md`; the task is incomplete and no merge/Ready was performed. Reference audit/log copies have trailing whitespace normalized; original user document bytes remain in Downloads.
