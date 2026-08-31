# Universe Art v2 — Codex generation backlog

This file records art that is **not required for the current implementation**. The current Universe screen uses existing Asterion assets plus procedural CSS layers so development is not blocked.

When Codex image generation is free, replace the procedural layers below with transparent production art without changing the orbital/navigation logic.

## 1. Star corona overlays

Generate 6 transparent RGBA PNG overlays:

- `assets/source/universe-navigation/star-coronas/star-corona.variant-01.png`
- `assets/source/universe-navigation/star-coronas/star-corona.variant-02.png`
- `assets/source/universe-navigation/star-coronas/star-corona.variant-03.png`
- `assets/source/universe-navigation/star-coronas/star-corona.variant-04.png`
- `assets/source/universe-navigation/star-coronas/star-corona.variant-05.png`
- `assets/source/universe-navigation/star-coronas/star-corona.variant-06.png`

Canvas: 1024x1024, transparent background.

Purpose: animated overlay placed above/below the existing `system-star.variant-XX.png` images. It must contain **only** corona, plasma wisps, flare arcs, sparks and glow detail. Do not draw a solid star body in the center. Keep the central 45–55% mostly transparent so the existing star remains visible. No text, no UI, no planets.

Style: premium dark sci-fi strategy game, physically believable stellar plasma, high contrast rim emission, clean alpha edges, readable when scaled to 180–240 px.

Each variant should visually match the corresponding existing star family rather than replacing it.

## 2. Orbital debris / asteroid belt overlays

Generate 4 transparent RGBA PNG cluster elements:

- `assets/source/universe-navigation/orbital-debris/orbital-debris.variant-01.png`
- `assets/source/universe-navigation/orbital-debris/orbital-debris.variant-02.png`
- `assets/source/universe-navigation/orbital-debris/orbital-debris.variant-03.png`
- `assets/source/universe-navigation/orbital-debris/orbital-debris.variant-04.png`

Canvas: 1024x512, transparent background.

Purpose: small asteroid/debris clusters that can be repeated around an elliptical orbit. Each image should contain 8–20 irregular rocks with large transparent gaps. No background, no star, no planet, no orbit line, no text. Avoid one giant central asteroid; the result should tile/combine naturally with other variants.

Lighting: cold cyan/blue system light with restrained neutral rock tones. Crisp alpha edges.

## Integration rule

The current procedural corona and asteroid belt are fallbacks. Once these assets exist:

1. keep the fixed 24-slot `[G:S:P]` orbital grid unchanged;
2. swap only decorative procedural layers for generated PNGs;
3. retain CSS motion/opacity animation;
4. do not bake coordinates, labels, orbit lines or UI into generated images.
