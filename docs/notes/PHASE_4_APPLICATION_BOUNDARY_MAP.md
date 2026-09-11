# Phase 4 Application Boundary Map

This note records the ownership boundaries introduced by the Phase 4 internal-logic separation changeset. It separates the implementation requirements taken from the Phase 4 prompt from the repository facts verified against the `origin/main` worktree.

## Scope and non-goals

The application layer owns orchestration for the existing building, science, queue, recycling, trade, spaceport, bot, and fleet UI flows. Domain modules remain the source of truth for formulas, catalogs, validation, transitions, migrations, and runtime rules.

This changeset does not rebalance costs, durations, income, capacities, refunds, science progression, or fleet mechanics. It does not introduce Fleet Mission Runtime, change mission behavior, or change the save keys/schema version. UI components remain presentation and event-dispatch surfaces.

## Owner map

| Capability | Canonical domain owner | Application owner | Persistence/snapshot owner | UI boundary |
| --- | --- | --- | --- | --- |
| Building preview/start/cancel/complete/destroy | `src/domain/buildings/resource-zone.ts` | `src/application/buildings.ts` | `src/application/persistence.ts` | `App.tsx`, `ConstructionCatalogView.tsx` |
| Production bots | `src/domain/buildings/production-bots.ts` | `src/application/buildings.ts` | `src/application/persistence.ts` | `App.tsx` |
| Science start/cancel/preview/reconcile | `src/domain/science/runtime.ts`, `catalog.ts`, `time-rebalanced.ts` | `src/application/science.ts` | `src/application/science.ts` + `persistence.ts` | `ScienceView.tsx` dispatches typed request events and reads an application snapshot |
| Building/science/recycling/spaceport reconciliation | respective domain transition modules | `src/application/reconcile.ts` | `src/application/persistence.ts` | `App.tsx` supplies one clock and commits one resulting state |
| Recycling | `src/domain/buildings/recycling.ts` | `src/application/buildings.ts`, `reconcile.ts` | `src/application/persistence.ts` | `App.tsx` |
| Trade | `src/domain/buildings/trade.ts` | `src/application/buildings.ts`, `reconcile.ts` | `src/application/persistence.ts` | `App.tsx` |
| Spaceport upgrades | `src/domain/buildings/spaceport-upgrades.ts` | `src/application/buildings.ts`, `reconcile.ts` | `src/application/persistence.ts` | `App.tsx` |
| Fleet state/summary/build budget | `src/domain/fleet/runtime.ts` | `src/application/fleet.ts` | `src/application/persistence.ts` | `FleetWorkspacePortal.tsx`, `ConstructionCatalogView.tsx`, `ShipyardView.tsx` |
| Shared runtime event publication | `src/domain/runtime/state-store.ts` | `src/application/runtime.ts` | state snapshot is derived from the committed application state | fleet portal subscription |
| Save envelope and migrations | existing domain `createDefault*`/`migrate*` functions | `src/application/persistence.ts` | one Phase 4 facade writer for the campaign envelope | `App.tsx` composition root |

The application contracts in `src/application/contracts.ts` keep the current single homeworld (`helion-01`) explicit while making planet lookup/replacement a named boundary for later expansion.

## State flow

```text
UI intent/event
  -> application adapter/controller
  -> canonical domain transition
  -> application commit/reconcile
  -> application persistence facade
  -> application snapshot/event
  -> UI presentation
```

`App.tsx` is the composition root. It creates the persistence facade, reads the initial state, owns the committed React state, supplies the one-second application clock to `reconcileRuntime`, writes the resulting campaign state, and publishes the runtime snapshot. No Phase 4 UI component reads or writes `localStorage` directly.

## Storage writers, readers, events, and timers

### Phase 4 path

- `src/application/persistence.ts` is the owner of the production/test save-key selection, initial state, read/migration path, campaign-envelope write, clear/reset, and test-time-scale write. Existing production and test keys and schema versions are preserved.
- `App.tsx` has the single campaign persistence effect for the Phase 4 state path. Building, science, queue, recycling, trade, spaceport, and fleet actions commit React/application state and do not write storage themselves.
- `src/application/science.ts` owns the typed science start/cancel event bridge and the application-level science snapshot reader. `ScienceView.tsx` only dispatches requests, subscribes to the published event, and renders pure previews/derived values.
- `src/application/runtime.ts` publishes one `SCIENCE_RUNTIME_CHANGED_EVENT` and one `RUNTIME_STATE_CHANGED_EVENT` per snapshot publication. `FleetWorkspacePortal.tsx` consumes the runtime event and refreshes its application fleet snapshot.
- `App.tsx` owns the one-second `now` tick used for application reconciliation. `ScienceView.tsx` retains a one-second local display tick only; it does not commit runtime state. `UniverseView.tsx` retains its unrelated map display clock.

### Existing writers deliberately outside this Phase 4 changeset

The repository still contains legacy persistence helpers for combat history/priority/simulator, command, operations, and reports under their respective domain repository files. Preferences also use a separate preference key. These writers are not used by the Phase 4 building/science/queue/recycling/trade/spaceport/fleet path and were not widened into this changeset because that would change the requested scope and risk unrelated behavior. A future persistence consolidation should migrate those domains one at a time behind the same facade and add cross-domain writer enforcement.

This is an explicit limitation: “one writer” in this changeset means one writer for the Phase 4 campaign state path, not a claim that every historical subsystem in the repository has already been migrated.

## Verification hooks

`src/application/application.test.ts` covers save-key/envelope migration and writer behavior, building transitions, recycling/trade/spaceport, science event-bridge freshness and idempotent reconciliation, fleet snapshot/budget reads, and one-event-per-runtime-publication behavior. The package exposes this suite as `npm run test:application`.
