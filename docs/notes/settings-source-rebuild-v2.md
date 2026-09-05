# Settings — source rebuild v2

## Scope

`Настройки` заменяет utility placeholder, сохраняя принятую композицию: навигация секций слева, рабочая панель справа, текущий dark/cyan Asterion HUD language.

Главные исправления этой версии — семантическая типографика и корректный scroll/viewport contract.

## Rejected global scaling approach

Запрещён подход с обходом `document.styleSheets` / `CSSStyleRule` и runtime-умножением всех найденных `font-size`.

Вместо него используется восемь независимых semantic tokens:

- `--text-scale-hud`
- `--text-scale-page-title`
- `--text-scale-section-title`
- `--text-scale-body`
- `--text-scale-table`
- `--text-scale-control`
- `--text-scale-secondary`
- `--text-scale-helper`

Каждая категория нормализуется независимо в диапазоне `80–180%` с шагом `5%`.

## Persistence ownership

UI/device preferences принадлежат отдельному contract:

`asterion.preferences.v2`

Campaign/gameplay state остаётся в:

`asterion.vertical-slice.v1`

Campaign Reset не удаляет typography preferences. Settings Reset сбрасывает только UI/device preferences.

## Electron / web boundary

Desktop display controls используют узкий preload bridge:

- `getDisplayState()`;
- `setDisplay({ mode, preset })`;
- read-only display-state notifications для синхронизации UI с F11/Escape/resize.

Renderer не получает произвольный Electron API. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` сохранены.

Поддерживаемые режимы:

- полный экран;
- оконный.

Windowed presets:

- 1280×720;
- 1600×900;
- 1920×1080;
- 2560×1440.

В web/Pages display controls disabled и не имитируют работу desktop API.

## Scroll / viewport contract

Utility host занимает ровно существующий `.workspace`:

- `position: absolute; inset: 0`;
- `min-height: 0`;
- global host `overflow: hidden`;
- settings content использует только внутренний `overflow-y: auto`.

Settings не увеличивает высоту stage/document и не создаёт пустую страницу под игровым экраном.

## Deferred

- audio engine;
- OS/push notification runtime;
- full key rebinding.

Disabled controls не создают fake functionality.
