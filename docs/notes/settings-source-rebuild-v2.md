# Settings — source rebuild v2

## Scope

`Настройки` заменяет utility placeholder, сохраняя принятую композицию: навигация секций слева, рабочая панель справа, текущий dark/cyan Asterion HUD language.

Главные исправления этой версии — семантическая типографика, которая реально действует на существующие игровые экраны, и единый Asterion page-scroll contract.

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

Новые utility screens используют явные semantic classes. Существующие игровые экраны подключаются через `GlobalTypographyController`: он классифицирует реальные text-bearing DOM elements один раз, сохраняет их исходный computed `font-size` в CSS custom property и далее применяет тот же semantic token. Это не мутирует stylesheet rules и не создаёт общий `textScale`.

HUD остаётся отдельной категорией и применяется к существующему global header напрямую через semantic CSS. Таким образом изменение, например, `pageTitle` влияет и на существующий экран Планеты, а изменение `HUD` — на текущую верхнюю панель игры, при этом helper/body остаются независимыми.

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

После controller visual review utility screens используют тот же document-level scrolling contract, что и остальные длинные экраны Asterion.

- `.workspace` остаётся частью существующего global shell;
- `GlobalPageScrollController` измеряет реальную высоту активного screen content;
- если экран выше доступного workspace, включается общий `html.asterion-long-page` scrollbar;
- Settings не создаёт собственный `overflow-y: auto`;
- при коротком контенте лишний scrollbar не появляется;
- высота страницы вычисляется по реальному контенту, поэтому пустого гигантского хвоста ниже интерфейса нет.

Это заменяет ранний internal-scroll вариант, который был отклонён после проверки реального поведения общего Asterion scroll.

## QA contract

Electron visual QA проверяет:

- 1920×1080, 1600×900, 1280×720, 2560×1440;
- document scrollbar, если он нужен, принадлежит `GlobalPageScrollController`;
- Settings не владеет nested vertical scrollbar;
- helper 180% не изменяет HUD;
- HUD 130% реально изменяет существующий global header;
- page-title 130% реально изменяет существующий экран Планеты через global semantic typography.

## Deferred

- audio engine;
- OS/push notification runtime;
- full key rebinding.

Disabled controls не создают fake functionality.