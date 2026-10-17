# PR 93: blank preview after incoming pirate raid

## Confirmed cause

The user's stack from `index-Bcv4psIB.js:9` maps to `resolveCombat` → `resolvePirateIncomingRaid` → `reconcileFlights` → `reconcileRuntime` → App's startup effect.

The raid generator uses 90–95% of the target's combined fleet and defense population. Both pools can legally contain 25,000 population, generating a pirate attacker above the simulator's 35,000 cap. Combat validation incorrectly applied that cap to the generated raid. The uncaught exception in the startup reconciliation effect unmounted the game after its initial render.

## Correction

Only `pirate-raid` with a valid pirate attacker and a non-pirate defender may exceed the attacker simulator cap. Population must remain a safe integer. All other input/profile checks, simulator/player caps, defender fleet and defense caps remain enforced. Raid force generation, frozen ship quantities, damage, loot and saves are unchanged. No save reset is needed.

## Evidence

- New integration regression fails before the fix with the exact `CombatInputValidationError: Флот атакующего превышает лимит 35 000` and the same application call chain.
- The same test passes after the fix: a real generated raid against 25,000 fleet + 25,000 defense is persisted, reloaded, resolved at startup, and not duplicated on repeated reconciliation.
- Boundary test preserves simulator, non-raid player, defender-fleet and defender-defense limits.
- Generated browser fixture contains an actual 46,610-population raid. The previously deployed build loses the stage after initial render in Yandex; the fixed local build remains mounted and produces exactly one report with all 46,610 population preserved.
- Yandex checks: 1280×720, 1204×650, 1600×900, 1920×1080 and 1919×936 (user screenshot aspect), with delayed observations, Reports and Operations navigation, loaded assets and no JS exceptions.
- Build passes. Combat tests 163/163; pirate domain 66/66; pirate integration 31/31.

`tools/pages-preview-qa.mjs` now accepts an isolated saved regression fixture, includes the screenshot viewport, asserts mounted game navigation and checks the persisted raid report. Pages CI runs this regression against the exact `?mode=test` URL in addition to the clean-profile test.

Fixture reproduction (synthetic Test Mode storage only):

```powershell
node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs tools/generate-preview-raid-fixture.mjs "$env:TEMP/preview-large-raid.json"
$env:ASTERION_PREVIEW_SAVE_FIXTURE = "$env:TEMP/preview-large-raid.json"
node tools/pages-preview-qa.mjs 'https://ratoker-jpg.github.io/Asterion/pr/93/?mode=test' 'D:/Program Files/Yandex/YandexBrowser/Application/browser.exe'
```

Pirate Operations Electron QA also passes at 1920×1080 and 1280×720 (one retry after a fixture-seeding setup race).
