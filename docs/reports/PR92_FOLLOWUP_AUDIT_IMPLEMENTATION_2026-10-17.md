# PR #92 — implementation follow-up to independent audit (17 Oct 2026)

Repo: `ratoker-jpg/Asterion`, only existing branch `codex/pr92-exploration-fields`, only existing **Draft PR #92**. No merge or Ready transition.

Original audit baseline: `63ec480fbc1a7366e484f5efe43684f5288eb8b2`.

## Fixed — player-visible

1. **Normal Attack → occupied unique/anomaly** (`src/application/flights.ts`, `src/application/exploration-combat.ts`, `src/App.tsx`, `src/OperationsView.tsx`, `src/FleetWorkspacePortal.tsx`): Attack is validated against the actual persisted contact cycle and foreign occupancy, requires a selected real fleet, uses the production `resolveCombat` with actual launch snapshots and seeded report ID, applies surviving ship/commander losses and updates the claim. Attack win captures cargo by `settleExplorationContest` (30% of accumulated material constrained by surviving cargo capacity) and keeps winner on orbit; defender win or draw keeps the defender's right to mine. Attackers can recall via the existing 30-second orbit-return procedure. Physical returns and reporting are not instantaneous.
2. **Bot 01 demonstration** (`src/application/exploration-bot01.ts`, `src/App.tsx`, `src/FleetWorkspacePortal.tsx`, `src/OperationsView.tsx`): Test Mode can launch a **finite snapshot from Bot 01's actual planet fleet** into a timed free contact. The ship quantity is reserved from the original NPC planet, the flight has an actual origin/route/arrival, is persisted, can occupy only on arrival, and restores **surviving** hulls exactly once when returning. Two entrypoints: `Флоты → BOT 01 · ЗАХВАТИТЬ ОБЪЕКТ (ТЕСТ)` auto-selects a free live contact; or the selected free dossier in `Операции → ТЕСТ: BOT 01 · ЗАНЯТЬ ОБЪЕКТ`. After arrival accept/select the occupied contact and launch Attack with player's actual fleet. The outcome is produced only by the existing combat resolver.
3. **Reports**: contested battle is stored as normal `BattleReport` in the canonical `combat.reports` and projected to `Сообщения → Боевые`; a dossier link uses the exact `battle:battle-exploration-<flight-id>` report item ID. Never present hidden foreign NPC mining cargo in Operations before/after recon. Bot 01 is named in the battle report, rather than showing a raw owner ID.
4. **Reports Electron red CI** (`electron/reports-profile-qa.cjs`): previous QA wrongly looked in System for recycler and gas receipts that were intentionally moved to Flights. Updated navigation to Flights, preserving old report IDs and unread/detail assertions. Do not duplicate messages.
5. **Persisted score high-water and honest catch-up** (`src/application/reconcile.ts`, `src/application/exploration-flight.ts`, `src/application/exploration-operations.ts`): genuine owner rating peak is updated at live reconciliation, acceptance and dispatch; eligible real rated owners of the same galaxy provide median only when 5+ actual owners exist, else bonus ×1.
6. **Anomaly hazards** (`src/domain/exploration/ledger.ts`): seeded 3-minute checkpoints for actual anomalies, bounded to a maximum 10% cargo loss at a triggered slot, no fabricated warship losses, no recredit of finite deposits; offline catch-up vs split reconciliation follows the same event IDs.

## Technical acceptance and proof

- `src/application/exploration.integration.test.ts`: actual Attack/defender contest with persisted report and no replays, real Bot 01 launch with finite ship reservation and player attack/report, 30% bound against **defender cargo accrued to actual combat arrival** (not the launch-time snapshot), exactly-once return and false-archive protection preexisting in same suite.
- `src/domain/exploration/exploration.test.ts`: deterministic bounded hazards with split/offline replay equality; existing rare drop, finite reserves, catch-up, 30-second recall boundary and payout exactly once tests.
- **Verified intermediate SHA `6cf3f485`**: [CI run 38969150486](https://github.com/ratoker-jpg/Asterion/actions/runs/38969150486) steps `PR92 exploration domain tests`, `Reports domain tests`, `Build renderer`, **`Reports Electron QA` all SUCCESS**. This run continues with other, slower Electron jobs; do not infer overall CI SUCCESS.
- **Verified Pages deploy at later SHA `cd0d8d61`**: [Pages run 38969562779](https://github.com/ratoker-jpg/Asterion/actions/runs/38969562779) SUCCESS. Subsequent HEAD requires its own Pages outcome; pushing does not prove published SHA.
- Preview URL: https://ratoker-jpg.github.io/Asterion/pr/92/ . Independent HTTP read of `preview-sha.txt` was not available.
- No interactive visual browser QA performed. Full final CI cannot be marked green until all relevant jobs finish.

## Open blockers and limitations

1. **Autonomous production NPC competition is NOT implemented**. Bot 01 currently works as a **manual, bounded Test Mode gameplay QA scenario** with a real finite source fleet; there is no periodic autonomous NPC arrival/check based on risk I–V, nor production NPC owner cross-contest. Beginner protection for such autonomous raids is therefore not applied in live flight scheduling. Do not claim full NPC feature.
2. **Shared reserve world-score snapshot remains materialized on first observation/accept/dispatch**. It has not been replaced by an immutable authority snapshot from appearance. Design contract still needed: world scheduler must provide `worldScoreAtAppearance` per cycle before any owner can accept. Do not rebalance per first visitor.
3. Combat integration tests execute the **real resolver**, but forced independent attacker win, defender win and draw suites with replay/survivor verification on all three outcomes are not yet complete. The seeded test checks whatever real outcome the resolver produces. Autonomous NPC offense and a mixed-owner offline schedule likewise still need scenario testing.
4. Current hazard outcome is **cargo loss only**, not ship destruction; each triggered event burns at most 10% of then-stored cargo. Additional hazard effects must be agreed before implementation.
5. Battle attestation, UI colors and Preview correctness require manual review in the deployed Test Mode; CI and unit tests alone cannot certify visual gameplay.

**Unchanged**: rare-reward single payout event, 30-second recall protocol, storage overflow treatment, deterministic deposits, and the user's exclusive right to merge.

## Reviewer walkthrough

In Test Mode: open `Флоты`, press `BOT 01 · ЗАХВАТИТЬ ОБЪЕКТ (ТЕСТ)`; Operations opens with selected free object and Bot 01 inbound. After real arrival, select/accept the object, press `АТАКОВАТЬ ЗАНЯТЫЙ ОБЪЕКТ`, select your actual ships in Fleets, launch; observe active flight and return, then `Сообщения → Боевые` or the link in Operations. If a specific object is preferred, press `ТЕСТ: BOT 01 · ЗАНЯТЬ ОБЪЕКТ` directly on that operation dossier.

Final HEAD, CI and Pages URLs must be taken from the GitHub PR after this documentation commit. Do not merge or change Draft.
