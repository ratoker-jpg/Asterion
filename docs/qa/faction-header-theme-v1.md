# Faction header theme QA

## Scope

The command header now resolves the player's faction from the live profile state and supports the three faction variants from the brief:

- `aegis` — Астеры, cyan/blue metallic treatment
- `synod` — Илары, emerald/ceramic treatment
- `veyra` — Рой, red/burgundy organic treatment

The `?faction=` query parameter is a preview-only QA override. It does not mutate the saved profile, economy, or runtime state.

## Changed files

- `src/App.tsx` — faction theme resolution, resource semantics, accessible header labels, asset wiring.
- `src/faction-header.ts` — theme registry and resource fill/status helpers.
- `src/faction-header.test.ts` — theme, preview override, and full/overflow resource tests.
- `src/asterion-header.css` — shared geometry, faction tokens, asset frames, status colors, focus and reduced-motion behavior.
- `src/shell-v4.css` — workspace offset for the expanded header.
- `electron/faction-header-qa.cjs` — reproducible six-viewport Electron QA runner and screenshot capture.
- `package.json` / `package-lock.json` — header test and UI QA scripts.

## Reused assets

The implementation reuses the repository's delivered faction assets instead of creating replacement artwork:

- `assets/source/faction-delivery-v1/ui/{aegis,synod,veyra}_panel_frame.png`
- `assets/source/faction-delivery-v1/ui/{aegis,synod,veyra}_primary_button.png`
- `assets/source/faction-delivery-v1/ui/{aegis,synod,veyra}_active_tab.png`
- `assets/source/generated-factions-v1/factions/{aegis,synod,veyra}_emblem.png`

## Verification

Passed:

- `npm run build`
- `npm run test:header` — 3/3 tests
- Existing domain suites: buildings 82, combat 75, operations 12, command 15, reports 17, settings 6, rating 7, runtime 2, fleet 3, science 15, universe 14.
- Browser smoke for all three query-preview themes: labels, no population capacity suffix, critical red full/overflow bars, zero broken images, focus behavior, and no console warnings/errors.

The exact-size runner is included as `npm run test:header-ui` and covers 1920x1080 and 1280x720 for all three factions. In this desktop environment Electron terminates when the offscreen `BrowserWindow` is created, before the runner can render; therefore the exact-size Electron capture is recorded as environment-blocked rather than reported as passed. The browser smoke was completed in the available in-app viewport and is not presented as a substitute for those exact-size captures.
