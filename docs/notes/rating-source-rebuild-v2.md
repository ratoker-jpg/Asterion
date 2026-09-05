# Rating — source rebuild v2

## Saved Nemexia sources

Structure was rechecked against `ratoker-jpg/Nemexia_auto_v2` saved `ranking.php` pages:

- `saved_pages/page_2026-09-05_22-54-33.html` — Players mode;
- `saved_pages/page_2026-09-05_22-54-46.html` — Alliances mode.

The source information hierarchy is ranking-first:

1. ranking title;
2. mode selection;
3. compact search and “show my position”;
4. pagination/status;
5. one large ranking table;
6. pagination/status below the table.

## Source-derived semantics

Players source confirms sortable score dimensions for:

- achievement points;
- total/general points;
- resource points;
- battle points.

The saved page also exposes Players / Alliances / Championships / Hall of Fame modes. Only Players and Alliances have usable Asterion data in this rebuild. Championships and Hall of Fame remain disabled instead of showing invented data.

Alliance source confirms a dense alliance ranking table including rank, alliance identity/tag, alliance level, alliance points and total points.

## Asterion implementation

The rejected corporate dashboard composition is not reused. The table is the primary visual object.

Implemented interactions:

- Players / Alliances;
- case-insensitive search;
- supported score sorting;
- deterministic pagination, 12 rows per page;
- `Показать мою позицию`;
- current player/current alliance highlighting;
- top-3 states;
- row selection with a compact lower strip only.

No right-side profile dossier or metric dashboard is introduced.

## Data truth / provider boundary

A canonical multiplayer leaderboard backend does not exist yet. Non-local rows therefore come from a deterministic presentation provider in `src/domain/rating/fixtures.ts`.

The UI deliberately does not label data as `fixture`, `foundation` or `local`.

The current alliance identity may reuse the real `CommandState` alliance name/tag. No server authority is implied.

The existing accepted local invariant `total = resource + battle` is preserved by this display provider; it is not presented as a newly invented server scoring formula. Achievement points stay separate from total.

## Deferred

- multiplayer/server leaderboard;
- canonical season/scoring runtime;
- Championships runtime;
- Hall of Fame runtime.
