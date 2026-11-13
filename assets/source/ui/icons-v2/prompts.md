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
| `zone-military` | two crossed cannon barrels over a small armoured silver shield |
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
