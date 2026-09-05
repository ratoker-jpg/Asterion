# Settings foundation v1

## Scope

`Настройки` replaces the utility placeholder with a functional device/UI preferences screen. The supplied Settings screenshot is a visual/layout reference only; it is not a source for Asterion settings, save slots, audio values, FPS limits or color presets.

## Working settings

- Text scale: 90%, 100%, 110%, 120%, 130%.
- Tooltips: on/off for the centralized resource tooltip contract plus the supported header `title` hints wired by App.
- Motion: normal/reduced through root `data-reduced-motion`.
- Desktop window mode: fullscreen/windowed through the Electron bridge.
- Desktop window size presets in windowed mode: 1280×720, 1600×900, 1920×1080, 2560×1440.
- Reset Settings restores only UI/device preferences.

All supported parameters apply immediately. There is no decorative fake Apply action.

## Text scale

Asterion's current shell uses many fixed desktop `px` font declarations. `applyPreferencesToDocument()` caches the original `font-size` declaration for each accessible stylesheet rule and applies a multiplier from that baseline. This changes typography globally without changing the existing 1920×1080 stage scale or threading a `textScale` prop through every view. The root also exposes `--asterion-text-scale` / `data-text-scale` for future components.

This is deliberately separate from `useStageScale()`. UI geometry scaling is deferred because changing the stage contract would be a global shell rewrite.

## Reduced motion and tooltips

Reduced motion is a root-level presentation preference and suppresses decorative animation/transition duration while leaving state/progress rendering intact. Tooltips are also root-controlled; existing custom resource tooltips are hidden when disabled, and App only supplies supported native `title` hints when the preference is enabled. Legacy UI is not mass-rewritten in this PR.

## Persistence ownership

Campaign state and device preferences are separate owners:

- campaign: `asterion.vertical-slice.v1`
- device/UI preferences: `asterion.preferences.v1`

Prototype/campaign reset removes only campaign state. Settings reset removes only preferences. Migration is defensive and invalid text scale, window mode or resolution falls back to canonical defaults.

## Desktop integration

Electron keeps the existing security model:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

`electron/preload.cjs` exposes only three narrow methods through `contextBridge`: read display settings, set whitelisted window mode, set whitelisted content size. `electron/window-settings.cjs` validates all IPC payloads. No arbitrary Electron/Node API is exposed to the renderer.

Fullscreen does not claim to change monitor resolution. The resolution control is disabled in fullscreen; size presets only call `BrowserWindow.setContentSize()` in windowed mode. Existing F11 toggle and Escape-from-fullscreen behavior remain in `electron/main.cjs`.

## Web / Pages fallback

Browser/Pages preview cannot resize the desktop Electron window. Window mode and window resolution controls are therefore disabled and the screen explicitly displays `WEB PREVIEW`. Text scale, reduced motion, tooltips and preference persistence still work in the browser.

## Deferred

- Audio engine and real volume channels.
- Push/OS/economic/research notification runtime.
- Full key rebinding engine; F11 and Escape are shown read-only.
- Independent UI geometry scale / density rewrite.
