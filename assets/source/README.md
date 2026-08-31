# User-supplied source asset library

This directory is reserved for original/generated source packs supplied for Stellar Empires.

## Policy

- Files here are source-only and are not loaded by the production client automatically.
- Runtime derivatives belong under `public/assets/generated/` or another documented runtime path.
- Each runtime integration must define stable IDs, optimize dimensions/format, add tests and preserve provenance.
- Existing compact WebP atlases and SVG fallbacks remain the runtime contract.
- Do not mix captured Nemexia HTML, screenshots or third-party visual assets into this directory.
- Do not rename mechanical IDs merely to match source filenames.

See `docs/assets/user-supplied-asset-intake.md` for the validated 162-file pack inventory and publication status.
