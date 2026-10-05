# Planet siege implementation notes

## Deviations

- The current Asterion building catalog has no endgame-locked building definitions. The target state therefore accepts an optional `endgameLockedBuildings` list; current targets default to no locked entries and future injected targets can opt into the contract without inventing an endgame catalog.
- The current save contract has no global `state.seed`. Siege rolls use the existing deterministic attack seed (`attack:<flight id>`) and add report id, flight id, event sequence, target id/coordinate, domain label, and building id where applicable.
- The current target model has no persisted target construction queue. An optional migration-safe `buildingQueue` is carried on injected targets; a successful demolition removes affected queue entries with no refund.
- Asterion currently resolves attack targets from the authoritative espionage target registry rather than a separate colony/event subsystem. Successful destruction removes the target from that registry and its Test Mode alias, marks active espionage missions for that target destroyed, preserves the historical battle report, and lets the attacking flight follow the existing normal-return path.

## How the run ended

- Planet destroyer levels now affect attack and life at the canonical 15% per level coefficient without an armor level bonus.
- Post-combat demolition and whole-planet destruction are resolved once, deterministically, recorded in `BattleReport.siege`, and rendered in compact and full battle-report views.
- Legacy battle reports remain readable because siege data is optional and the view-model parser is defensive.
- Focused combat, attack, flight, espionage, report, build, required UI, and consolidated full-suite checks all passed before the final commit.
