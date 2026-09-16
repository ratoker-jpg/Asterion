# Combat evidence ledger

This ledger separates source-backed facts from Asterion decisions and uncalibrated mechanics. It is intentionally small; the Nemexia archive remains external read-only evidence.

| Parameter | Status | Source | Confidence | Runtime policy |
| --- | --- | --- | --- | --- |
| Simulator attacker fleet cap | CONFIRMED | User decision, 2026-09-16 | high | 35,000 population |
| Simulator defender fleet cap | CONFIRMED | User decision, 2026-09-16 | high | 35,000 population |
| Simulator defender defense cap | CONFIRMED | User decision, 2026-09-16 | high | 35,000 population, independent from fleet |
| Planet hangar capacity | CONFIRMED | `src/domain/fleet/runtime.ts` | high | 25,112 is not a combat cap |
| Commander presence | CONFIRMED | User decision, 2026-09-17 | high | Each side may select zero or more distinct commander types; each type is limited to one ship, with at most one leading commander |
| Commander maximum level | CONFIRMED | `src/domain/buildings/spaceport-upgrades.ts` | high | 0..40 |
| Ship maximum level | CONFIRMED | `src/domain/buildings/spaceport-upgrades.ts` | high | 0..10 |
| Combat effect of ship/commander/defence levels | UNKNOWN | Level ranges are sourced, combat coefficients are not | low | Store and report levels; do not apply a hidden multiplier |
| Defense positive level cap | UNKNOWN | No source-backed defense upgrade track found | low | Only level 0 is accepted until evidence adds a cap |
| Supported round limits | STRUCTURAL | Existing simulator and fixtures | high | 5, 8, 12 |
| Attacker before defender | CONFIRMED | Asterion resolver decision | high | Sequential side resolution |
| Target tie-break | STRUCTURAL | Existing resolver | medium | Threat, population, catalog order |
| Dynamic retargeting | CONFIRMED | Asterion resolver decision | high | Re-select after every applied action |
| Armor mitigation baseline | INFERRED | Existing Asterion Combat Resolver v1 | medium | Preserve 80% clamp and floor; expose provenance |
| Weapon matchup coefficients | UNKNOWN | Evidence not sufficient | low | Neutral; no hidden multiplier |
| Commander abilities/equipment | UNKNOWN | Existing commander catalog is display-only | low | Inactive and visible in report |
| Critical-hit RNG | UNKNOWN | Variable archive events not sufficient | low | Inactive; seed plumbing only |
| Science 7 curve | INFERRED | Campaign calibration observations | medium | Piecewise curve in calibration mode only |
| Science 10/11/12 curves | INFERRED | Campaign calibration observations | medium | Piecewise curves in calibration mode only |
| Science 18/19 curves | INFERRED | Campaign calibration observations and source names | medium | Piecewise curves in calibration mode only |
| Science 20 effect | UNKNOWN | Critical events are variable | low | Neutral and marked not calibrated |
| Science 21/22/23 combat coefficients | UNKNOWN | Source descriptions lack repeated combat calibration | low | Neutral and marked not calibrated |
| Seeded replay | STRUCTURAL | Asterion runtime contract | high | Xorshift32 v1 provenance is persisted |

The `25,000` Nemexia per-side value is kept as archive evidence only and is not used by the Asterion simulator profile.

## Evidence handling

The attached implementation brief describes the local archive as a calibration corpus with repeated science, damage/armor, commander-level, defence-dose, and target/round blocks. Those observations are treated as evidence for candidate curves, not as causal proof: a curve is runtime-active only when its row is `INFERRED` and the simulator is explicitly in `calibration` mode. `UNKNOWN` rows remain neutral in both persistence and production runs.

The ledger does not infer mechanics from a single win, a single loss, or an untracked random outcome. Every report records the selected profile, technology mode, execution mode, target-selection status, and RNG provenance; legacy reports receive `unknown`/`non-replayable` markers instead of reconstructed numeric values.
