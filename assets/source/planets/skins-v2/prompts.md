# Облики планет (пакет 14.11.2026): промпты

Сгенерировано 14.11.2026 через Codex (GPT image) сразу на прозрачном фоне, пачками по 6 (`gen-batch.cjs jobs.json out/`, до 3 процессов параллельно). Исходники здесь — PNG около 1254×1254. В игру идут WebP: 512 px предпросмотр (`public/assets/generated/asterion/universe/planet-skins-v2/`) и 192 px миниатюра для сетки и карты (`.../planet-skin-thumbs/`, для всех 78 обликов, включая старые). Собрать заново: `python assets/source/planets/skins-v2/build-art.py`.

Стиль: как у базовых планет (Терран, Океан…): один шар по центру, мягкий свет сверху слева, тонкое свечение атмосферы, без колец-рамок и текста. Облики союза — тот же шар плюс мотив союза: серебряные орбитальные конструкции, гербовые огни, крылатая эмблема, ленты-знамёна.

## База (обычные и редкие)

```
Planet art for the look picker of a dark sci-fi space strategy game. One single whole planet seen from space, perfectly centered, the sphere fills about 66% of the canvas width. Painterly-realistic, rich detail, soft key light from the upper left with a gentle terminator shadow toward the lower right, a thin soft atmospheric rim glow hugging the edge of the sphere. No moons, no stars, no nebula, no ring, no frame, no badge, no text. Transparent background. Planet: {S}
```

## База (облики союза)

```
Planet art for the look picker of a dark sci-fi space strategy game, an exclusive look reserved for the planet of an alliance leader. One single whole planet seen from space, perfectly centered, the sphere fills about 60% of the canvas width, any orbital structure stays fully inside the canvas. Painterly-realistic, rich detail, soft key light from the upper left with a gentle terminator shadow toward the lower right, thin soft atmospheric rim glow. Alliance motif: polished silver orbital structures, heraldic beacon lights in cyan and warm gold, a stylised emblem of two swept wings around a crystal, banner-like light ribbons. No stars, no nebula, no frame, no badge, no text or letters. Transparent background. Planet: {S}
```

## Облики

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
| `ps-cold-dead` | Остывшая | a long dead frozen world, black ice and dark grey rock with dim frost, only a very faint rim glow |
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
| `ally-citadel` | Цитадель союза | a fortress world with dark armoured continents, one thin silver orbital ring station circling it, bearing many cyan and gold heraldic beacon lights |
| `ally-banner` | Знамя | a night-side ocean world whose city lights on the continents form a huge symmetrical emblem of two swept wings around a glowing crystal, gold and cyan |
| `ally-throne` | Престол | a regal golden world, polished gold-plated surface patterns, a thin gold orbital ring with bright beacon lights |
| `ally-crimson` | Алый штандарт | a deep crimson world with long glowing red and gold banner-like aurora ribbons streaming around it, a ring of small beacon lights |
| `ally-crown` | Корона | a blue-green world encircled by three thin crossing silver orbital rings like a crown, beacon lights where the rings cross |
| `ally-aegis` | Эгида | a green world inside a faint translucent hexagonal energy shield sphere, gold heraldic lights at the shield nodes |
| `ally-beacon` | Маяк союза | a dark world with one tall glowing beacon tower sending a vertical cyan light beam, a halo ring of small gold orbital lights |
| `ally-sigil` | Печать | a violet and silver world with a glowing winged crystal sigil drawn across its surface in cyan light, gold rim lights |

## Переделки после проверки

(заполняется по ходу проверки листа)
