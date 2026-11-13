# Аудит картинок Asterion — 14.11.2026

Что проверено: все картинки игры в `assets/source/**`, `src/assets/**`, `public/assets/**` (963 файла, 950 МБ). Для каждой папки собран лист-превью на шахматке (видно прозрачность), использование найдено поиском по коду (`src/`, `electron/`, `server/`, `tools/`, включая динамические пути `new URL(\`…${faction}…\`)` и `import.meta.glob`).

Листы-превью по категориям лежат в `docs/art/sheets/*.jpg`, скрипт для пересборки — `docs/art/sheets/make-sheets.py` (Python + Pillow: `python docs/art/sheets/make-sheets.py . docs/art/sheets`).

Вне аудита: фоны главного меню и мастер новой игры (`assets/source/menu/*`, `menu-background-*.webp`, `race-catalog`: `*_card_bg`, `*_hero`, `*_emblem`) — их сейчас переделывает отдельная сессия.

## Коротко: что хуже всего и что делать первым

1. **Иконки шапки и ресурсов** (`src/assets/ui/header-icons`, 19 шт.) — видны на каждом экране и слабее всего. Это набор разношёрстного «глянцевого клипарта»: колокольчик, человечки, листок, звезда, колба, шестерёнка, заводик. Материалы у них разные (стекло, пластик, металл), рядом с гравированными иконками отчётов (`report-icons`) и медальонами действий они смотрятся чужими. **Перегенерировать первыми, одним семейством.**
2. **Иконки миссий и вкладок флота** (`assets/source/mission-icons-v1`, 19 в игре) — плоский белый значок в непрозрачной квадратной рамке, у 31 и 33 рамка другая. В том же окне «Флоты» стоят живописные медальоны действий: два разных языка на одном экране. Миссиям медальоны уже есть (`src/assets/ui/actions`), вкладкам (Ремонт, Приоритет, Бои, Симулятор) и «Операциям» нужны иконки из семейства шапки.
3. **Раса Илари (synod) расходится сама с собой.** Корабли, оборона и постройки у неё оливково-изумрудные, а генерал (`synod_general.png`, профиль) и портрет в отчёте о бое (`synod_battle_icon`) — слоновая кость с золотом и бирюзой. Врата Солнца: «построены» зелёные, а «стройка» и «руины» — костяные.
4. **Планеты на карте системы** (`universe-navigation/planets/planet.variant-01…12`) — плоская мультяшная заливка без ночной стороны. Рядом живописные скины планет игрока и уникальные объекты, разница бросается в глаза. Стартовые скины (`starter/planets`, 9 шт., редактор планеты и NPC на карте) тоже простоваты и мелкие в кадре.
5. **Вес, без генерации.** В сборку уходят 351 исходный PNG на 642 МБ (здания по 2–3 МБ, иконки миссий 1254 px по 1,5 МБ для кнопки 40 px). Через `import.meta.glob` в «Космопорте» в сборку попадает QA-лист `technologies/qa-edges-dark-light.png` (10 МБ). Ещё 302 файла (289 МБ) не используются вовсе. Это отдельный технический PR (Sonnet), Codex не нужен.

Хорошие и единые (оставить): корабли трёх рас, оборона, постройки, технологии, медальоны действий, баннеры миссий, геральдика альянсов, кристаллы и солнца рейда, уникальные и пиратские планеты, звёзды и аномалии, иконки отчётов/очков/настроек, медали рейтинга, галактики атласа, фоны боя, корабли командиров и пиратов.

## Топ-10 на перегенерацию

| # | Что | Файлы | Почему |
|---|---|---|---|
| 1 | Иконки навигации в шапке | `header-icons/{planet,universe,fleets,operations,command,reports,settings,rating,science,alerts}.png` | клипарт разных материалов, видно всегда |
| 2 | Иконки ресурсов | `header-icons/{metal,mineral,gas,energy,population,debris}.png` | то же; `debris.png` ещё и 1254 px / 1,9 МБ |
| 3 | Иконки зон планеты | `header-icons/zone-{resource,industry,military}.png` | заводик и ракета — мультяшные |
| 4 | Вкладки «Флотов» и «Операций» | `mission-icons-v1/{36,18,20,24,23,31}*.png` в роли вкладок | плоские глифы в рамках, непрозрачные |
| 5 | Генерал Илари | `generated-factions-v1/factions/synod_general.png` | не та палитра расы |
| 6 | Портрет Илари в отчёте о бое | `factions/battle-icons/synod_battle_icon.png` → `public/.../battle-icons/synod.webp` | не та палитра расы |
| 7 | Врата Илари: стройка и руины | `New assets/buildings/synod/building.synod.supreme-gates-{construction,ruined}.png` → `sun-raid/gates-synod-*.webp` | костяные вместо зелёных |
| 8 | Планеты карты системы | `universe-navigation/planets/planet.variant-01…12.png` | плоский мультяшный стиль |
| 9 | Стартовые скины планет | `starter/planets/*.png` (9) | простые, мелкие в кадре |
| 10 | Иконки рейда на Солнце и поиска обломков | `sun-raid/mission-sun-raid.webp`, `debris-finder.webp` | рамка-квадрат; стиль не совпадает ни с глифами, ни с медальонами |

## Таблицы по категориям

Оценки: **хорошо**, **слабо** (перерисовать), **разнобой** (стиль спорит с соседями), **формат** (альфа, вес, размер, светлое место под текстом).

### Планеты и объекты карты

| Папка | Шт. | Формат, размер | Вес | Где в игре | Оценка |
|---|---|---|---|---|---|
| `assets/source/planets/skins` | 24 | PNG α, 1024–1254 | 49 МБ | скины планет (`planet-skin-art.ts`), превью в `public/.../planet-skins` | разнобой: три стиля в одном списке (вычурные 002–032 с шестернями и шипами, живописные `skin-asterion-*`, стартовые). 012 «планета-шестерня», 015, 028 выглядят игрушечно |
| `assets/source/starter/planets` | 9 | PNG α, 1024 | 7,9 МБ | редактор планеты, NPC на карте | слабо: простые, планета занимает ~60% кадра |
| `universe-navigation/planets` 01–12 | 12 | PNG α, ~1010 | 21 МБ | карта системы (`UniverseView.tsx:121`) | слабо: плоские, без терминатора |
| `universe-navigation/planets` 13–24 | 12 | PNG α | 24 МБ | не используются | — |
| `planets/unique` | 16 | PNG α, 1254 | 45 МБ | уникальные объекты (`exploration-art.ts`), 384 px WebP в `public/operations` | хорошо, формат: исходники в сборке не нужны |
| `planets/pirate` | 14 | PNG α | 31 МБ | пиратские планеты | хорошо |
| `universe-navigation/system-stars` 01–06 | 6 | PNG α | 7 МБ | звёзды систем | хорошо; 07–12 не используются |
| `universe-navigation/stellar-remnants` | 10 | PNG α | 14 МБ | аномалии | хорошо |
| `universe-navigation/asteroids` | 8 | PNG α | 13 МБ | астероиды на карте | разнобой: 03, 05, 06 мультяшные рядом с реалистичными |
| `assets/source/debris` | 2 | PNG α | 4,5 МБ | обломки | хорошо |

### Корабли, оборона, постройки

| Папка | Шт. | Формат | Вес | Где | Оценка |
|---|---|---|---|---|---|
| `New assets/ship/{aegis,synod,veyra}` | 39 | PNG α, ~1000 | 45 МБ | каталог кораблей, бой, верфь | хорошо, единый стиль на расу |
| `New assets/comander_ship` | 13 | PNG α | 11 МБ | командиры | хорошо (рендер чуть другой, не мешает) |
| `ships/pirates` + `characters/pirates` | 8 | PNG α, 1536×1024 | 21 МБ | пираты | хорошо; формат: 3 МБ на корабль |
| `New assets/defenses/*` | 27 | PNG α | 39 МБ | оборона | хорошо |
| `New assets/buildings/*` | 78 | PNG α, 1254 | 177 МБ | постройки, интерьеры, врата | хорошо, кроме 2 врат Илари; формат: здание занимает ~50% холста, 2–3 МБ на файл |
| `New assets/technologies` | 22 + QA-лист | PNG α, 1024 | 42 + 10 МБ | наука, бой, симулятор | хорошо; формат: QA-лист попадает в сборку через glob |

### Интерфейс: иконки, медальоны, баннеры

| Папка | Шт. | Формат | Вес | Где | Оценка |
|---|---|---|---|---|---|
| `src/assets/ui/header-icons` | 19 | PNG α, 128 (debris 1254) | 2,2 МБ | шапка, ресурсы, зоны, «Командование», «Операции» | **слабо**, разнобой материалов |
| `public/.../ui/report-icons`, `score-icons` | 12 | WebP α, 96 | 0,06 МБ | отчёты, очки | хорошо — **образец стиля для иконок шапки** |
| `src/assets/ui/settings` | 7 | WebP α, 96 | 0,02 МБ | настройки | хорошо (стеклянные плашки, своя семья) |
| `src/assets/ui/actions` | 19 | WebP α, 192 | 0,2 МБ | быстрые действия | хорошо — эталон стиля |
| `mission-icons-v1` (используемые) | 19 | PNG без α, 1254 | 30 МБ | лента миссий «Флотов», вкладки флота, «Операции», «Командование» | **слабо + формат**: плоские, непрозрачные, по 1,5 МБ |
| `mission-icons-v1` (прочие) | 18 | PNG | 27 МБ | не используются | — |
| `src/assets/ui/missions` | 12 | WebP, 1440×360 | 0,6 МБ | баннеры миссий | хорошо: левые 40% тёмные (средняя яркость 6–7 из 255) |
| `src/assets/ui/empty` | 5 | WebP, 640×360 | 0,2 МБ | пустые состояния | разнобой: `empty-mail` — непрозрачный тёмный прямоугольник, остальные вырезаны |
| `src/assets/ui/rating` | 4 | WebP | 0,1 МБ | рейтинг | хорошо |
| `src/assets/ui/atlas`, `actions/atlas` | 9 | WebP | 1 МБ | атлас галактик | хорошо |
| `src/assets/command/orbital-heraldry` | 98 | WebP/PNG α, 512 | 2,9 МБ | конструктор гербов | хорошо |

### Расы и персонажи

| Папка | Шт. | Где | Оценка |
|---|---|---|---|
| `generated-factions-v1/factions` | 13 | генералы (профиль), эмблемы (шапка), карточки и герои (меню) | Астеры и Рой — хорошо; **Илари: генерал не той палитры**; `aegis_profile_avatar.png` не используется |
| `starter/factions` | 9 | не используются (дубли имён с `generated-factions-v1`) | причём Илари там синие, а Рой — чёрно-красная птица: третья версия рас |
| `factions/battle-icons` → `public/.../battle-icons` | 4 | портреты в отчёте о бое | Астеры, пираты, Рой — хорошо; **Илари не той палитры**; формат: непрозрачный квадрат 128 px |

### Фоны и сцены

| Папка | Шт. | Где | Оценка |
|---|---|---|---|
| `battle-report-v2`, `src/assets/battle-report` | 4 | отчёт о бое | хорошо |
| `faction-delivery-v1/territories` | 3 | фон зон планеты (`ZoneView`, бот-фабрика, переработка, торговля) | формат под вопросом: серые, средняя яркость 74–91 из 255 — светлее остальных фонов. Если подписи стоят прямо на земле, затемнить или перегенерировать |
| `starter/backgrounds/system_background.png` | 1 | фон системы | хорошо |
| `public/assets/generated/sun-raid` | 29 | рейд на Солнце, врата, итог кампании | хорошо, кроме врат Илари (см. выше) и двух иконок-квадратов |

### Не используются (302 файла, 289 МБ)

| Папка | Шт. | МБ |
|---|---|---|
| `faction-delivery-v1/{building_sheets,ships,ui,previews}` | 104 | 96 |
| `ui-generated-v1/*` (рамки, кнопки, табы трёх рас) | 54 | 9,6 |
| `universe-navigation/{active-suns,galaxies,star-coronas,renegades,protostars,markers,orbital-debris,debris}` | 64 | 81 |
| `universe-navigation/planets` 13–24, `system-stars` 07–12 | 18 | 30 |
| `starter/{asteroids,buildings,ships,stars,pirates,preview,factions}`, `galaxy_background.png` | 47 | 41 |
| `mission-icons-v1` (не 01–10, 18, 20, 23, 24, 31, 33, 36) | 18 | 29 |
| `sun-raid/{crystals/*-empty,sun/sun-bright,sun-dimmed}`, `menu/*` (исходники WebP из `public`) | 10 | 21 |
| прочее (`aegis_profile_avatar`, превью-листы) | 3 | 6 |

Исходники рейда и меню нужны для пересборки WebP, их оставить. Остальное можно унести из репозитория в архив, это решение владельца.

## Замечание про стиль рас (решать владельцу, не генерирую)

Триада «синий техно-флот / зелёная био-механика / красный органический рой» у кораблей, обороны и построек очень узнаваема по классическим RTS. Правило «не подражать чужим играм» под это может попадать. Переделка — 144 картинки (≈4,3 млн токенов Codex), поэтому только по решению владельца. Сейчас набор единый и хорошо читается, в план он не входит.

## План генераций

Как запускать (по одной, в фоне, ~2 мин и ~30 тыс. токенов на картинку):

```bash
node C:/Users/Den/.claude/skills/codex-image/gen.cjs --out <файл> [--transparent] --size <WxH> "<промпт>"
```

Промпт = база пакета + строка «Subject» из таблицы. Каждую картинку смотреть глазами (буквы, артефакты, альфа, стиль), промпт класть в `prompts.md` рядом с исходником. Исходник PNG — в `assets/source/...`, в игру — уменьшенный WebP (как уже сделано у `actions` и `report-icons`).

### Пакет 0. Вес и формат (без Codex, отдельный PR на Sonnet)

- Используемые PNG из `assets/source` (642 МБ) отдавать в игру как WebP под размер показа: иконки 96–192 px, корабли и оборона ~512, здания ~640 (с обрезкой пустых полей), планеты 512. Исходники оставить вне сборки.
- Убрать `technologies/qa-edges-dark-light.png` из glob в `SpaceportUpgradeView.tsx:58` (или перенести файл).
- `mission-icons-v1` — WebP 128 px до замены (пакет 2).
- Неиспользуемые 302 файла — в архив по решению владельца.

### Пакет 1. Иконки шапки, ресурсов, зон и вкладок — 25 картинок, ≈750 тыс. токенов

Цель: одно семейство с `report-icons`: гравированный тёмный металл, бирюзовая эмаль, немного бронзы. Исходник 1024×1024 с прозрачностью → `assets/source/ui/header-icons-v2/<имя>.png`; в игру 128×128 WebP в `src/assets/ui/header-icons/`. Флаг `--transparent`, `--size 1024x1024`.

База:

```
Game UI icon for a dark sci-fi space strategy game, 1024x1024, transparent background. Subject: {SUBJECT}. It must belong to one family of engraved metal-and-enamel emblem icons: dark gunmetal with engraved panel lines, cyan-teal enamel inlays and soft cyan glow, thin warm bronze trim, painterly-realistic rendering with soft rim light from the upper left. High contrast: bright highlights and a light rim on the outer edge so the silhouette reads on a near-black header bar. Centered, fills about 80% of the canvas, bold clean silhouette readable at 24 pixels. No background plate, no circle frame, no text, no letters, no numbers, no logos, not imitating any existing game or brand.
```

Строку про контраст добавил после первой пробы: тёмный металл на тёмной шапке при 24 px теряется. Codex отдаёт 1254×1254 даже при `--size 1024x1024`, для иконок это не важно.

| Файл | Subject |
|---|---|
| `planet` | a single planet with a thin engraved orbital ring and a tiny station on the ring |
| `universe` | a spiral galaxy disc held inside a thin engraved orbit ring |
| `fleets` | a compact arrowhead formation of three sleek warships in three-quarter view with cyan engine glow |
| `operations` | a targeting reticle locked onto a small rocky asteroid outpost |
| `command` | an alliance crest: two swept metal wings around a glowing cyan crystal core |
| `reports` | two thin stacked metal data tablets with glowing cyan line patterns, no readable symbols |
| `settings` | a heavy machined gear with a glowing cyan core |
| `rating` | a five-pointed metal star medal with bronze edges hanging from a short metal ribbon |
| `science` | a glowing cyan atom model hovering above a small metal pedestal |
| `alerts` | a compact signal beacon emitting two cyan arcs, warm amber light at its tip |
| `zone-resource` | three cyan crystals growing from an engraved metal socket |
| `zone-industry` | a compact orbital factory block with one stack venting warm amber light |
| `zone-military` | two crossed cannon barrels over a small armoured shield |
| `metal` | a stack of three brushed steel ingots, cool grey metal with bronze edges (resource color: steel grey) |
| `mineral` | a cluster of deep blue faceted crystals in a metal clasp (resource color: blue) |
| `gas` | a sealed glass capsule with swirling emerald gas between two metal caps (resource color: green) |
| `energy` | an amber lightning bolt inside a small reactor ring (resource color: amber) |
| `population` | two colonist helmets side by side with cyan visors |
| `debris` | a small drifting cluster of broken hull plates and metal scraps |
| `tab-repair` | a wrench crossed with a hull plate, cyan weld sparks |
| `tab-priority` | three chevrons stacked upwards |
| `tab-battles` | two crossed energy beams over a small explosion flash |
| `tab-simulator` | a holographic wireframe warship hovering above a projector disc |
| `ops-available` | a scanner dish emitting a cyan wave |
| `ops-active` | a small exploration ship heading toward a distant star with a short cyan trail |

Подключение: заменить файлы в `header-icons` (имена те же), в `FleetWorkspacePortal.tsx:138–141` и `OperationsView.tsx:26–27` взять новые `tab-*`/`ops-*`.

### Пакет 2. Миссии на медальонах — 2 картинки, ≈60 тыс. токенов (+ правка кода)

Ленте миссий «Флотов» отдать уже готовые медальоны из `src/assets/ui/actions` (transport, espionage, attack, deployment, colonize, recycle, gas, sun-support, space-flight, pirate-raid → «Пиратский рейд», expedition, aid). Это правка кода без генерации. Не хватает двух. Генерировать квадрат без прозрачности (`--size 1024x1024`), потом вырезать круг с мягким краем и уменьшить до 192 WebP, как в `asterion-assets-v2`.

База (как у медальонов v2):

```
1:1 Asterion quick-action illustration for a circular production crop. Layered blue-black orbital atmosphere, high-detail painterly cinematic materials, the key shapes fit inside a centered safe circle about 90% of the square width and stay readable at 48 pixels. Extend the space scene fully to all four edges. Opaque square artwork. Subject: {SUBJECT}. No border, no vignette circle, no UI, no text, no symbols, no logos, not imitating any existing game or brand.
```

| Файл | Subject |
|---|---|
| `src/assets/ui/actions/sun-raid.webp` | a strike group of dark warships diving toward a huge burning orange star, a faint ring gate silhouette in front of the star, blue engine trails |
| `src/assets/ui/actions/debris-finder.webp` | a salvage ship sweeping a field of drifting wreckage with a wide cyan scanning fan, distant blue planet limb |

### Пакет 3. Палитра Илари — 4 картинки, ≈120 тыс. токенов

Палитра Илари по `docs/ui/CODEX_IMAGE_REQUESTS.md`: изумруд `#3fdc86` / `#b5ffd6`, тёмная олива, органический металл с гладкими наплывами, как у их кораблей и зданий.

| Файл | Флаги | Промпт |
|---|---|---|
| `generated-factions-v1/factions/synod_general.png` | `--transparent --size 1024x1536` | Full-body portrait of the Ilary faction general for a dark sci-fi strategy game, transparent background. Tall elegant figure in smooth dark-olive bio-mechanical armour with flowing organic plates, glowing emerald seams (#3fdc86) and pale mint highlights, a long segmented cloak, calm commanding pose, face hidden behind a smooth crested helmet with an emerald visor slit. Painterly-realistic, cinematic rim light from upper left, deep shadows. Same proportions as a three-quarter standing hero portrait. No ivory, no gold, no text, no logos, not imitating any existing game or character. |
| `factions/battle-icons/synod_battle_icon.png` | `--size 1024x1024` | Square bust portrait of the Ilary faction commander for a battle report, dark emerald-black background with faint green haze. Smooth dark-olive bio-mechanical crested helmet with glowing emerald visor slit and emerald seams, organic layered shoulder plates. Head and shoulders fill the frame, readable at 64 pixels, painterly-realistic, rim light from upper left. No ivory, no gold, no text, no logos. |
| `New assets/buildings/synod/building.synod.supreme-gates-construction.png` | `--transparent --size 1024x1024` | Isometric three-quarter view game building sprite, transparent background: a giant ring gate of the Ilary faction under construction — dark-olive organic metal arcs with smooth bulbous joints, only two thirds of the ring grown, the missing arc outlined by thin glowing emerald filaments, small drones around it, emerald light in the seams. Same rendering as a set of olive bio-mechanical buildings with emerald glow. Building fills ~70% of the canvas. No ivory, no bone, no text. |
| `New assets/buildings/synod/building.synod.supreme-gates-ruined.png` | `--transparent --size 1024x1024` | Isometric three-quarter view game building sprite, transparent background: a giant ring gate of the Ilary faction in ruins — the dark-olive organic metal ring is cracked in two, broken arcs lying on its base, fragments floating, the emerald seams dim and flickering, thin smoke. Same rendering as a set of olive bio-mechanical buildings with emerald glow. Fills ~70% of the canvas. No ivory, no bone, no text. |

После — пересобрать `public/assets/generated/sun-raid/gates-synod-*.webp` и `battle-icons/synod.webp` (`node tools/sun-raid-assets.mjs`, `npm run assets:asterion:generate`).

### Пакет 4. Планеты — 21 картинка, ≈630 тыс. токенов

Исходник 1024×1024 с прозрачностью, в игру 512 WebP. Флаги `--transparent --size 1024x1024`.

База:

```
Single planet sprite for a dark sci-fi space strategy game map, 1024x1024, transparent background. Subject: {SUBJECT}. Painterly-realistic, lit from the upper left with a clear day/night terminator, the night side fades to near-black, thin soft atmospheric rim light on the lit edge. The planet is a perfect sphere filling about 88% of the canvas, centered. No stars, no background, no extra moons unless stated, no text, no logos.
```

Планеты карты системы, `universe-navigation/planets/planet.variant-NN.png`:

| NN | Subject |
|---|---|
| 01 | grey metallic cratered moon-like world with rust streaks |
| 02 | toxic world with swirling yellow-green clouds over dark ground |
| 03 | deep blue ocean world with white storm spirals |
| 04 | violet gas giant with banded storms |
| 05 | temperate terran world, green-brown continents, white clouds, blue oceans |
| 06 | tan banded gas giant with a thin pale-blue ring seen at an angle |
| 07 | lava world, black crust with glowing orange fissures |
| 08 | blue banded gas giant with a dark storm spot |
| 09 | orange desert world with dry riverbeds and dunes |
| 10 | ice world with deep blue crevasses |
| 11 | world completely covered by dense white cloud layers |
| 12 | jungle world, dense dark-green forests and small cyan lakes |

Стартовые скины, `starter/planets/planet_<id>.png`: `colonized` (terran world with glowing amber city lights on the night side and a few orbital stations), `terran`, `oceanic`, `desert`, `ice`, `volcanic`, `toxic`, `barren_rocky` (dark grey cratered rock world), `gas_giant` (warm banded gas giant) — Subject как у близких номеров выше.

Отдельный вопрос владельцу: оставить ли вычурные скины `planet-002…032` (шестерни, шипы, кристаллы). Если убрать — минус 12 скинов, генерация не нужна.

### Пакет 5. Мелочи — 7 картинок, ≈210 тыс. токенов

| Файл | Флаги | Subject / промпт |
|---|---|---|
| `universe-navigation/asteroids/asteroid.variant-03.png`, `-05`, `-06` | `--transparent --size 1024x1024` | Single asteroid sprite for a space strategy map, transparent background, painterly-realistic, dark rock with {pale porous / orange porous / icy blue} surface, lit from the upper left with a deep shadow side, fills ~80% of the canvas. No text. |
| `src/assets/ui/empty/empty-mail.webp` | `--transparent --size 1536x1024` | Empty-state illustration, transparent background: a small sealed courier capsule drifting alone in the dark with a faint cyan running light, a few tiny particles around it. Painterly-realistic, same family as other cut-out empty-state objects (a hologram table, a docking ring, a repair station). Object centered, fills ~60% of the width. No text, no envelope symbol. |
| `faction-delivery-v1/territories/{resource,industry,military}-terrain.png` | `--size 1536x1024` | только если на проверке в игре подписи стоят прямо на земле: тот же сюжет (вид сверху на плато в кратере), но тёмный — средняя яркость не выше 40, холодные сине-серые тона. |

### Итог по стоимости

| Пакет | Картинок | Токенов Codex | Время генерации |
|---|---|---|---|
| 0. Вес и формат | 0 | 0 | — |
| 1. Иконки шапки и вкладок | 25 | ≈750 тыс. | ≈50 мин |
| 2. Медальоны миссий | 2 | ≈60 тыс. | ≈4 мин |
| 3. Палитра Илари | 4 | ≈120 тыс. | ≈8 мин |
| 4. Планеты | 21 | ≈630 тыс. | ≈42 мин |
| 5. Мелочи | 7 | ≈210 тыс. | ≈14 мин |
| **Всего** | **59** | **≈1,8 млн** | **≈2 ч** |

На перегенерацию закладывать ещё ~20% (брак: буквы, лишние рамки, не та палитра).

## Пробы

В `docs/art/samples/` лежат пробы из пакета 1 и их промпты (`samples/prompts.md`). В игру они не подключены.
