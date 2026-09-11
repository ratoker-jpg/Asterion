# Phase 2–3 header visual stability

This report records the stable route and visual contracts covered by `electron/header-qa.cjs`.

## Route matrix

| Area | Route IDs | Owner | QA contract |
| --- | --- | --- | --- |
| Primary | `planet`, `universe`, `fleets`, `operations`, `command`, `reports` | `src/ui/navigation.tsx`, `src/ui/header/AsterionHeader.tsx` | `[data-qa-navigation="primary"] [data-qa-route="<id>"]`, one `aria-current="page"` |
| Utility | `settings`, `rating`, `science` | `src/ui/navigation.tsx`, `src/UtilityScreensPortal.tsx` | `[data-qa-navigation="utility"] [data-qa-route="<id>"]`, `[data-qa-utility-screen="<id>"]` |
| Planet zones | `resource`, `industry`, `military` | `src/ui/header/AsterionHeader.tsx`, `src/App.tsx` | `[data-qa-zone="<id>"]`, radial positions remain distinct |

## Header contracts

- The header keeps the canonical top/height contract `20px` / `220px` in the fixed `1920×1080` stage; document-level scrolling remains owned by `GlobalPageScrollController` for long screens.
- Planet selection exposes `data-qa-current-planet`, a labelled listbox controlled by `aria-controls`, one selected option, Escape-to-close, and focus return to the trigger only after Escape or a planet selection; route and zone navigation retain focus on the activated control.
- The resource rail keeps five cards in the order metal, mineral, gas, energy, population. Energy has no fill bar; population shows the current value in the chip and capacity only in its tooltip.
- Campaign status, time, and utility navigation occupy non-overlapping rows. Test Mode keeps its speed picker inside the campaign frame.
- Faction presentation IDs remain `aegis`, `synod`, and `veyra`; the QA harness verifies distinct accent tokens and identical geometry for all three.
- Header/Electron probes use route and `data-qa-*` contracts rather than visible labels or legacy generic selectors.

## Reproduction

```text
npm run build
npm run test:header-ui
npm run test:test-mode-ui
npm run test:science-ui
npm run test:reports-ui
npm run test:building-actions-ui
npm run qa:visual
npm run dist:win
```

All commands above passed on 2026-09-11 in the phase-2/3 worktree. Build and packaging retain the repository's existing large-chunk, missing-package-metadata, and default-icon warnings; none are build failures.

`ASTERION_SKIP_SCREENSHOTS=1` is optional and is not required for CI. The science-queue screenshot uses Electron's native viewport capture because the slower DevTools capture can outlast the first accelerated Test Mode task and make the queue advance before its unchanged persistence assertion runs.
