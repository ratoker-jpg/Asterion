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

## 3. Anomaly discovery pack

The current `stellar-remnants.variant-01..02.png` images are placeholders, not a complete anomaly language: they read as the same glowing object at different coordinates. Generate a varied pack of **8 distinct transparent RGBA PNG base assets**. Each anomaly must have a different silhouette, physical story and dominant colour signature. Do not make another spherical planet, generic blue portal or recoloured star.

### Required anomaly families

1. `anomaly-gravitational-lens.png` — **Einstein ring / lensing event**. A dark compact lens bends a distant cyan-gold light source into an incomplete luminous ring or arc. The centre must stay visually dark; use warped arcs and duplicated light, not a planet surface.
2. `anomaly-relativistic-jet.png` — **black-hole accretion disk and bipolar jet**. Black centre, thin hot amber disk, two asymmetric blue-violet plasma jets and a small amount of gravitational distortion. Keep the jets readable at 48 px.
3. `anomaly-magnetar-wind.png` — **magnetar / pulsar wind nebula**. A pin-bright neutron star with a tilted magnetic axis, a compact torus and two narrow electric-cyan outflows. Use a white-hot core and restrained red-violet field lines.
4. `anomaly-supernova-shell.png` — **filamentary supernova remnant**. An irregular expanding shell of red, teal and pale-gold shock filaments with a dim compact remnant, not a solid glowing ball. The outer rim should carry most of the detail.
5. `anomaly-dark-nebula.png` — **dark nebula / Bok-globule silhouette**. An opaque, ragged charcoal cloud blocks a background star field; only a thin amber/cyan rim and a few dust filaments reveal its shape. Large transparent gaps are required.
6. `anomaly-protostar-outflow.png` — **embedded protostar with Herbig–Haro bipolar outflow**. Warm hidden core inside a dusty cocoon, two unequal cone-shaped jets and scattered particles. The two-sided outflow must create a distinct vertical silhouette.
7. `anomaly-cosmic-bubbles.png` — **Fermi-like bipolar bubbles**. Two translucent magenta/cyan lobes joined at a narrow waist, with a crisp edge and faint internal turbulence. It should read as a large-scale energy structure rather than a portal.
8. `anomaly-kilonova-stream.png` — **compact-object merger / kilonova**. Two tiny dense luminous remnants, a short-lived blue-white flash and an asymmetric red-gold tidal stream. No humanoid or spacecraft shapes.

### Optional speculative variants

These may be added later as rare discoveries, clearly labelled as speculative in data rather than presented as established astronomy:

- `anomaly-wormhole-throat.png` — a warped tunnel with a visible far-side star field;
- `anomaly-cosmic-string.png` — a razor-thin luminous defect cutting across the background field;
- `anomaly-megastructure-signal.png` — an incomplete geometric occultation around a star, with no readable text or logos.

### Shared art constraints

- Canvas: `1024x1024`, transparent background, premultiplied-alpha-safe edges.
- Produce a clean base image plus enough negative space to layer a subtle CSS pulse or scan halo behind it. Do not bake animation into the PNG.
- No labels, coordinate text, orbit rings, UI panels, borders or background rectangles in the art.
- Avoid a circular planet silhouette as the default composition. At least six of eight required assets must have a non-circular silhouette.
- Use different visual signatures: cyan/gold lensing, black/amber/blue jet, cyan/white magnetar, red/teal shell, charcoal/amber cloud, warm dusty outflow, magenta/cyan bubbles and blue-white/red-gold merger.
- The base image must remain recognisable at a 52 px map marker and reward inspection at a 140–180 px modal preview.
- Keep the centre and edges legible against Asterion's dark navy shell; do not rely on a white background or a glow that erases the silhouette.
- Each file is a visual asset only. Scientific naming, `known` state, description and future interaction belong to the Universe data model.

### Source inspiration and interpretation

The visual directions are grounded in observed phenomena, then stylised for a strategy-game discovery map. NASA describes Einstein rings as curved light from alignment with a gravitational lens; Fermi reports the large bipolar gamma-ray bubbles; NASA/JPL describes Herbig–Haro objects as protostellar outflows; NASA's Hubble guide covers emission, reflection, planetary, supernova-remnant and absorption nebulae. The compact-object-merger direction is grounded in observed multi-messenger events; only the wormhole, cosmic-string and megastructure variants are marked as speculative or interpretive.

- [NASA Hubble — Gravitational Lenses](https://science.nasa.gov/mission/hubble/science/universe-uncovered/hubbles-gravitational-lenses/)
- [NASA Fermi — Fermi Bubbles](https://fermi.gsfc.nasa.gov/science/constellations/pages/bubbles.html)
- [NASA/JPL — Herbig–Haro 46/47](https://www.jpl.nasa.gov/images/pia04940-spectrum-from-embedded-star-in-herbig-haro-4647/)
- [NASA Hubble — Nebulae field guide](https://science.nasa.gov/mission/hubble/science/universe-uncovered/hubble-nebulae/)
- [NASA Hubble — Stellar explosions and kilonovae](https://science.nasa.gov/mission/hubble/science/science-behind-the-discoveries/hubble-stellar-explosions/)

## Integration rule

The current procedural corona and asteroid belt are fallbacks. Once these assets exist:

1. keep the fixed 24-slot `[G:S:P]` orbital grid unchanged;
2. swap only decorative procedural layers for generated PNGs;
3. retain CSS motion/opacity animation;
4. do not bake coordinates, labels, orbit lines or UI into generated images.
5. expose the selected family through a stable anomaly asset ID so different anomalies do not collapse into one generic `stellar-remnant` fixture;
6. keep the existing placeholder images as a temporary fallback only until the full pack is imported and QA-captured.
