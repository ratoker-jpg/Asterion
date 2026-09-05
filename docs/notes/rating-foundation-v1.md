# Rating foundation v1

## Scope

`Рейтинг` replaces the utility placeholder with a local visual/read-model foundation. The supplied Asterion and Nemexia screenshots are composition/interaction references: the score-type icon semantics and sortable score dimensions are reused, while names and numeric values remain local Asterion fixtures until a canonical backend exists.

V1 exposes:

- Players.
- Alliances.
- Search.
- Four score dimensions with matching semantic glyphs.
- Clickable score headers / active score filter.
- Row selection and dossier.
- Local player highlighting / `ВЫ`.
- Local player's place strip.
- Alliance summary strip.
- Global workspace scrolling only; the rating table has no nested scrollbar.

## Score contract

The read-model has three stored score components:

- `resource` — resource score.
- `combat` — combat score.
- `achievement` — achievement score.

`total` is derived, never stored independently:

`total = resource + combat`

Achievement score is deliberately excluded from total. This invariant is covered by tests.

The exact earning rules are not defined in this PR. The current values remain deterministic fixtures and must not be interpreted as a live scoring formula.

## Ranking behavior

Selecting Total / Resource / Combat / Achievement reorders the table by that dimension. Displayed place for non-total dimensions is derived from the selected score ordering. Historical movement (`previousRank`) is only meaningful for the existing total fixture; other score dimensions show no fabricated movement.

The table shows all four score columns at once, matching the reference pattern where the same score glyphs are used both in the personal score summary and in ranking column controls.

## Data truth

There is no canonical multiplayer leaderboard backend or server season runtime in current Asterion. `src/domain/rating/` therefore identifies every rating row and the provider as `deterministic-local-fixture`.

The local player ID reuses `ASTERION_LOCAL_PLAYER_ID` from Combat. The local alliance name, tag and current member count are projected from current `CommandState`; non-local identities reuse current Command diplomacy names/tags where available.

## Scroll ownership

The previous implementation put `overflow:auto` on `.rating-table-body`, creating an inner scrollbar. The rating workspace now owns vertical scrolling through `.workspace--rating`; table body and dossiers grow naturally with the screen content.

## Deferred

- Real score earning rules.
- Multiplayer/server leaderboard.
- Real season lifecycle/countdown.
- Server-sourced player profiles.
