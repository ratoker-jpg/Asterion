# Rating foundation v1

## Scope

`Рейтинг` replaces the utility placeholder with a local visual/read-model foundation. The supplied Rating screenshot is a composition reference only; names, points, winrate, fleet strength, economy, empire levels, rewards and season values from the image are not Asterion canon.

V1 exposes only:

- Players.
- Alliances.
- Search.
- Sort by place or score.
- Row selection and dossier.
- Local player highlighting / `ВЫ`.
- Local player's place strip.
- Alliance summary strip.

## Data truth

There is no canonical ranking formula, multiplayer leaderboard backend or server season runtime in current Asterion. `src/domain/rating/` therefore identifies every rating row and the provider as `deterministic-local-fixture`.

Scores, ranks, previous ranks, sectors and non-local player identities are fixture data for UI/read-model testing. The UI labels this truth explicitly and does not present the table as a live server leaderboard.

The local player ID reuses `ASTERION_LOCAL_PLAYER_ID` from Combat rather than defining another magic identifier. The displayed local-player profile name is still a Rating fixture because Asterion has no canonical player-profile domain yet.

## Command reuse

The local alliance name, tag and current member count are read from the `CommandState` passed by `App.tsx`. Non-local alliance identities reuse current Command diplomacy names/tags where available, while their ranking members/score/rank remain Rating fixtures.

Changing the alliance settings in Command therefore changes the local alliance identity shown by Rating without inventing a second alliance owner.

## Architecture

- `types.ts` — read-model types and explicit data-truth marker.
- `fixtures.ts` — deterministic fixture values only.
- `selectors.ts` — Command projection, search, sorting, local selection and rank delta.
- `rating.test.ts` — determinism and integrity coverage.
- `RatingView.tsx` / `rating.css` — visual foundation.

Rank delta is presentation math only: `previousRank - currentRank`. It does not calculate ranking score.

## Deferred

- Real ranking/scoring formula.
- Multiplayer/server leaderboard.
- Real season lifecycle/countdown.
- Achievements, glory and empire leaderboard tabs.
- Server-sourced player profiles, winrate, fleet power or economy statistics.
