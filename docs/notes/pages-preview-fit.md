# GitHub Pages preview fit

Browser preview uses a browser-only stage fit mode:

- Electron keeps the normal desktop `contain` scaling.
- Browser preview near 16:9 uses `cover` scaling to remove black bars.
- Unusual browser aspect ratios fall back to `contain` to avoid aggressive cropping.
- The 1920×1080 game canvas remains unchanged.

This is a preview-only presentation fix; it does not change game layout coordinates or desktop packaging.
