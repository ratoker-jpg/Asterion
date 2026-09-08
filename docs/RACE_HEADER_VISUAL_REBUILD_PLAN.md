# Race header visual rebuild plan

## Scope

Rebuild only the permanent Asterion command header from the supplied reference. Do not add faction names, slogans, or any text above the header.

Runtime behavior, resource values, planet selection, navigation, campaign state, tooltips, and existing domain logic remain data-driven DOM/React.

## Asset decision

- **Aegis / Астеры**: generate a dedicated blue-steel header shell as well. Existing Aegis assets remain useful as supporting material, but they are no longer treated as the final visual target.
- **Synod / Илары**: regenerate the header art. The current green skin reads too generic and does not match the intended ivory ceremonial / emerald crystal language strongly enough.
- **Veyra / Рой**: regenerate the header art. The current red skin is too generic/fantasy-like; target a stronger black-crimson bio-mechanical/chitin identity.

## Generation rule

Generate only text-free decorative assets. No baked-in labels, numbers, planet name, campaign time, resource values, or navigation captions.

Final raster assets must be PNG with real alpha transparency. Generated backgrounds are removed before runtime integration.

## Required visual roles

The header needs the following visual roles, but not necessarily ten separate raster files per faction. Reuse CSS geometry or one compatible decorative asset when a separate bitmap adds no visible value.

1. `planet_outer_frame`
2. `planet_inner_ring`
3. `zone_button_frame`
4. `planet_selector_frame`
5. `resource_rail_frame`
6. `resource_cell_separator`
7. `campaign_frame`
8. `navigation_rail_frame`
9. `navigation_button_frame`
10. `navigation_active_overlay`

This avoids wasting generation credits on separators and inactive states that CSS can reproduce cleanly while preserving live DOM content.

## Aegis visual language

- navy / gunmetal structural shell;
- brushed steel hard-surface armour;
- cyan-blue signal light and glass glow;
- disciplined military engineering and sharp geometry;
- restrained highlights, no decorative fantasy ornament;
- avoid green tint, organic forms, or excessive chrome.

## Synod visual language

- ivory / white ceramic structural shell;
- emerald-teal crystal and glass;
- restrained silver / pale gold mechanical supports;
- symmetry and ceremonial high technology;
- thin luminous green signal channels;
- avoid generic neon-green sci-fi plastic.

## Veyra visual language

- black and deep crimson chitin;
- red internal bioluminescence;
- organic ribs, tendons, veins and asymmetric growth;
- sharp but biological silhouettes;
- subtle wet/translucent membrane detail only where useful;
- avoid generic gothic metal, pirate styling, flames, or clean human engineering.

## Runtime architecture

One React header structure, skinned by the faction visual token layer. The current prototype remains Aegis in domain state; `?headerFaction=aegis|synod|veyra` is a visual-only QA override and does not mutate saves or gameplay state.

When faction selection becomes runtime-configurable, the same visual token layer should be driven by `profile.factionId` (`aegis`, `synod`, `veyra`) rather than duplicating the component.

The generated art is decorative only. Labels, resource values, timer, planet name, icons, active state, hover state, focus state and tooltips stay live DOM.

## Current generation status

The deterministic task mapping and intended local filenames are tracked in `docs/RACE_HEADER_ASSET_MANIFEST.md`.

### Aegis

Generated:

- current-planet selector;
- reusable resource-cell frame;
- campaign + three-utility-slot module;
- active navigation overlay;
- supporting full-shell / navigation candidates from the earlier pass.

Alpha-cutout processing has been submitted for the selected high-value modules. The selector already has a completed alpha result.

### Synod

Generated:

- planet ring;
- navigation rail;
- current-planet selector;
- campaign + three-utility-slot module.

Alpha-cutout processing has been submitted for all selected modules. The selector already has a completed alpha result.

### Veyra

Generated:

- biomechanical planet ring;
- biomechanical navigation rail;
- current-planet selector;
- campaign + three-utility-slot module.

Alpha-cutout processing has been submitted for all selected modules. The planet ring already has a completed alpha result.

## Integration order

1. Select the strongest candidate per role; reject duplicates and weak generations.
2. Convert selected art to true-alpha PNG and verify edges.
3. Keep faction skin registry / CSS token layer separate from geometry and domain logic.
4. Copy approved PNGs into `assets/source/faction-header-v2/<faction>/`.
5. Wire decorative layers with `pointer-events: none` and local asset paths only.
6. Preserve current resource-tooltip behavior and navigation semantics.
7. Run build / lint / Electron QA that already covers the permanent header.
8. Compare 1920x1080 screenshots against the supplied faction reference.
9. Calibrate spacing, glow intensity and frame thickness only after full-header screenshot review.

## Binary transfer constraint

Temporary signed generation URLs must not be used as runtime dependencies. The connected GitHub contents API can update source text but cannot directly copy the remote generated PNG bytes into the repository. Until the binary transfer step is available, the branch uses the existing local faction-delivery images as safe visual fallbacks and keeps the new generated assets tracked by task id in the manifest.

## QA gates

- no slogans or faction headings above the header;
- all controls remain real interactive DOM elements;
- resource/tooltips remain readable and unclipped;
- active and hover states stay functional;
- decorative layers must not intercept pointer events;
- 1920x1080 visual comparison against the supplied reference;
- Aegis/Synod/Veyra geometry remains identical while faction art changes;
- no generated text or baked-in numeric values survive into runtime assets;
- no temporary signed generation URL is referenced by runtime CSS;
- do not merge automatically.
