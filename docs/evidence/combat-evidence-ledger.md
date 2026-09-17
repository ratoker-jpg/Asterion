# Combat evidence ledger

This ledger separates source-backed facts from Asterion decisions and uncalibrated mechanics. It is intentionally small; the Nemexia archive remains external read-only evidence.

| Parameter | Status | Source | Confidence | Runtime policy |
| --- | --- | --- | --- | --- |
| Simulator attacker fleet cap | CONFIRMED | User decision, 2026-09-16 | high | 35,000 population |
| Simulator defender fleet cap | CONFIRMED | User decision, 2026-09-16 | high | 35,000 population |
| Simulator defender defense cap | CONFIRMED | User decision, 2026-09-16 | high | 35,000 population, independent from fleet |
| Planet hangar capacity | CONFIRMED | `src/domain/fleet/runtime.ts`, user decision | high | 25,112 is not a combat cap; retained as external evidence only |
| Commander presence and cardinality | CONFIRMED | User decision, 2026-09-17; implementation brief §4.2 | high | Each side has either no commander or exactly one commander stack with count 1; legacy multi-commander data is preserved and blocks launch with a migration error |
| Commander maximum level | CONFIRMED | `src/domain/buildings/spaceport-upgrades.ts` | high | 0..40 |
| Ship maximum level | CONFIRMED | `src/domain/buildings/spaceport-upgrades.ts` | high | 0..10 |
| Combat eligibility | CONFIRMED | Implementation brief §4.3; catalog roles | high | Service/civil ships are shown for fleet context but are rejected by combat validation; only combat entities enter the resolver |
| Ship level coefficients | INFERRED | Implementation brief §4.4; Asterion reconstruction decision | high | Apply per-unit before group count: scout .05, cruiser/defender/battleship .08, destroyer .11, bomber .10 |
| Commander level effects | CONFIRMED / INFERRED | Implementation brief §4.2 | medium | Implement documented attack, life, armor-debuff, critical, paralyze, cancel and recovery effects; unlisted abilities remain neutral |
| Defense level | UNKNOWN | No source-backed defense upgrade track found | low | Preserve the field, but production accepts only level 0 |
| Supported round limits | STRUCTURAL | Existing simulator and fixtures | high | 5, 8, 12 |
| Attacker before defender and round snapshots | STRUCTURAL | Implementation brief §4.5; Asterion resolver | high | Initial snapshot precedes round 1; each round records state before actions, attacker resolves before defender, and after(N) becomes before(N+1) |
| Target priority and tie-break | STRUCTURAL | User-facing simulator contract; existing resolver | high | Threat, population, catalog order; priority is visible and persisted, not a hidden rule |
| Dynamic retargeting | CONFIRMED | Implementation brief §4.5; Asterion resolver | high | Re-select a living target after every applied action; destroyed stacks cannot act |
| Armor mitigation baseline | INFERRED | Existing Asterion Combat Resolver v1 | medium | Preserve 80% clamp and floor; expose provenance |
| Weapon matchup coefficients | INFERRED | Implementation brief §4.3.1; Asterion reconstruction fixture | high | Apply the documented 6×6 matrix to ordinary ship classes; commander and defense targets remain neutral and `not-calibrated` |
| Known special bonuses | CONFIRMED / INFERRED | Implementation brief §4.3.2; faction ship provenance | medium | Data-driven round-start bonuses for the seven documented faction/archetype mappings; frozen for the round, emitted as `special-bonus`, and applied only to other allied living stacks. Inferred cap gaps remain explicit. |
| Science 7 | CONFIRMED | Implementation brief §4.1; `SCIENCE_CATALOG` | high | +10% base life per level, additive to the original base in production and calibration |
| Science 10/11/12 | CONFIRMED | Implementation brief §4.1; `SCIENCE_CATALOG` | high | +15% base attack per matching weapon level, additive to the original base in production and calibration |
| Science 18/19 | CONFIRMED | Implementation brief §4.1; `SCIENCE_CATALOG` | high | 18: +5% base attack and 19: +5% base life per level; mutually exclusive with each other and 20 |
| Science 20 critical effect | INFERRED | Implementation brief §4.1, explicit Asterion decision/approximation | medium | +1% critical chance per level; successful critical is Asterion ×2; seeded draws are persisted |
| Science 21/22/23 armor coefficients | CONFIRMED | Implementation brief §4.1; `SCIENCE_CATALOG` | high | +1/+2/+3 armor percentage points per level for light/medium/heavy armor |
| Technology profiles | STRUCTURAL | Implementation brief §4.1; simulator contract | high | Attacker and defender profiles are independent by default; copy is an explicit current-scenario convenience action and does not overwrite the saved source profile |
| Commander abilities/equipment outside the documented subset | UNKNOWN | Implementation brief §4.2; catalog provenance | low | No hidden effects; remain neutral and visible as unknown/not-calibrated |
| Critical-hit RNG | INFERRED | Implementation brief §4.1; explicit Asterion decision | medium | Xorshift32 v1 for seeded runs; no seed is explicitly `non-replayable`; unknown mechanics never consume hidden draws |
| Seeded replay | STRUCTURAL | Asterion runtime contract | high | Xorshift32 v1 provenance is persisted |

The `25,000` Nemexia per-side value is kept as archive evidence only and is not used by the Asterion simulator profile.

## Evidence handling

The attached implementation brief describes the local archive as a calibration corpus with repeated science, damage/armor, commander-level, defence-dose, and target/round blocks. Source-backed formulas and explicit Asterion decisions are active in both execution modes. Documented inferred approximations are marked in the report and are available to calibration; `UNKNOWN` mechanics remain neutral in production and calibration, with no fabricated values or hidden random draws.

The ledger does not infer mechanics from a single win, a single loss, or an untracked random outcome. Every report records the selected profile, technology mode, execution mode, target-selection status, and RNG provenance; legacy reports receive `unknown`/`non-replayable` markers instead of reconstructed numeric values.
