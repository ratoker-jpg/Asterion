# PR91 balance evidence — incomplete, no fabricated simulation results

> **STATUS: BLOCKED — numerical combat seed study NOT RUN.** This file is an audit checklist, not a claim of completed PR91 combat/economic calibration. No derived win rates, destroyed hull distributions, or net profit may be interpreted as verified.

## Deterministic analytical raid-count estimates (NOT simulations)

Assumptions from approved design: ~18.8 active contact opportunities per system-day, one Bernoulli chance per owner-contact, independent systems, no daily throttle. Expected counts = 18.8 × days × systems × p.

| Per-base pRaid | Systems | Expected launches / 8h | Expected launches / 24h |
|---:|---:|---:|---:|
| 2.0% | 1 | 0.125 | 0.376 |
| 2.0% | 2 | 0.251 | 0.752 |
| 2.0% | 3 | 0.376 | 1.128 |
| 13.2% | 1 | 0.827 | 2.482 |
| 13.2% | 2 | 1.654 | 4.963 |
| 13.2% | 3 | 2.482 | 7.445 |
| 30.0% | 1 | 1.880 | 5.640 |
| 30.0% | 2 | 3.760 | 11.280 |
| 30.0% | 3 | 5.640 | 16.920 |

The numbers estimate launches, **not victories, casualties, resource loss or guaranteed observations**. Actual generator, successful owner contacts and destroyed bases change the number of checks.

## Recycling theoretical capacity (NOT measured jobs)

| New L10 concurrent jobs | Effective debris/sec | 16m debris | 160m debris |
|---:|---:|---:|---:|
| 1 | 980 | ≈4h32m | ≈45h21m |
| 10 | 9,800 | ≈27m13s | ≈4h32m |

These omit orbital collection, recycler cargo, flight and transport times. Recycling output efficiency remains 75–120% by existing levels; 10 parallel jobs must be separately scheduled. Job data captured before the rate update is not recomputed.

## Actual seeded calibration — outstanding

The project must still run and capture **measured** outcomes for:
- three player races, low/mid/high scores, technology 0/5/10, 75–90% elimination garrisons;
- raids at 90–95% defender population with six ordinary classes, normal and production-matrix counter fleets, zero-defense rich targets;
- defensive planet breakers with score threshold 2,999,999 / 3,000,000 and fixed 10% seeded cycle incidence;
- realistic legal 25,112-population mixed fleet, 95%-and-exactly-100%-hangar manifests and reward multipliers 1 / 1.25 / 1.5 / 2 / 2.5;
- actual report winner fractions, defender and attacker damaged/lost hulls, produced orbital pirate+player debris, measured recovered debris, recycled metal/minerals at efficiency 75% and 120%, destroyed-hull replacement costs, flight gas, collection transport and **net**;
- EV weighted by the measured victory/draw/loss frequencies rather than cherry-picked wins;
- 10+ cycles per system, simultaneous rolls in three systems, save/load before dispatch, at arrival and returning;
- 16m/160m debris real recycle transport/cargo throughput and visual QA.

Use deterministic seeds and a script committed to this PR to reproduce the final numbers. Existing `docs/evidence/pirate-combat-balance.md` with old fixed-90% defenders is **not** PR91 evidence. Merge should remain blocked until a real seeded report replaces this placeholder.

## Risk note

A ×2.5 multiplier applied to 60–80% base pirate salvage can produce salvage with a nominal value 150–200% of destroyed pirate metal+mineral costs **before** recycling, possibly making high-capacity victories inflationary. Net outcomes cannot be concluded without actual hull losses, flight gas and collection expenses. Approved balancing numbers were not silently changed.
