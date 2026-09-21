# Attack mission vertical slice

## Outcome

Connect Universe → fleet preparation → millisecond flight → arrival-time diplomacy check → canonical production combat → atomic loss/repair/debris/loot reconciliation → survivor return → persistent battle report.

## Repository evidence

- The current `origin/main` is the merge commit of PR #73, which already contains the espionage flight/report foundation. The attached specification described that PR as Draft, but the repository state is authoritative and the PR is already merged.
- `src/application/flights.ts` owns dispatch, recall, live espionage target resolution, and reconciliation. `src/domain/flights/runtime.ts` already supports mission id `attack`, but the application boundary rejects it.
- `src/domain/combat/resolver.ts` is the canonical resolver. `src/application/combat.ts` and `src/application/repair.ts` are the production application boundaries; simulator handoff stays separate.
- `src/domain/espionage/fixtures.ts` is the Test Mode Bot 01 target source. `src/application/espionage-targets.ts` is the authoritative target/relation resolver.
- `src/BattleReportsView.tsx` already contains the compact report card and accessible detail modal; `src/ReportsView.tsx` currently renders the detail body inline and needs to adopt the card/modal split.
- Graphify AST navigation found the shared flight seams. Semantic extraction was unavailable because this checkout contains images and no configured LLM key; no semantic graph claim is used for architecture decisions.

## Decisions and boundaries

1. Extend the existing flight record with an immutable attack launch snapshot and an idempotent attack-resolution marker. Do not add a second flight system.
2. Resolve the target through `resolveSpyTarget`/its shared authoritative registry, and re-check relation on arrival. Self/ally is a no-battle return; enemy/neutral is eligible.
3. Build a production `CombatInput` from the launch snapshot and live defender target state, then call `resolveCombat(..., { missionType: 'attack' })`. Simulator UI/state is not used for real attack resolution.
4. Apply attacker losses to the origin fleet, defender losses and 50% eligible repairs to the target registry, calculate catalog-cost debris, and persist one report. Store attack loot on the returning flight; credit it only on completed return.
5. Use the existing Asterion Test Mode resource-income semantics for Bot 01 only. Production persistence strips Bot 01 fixtures as it does today.
6. Keep attack round choices to `5 | 8 | 12`, allow multiple active attacks, and preserve request-id idempotency.
7. Reuse the existing visual system, attack mission asset, flight table, report card, and report modal. New controls must use existing Asterion tokens and responsive behavior.

## Vertical slices

### Slice A — domain/application contracts

- Add attack snapshot/resolution types to flight persistence and migration validation.
- Add shared combat-input builders for current attacker state and live target state.
- Add target resource clock state/migration for Test Mode and set Bot 01 resources to the specified high starting balance.

### Slice B — dispatch and reconciliation

- Add attack validation for target identity/relation, selected fleet, rounds, gas, and no global cap.
- Snapshot source fleet, upgrades, science, commanders, target metadata, and operation id at dispatch.
- At arrival, re-resolve diplomacy and live target resources/fleet/defense/technology/commanders.
- Apply combat, defender repair, debris, and deferred loot exactly once; return all survivors.
- Preserve recall-before-arrival semantics and complete returning attacks without duplicate effects.

### Slice C — Universe and preparation UI

- Add an Attack action only for neutral/enemy player/NPC targets; keep self/ally transport behavior unchanged.
- Route Attack into the existing FleetWorkspacePortal launch context.
- Expose attack composition, commander/target metadata, rounds 5/8/12, validation, and multiple-flight rows.

### Slice D — reports and QA

- Keep the report list compact and open full details through the existing accessible modal.
- Add focused domain/application/UI assertions and Electron selectors for attack dispatch, recall, arrival, combat, repair, debris, loot, report idempotency, and responsive report opening.

## Verification gate

- `npm run build`
- focused combat, repair, flight, espionage, report, universe, application, and UI tests
- full test suite
- Electron/Test Mode smoke checks at 1920×1080 and 1280×720 where the existing harness supports them
- inspect `git diff --check` and `git status --short`
- commit to `codex/attack-implementation`, push, and open a Draft PR against `main`; do not merge or mark ready

## Recovery

Changes are isolated in `D:/Desktop/Asterion/worktrees/attack-implementation`. The original dirty checkout and the earlier espionage worktree are untouched. If a slice fails, keep the failing evidence and revert only the new slice commit; never reset either existing checkout.
