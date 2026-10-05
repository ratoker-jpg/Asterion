# Pirate PvE follow-up decisions

This note keeps the agreed boundaries between the battle-contract work and the later playable pirate flow.

## Covered by PR2

- Keep the two battle directions distinct in saved reports:
  - `pirate-raid`: pirates attack a player's planet (incoming battle).
  - `pirate-elimination`: a player attacks pirates (outgoing battle).
- Use the shared combat resolver and ordinary battle-report history format. Set the pirate participant's race to `pirates` so the existing faction icon is reused.
- Apply pirate debris rules only to these explicit PvE mission types. Do not award Battle Points for either type.
- Exercise both directions with deterministic resolver tests.

## Deferred to later PRs

- PR2 does not create pirate contacts, schedule or trigger an incoming attack, launch a player fleet, or start reconnaissance. It adds the report/reward contracts and tests only; it does not create a playable pirate action yet.
- Preserve the distinction between pirates attacking a planet and a player attacking pirates when lifecycle work is added. Decide the trigger/timing and make reconciliation safe to repeat as part of that later work; no timer is enabled by PR2.
- When the actions are ready to connect, show the pirate threat in Operations and provide routes to recon and attack. The Universe view should lead to the same threat/operation. Do not make an action button look available before its action can run.
- Use the existing rounded Asterion panel/card styling for Operations and Universe pirate-threat surfaces.
- Keep the existing pirate faction icon mapping; no duplicate icon asset is needed.

The exact division of lifecycle and interface work between PR3 and PR4 remains to be agreed before either PR starts.
