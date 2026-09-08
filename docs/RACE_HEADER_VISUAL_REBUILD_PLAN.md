# Race header visual rebuild plan

## Scope

Rebuild only the permanent Asterion command header from the supplied reference. Do not add faction names, slogans, or any text above the header.

Runtime behavior, resource values, planet selection, navigation, campaign state, tooltips, and existing domain logic remain data-driven DOM/React.

## Asset decision

- **Aegis / Астеры**: keep the current visual direction and reuse existing good assets where they fit. Do not regenerate by default.
- **Synod / Илары**: regenerate the header art. The current green skin reads too generic and does not match the intended ivory ceremonial / emerald crystal language strongly enough.
- **Veyra / Рой**: regenerate the header art. The current red skin is too generic/fantasy-like; target a stronger black-crimson bio-mechanical/chitin identity.

## Generation rule

Generate only text-free decorative assets. No baked-in labels, numbers, planet name, campaign time, resource values, or navigation captions.

Final assets must be PNG with real alpha transparency. Generated backgrounds are removed before runtime integration.

## Required asset set per regenerated faction

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

## QA gates

- no slogans or faction headings above the header;
- all controls remain real interactive DOM elements;
- resource/tooltips remain readable and unclipped;
- active and hover states stay functional;
- decorative layers must not intercept pointer events;
- 1920x1080 visual comparison against the supplied reference;
- Aegis/Synod/Veyra geometry remains identical while faction art changes;
- do not merge automatically.
