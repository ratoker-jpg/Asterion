# Stellar Empires starter asset pack

## Contents

This package contains **52 final PNG files** created for the Stellar Empires starter pack:

- `factions/` — 3 hero arts (1024×1024), 3 emblems (512×512), and 3 card backgrounds (1600×900).
- `backgrounds/` — `galaxy_background.png` and `system_background.png` (1920×1080).
- `stars/` — 6 star types (1024×1024).
- `planets/` — 8 planet types plus `planet_colonized.png` (1024×1024).
- `asteroids/` — 4 common, 2 gas-rich, and 2 metal-rich asteroids (1024×1024).
- `pirates/` — pirate base, outpost, raider, and heavy ship (1024×1024).
- `ships/` — scout, cargo, colony, fighter, frigate, and recycler ships (1024×1024).
- `buildings/` — 8 horizontal 2048×512 PNG sprite sheets, each containing L1–L4 building stages in four 512×512 cells.
- `preview/asset_pack_overview.png` — an opaque 1920×1080 contact sheet.

## Transparency and post-processing

All object sprites are RGBA PNGs with transparent corners. The image-generation workflow used a contrasting solid chroma-key background, followed by soft-matte background removal and despill. Scene/card backgrounds and the preview are intentionally opaque RGB PNGs.

The only sprite sheets are the building files. All other gameplay assets are individual PNG files.

## Quality-repair pass

The eight included building sheets were rebuilt from their alpha-clean source renders using transparent gaps between stages, rather than equal-width source crops. This removes generated divider lines and prevents artwork from crossing the 512 px cell boundaries. `asteroids/asteroid_gas_02.png` was regenerated on a green chroma-key background to eliminate a magenta halo. The final quality check verifies all required dimensions, transparent corners, clear building-cell separators, and no magenta-key pixels on that asteroid.

## Known limitation

`buildings/storage_hub_sheet.png` is not included. Its generation was attempted twice, but the image service returned a network error both times. The requested pack otherwise contains every specified final asset.

## Packaging note

Only the final folders listed above and this manifest are included in `stellar_empires_starter_asset_pack.zip`. Any local chroma-key source folders are deliberately excluded.
