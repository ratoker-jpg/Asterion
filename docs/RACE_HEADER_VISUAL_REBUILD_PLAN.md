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

Final assets must be PNG with real alpha transparency. Generated backgrounds are removed before runtime integration.

## Required asset set per faction

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

One React header structure, skinned by `profile.factionId` (`aegis`, `synod`, `veyra`). Faction changes should switch CSS variables and decorative asset references, not duplicate the component.

The generated art is decorative only. Labels, resource values, timer, planet name, icons, active state, hover state, focus state and tooltips stay live DOM.

## Current generation status

### Aegis

Generated / in review:

- full two-row header shell candidate;
- planet frame candidates;
- six-slot navigation rail candidate;
- current-planet selector candidate;
- reusable resource-cell candidate;
- campaign + three-utility-slot module candidate;
- active navigation overlay candidate.

### Synod

Generated / in review:

- planet ring candidates;
- upper rail / resource rail candidates;
- lower navigation rail candidates;
- larger utility / campaign frame candidates.

### Veyra

Generated / in review:

- planet ring candidates;
- upper rail / resource rail candidates;
- lower navigation rail candidates;
- larger bio-mechanical utility / campaign frame candidates.

## Integration order

1. Select the strongest candidate per role; reject duplicates and weak generations.
2. Convert selected art to true-alpha PNG and verify edges.
3. Add faction skin registry / CSS token layer without duplicating header markup.
4. Wire decorative layers with `pointer-events: none`.
5. Preserve current resource-tooltip behavior and navigation semantics.
6. Run build / lint / Electron QA that already covers the permanent header.
7. Compare 1920x1080 screenshots against the supplied faction reference.
8. Calibrate spacing, glow intensity and frame thickness only after full-header screenshot review.

## QA gates

- no slogans or faction headings above the header;
- all controls remain real interactive DOM elements;
- resource/tooltips remain readable and unclipped;
- active and hover states stay functional;
- decorative layers must not intercept pointer events;
- 1920x1080 visual comparison against the supplied reference;
- Aegis/Synod/Veyra geometry remains identical while faction art changes;
- no generated text or baked-in numeric values survive into runtime assets;
- do not merge automatically.
