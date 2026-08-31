# Asterion UI Generated v1 — prompt and production spec

## Generation intent

Create a first production-oriented transparent UI asset pack for Asterion. The pack supplies the missing faction-specific shells and state variants for Aegis, Synod, and Veyra without replacing or regenerating existing gameplay art. Every source PNG is text-free, has a transparent background, leaves the usable content area open wherever the asset is a frame, and is sized for direct desktop strategy UI use.

The pack is intentionally scoped to exactly 18 asset IDs per faction (54 PNGs total): panel shells, a modal and tooltip shell, tab states, primary and secondary button states, production queue slots, a resource chip, and a selection ring.

## Style rules

- Use crisp, readable silhouettes with clean alpha edges and restrained decorative detail.
- Keep panel interiors mostly transparent and free of gameplay objects.
- Do not bake labels, words, numbers, faction names, emblems, or UI copy into the art.
- Do not include characters, planets, ships, buildings, stars, or scenes.
- Keep state differences visible at reduced scale: hover is brighter/more energized, pressed is darker and slightly recessed, active tabs are stronger than idle tabs, busy slots show operational progress, and locked slots are visibly unavailable.
- Preserve the established Asterion faction language from `assets/source/faction-delivery-v1/ui`, `assets/source/starter/factions`, `assets/source/generated-factions-v1/factions`, and the existing ships/buildings.

## Faction-specific visual guidance

### Aegis

Navy steel, angular armor plating, precision engineering, cool silver bevels, cyan signal light, and restrained amber command accents. Prefer hard-edged geometry, layered machined plates, and controlled technical grooves.

### Synod

Ivory ceramic, teal crystal/glass, fine gold structure, deliberate symmetry, and ceremonial high technology. Prefer smooth enamel-like surfaces, faceted crystal insets, elegant filigree, and balanced ornament.

### Veyra

Crimson-black chitin, red internal energy, asymmetry, ribs, sacs, tendrils, and bio-mechanical growth. Prefer layered organic plates and controlled emissive channels. Avoid pirate motifs and green chroma-key residue.

## Required asset list

| Asset ID | Canvas | Intended use |
| --- | ---: | --- |
| `panel_frame_large` | 1600×900 | Main screen panel shell / large scene container |
| `panel_frame_medium` | 1024×768 | Standard content panel |
| `panel_frame_small` | 640×480 | Small information panel |
| `modal_frame` | 1200×800 | Modal dialog frame |
| `tooltip_frame` | 700×220 | Tooltip / compact description popup |
| `tab_idle` | 512×128 | Inactive tab |
| `tab_active` | 512×128 | Active selected tab |
| `button_primary_idle` | 448×128 | Primary button default |
| `button_primary_hover` | 448×128 | Primary button hover |
| `button_primary_pressed` | 448×128 | Primary button pressed |
| `button_secondary_idle` | 448×128 | Secondary button default |
| `button_secondary_hover` | 448×128 | Secondary button hover |
| `button_secondary_pressed` | 448×128 | Secondary button pressed |
| `queue_slot_empty` | 512×160 | Empty production queue slot |
| `queue_slot_busy` | 512×160 | Active / occupied production queue slot |
| `queue_slot_locked` | 512×160 | Locked production queue slot |
| `resource_chip` | 320×96 | Small resource display shell / chip |
| `selection_ring` | 512×512 | Circular or elliptical selection marker / highlight ring |

## Prompt templates used

The three generated master frame motifs used the following normalized template, with the faction guidance substituted per call:

```text
Use case: ui-mockup
Asset type: transparent game UI source motif
Primary request: Create a clean, production-oriented transparent sci-fi strategy game UI frame motif for the <FACTION> faction, intended to seed a family of panels, tabs, buttons, queue slots, resource chips, and selection markers.
Style/medium: polished game UI concept asset, <FACTION MATERIAL LANGUAGE>
Composition/framing: centered isolated UI frame, generous empty transparent center, <FACTION COMPOSITION LANGUAGE>, no crop
Color palette: <FACTION PALETTE>
Materials/textures: <FACTION MATERIAL DETAILS>, clean edges
Constraints: genuinely transparent background with preserved alpha; avoid opaque fills inside the content area; no baked text; no characters, ships, buildings, planets, scene, or watermark
Avoid: fake screenshot, collage, clutter, raster junk, unrelated gameplay art
```

The Aegis call used navy steel, angular armor, cyan signal light, and amber accents. The Synod call used ivory ceramic, teal crystal/glass, gold filigree, and symmetry. The Veyra call used crimson-black chitin, red internal energy, asymmetry, ribs, sacs, tendrils, and bio-mechanical growth.

The exact requested dimensions and state behavior were then applied to the generated transparent motifs and the existing faction UI anchors. The production derivation is deterministic: panel variants are dimensioned frame resizes, tabs/buttons preserve each faction’s established source treatment with state transforms, queue slots and selection rings use matching faction palette geometry, and every output is written as RGBA PNG.

## Repair / retry notes

- The three master motif generations were visually checked against the existing faction panel references before production derivation.
- Alpha channels were normalized to remove near-transparent fringe noise below the validation threshold while preserving soft emissive glows.
- Hover, pressed, idle, active, busy, and locked states were checked as separate files; no baked text or gameplay objects were present.
- No unrelated source pack was overwritten, renamed, deleted, or regenerated.

