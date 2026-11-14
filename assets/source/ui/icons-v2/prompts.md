# Иконки v2 (пакет 1): промпты

Стиль и правила: `docs/art/STYLE.md`. Сгенерировано 14.11.2026 через Codex (GPT image), сразу с прозрачным фоном (`hasAlpha: true` у всех 36).

Как запускать: `node assets/source/ui/icons-v2/gen-batch.cjs jobs.json out/`, где `jobs.json` — список `{name, prompt}` до 6 штук; до 3 процессов параллельно. Скрипт берёт картинки из папки сессии Codex (`~/.codex/generated_images/<thread_id>`) по порядку.

Исходники здесь — PNG 1024×1024. В игру идут WebP 128 px с обрезанными полями: шапка и вкладки «Операций» в `src/assets/ui/header-icons/`, миссии в `src/assets/ui/mission-icons/` (`m-<id>` → `<id>.webp`), `m-sun-raid` → `public/assets/generated/sun-raid/mission-sun-raid.webp` (256), `m-debris-finder` → `.../debris-finder.webp` (96, через `tools/sun-raid-assets.mjs`).

## База

```
Game UI icon for a dark sci-fi space strategy game. Subject: {S}. House style: polished light silver-white metal with glowing cyan enamel accents, clean bevelled 3D forms, glossy specular highlights, key light from the upper left, only a thin faint cyan rim light hugging the outer edge (no wide glow halo). One or two large bold shapes, very little small detail, bright overall so the silhouette reads at 24 pixels on a near-black UI. Use a signature colour only where the subject names one. Centered, fills about 85% of the canvas, transparent background. No background plate, no frame, no circle badge, no text, no letters, no numbers.
```

## Предметы

| Файл | Subject |
|---|---|
| `planet` | a single planet with a thin bright orbital ring and a tiny station on the ring |
| `universe` | a spiral galaxy disc with bright cyan arms held inside a thin silver orbit ring |
| `fleets` | one sleek arrow-shaped warship seen from above pointing up, two much smaller escort ships tucked behind its wings |
| `operations` | a bold targeting reticle locked onto a small rocky asteroid outpost |
| `command` | an alliance crest: two swept silver wings around a glowing cyan crystal core |
| `reports` | two stacked thin metal data tablets with glowing cyan line patterns, no readable symbols |
| `settings` | a heavy machined gear with a glowing cyan core |
| `rating` | a five-pointed star medal (signature colour: warm gold) hanging from a short silver ribbon |
| `science` | a glowing cyan atom model with three orbits hovering above a small silver pedestal |
| `alerts` | a compact signal bell-shaped beacon emitting two cyan arcs, warm amber light at its tip |
| `zone-resource` | three faceted cyan crystals growing from a silver metal socket |
| `zone-industry` | a compact orbital factory block with one chimney venting warm amber light (signature colour: amber) |
| `zone-military` | the Military zone: a silver armoured shield with a red double chevron rank emblem and a single cannon barrel behind it pointing up (signature colour: red) |
| `metal` | a stack of three bevelled steel ingots (signature colour: cool steel grey) |
| `mineral` | a cluster of deep blue faceted crystals in a silver clasp (signature colour: sapphire blue) |
| `gas` | a sealed glass capsule with swirling emerald gas between two silver caps (signature colour: emerald green) |
| `energy` | a bold lightning bolt inside a small reactor ring (signature colour: amber yellow) |
| `population` | two colonist helmets side by side with cyan visors |
| `debris` | a small drifting cluster of three broken hull plates and metal scraps |
| `ops-available` | a scanner dish emitting two cyan signal waves |
| `ops-active` | a small exploration ship flying along a curved circular route arrow |
| `m-transport` | a chunky cargo freighter in three-quarter view carrying one big container box on its back, compact almost square silhouette |
| `m-espionage` | a small spy probe shaped like an eye with a big glowing cyan lens |
| `m-attack` | a sharp missile flying diagonally up-right through a bold targeting crosshair |
| `m-deployment` | a warship descending onto a landing pad, two short cyan arrows pointing down beside it |
| `m-colonize` | a colony dome with a small flag standing on the curved surface of a planet |
| `m-recycle` | a recycler ship with a big magnetic claw grabbing a broken hull fragment |
| `m-gas` | a funnel-shaped harvester ship scooping a stream of gas (signature colour: emerald green) |
| `m-sun-support` | a bold silver shield in front of a small bright sun (signature colour: orange for the sun) |
| `m-space-flight` | one sleek starship flying diagonally up-right with a long cyan engine trail |
| `m-pirate-elimination` | a horned pirate skull inside a bold targeting reticle (signature colour: red for the skull eyes) |
| `m-expedition` | a scout ship flying toward a glowing anomaly crystal asteroid |
| `m-aid` | a sealed silver cargo crate with a bold cyan arrow on its side pointing right, two small silver wings on the crate (sending supplies to an ally) |
| `m-gate` | a ring-shaped warp gate with a swirling cyan portal inside |
| `m-sun-raid` | a warship arrowhead diving toward a large burning sun (signature colour: orange for the sun) |
| `m-debris-finder` | a big round scanner lens in a silver ring hovering over one broken jagged hull plate, cyan scan light |

Переделаны после проверки листа: `m-aid` (первая версия читалась как аптечка), `m-debris-finder` (полупрозрачный конус терялся в 24 px), `m-transport` (слишком тонкий силуэт в 24 px).

`zone-military` переделана 14.11 по слову владельца: «скрещённые стволы на щите» не читались как военная зона; из трёх вариантов (ракета, турель, щит с шевронами) выбран щит с красными шевронами.

## Иконки отчётов и очков (добавлены 14.11)

Владелец: в «Командовании» и «Операциях» новые иконки стояли вперемешку со старым тёмным набором `report-icons` / `score-icons`. Набор перерисован целиком, в игру — WebP 96 px в `public/assets/generated/ui-icons-v2/` (имена файлов прежние), подключение через `src/ui/ui-icons.ts`. Старые файлы интеграции не тронуты: их исходники охраняет `tools/asterion-asset-integration.mjs`.

| Файл | Subject |
|---|---|
| `r-achievements` | achievements: a round medal with a small laurel wreath and a star in the centre (signature colour: warm gold) |
| `r-alliances` | alliance members: two interlocked thick silver rings with glowing cyan cores |
| `r-arena` | diplomacy and war: two crossed glowing cyan energy blades with silver hilts |
| `r-command_reports` | alliance applications: a thin metal data tablet with a bold cyan arrow entering it from the right |
| `r-flights` | flights: a small sleek ship travelling along a thin elliptical orbit path with a cyan trail |
| `r-profile` | player profile: a single commander helmet seen from the front with a wide cyan visor |
| `r-reports` | reports: a thin metal data tablet with a glowing cyan bar chart and a small check mark |
| `r-system` | system messages: a glowing cyan core with two small satellites on thin silver orbit rings |
| `s-achievement-trophy` | achievement points: a trophy cup with two handles on a short base (signature colour: warm gold) |
| `s-battle` | battle points: a silver shield with two crossed cannon barrels behind it and a red glowing centre (signature colour: red) |
| `s-overall-star` | total points: a bold five-pointed star with bevelled facets (signature colour: warm gold) |
| `s-resource-crystal` | resource points: one big faceted cyan crystal standing in a gold-trimmed silver base |

## Быстрые действия и «Настройки» (пакет 6, 14.11)

Медальоны `src/assets/ui/actions` (WebP 192 px) и плашки `src/assets/ui/settings` (WebP 96 px). Установка: `python assets/source/ui/icons-v2/install-batch6.py`.

У одной миссии везде одна иконка, поэтому 13 медальонов собраны из готовых исходников: `aid`, `attack`, `colonize`, `deployment`, `espionage`, `expedition`, `gas`, `recycle`, `space-flight`, `sun-support`, `transport` ← `m-<то же>`; `pirate-raid` ← `m-pirate-elimination`; `profile` ← `r-profile`. Новые (13 шт., все `hasAlpha: true` с первого раза, без перегенерации):

| Файл | Subject |
|---|---|
| `a-object-attack` | a sharp missile diving down-left into a jagged glowing anomaly crystal cluster, a bright impact flash where it hits (signature colour: violet for the crystals) |
| `a-object-card` | a small planet sphere floating above a thin metal hologram tablet, a cyan scan beam rising from the tablet to the planet |
| `a-pirate-report` | a thin metal data tablet with a horned pirate skull emblem on it (signature colour: red for the skull eyes) |
| `a-pirate-scout` | a small round spy probe with a big glowing cyan lens, a small horned pirate skull emblem on its side (signature colour: red for the skull eyes) |
| `a-probe-explore` | a spherical probe with four thin antennas sending a cyan scan beam toward a small glowing anomaly crystal |
| `a-show-on-map` | a bold location pin marker with a glowing cyan core standing above a small flat spiral galaxy disc |
| `st-screen` | a sleek widescreen display panel on a short stand, the screen glows plain cyan with no content |
| `st-interface` | a round magnifying lens over three horizontal glowing cyan bars of different lengths (larger text size) |
| `st-controls` | one big keyboard key cap with a glowing cyan edge, seen in three-quarter view, blank top |
| `st-sound` | a loudspeaker with three cyan sound wave arcs coming out of it |
| `st-notifications` | a classic bell with a small glowing cyan dot on its rim |
| `st-save` | a rounded cloud shape made of polished silver metal with a glowing cyan data core inside it (world stored on a server) |
| `st-journal` | a partly unrolled thin metal scroll with glowing cyan lines on it, no readable symbols |
