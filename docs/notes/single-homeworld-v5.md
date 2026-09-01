# Single homeworld v5

Temporary multi-planet prototype data has been removed from the active game model.

Current rules:

- Player owns exactly one planet: `[1:1:1]`.
- The header planet selector stays in place as the future colony selector.
- New planets must later enter this selector only through the real colonization flow.
- Planet edit is available from the Planet screen row, not from the persistent header.
- Planet edit currently supports renaming and skin selection.
- Old local saves that contain the temporary Lemay/Ostrogo prototype entries are migrated back to the single-homeworld model on load.
