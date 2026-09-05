# Rating foundation v1 — Nemexia-backed correction

## Source pattern

The rating screen was rechecked against the saved Nemexia ranking page in `ratoker-jpg/Nemexia_auto_v2/saved_pages`:

- `saved_pages/page_2026-09-05_22-54-33.html` — Players selected.
- `saved_pages/page_2026-09-05_22-54-46.html` — Alliances selected.
- original recorded page: `https://game.ares.nemexia.com/ranking.php`.

The source confirms the core interaction pattern used by Asterion:

- Players / Alliances top-level modes.
- Search.
- “Show my position”.
- A central ranking table.
- Sortable score columns.
- Achievement points.
- Total points.
- Resource points.
- Battle points.

Nemexia also exposes Championships and Hall of Fame. Asterion shows those labels as unavailable reference modes only; no fake tournament/hall data is created in this foundation.

## Score contract

Asterion keeps three stored fixture components:

- `resource`
- `combat`
- `achievement`

`total` is derived as:

`total = resource + combat`

Achievement score remains separate. Selecting any score header reorders the visible table by that metric.

## Visual correction

The previous heavy three-column dashboard is replaced with the ranking-first layout seen in Nemexia:

- slim mode tabs;
- search and “my position” controls;
- one large central table;
- score icons directly in sortable headers;
- local player/alliance highlight;
- compact selected-row summary below the table;
- no nested table scrollbar.

## Data truth

The UI semantics come from the saved Nemexia page, but the numeric Asterion leaderboard is still `deterministic-local-fixture` because there is no canonical multiplayer leaderboard backend or scoring runtime yet.

The local player continues to reuse `ASTERION_LOCAL_PLAYER_ID`. The local alliance identity continues to project from current `CommandState`.

## Deferred

- Real score earning rules.
- Multiplayer/server leaderboard.
- Season lifecycle/runtime.
- Championships.
- Hall of Fame.
