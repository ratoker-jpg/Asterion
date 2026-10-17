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
- The route has five 3-minute slots during the 15-minute mining window. The model's risk-1 NPC attempt rate is 3% per slot, but Production currently has no automatic NPC sources by owner decision, so that rate does not produce Production attacks or affect this scenario. If the slots are interpreted as independent trials after real NPC sources are connected, the attempt estimate is `1 − 0.97⁵ ≈ 14.1%`; it is not a combat, ship-loss, or resource-loss probability.

## Calculation sources and limits

- Contact profile, lifetime, and risk-slot constants: `src/domain/exploration/model.ts` and `src/domain/universe/runtime.ts`.
- Stage, rate, catch-up, reserve, and finite-stock caps: `src/domain/exploration/model.ts` and `src/domain/exploration/ledger.ts`.
- Fleet cargo and capacity: `src/domain/combat/catalog.ts` and `src/application/exploration-flight.ts`.
- Route, speed floor, and fuel: `src/domain/flights/distance.ts`, `src/domain/flights/speed.ts`, and `src/domain/flights/fuel.ts`.

The 18-minute lifetime, 15 minutes of mining, score values, zero-upgrade profile, and no-loss return are illustrative assumptions, not guaranteed outcomes. Technology investments, NPC combat losses, a non-unit catch-up multiplier, hazards, and storage overflow are excluded. Metal, minerals, and gas are kept as separate resource quantities; this report does not assign conversion values or claim a cross-resource profit total.

## Source-grounded profile, capacity, and timing model

This section expands the scenario inputs without changing game data. On contact creation, the reserve uses `worldScoreAtAppearance = 100,000` and `round(round(100,000 × q) × lifetimeMinutes × 1.5)`, split by profile resource weights. It is independent of the visitor's score. Therefore the `15 / 18 / 20` columns below are the total contact reserve for each lifetime, not each visiting player's expected payout. Per-resource splits floor weighted amounts. Sources: `src/domain/exploration/ledger.ts:111–138` and `src/domain/exploration/model.ts:17–47`.

| Profile | q | Risk | Resource weights | Reserve 15m | Reserve 18m | Reserve 20m |
|---|---:|---:|---|---:|---:|---:|
| Unique 1 | .35 | 1 | metal 100% | 787,500 | 945,000 | 1,050,000 |
| Unique 2 | .55 | 2 | metal 100% | 1,237,500 | 1,485,000 | 1,650,000 |
| Unique 3 | .70 | 3 | metal 70%, debris 30% | 1,575,000 | 1,890,000 | 2,100,000 |
| Unique 4 | 1.25 | 4 | metal 100% | 2,812,500 | 3,375,000 | 3,750,000 |
| Unique 5 | .35 | 1 | minerals 100% | 787,500 | 945,000 | 1,050,000 |
| Unique 6 | .55 | 2 | minerals 100% | 1,237,500 | 1,485,000 | 1,650,000 |
| Unique 7 | .85 | 3 | minerals 100% | 1,912,500 | 2,295,000 | 2,550,000 |
| Unique 8 | 1.25 | 4 | minerals 100% | 2,812,500 | 3,375,000 | 3,750,000 |
| Unique 9 | .35 | 1 | gas 100% | 787,500 | 945,000 | 1,050,000 |
| Unique 10 | .60 | 2 | gas 100% | 1,350,000 | 1,620,000 | 1,800,000 |
| Unique 11 | .90 | 3 | gas 100% | 2,025,000 | 2,430,000 | 2,700,000 |
| Unique 12 | 1.35 | 4 | gas 100% | 3,037,500 | 3,645,000 | 4,050,000 |
| Unique 13 | .45 | 2 | debris 100% | 1,012,500 | 1,215,000 | 1,350,000 |
| Unique 14 | .90 | 3 | debris 100% | 2,025,000 | 2,430,000 | 2,700,000 |
| Unique 15 | 1.10 | 4 | metal 60%, minerals 40% | 2,475,000 | 2,970,000 | 3,300,000 |
| Unique 16 | 1.50 | 5 | metal 40%, minerals 30%, gas 30% | 3,375,000 | 4,050,000 | 4,500,000 |
| Anomaly 1 | .35 | 2 | gas 100% | 787,500 | 945,000 | 1,050,000 |
| Anomaly 2 | .60 | 3 | gas 100% | 1,350,000 | 1,620,000 | 1,800,000 |
| Anomaly 3 | .45 | 2 | minerals 100% | 1,012,500 | 1,215,000 | 1,350,000 |
| Anomaly 4 | .75 | 3 | minerals 100% | 1,687,500 | 2,025,000 | 2,250,000 |
| Anomaly 5 | 1.00 | 4 | gas 60%, metal 40% | 2,250,000 | 2,700,000 | 3,000,000 |
| Anomaly 6 | 1.00 | 4 | metal 50%, minerals 50% | 2,250,000 | 2,700,000 | 3,000,000 |
| Anomaly 7 | .60 | 3 | debris 100% | 1,350,000 | 1,620,000 | 1,800,000 |
| Anomaly 8 | 1.20 | 4 | debris 50%, gas 50% | 2,700,000 | 3,240,000 | 3,600,000 |
| Anomaly 9 | 1.10 | 4 | metal 30%, minerals 30%, gas 40% | 2,475,000 | 2,970,000 | 3,300,000 |
| Anomaly 10 | 1.60 | 5 | metal 30%, minerals 35%, gas 35% | 3,600,000 | 4,320,000 | 4,800,000 |

Mining stage is `clamp((score / 100,000)^0.65, 0.15, 15)`. At score inputs `1K / 100K / 1M / 3M`, the stages are `.15 / 1 / 4.4668 / 9.1228`; the corresponding pre-profile rates are `15,000 / 100,000 / 446,684 / 912,281` units per minute before multiplying by `q`. Score is the expedition's rated input, not wallet stock. Fleet rate, finite reserve, contact expiry, and cargo all cap the collected amount. Sources: `src/domain/exploration/model.ts:147–216`.

The default scheduled contact lifetime is 15–20 minutes (`src/domain/universe/runtime.ts:58–66`). On the documented route `[1:1:1] → [1:2:11]`, distance is 1,425, and the minimum outbound duration is 3 minutes for the listed fleet examples. If dispatched at appearance, that leaves 12–17 minutes before contact expiry. Zero-chemistry outbound fuel uses `ceil(shipFuel × 1,425 / 12,000)` per ship (`src/domain/flights/distance.ts:29–47`, `src/domain/flights/speed.ts:51–65`, `src/domain/flights/fuel.ts:36–46`).

| Faction | Mega-transporter cargo / speed / fuel | Pure mega fleet cargo: 10 / 100 / 1,200 | Outbound gas: 10 / 100 / 1,200 |
|---|---|---:|---:|
| Aegis | 20,000 / 19,000 / 45 | 200,000 / 2,000,000 / 24,000,000 | 54 / 535 / 6,413 |
| Synod | 50,000 / 14,000 / 50 | 500,000 / 5,000,000 / 60,000,000 | 60 / 594 / 7,125 |
| Veyra | 30,000 / 16,000 / 45 | 300,000 / 3,000,000 / 36,000,000 | 54 / 535 / 6,413 |

The balance script's defined combat escorts give two additional source-based examples, not a universal composition: 10 mega-transports + 1 destroyer, and 100 + 10 destroyers. Resulting cargo is Aegis `202,000 / 2,020,000`, Synod `502,200 / 5,022,000`, and Veyra `301,000 / 3,010,000`; outbound gas for each pair is Aegis `161 / 1,604`, Synod `167 / 1,663`, and Veyra `125 / 1,247`. The script defines no escort for the 1,200-ship fleet. Its separate debris case is 10 recyclers + 1 destroyer, not a recycler ratio for a mega fleet. Do not infer another composition. Ship inputs are in `src/domain/combat/faction-ship-data.ts:98–102, 133–137, 164–168, 199–203, 230–234, 265–269`; fleet examples are in `tools/generate-exploration-pr92-balance.mjs:11–20`.

## Delivery and comparison limits

- Resource cargo is limited first by the per-minute material rate, contact stock, and total fleet cargo. With no recyclers, debris collection is zero. A winning battle's returned cargo also depends on the existing battle-settlement rule and surviving cargo capacity.
- Metal, minerals, and gas use separate storage capacities. Base storage is 100,000 per resource; buildings increase it. Delivery beyond remaining destination capacity is discarded. Debris is credited separately and is not capped by resource storage. Exact credited delivery therefore needs destination building levels and current wallet stock (`src/application/exploration-flight.ts:123–140`, `src/domain/resources/credit.ts:32–67`, `src/domain/flights/cargo.ts:126–143`, `src/domain/buildings/balance-v1.ts:359–372`).
- The model's risk-1..5 NPC attempt rates are 3%, 5%, 8%, 12%, and 16% per slot; anomaly hazards are 0%, 3%, 5%, 8%, and 12%. They describe attempt/hazard checks, not battle losses. Production currently has no NPC source, by owner decision; automatic NPC attacks are deferred. These rates are not active Production risk until real sources are connected (`src/domain/exploration/model.ts:64–66, 275–276`).
- The illustrative pirate report estimate is `orbitalDebrisGenerated × 1.2 − known player hull-loss cost − captured outbound-fuel gas`; it may be unavailable and excludes actual return/recycler fuel, debris gathering, and storage effects. Pirate debris uses destroyed pirate hull metal/mineral cost and a 60% base share, up to 80% with a surviving Corsair (`src/application/pirate-battle-export.ts:50–62, 130–137, 181–188`, `src/domain/pirates/debris.ts:5–22, 39–55`). It is not directly comparable to mined exploration resources.

There is no single source-grounded net-profit result across all 26 profiles without fixing fleet faction/composition, destination stock and storage buildings, and combat outcomes. The current balance script uses a `1e10` reserve and `battleResult: 'NOT SIMULATED'` (`tools/generate-exploration-pr92-balance.mjs:49–60`), so that aggregate is not finite-reserve profit evidence. The tables above retain explicit source values and mark the missing inputs; they do not change coefficients or imply a balance recommendation.
