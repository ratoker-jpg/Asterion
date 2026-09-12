# Fleet production v1

Phase 7 keeps fleet production separate from the Spaceport upgrade queue. A planet has three independent FIFO queues:

- `shipQueue` for ordinary ships;
- `defenseQueue` for planetary defenses;
- `commanderQueue` for commander ships.

Each order stores a stable id, queue kind, item id, batch quantity, completed quantity, enqueue/start/finish timestamps, the effective per-unit duration, the commander level snapshot when applicable, and the full canonical cost used for cancellation. Enqueue deducts the complete batch cost and reserves the complete batch population immediately. Fleet and defense population are separate pools; fleet ships and commanders share the fleet/hangar pool, while defense uses its own capacity.

Reconciliation is timestamp-based and idempotent. It runs all three queues at the same clock value, credits completed units exactly once, removes completed head orders, and preserves FIFO ordering within each queue. A queued order can be canceled independently. Cancellation releases only unfinished units and refunds their proportional saved cost using the shared 60–80% integer refund range; storage credits are accepted only up to the capacity available at that moment and overflow is burned. Existing orders keep their duration snapshots after reload, building-level changes, or Test Mode changes.

## Save compatibility

The save schema is versioned at `13`. Legacy saves without `fleetProduction` or `defense` load with empty queues and an empty defense roster. Legacy saves without an explicit fleet retain their faction-specific canonical starter fleet; an explicit legacy fleet is preserved and normalized rather than replaced. Existing Spaceport upgrade queues remain under their original `spaceportUpgrades` key and are migrated by their existing rules.

Malformed or unknown production entries are dropped during migration. Valid migrated orders retain their enqueue/start timestamps and saved cost when present; finish timestamps are rebuilt from the saved start time, duration snapshot, quantity, and FIFO predecessor so malformed timestamps cannot overlap queues. Orders that do not contain a complete saved cost remain visible and cancellable to release their reservation, but are not eligible for an invented cancellation refund. Commander and shield single-copy limits are enforced for owned state and queue quantities during enqueue and migration, and migration also rechecks the aggregate population pools against current capacity.

## UI and verification

The Fleet workspace exposes production through the existing Shipyard and construction catalog surfaces. All three queue panels use the same active/waiting layout, cancellation action, empty-state copy, and natural page growth; no fleet-production queue has an artificial three-item limit. Ordinary ship levels are visible as `0/10`, commander levels as `0/40`, and fleet/defense population totals are displayed in their respective sections.

Focused coverage lives in `src/domain/fleet/production.test.ts`, `src/application/application.test.ts`, and `electron/fleet-production-qa.cjs`. The QA script checks both 1920×1080 and 1280×720, persistence, reload/idempotence, separate population pools, queue cancellation, and horizontal overflow.
