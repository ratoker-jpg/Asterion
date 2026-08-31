# UI Generated v1 summary

Added a new transparent source pack at `assets/source/ui-generated-v1/` with 18 UI assets for each faction:

- `aegis/` — navy steel, cyan signal, restrained amber accents
- `synod/` — ivory ceramic, teal crystal, fine gold structure
- `veyra/` — crimson-black chitin, red internal energy, asymmetrical bio-mechanical detail

The pack contains exactly 54 PNGs. It includes five panel/shell sizes, tab idle/active states, primary and secondary idle/hover/pressed button states, empty/busy/locked queue slots, a resource chip, and a selection ring for every faction. All assets are RGBA PNGs with transparent backgrounds and no baked text.

The visual basis is the existing faction UI and gameplay language in `assets/source/faction-delivery-v1/ui`, `assets/source/starter/factions`, `assets/source/generated-factions-v1/factions`, and the existing faction ships/buildings. Three new transparent master motifs were generated with Codex image generation and used as the source for the exact-dimension production variants; the existing UI anchors were retained for buttons and tabs to keep the new pack compatible with the delivered style.

Machine-readable inventory: `assets/manifests/ui-generated-v1.manifest.json`.

Runtime integration is intentionally deferred. This is a source asset drop only and does not replace shared runtime art or change gameplay behavior.

