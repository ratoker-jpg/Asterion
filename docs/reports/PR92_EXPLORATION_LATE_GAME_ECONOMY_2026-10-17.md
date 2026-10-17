# PR #92 exploration: late-game economy scenario

This is a report-only scenario check for the independent audit. It does not change exploration coefficients, resource reserves, ship statistics, or combat balance.

## Scenario

- One unique-object variant 1 contact with an 18-minute lifetime, within the existing 15–20 minute lifetime range.
- Aegis fleet: 10 mega-transporters and 1 destroyer; zero technology, ship upgrades, and commanders.
- Route: `[1:1:1]` to `[1:2:11]`; zero fuel technology. The modeled outbound flight is 3 minutes, leaving 15 minutes for mining before expiry.
- Catch-up multiplier 1, no defense boost or hazard loss, no NPC contest, fleet survives, and the origin has enough storage to accept all returned metal.
- The score column is the expedition's launch resource-points input. It is not the player's wallet balance.

## Finite-stock results

Unique variant 1 has a fixed 945,000-metal contact reserve in this scenario. The fleet has 202,000 total cargo capacity and a 20,010 metal/minute capacity-limited rate.

| Launch resource-points | Metal collected in 15 min | Contact metal remaining | Wallet delta before any other costs |
| ---: | ---: | ---: | --- |
| 1,000 | 78,750 | 866,250 | +78,750 metal; −161 gas |
| 100,000 | 202,000 | 743,000 | +202,000 metal; −161 gas |
| 1,000,000 | 202,000 | 743,000 | +202,000 metal; −161 gas |
| 3,000,000 | 202,000 | 743,000 | +202,000 metal; −161 gas |

The first row is below the fleet's 202,000 cargo ceiling. The other rows hit that ceiling; raising the score further does not increase this fleet's collected metal. The 945,000 reserve is shared stock attached to this contact, not a player's initial stock. A full destination storage can reduce the credited wallet amount and burn overflow.

## Fleet and competition costs

- Outbound travel consumes **161 gas** for the modeled route. Return does not charge a second outbound dispatch cost.
- Building this fleet costs **157,900 metal, 134,500 minerals, and 9,400 gas** at the current catalog values. This is reusable fleet capital, not a per-flight expense or an assumed loss.
- The route has five 3-minute risk slots during the 15-minute mining window. Risk 1 uses the existing seeded 3% NPC-attempt frequency per slot. If those slots are interpreted as independent probability trials, the approximate chance of at least one attempt is `1 − 0.97⁵ ≈ 14.1%`. This is only an attempt estimate; it is not a combat, ship-loss, or resource-loss probability.

## Calculation sources and limits

- Contact profile, lifetime, and risk-slot constants: `src/domain/exploration/model.ts` and `src/domain/universe/runtime.ts`.
- Stage, rate, catch-up, reserve, and finite-stock caps: `src/domain/exploration/model.ts` and `src/domain/exploration/ledger.ts`.
- Fleet cargo and capacity: `src/domain/combat/catalog.ts` and `src/application/exploration-flight.ts`.
- Route, speed floor, and fuel: `src/domain/flights/distance.ts`, `src/domain/flights/speed.ts`, and `src/domain/flights/fuel.ts`.

The 18-minute lifetime, 15 minutes of mining, score values, zero-upgrade profile, and no-loss return are illustrative assumptions, not guaranteed outcomes. Technology investments, NPC combat losses, a non-unit catch-up multiplier, hazards, and storage overflow are excluded. Metal, minerals, and gas are kept as separate resource quantities; this report does not assign conversion values or claim a cross-resource profit total.
