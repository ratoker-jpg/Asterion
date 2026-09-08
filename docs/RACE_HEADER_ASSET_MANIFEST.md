# Race header asset manifest

This file tracks the decorative assets integrated into draft PR #51.

## Rules

- Runtime text, values, icons and controls remain live DOM/React.
- Generated art is decorative only and does not intercept pointer events.
- Runtime uses only local repository assets; no temporary generation URL is referenced by CSS or TypeScript.
- Runtime raster assets are PNG with a real alpha channel.
- Do not merge automatically.

## Runtime layout

```text
assets/source/faction-header-v2/
  ASSET_METADATA.json
  aegis/
    planet_selector.png
    resource_cell.png
    campaign_utility.png
    navigation_active.png
  synod/
    planet_frame.png
    navigation_rail.png
    planet_selector.png
    campaign_utility.png
  veyra/
    planet_frame.png
    navigation_rail.png
    planet_selector.png
    campaign_utility.png
```

`ASSET_METADATA.json` stores dimensions, byte size, SHA-256, source/cutout task and whether the deterministic border-connected black-key fallback was used.

The first integration pass intentionally keeps CSS geometry, separators and inactive button treatment where raster art would not add meaningful faction identity. This keeps live controls readable and avoids redundant generated art.

## Aegis / Астеры

| Runtime file | Source / alpha task | Preparation | Status |
| --- | --- | --- | --- |
| `aegis/planet_selector.png` | `1feb8860-7fd7-46ad-b432-6b266f57365b` | Runway alpha + crop + selector glyph scrub | integrated |
| `aegis/campaign_utility.png` | `40f15951-b585-446e-b731-216963077621` | Runway alpha + crop | integrated |
| `aegis/resource_cell.png` | `db4ec53c-b1f7-48a3-affe-fad35aff4b4b` | border-connected black-key + edge feather | integrated |
| `aegis/navigation_active.png` | `7ed9d807-acab-4b77-b1fb-5b678d70d43d` | Runway alpha + crop | integrated |

The automated segmentation service could not detect the resource frame even after the permitted retry. The repository asset therefore uses a deterministic border-connected near-black removal that preserves enclosed dark panel interiors.

## Synod / Илары

| Runtime file | Source / alpha task | Preparation | Status |
| --- | --- | --- | --- |
| `synod/planet_frame.png` | `4506ce16-0a95-440a-956e-e575913aac16` | Runway alpha + crop | integrated |
| `synod/navigation_rail.png` | `d6da4315-092f-4870-9420-e8df3b873163` | Runway alpha + crop | integrated |
| `synod/planet_selector.png` | `cc9f91fd-d834-4416-bcba-97308e974b0e` | Runway alpha + crop + selector glyph scrub | integrated |
| `synod/campaign_utility.png` | `3ed70adb-7fd8-4a12-9661-31bbbff8382b` | border-connected black-key + edge feather | integrated |

The campaign module segmentation failed after the permitted retry, so the same deterministic black-key fallback was used locally.

## Veyra / Рой

| Runtime file | Source / alpha task | Preparation | Status |
| --- | --- | --- | --- |
| `veyra/planet_frame.png` | `83bea2b6-5115-4e3c-869a-5a6d54622730` | Runway alpha + crop | integrated |
| `veyra/navigation_rail.png` | `c4770c58-9e25-4daf-b7d1-a1fe0c009a52` | Runway alpha + crop | integrated |
| `veyra/planet_selector.png` | `e41e8be3-85cb-424f-a717-4028bf719706` | Runway alpha + crop + selector glyph scrub | integrated |
| `veyra/campaign_utility.png` | `213558fa-c788-42f6-9270-36237449d23a` | border-connected black-key + edge feather | integrated |

The campaign module segmentation failed after the permitted retry, so the deterministic black-key fallback was used locally.

## Selector text/icon ownership

Generated selectors sometimes contained a decorative bright dropdown glyph even though the runtime already owns the dropdown chevron. During binary preparation the small bright accent glyph inside the selector's right-hand recess is scrubbed while the surrounding frame remains intact. The visible chevron therefore remains live DOM, not baked raster content.

## Runtime wiring

`src/asterion-header-faction-skins.css` now maps faction-specific roles to local files:

- selector art for all three factions;
- campaign/utility shell for all three factions;
- Aegis resource-cell and active-tab art;
- Synod/Veyra planet frames;
- Synod/Veyra whole navigation rails.

Decorative pseudo-elements are kept below live labels/icons/tooltips and use `pointer-events: none`.

## QA gate

A candidate is considered integrated only if:

1. the file exists locally under `assets/source/faction-header-v2/`;
2. PNG alpha spans transparent through opaque pixels;
3. runtime CSS references the local file, never a signed URL;
4. live selector/resource/campaign/navigation content remains DOM text/icons;
5. 1920×1080 faction QA confirms identical header geometry;
6. resource tooltip remains visible, inside the viewport and unclipped;
7. normal build / Electron visual QA passes.

The dedicated Electron check is `npm run qa:header-factions`; it captures `aegis.png`, `synod.png`, `veyra.png` plus `metrics.json` under `visual-qa/header-factions/`.

## Merge status

PR #51 remains draft. No merge is performed by this work.
