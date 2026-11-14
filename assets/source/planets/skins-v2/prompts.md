# Облики планет (пакет 14.11.2026): промпты

84 новых облика: 52 обычных и редких, 24 «Фантазии», 8 обликов союза. Сгенерированы 14.11.2026 через Codex (GPT image) сразу на прозрачном фоне, пачками по 6 (`node gen-batch.cjs jobs.json out/`, до 3 процессов параллельно). Каждый проверен глазами.

Исходники здесь — PNG около 1254×1254. В игру идут только WebP (тот же принцип, что у `tools/build-game-art.mjs`): 512 px в `src/assets/art/planets/skins-v2/` и миниатюра 192 px для сетки, карты и Империи в `src/assets/art/planets/skin-thumbs/` (для всех 114 обликов, включая старые). Поля обрезаются по планете, чтобы все облики были одного размера. Собрать заново: `python assets/source/planets/skins-v2/build-art.py`, контакт-лист: `python assets/source/planets/skins-v2/contact-sheet.py`.

Добавить облик: строка в `src/domain/universe/planet-skins.ts` (рубрика, по желанию цена или достижение), PNG сюда под тем же id, затем build-art.py.

## База: обычные и редкие

```
Planet art for the look picker of a dark sci-fi space strategy game. One single whole planet seen from space, perfectly centered, the sphere fills about 66% of the canvas width. Painterly-realistic, rich detail, soft key light from the upper left with a gentle terminator shadow toward the lower right, a thin soft atmospheric rim glow hugging the edge of the sphere. No moons, no stars, no nebula, no ring, no frame, no badge, no text. Transparent background. Planet: {S}
```

## База: «Фантазия»

```
Art for the look picker of a dark sci-fi space strategy game: one single whole imaginative celestial world, perfectly centered, fills about 64% of the canvas width, every part stays fully inside the canvas. Same painterly-realistic rendering as a planet set: soft key light from the upper left, gentle shadow toward the lower right, thin soft rim glow. Bold, playful, memorable, original design. No stars, no nebula, no frame, no badge, no text, no letters, no numbers. Transparent background. World: {S}
```

## База: облики союза

```
Planet art for the look picker of a dark sci-fi space strategy game, an exclusive look reserved for the planet of an alliance leader. One single whole planet seen from space, perfectly centered, the sphere fills about 60% of the canvas width, any orbital structure stays fully inside the canvas. Painterly-realistic, rich detail, soft key light from the upper left with a gentle terminator shadow toward the lower right, thin soft atmospheric rim glow. Alliance motif: polished silver orbital structures, heraldic beacon lights in cyan and warm gold, a stylised emblem of two swept wings around a crystal, banner-like light ribbons. No stars, no nebula, no frame, no badge, no text or letters. Transparent background. Planet: {S}
```

## Обычные и редкие

| Файл | Имя в игре | Planet |
|---|---|---|
| `ps-jungle` | Джунгли | a lush jungle world, dense emerald rainforest continents cut by wide brown river deltas, humid white clouds, small blue seas |
| `ps-savanna` | Саванна | a warm savanna world, golden grassland continents with sparse dark green woodland, shallow turquoise seas, thin clouds |
| `ps-archipelago` | Архипелаг | an archipelago ocean world, deep blue ocean scattered with thousands of small sandy islands and bright turquoise reefs |
| `ps-tundra` | Тундра | a cold tundra world, grey-green moss plains with patchy snow, many dark lakes, pale low clouds, white polar caps |
| `ps-canyon` | Каньоны | a canyon world, red-orange rock plateaus cut by deep branching canyon networks and dry riverbeds, thin dusty atmosphere |
| `ps-saltflat` | Солончак | a salt flat world, vast bright white salt plains with pale pink and teal shallow brine lakes, very thin clouds |
| `ps-swamp` | Топи | a swamp world, murky olive-green wetlands, winding dark channels, low mist banks and soft yellow-green haze |
| `ps-highland` | Нагорье | a mountain world, endless snow-capped grey-brown mountain ranges, narrow green valleys, small glacial lakes |
| `ps-oasis` | Оазис | a desert world with pale sand plains dotted with many small green oases and bright blue lakes, thin clouds |
| `ps-glacier` | Ледник | a glacier world, cracked blue glacier sheets with deep turquoise crevasses, frozen grey sea in places |
| `ps-crater` | Кратерная | an airless cratered moon-like world, grey and beige surface with countless impact craters and bright ray streaks |
| `ps-rust` | Ржавая | an iron-oxide world, rust-red and ochre plains with darker basalt patches and thin pink dust clouds |
| `ps-autumn` | Осень | an autumn world, forest continents in orange, crimson and gold autumn colours, deep blue seas, soft clouds |
| `ps-winter` | Зима | a winter world, continents covered in fresh snow with dark pine forest patches, partly frozen grey-blue seas |
| `ps-blossom` | Цветение | a spring blossom world, green continents dotted with pink and white flowering forests, bright blue seas, light clouds |
| `ps-storm` | Шторм | a storm world, ocean planet wrapped in huge spiral cyclones, bright lightning flashes inside dark storm clouds |
| `ps-monsoon` | Муссон | a monsoon world, green continents under heavy grey rain bands sweeping in long belts across the planet |
| `ps-duststorm` | Пыльная буря | a dust storm world, desert planet half engulfed by a vast swirling orange dust storm front |
| `ps-aurora` | Сияние | a polar aurora world, dark blue ocean planet with glowing green and violet aurora curtains around the poles |
| `ps-fog` | Туманная | a fog world, pale lavender fog blanket covering everything, dark mountain peaks poking through the fog |
| `ps-ash` | Пепельная | a dead ash world, grey ash deserts, dried dark seabeds, faint smoke wisps, no life |
| `ps-cold-dead` | Остывшая | a long dead frozen world of glossy jet-black ice sheets with faint pale blue frost veins and dark navy shadows, almost no atmosphere, eerie and cold, clearly black and blue, not grey rock |
| `ps-tidal` | Приливная | a tidally locked world, the day half scorched cracked orange desert, the night half frozen dark blue ice, a thin ring of green land along the boundary |
| `ps-ecumenopolis` | Город-планета | a city-planet, the entire surface covered by a dense megacity grid, the night side glowing with golden city lights |
| `ps-forge` | Кузня | a forge world, dark metal plating covering the surface with glowing orange molten vents and factory lines |
| `ps-hexshell` | Панцирь | an artificial shell world, the whole sphere covered in dark hexagonal armour panels with thin glowing cyan seams |
| `ps-terraform` | Терраформинг | a world mid-terraforming, half grey barren rock and half fresh green land and seas, glowing atmosphere processor towers along the boundary |
| `ps-crystal` | Кристальная | a crystal world, surface covered by huge glowing cyan crystal spires and faceted crystal plains |
| `ps-pearl` | Жемчужная | a pearl world, smooth iridescent pearl-white surface with soft pink, mint and lilac sheen, gentle swirls |
| `ps-obsidian` | Обсидиан | an obsidian glass world, glossy black volcanic glass surface with mirror-like reflections and thin red cracks |
| `ps-shattered` | Расколотая | a shattered world, the planet split into a few large fragments floating close together, glowing molten core visible in the cracks |
| `ps-scarred` | Поле битвы | a war-scarred world, huge impact craters and burning ruined cities, smoke plumes, scorched continents |
| `ps-cracked-ice` | Треснувший лёд | an ice shell world cracked by giant fractures with bright blue light shining from the ocean beneath |
| `ps-geyser` | Гейзеры | an icy moon-like world with pale blue cracked ice and several tall white geyser plumes erupting into space at its edge |
| `ps-biolum` | Сияющий лес | a bioluminescent world, dark planet whose forests and seas glow in teal and electric blue |
| `ps-fungal` | Грибница | a fungal world, continents covered with giant purple and orange fungal growths, spore haze |
| `ps-plasma` | Плазма | a plasma world, turbulent magenta and violet glowing gas swirls with bright filaments |
| `ps-gas-teal` | Бирюзовый гигант | a teal gas giant with smooth cyan, teal and white cloud bands, soft storms |
| `ps-gas-rose` | Розовый гигант | a rose and gold gas giant with soft pastel pink, peach and gold cloud bands |
| `ps-mercury` | Ртутная | a liquid metal world, mirror-like silver mercury oceans reflecting light, dark islands |
| `ps-steppe` | Степь | a windswept steppe world, endless pale green and straw-yellow grass plains, low rolling hills, thin streaky clouds |
| `ps-mangrove` | Мангровая | a mangrove world, tangled dark green mangrove forests over shallow brown-green tidal waters, warm haze |
| `ps-karst` | Карстовая | a karst world, grey-white limestone tower forests and sinkholes covered in green moss, misty river valleys |
| `ps-lakes` | Озёрная | a lake world, green and brown land dotted with thousands of small bright blue lakes, light clouds |
| `ps-mesa` | Плато | a mesa world, flat-topped ochre and terracotta plateaus with sheer cliffs, sage-green valleys |
| `ps-taiga` | Тайга | a taiga world, endless dark green conifer forests, grey rivers, snowy northern half, cold clouds |
| `ps-blizzard` | Метель | a blizzard world, white snow storms swirling over the whole planet, only glimpses of grey ice beneath |
| `ps-sunset` | Закатная | a golden hour world, green and ocean planet lit warm orange-gold from the side, long soft terminator glow |
| `ps-flood` | Половодье | a flood season world, green continents half drowned under wide shining sheets of muddy brown flood water, river valleys turned into lakes, heavy grey rain clouds |
| `ps-drought` | Засуха | a drought world, bone-dry cracked yellow-ochre earth with a polygon crack pattern, dried white lake beds, almost no clouds, thin dusty haze |
| `ps-frost` | Иней | a hoarfrost world, frosted silver-white forests and plains with pale blue frozen rivers, crisp clear air |
| `ps-irradiated` | Радиоактивная | an irradiated dead world, ash grey land with sickly glowing green craters and toxic green haze |

## «Фантазия»

| Файл | Имя в игре | World |
|---|---|---|
| `fan-cube` | Куб | a cube-shaped planet with rounded edges, oceans, green continents and clouds wrapping over its six faces |
| `fan-faceted` | Огранка | a faceted polyhedron planet cut like a gemstone, each flat facet a different landscape: desert, ocean, ice, forest |
| `fan-hollow` | Полая | a hollow planet shell with a big round opening, a tiny bright sun glowing inside lighting green inner landscapes |
| `fan-ringworld` | Мир-кольцо | a ring-shaped world, a wide habitable band of oceans and continents curving around a small bright star at its centre, seen at an angle |
| `fan-wrapped` | В скорлупе | a blue planet partly enclosed in a cracked open silver metal shell sphere, light leaking through the gaps |
| `fan-fire-ring` | Огненное кольцо | a dark basalt planet circled by a blazing ring of fire and embers |
| `fan-ice-ring` | Ледяное кольцо | a deep blue planet circled by a sparkling ring of floating ice shards and frost crystals |
| `fan-eye` | Око | a planet that looks like a giant eye: a white cloudy sphere with a huge round turquoise iris ocean and a dark pupil crater |
| `fan-mask` | Маска | a stone planet whose mountains form a calm ceremonial mask face, glowing amber eyes and mouth lava pools |
| `fan-crest` | Герб кометы | a midnight blue planet with a glowing silver heraldic emblem of a comet over a shield traced across its surface in light |
| `fan-winter-orb` | Ёлочный шар | a festive glass ornament planet: a shiny deep red glass bauble world with a silver cap on top, frosted snowflake patterns and tiny warm garland lights |
| `fan-easter` | Писанка | a spring festival planet painted like a decorated egg, pastel stripes, zigzags and dots in mint, pink, lilac and yellow |
| `fan-pumpkin` | Тыква | a harvest night planet shaped like a carved pumpkin with ribbed orange surface, glowing carved eyes and grin, a curly green stem |
| `fan-candy` | Карамель | a candy planet with pink and white swirled frosting oceans, chocolate continents and colourful sprinkles |
| `fan-lantern` | Фонарь | a lantern festival planet glowing from within like a paper lantern, warm red and gold light through thin translucent bands |
| `fan-dragon` | Спящий дракон | a planet coiled by a colossal sleeping stone dragon whose scaled body forms mountain ranges around the globe, its head resting on a continent |
| `fan-turtle` | Черепаха | a planet shaped as a giant cosmic turtle shell dome with mossy plates and small forests, little head and flippers peeking out |
| `fan-whale` | Небесный кит | a deep ocean planet with a gigantic luminous space whale swimming through its upper atmosphere, curving along the sphere |
| `fan-phoenix` | Феникс | a fire planet with flame-feather patterns, two great wings of fire unfolding from its sides |
| `fan-kraken` | Кракен | a purple ocean planet gripped by enormous tentacles rising from the sea and wrapping around the globe |
| `fan-clockwork` | Часовой механизм | a clockwork planet built of brass gears, cogs and turning rings, a blank clock face without numbers on one side |
| `fan-core` | Звёздное ядро | a planet with a transparent glassy crust revealing a blazing white-gold miniature star core inside |
| `fan-geode` | Жеода | a planet split open like a geode, rough grey outside and a glittering violet amethyst crystal interior |
| `fan-circuit` | Схема | a dark planet covered with glowing cyan and green circuit board traces, chips and data light pulses |

## Облики союза

| Файл | Имя в игре | Planet |
|---|---|---|
| `ally-citadel` | Цитадель союза | a fortress world with dark armoured continents, one thin silver orbital ring station circling it, bearing many cyan and gold heraldic beacon lights |
| `ally-banner` | Знамя | a night-side ocean world whose city lights on the continents form a huge symmetrical emblem of two swept wings around a glowing crystal, gold and cyan |
| `ally-throne` | Престол | a regal golden world, polished gold-plated surface patterns, a thin gold orbital ring with bright beacon lights |
| `ally-crimson` | Алый штандарт | a deep crimson world with long glowing red and gold banner-like aurora ribbons streaming around it, a ring of small beacon lights |
| `ally-crown` | Корона | a blue-green world encircled by three thin crossing silver orbital rings like a crown, beacon lights where the rings cross |
| `ally-aegis` | Эгида | a green world inside a faint translucent hexagonal energy shield sphere, gold heraldic lights at the shield nodes |
| `ally-beacon` | Маяк союза | a dark world with one tall glowing beacon tower sending a vertical cyan light beam, a halo ring of small gold orbital lights |
| `ally-sigil` | Печать | a violet and silver world with a glowing winged crystal sigil drawn across its surface in cyan light, gold rim lights |

## Замены и переделки после проверки

- Ещё до генерации заменены четыре задумки, слишком похожие на старые облики: «Дюны» → `ps-oasis`, аметист → `ps-pearl`, лавовый океан → `ps-geyser`, гигант с бурей → `ps-gas-rose`.
- `ps-cold-dead`: первая версия была серым камнем, как «Пепельная»; перерисована чёрным льдом.
- `ps-flood`, `ps-drought`: первая картинка не читалась ни как половодье, ни как засуха; обе перерисованы с более явным описанием.
- `ps-mercury`: вокруг шара висели мелкие осколки; альфа обнулена кругом по планете (фон не вырезался).
- Сбой сети в пачке сдвигает имена файлов (скрипт раскладывает картинки по порядку). Все пачки сверены глазами, сдвиги исправлены переименованием, пропавшие перерисованы.
