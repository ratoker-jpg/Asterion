# NPC science implementation

Base: `34000847794156ec912439fd23e510e8accec1b6` (PR103). Scope follows the supplied NPC science implementation prompt of 2026-10-23. User explicitly authorizes GPT-6.1 Sol coordination and GPT-6 Luna workers for this task.

## Outcome and sequence

1. Add schema27 owner-scoped `npcScience` ledger, strict save guards and migration. Preserve NPC v1 personas/cursors. Activate legacy science policy at the later of the saved resource clock and pending replay target. Keep old queues, costs and timestamps.
2. Add laboratory to the restricted building allowlist. Choose a legal economic building, lab, paid science or wait in one existing scheduled attempt. Shared science preview/start/reconcile own all science rules; explicit campaign scale bypasses mutable global speed.
3. Put science heads into chronological checkpoint selection. Settle old income, complete timers and project knowledge/Physics energy, preserve asteroid/flight/pirate micro-order, then apply session boundaries and decisions. Cancel destroyed-payer tasks with shared domain rules; refund only invalid surviving-payer successors according to existing rules.
4. Source NPC rating from canonical levels and queue once per owner. Existing defense/espionage consumers use the atomically updated owner projection.
5. Run focused and full relevant suites, replay/save-load parity, Node/Electron benchmarks, build and Windows packaging. Publish one Draft PR, observe latest-head CI, report measured evidence. Never merge or mark Ready.

## Recovery and validation

Malformed/future raw saves are preserved by existing load/write health gates; schema27 requires valid ledger. Migration starts legacy queues empty and cannot retroactively schedule science inside a pending v26 catchup. Tests cover owner isolation, exact payment, queue bounds, deterministic choices, saved timestamps, completion boundary effects, and destroyed payers. Compare 1/7/30-day full-world performance against the same base and deterministic benchmark fixture; the 120-second limit is unchanged.

Product balance, fleet construction/initiated attacks, colonization, diplomacy and new UI are outside scope. The report is `docs/reports/NPC_SCIENCE_PR104_IMPLEMENTATION_REPORT.md`; incomplete checks and performance risks must stay explicit.
