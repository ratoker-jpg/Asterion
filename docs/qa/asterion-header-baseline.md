# Asterion header refactor baseline

Baseline captured before the header refactor from source commit `7b0e3ae` in the isolated worktree.

Commands:

- `npm run build`
- `npm run test:test-mode-ui`
- `npm exec -- electron electron/visual-capture.cjs`

The visual capture used the production save and the existing routes for Planet, Universe, Fleets, Operations, Command, Reports, Settings, Rating, and Science. The dedicated capture script measured the utility screens at the viewport sizes below.

| viewport | Settings workspace | Settings host | Rating workspace | Rating host | Science workspace | Science host |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1280×720 | x=17.833, y=164, w=1229.333, h=606 | w=571.094 | h=714.667 | h=680 | h=898 | h=863.042 |
| 1920×1080 | x=30.5, y=246, w=1844, h=899 | w=1844, h=846.594 | h=1072 | h=1020 | h=1347 | h=1294.563 |

Additional captured scales were 1600×900 and 2560×1440. Long utility pages intentionally owned document-level vertical scroll; the baseline checks did not treat that as horizontal overflow. Typography probes covered HUD 130%, helper 180%, and page-title scaling. Before the refactor, the visible population header value was `58 / 70`; the refactor keeps the current value as `58` and exposes `58 / 70` in its accessible tooltip per the header brief.

This file records the pre-change measurements only. Post-change contract checks live in `electron/header-qa.cjs` and are run with `npm run test:header-ui`.
