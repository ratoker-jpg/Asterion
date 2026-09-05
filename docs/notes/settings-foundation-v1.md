# Settings foundation v1

## Scope

`Настройки` replaces the utility placeholder with a functional device/UI preferences screen. The supplied Settings screenshot is a visual/layout reference only; it is not a source for Asterion save slots, audio values, FPS limits or color presets.

## Working settings

- Text scale: 90%, 100%, 110%, 120%, 130%, 150%, 170%.
- Tooltips: on/off for the centralized resource tooltip contract plus supported header `title` hints.
- Motion: normal/reduced through root `data-reduced-motion`.
- Desktop window mode: fullscreen/windowed through the Electron bridge.
- Desktop window size presets in windowed mode: 1280×720, 1600×900, 1920×1080, 2560×1440.
- Reset Settings restores only UI/device preferences.

All supported parameters apply immediately. There is no decorative fake Apply action.

## Text scale

Asterion's current shell uses many fixed desktop `px` font declarations. `applyPreferencesToDocument()` caches the original `font-size` declaration for each accessible stylesheet rule and applies a multiplier from that baseline. Supported scales now extend through 150% and 170% for accessibility/readability use.

This changes typography globally without changing the existing 1920×1080 stage scale. Independent UI geometry scaling remains separate and deferred.

`normalizeTextScale()` clamps and snaps arbitrary persisted values to the supported scale list; tests cover the new 150% / 170% upper range.

## Reduced motion and tooltips

Reduced motion suppresses decorative animation/transition duration while leaving state/progress rendering intact. Tooltips are root-controlled; existing custom resource tooltips are hidden when disabled, and App only supplies supported native `title` hints when the preference is enabled.

## Persistence ownership

- campaign: `asterion.vertical-slice.v1`
- device/UI preferences: `asterion.preferences.v1`

Prototype/campaign reset removes only campaign state. Settings reset removes only preferences. Migration remains defensive.

## Desktop integration

Electron keeps:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

The preload bridge exposes only display settings, whitelisted window mode and whitelisted content size. Fullscreen does not claim to change monitor resolution; resolution presets only resize the Electron content area in windowed mode.

## Deferred

- Audio engine and real volume channels.
- Push/OS/economic/research notification runtime.
- Full key rebinding engine.
- Independent UI geometry scale / density rewrite.
