# Resume checkpoint

## Deviations

- No behavior was changed outside the supplied feature requirements. Ordinary outgoing Planetolom targeting and combat rules remain unchanged.
- Test Mode saves accept a Space Flight duration only when it is exactly derivable from a valid 5–719 minute setting and one of the supported Test Mode scales. This preserves accelerated flights across reloads and scale changes.
- Compatibility note: keep previously supported values in `TEST_TIME_SCALE_OPTIONS` if saves from those scales must remain loadable.
- QA outputs and the final Windows installer are kept under `artifacts-feature-space-flight/`. They are local review artifacts and are not part of the source commit.
- The source prompt `docs/prompts/space-flight-and-incoming-attacks-implementation.md` is user-provided input. Keep it untracked and out of the implementation commit.

## How the run ended

- Feature worktree: `D:\Desktop\Asterion\worktrees\space-flight-implementation`
- Branch: `codex/space-flight-implementation-20260924`
- Base: `origin/main` at `c2a12171f8e0478d333893e48afbefd3d85185f6`
- Implementation commit: `4b333b0` (`Add Space Flight and Bot 01 incoming attacks`), pushed to `origin`.
- Draft PR: [#78](https://github.com/ratoker-jpg/Asterion/pull/78). It remains open and in Draft state; it was not marked ready or merged.
- The original checkout at `D:\Desktop\Asterion\repo` remains untouched.
- `npm run build` passed. All 18 domain/application test scripts passed; the flight suite reports 97/97 and the application suite 44/44.
- `npm run test:space-flight-ui` passed at 1920×1080 and 1280×720, including commander-only dispatch, 100 gas fee, satellite/defense preservation, targetless row rendering, Test Mode ×15 persistence after reload, and Bot 01 incoming-row persistence.
- Previously completed UI checks also passed: fleet, universe, battle reports, and Test Mode at their required viewports.
- `npm run dist:win` passed. Final installer: `artifacts-feature-space-flight/release-final/Asterion Setup 0.1.0.exe`. The earlier `release/` installer was preserved.
- `git diff --check` passed; Git emitted only its line-ending conversion notices.
- Independent final review found no new defects. To resume, continue from the feature branch and address any PR feedback; do not mark the PR ready or merge it without an explicit request.

## PR #78 audit follow-up

- Bot 01 incoming siege now reconciles production-bot assignments after factory demolition and energy ledgers after energy-building demolition on surviving planets. Regression coverage includes both factory roles and both last-level energy sources, comparing the energy result with the ordinary building-destruction transition.
- Reports Electron QA no longer seeds `savedReportIds` by directly mutating `localStorage`. It saves the canonical report through the Reports UI, checks persistence immediately after reload, then deletes that exact report and confirms both the report history and saved ID remain intact. The previous CI error was in this QA sequence; GitHub logs showed the direct storage seed and the empty ID array but could not identify the precise write that lost it.
- Space Flight Electron QA now sets 7 minutes and asserts the 00:28 one-way and 00:56 round-trip preview, along with 28,000 ms in the stored flight and after reload.
- Follow-up validation: `npm run test:attack` 18/18, `test:application` 44/44, `test:buildings` 119/119, `test:energy` 10/10, `test:flights` 97/97, `npm run build`, Reports Electron QA, and Space Flight Electron QA passed. Outputs were written to new directories under `artifacts-feature-space-flight/`.
- Reports CI failure cause: the old QA wrote `savedReportIds` directly to localStorage without updating App's in-memory save state, then reloaded. App persists its full save state, so this test setup could be overwritten before reload. CI did not record which write won; the QA now saves through the actual Reports action and asserts the saved ID after reload.
- The Simulator CI timeout did not capture the preset state that failed its exact `presets.length === 1` assertion. Simulator QA now confirms the storage reset per viewport, waits for the expected named preset in both storage and the selector, and includes storage/UI diagnostics on failure. This improves the failure evidence; the exact cause of that one timeout remains unconfirmed.
- Building actions CI failure came from a queue helper that collapsed queue-shape failures and `executeJavaScript` reload errors into one `false` result. It also requested a reload from inside the renderer script. The QA now waits for each expected queue role, holds entries one at a time, reloads from Electron's host process, and checks held timestamps after reload.
- Full CI run #676 passed all domain tests, the renderer build, and every Electron QA step through Universe planet interaction. Its visual-capture step exposed a stale fixture: it set only the legacy root `save.metal` to zero, while the current schema reads `planets['helion-01'].resources.metal`. The fixture now zeros both fields and verifies the canonical zero balance survives reload.
- Full CI run #677 passed all steps through Universe planet interaction and the resource QA's insufficient-wallet case. It then timed out after the visual-capture script injected past queue timestamps and asked the Electron host to reload in a later task. `resetTestSave` documents the same stale-state overwrite window. Queue mutation and reload now run in one renderer task; a failing transition reports the saved queue, building levels, energy, time scale, and current time. `electron/visual-capture.cjs` passed locally at all four viewports, including resource-zone checks at 1920×1080, 1600×900, and 1280×720.
- Additional follow-up validation after the Electron QA changes: `npm run build`, `npm run test:attack` 18/18, `npm run test:building-actions-ui` at 1920×1080 and 1280×720, and `npm run test:simulator-ui` at both viewports passed. QA outputs were written to fresh directories under `artifacts-feature-space-flight/`.
- Full GitHub CI for the queue-fixture follow-up is pending; keep PR #78 open in Draft and do not merge or mark it Ready.
