# Asterion

Desktop sci-fi strategy game prototype.

## Current vertical slice

- Aegis planet screen
- native 1920×1080 design canvas
- launches fullscreen in Electron
- `F11` toggles fullscreen
- `Esc` exits fullscreen
- planet/resource HUD
- zone switching
- one working construction queue item
- local persistence via `localStorage`
- existing Asterion source art is imported directly by Vite

## Run locally

```bash
npm install
npm run desktop
```

## Build Windows installer

```bash
npm install
npm run dist:win
```

The installer is written to `release/`.
