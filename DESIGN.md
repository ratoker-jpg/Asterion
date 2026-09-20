---
name: Asterion UI
version: 1
description: Shared visual contract for Asterion's dark space-command interface.
---

# Asterion UI design contract

Asterion is a dark, information-dense command interface. The work surface carries the hierarchy; navigation and metadata stay quieter. The visual language is rounded, cyan-led, amber for attention, and red for destructive actions.

This file is the product-facing contract. The canonical implementation tokens live in `src/asterion-unified-theme.css`; new UI should use those tokens or the shared primitives below instead of adding a parallel visual language.

## Type scale

The product uses the bundled variable Montserrat font. The default scale is fixed and readable at 100%; the optional typography settings multiply these values but are not required for legibility.

| Role | Token | Size | Use |
| --- | --- | ---: | --- |
| Large title | `--ut-font-page-title` | 18px | Screen and modal titles |
| Section title | `--ut-font-section-title` | 14px | Panel, card, and mini-headings |
| Data / lead | `--ut-font-data` | 12px | Values, counters, table data |
| Control | `--ut-font-control` | 12px | Buttons, tabs, selects, form controls |
| Body | `--ut-font-body` | 12px | Descriptions and operational copy |
| Secondary | `--ut-font-secondary` | 11px | Labels, metadata, coordinates, status copy |
| Helper | `--ut-font-helper` | 11px | Hints and explanatory text |
| HUD | `--ut-font-hud` | 12px | Compact fixed header telemetry only |

New content must not introduce text below 11px. The 12px body size is the default reading size; use weight, contrast, and spacing before increasing it. A smaller HUD value is an existing fixed-chrome exception, not a default for panels, cards, operations, settings, or actions.

## Surfaces and shape

Use the shared radius tokens: `--ut-r-panel` (18px), `--ut-r-card` (13px), `--ut-r-chip` (9px), `--ut-r-btn` (10px), and `--ut-r-input` (9px). Nested surfaces follow the concentric rule: an outer boundary is larger than its inner content boundary.

Use one visual boundary per meaningful component. A portal host is a mount point, not a second panel: it must not add a full-canvas rectangular border, pseudo-frame, or competing background behind its rounded child panels.

Use `.asterion-panel`, `.asterion-card`, `.asterion-chip`, `.asterion-button`, `.asterion-button--primary`, `.asterion-button--danger`, and `.asterion-icon-button` for new components. Their border, surface, radius, type, and motion come from the unified theme.

## Colour and depth

Use `--ut-surface` for primary panels and `--ut-surface-2` for inner cards. Use `--ut-border` for quiet boundaries and `--ut-border-strong` for active boundaries. Reserve `--ut-accent` for primary interaction, `--ut-amber` for attention, `--ut-danger` for destructive actions, and `--ut-positive` for successful or active production state.

Do not add a flat opaque rectangle behind an already rounded panel. Prefer a restrained border and surface tint; glow and shadow must clarify ownership or focus rather than decorate every block.

## Controls and states

Buttons and inputs use the shared radius tokens and 12px control text, with 14px reserved for a heading-like action that needs extra emphasis. Every interactive control has visible hover, keyboard focus, pressed, and disabled states. Focus uses the shared cyan outline. Primary actions use the cyan treatment; cancel, close, delete, and other destructive actions use the danger treatment. A close control is an icon button with an accessible label/title, not a tiny text label.

## Layout and overflow

Every grid/flex child that contains user-facing copy starts with `min-width: 0`. Long names and metadata either wrap at a deliberate copy boundary or use ellipsis inside their own surface. Text must not paint over a neighbouring panel, and a child panel must not create a second nested scrollbar unless it is the intentional owner of scrolling.

The lower global status strip is not part of the design contract and must not be restored to reclaim space. The primary surface owns the available height instead.

## Type specimen

This is the visual calibration for new screens. The same Montserrat weight/contrast relationships should be visible in the built UI:

```text
18  ASTERION / РЕЙТИНГ
14  ОПЕРАЦИОННЫЙ ЦЕНТР
12  1 325 120        ОТПРАВИТЬ        РЕСУРСНЫЕ ОЧКИ
11  Проверка цели и создание планеты.  ГАЛАКТИКА 1 · СИСТЕМА 07
```

The flight-plan modal remains the reference composition for a rounded panel, readable metrics, cyan primary action, and red cancel/close action. New surfaces should match its hierarchy and state clarity while using the fixed scale above.

## Implementation checklist

- Use the shared tokens and primitives before adding a local value.
- Keep the panel hierarchy rounded and single-boundary.
- Start ordinary copy at 12px, secondary copy at 11px, and headings at 14px or 18px according to role.
- Add hover, focus-visible, pressed, disabled, empty, and error treatment where the state exists.
- Verify desktop and narrow desktop rendering for overflow and nested frames before considering a visual change complete.
