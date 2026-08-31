# Stellar Empires — faction asset delivery (current state)

## What is included

This package is a source-ready visual delivery, not a runtime patch. It contains:

- 39 faction ship sprites: 13 gameplay role families for Aegis, Synod, and Veyra;
- 54 building sheets: 18 roles for each faction, with L1–L4 in four `512×512` frames (`2048×512` per sheet);
- 9 first-pass faction UI skins: `panel_frame`, `primary_button`, and `active_tab` for the three factions;
- 3 neutral, opaque placeable-territory backgrounds: resource, industry, and military;
- preview images created for visual QA.

All ships are `1024×1024` RGBA cutouts. Building sheets have transparent corners and empty boundary columns between level frames. The territory images intentionally remain opaque.

## Faction language

| Faction | Deliberate visual identity |
| --- | --- |
| Aegis | Navy steel, angular armour, precision engineering, cyan signal light and restrained amber command accents. |
| Synod | Ivory ceramic, teal crystal/glass, fine gold structure, deliberate symmetry and ceremonial high technology. |
| Veyra | Crimson-black chitin, red internal energy, asymmetry, ribs, sacs, tendrils and bio-mechanical growth. Not pirate language and not green chroma-key residue. |

## Why the pack differs from a literal copy of Nemexia

The user supplied authenticated visual references from the live game, including ship production cards and three placeable territory zones. Those references were used to identify gameplay families and the placement model; the delivered art is original faction art rather than copied game art.

### Ships

The live reference exposes a broader and more granular catalogue than a small three-role prototype: satellite, spy, cargo and large cargo, colony, recycler, fighter, interceptor, shield bot, armada/frigate line, Goliath, bomber, and Titan. The pack therefore uses 13 role families × 3 factions (39 assets), rather than pretending that scout/fighter/frigate alone describes the available fleet.

The `frigate` family is the project’s neutral name for the observed armada/frigate line. This is a semantic mapping for future data-driven integration, not a claim that the reference game’s exact unit rules, stats, names, or assets were reproduced.

### Buildings and territories

The live game shows a terrain surface with buildings independently placed on it. Earlier composited-terrain ideas were therefore rejected. The delivery instead keeps three terrain scenes free of baked-in buildings and supplies transparent building sprites above them. A future renderer must enforce each role’s placement footprint, collision rule, bounds check, and draw depth.

The original requested role total was completed as 18 building families: command centre, research lab, shipyard, defence platform, bank, robotics factory, missile battery, shield generator, metal extractor, crystal refinery, gas extractor, solar plant, storage hub, water processor, hydroponics dome, ore processor, crystal vault, and gas reservoir. Level growth is intended to be vertical/detail growth inside a stable footprint rather than a request to relocate an upgraded building.

### UI

The initial delivery plan named 63 UI assets. Only the first 9 non-text faction skins are currently delivered. They are deliberately text-free so that runtime labels remain localized, accessible, and data-driven. The remaining UI states, panel variants, icons, and runtime use are explicitly not represented as complete.

### Runtime integration is intentionally deferred

The bundle does not change game balance or silently replace current shared assets. The intended next code phase is a data-driven faction asset registry and renderer migration, with fallback to current shared assets. This avoids coupling an image drop to a fixed Aegis-only CSS contract and makes it possible to integrate per-faction ships and buildings safely.

## Completion status

| Area | Planned | Delivered | Status |
| --- | ---: | ---: | --- |
| Ships | 39 | 39 | Complete asset set |
| Building sheets | 54 | 54 | Complete asset set |
| Territory backgrounds | 3 | 3 | Complete asset set |
| UI skins/assets | 63 | 9 | First batch only |
| Contact sheets | ship preview present; delivery preview included | current | QA artifact, not runtime content |
| Data-driven runtime wiring | future phase | 0 | Not part of this asset-only delivery |

## Important omissions and next actions

1. Complete the remaining 54 UI assets and their states.
2. Add a versioned data-driven asset manifest for all new role IDs and faction variants.
3. Integrate placement metadata, previews, tint states, and fallback selection in the runtime.
4. Run blind-read review at `128×128`: faction recognition must survive without name, emblem, or colour alone.
5. Review all outputs in the target game UI before replacing any shared runtime art.

