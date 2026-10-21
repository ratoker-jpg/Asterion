# Asterion — промты генерации ассетов (меню, рейд на Солнце, кристаллы, Врата)

Для Codex. Сгенерированные файлы положить по указанным путям и отдать мне — я подключу их вместо процедурных заглушек.
Сейчас в игре работают **процедурные** версии (SVG/CSS) и уже существующие ассеты; ничего из списка не блокирует игру.

## Общие правила (для каждого промта)

- Стиль: тот же, что у `assets/source/New assets/buildings/*` и `assets/source/generated-factions-v1/factions/*` — тёмный sci-fi, полуреалистичный painterly-рендер, мягкий ободок света, высокая детализация, без текста и логотипов.
- Расы: **Астеры** (`aegis`) — синий `#5f9bff` + сталь и золото, угловатые панели; **Илары** (`synod`) — белый/золото + зелёный `#3fdc86`, плавные кольца и шпили; **Рой** (`veyra`) — органика, хитин, красный `#ff5468`, светящиеся прожилки.
- Прозрачный фон (PNG RGBA) для объектов; без тени-подложки, без рамки, объект по центру, ~8% отступа от краёв.
- Запрещено: текст, буквы, цифры, водяные знаки, UI-элементы, люди в кадре (кроме портретов), обрезанные края объекта.
- Negative prompt (добавлять ко всем): `text, letters, watermark, signature, logo, frame, border, UI, cropped, blurry, low detail, photo, plastic toy look, flat vector`.

---

## 1. Четыре солнечных кристалла (иконки, обязательно)

Путь: `assets/source/sun-raid/crystals/crystal-{1..4}.png` · 1024×1024 · PNG RGBA · один кристалл в кадре, вертикально, лёгкий наклон 8°.

| Файл | Название в игре | Цвет | Промт |
|---|---|---|---|
| `crystal-1.png` | Кристалл Короны | золото `#ffc94a` / оранжевое свечение `#ff9d1f` | `A single faceted solar crystal floating in space, elongated hexagonal gem, molten gold interior with swirling plasma like a solar corona, sharp polished facets, warm orange inner glow and soft rim light, tiny embers drifting around it, game item icon, centered, transparent background, dark sci-fi painterly style, ultra detailed` |
| `crystal-2.png` | Кристалл Прилива | лазурь `#5fe6ff` / `#1fa8ff` | `A single faceted solar crystal floating in space, elongated hexagonal gem, cold cyan-blue interior with flowing magnetic field lines like a plasma tide, sharp polished facets, icy blue glow and soft rim light, faint aurora ribbons around it, game item icon, centered, transparent background, dark sci-fi painterly style, ultra detailed` |
| `crystal-3.png` | Кристалл Затмения | фиолет `#b58cff` / `#7a3cff` | `A single faceted solar crystal floating in space, elongated hexagonal gem, deep violet interior with a dark eclipse disc and a thin bright ring of light inside, sharp polished facets, purple glow and soft rim light, subtle shadow halo, game item icon, centered, transparent background, dark sci-fi painterly style, ultra detailed` |
| `crystal-4.png` | Кристалл Вспышки | алый `#ff6b5a` / `#ff2d3f` | `A single faceted solar crystal floating in space, elongated hexagonal gem, crimson interior with a frozen solar prominence arc bursting inside, sharp polished facets, intense red-orange glow and soft rim light, small sparks around it, game item icon, centered, transparent background, dark sci-fi painterly style, ultra detailed` |

Дополнительно (по желанию): те же 4 кристалла в варианте «гнездо пустое» — `crystal-{n}-empty.png`, тот же силуэт, тусклое стекло без свечения, 40% непрозрачности.

## 2. Иконка миссии «Командный рейд на Солнце» (обязательно)

Путь: `assets/source/mission-icons-v1/37_sun_raid.png` · 1254×1254 · PNG · **в стиле существующих** `mission-icons-v1/*` (тёмно-синяя техно-рамка с бирюзовыми бликами, белая глифовая пиктограмма в центре). Сейчас используется `20_bombardment.png`.

Промт: `Square game mission icon in the exact style of a dark blue sci-fi HUD tile with cyan circuit-line frame and soft glow, centered white glowing glyph: a stylized sun disc with rays being pierced by three converging arrowhead ships (alliance raid), clean bold silhouette readable at 48px, subtle cyan bloom, no text`.

## 3. Солнце — состояния для досье (по желанию)

Путь: `assets/source/sun-raid/sun/sun-{bright,dimmed,frozen}.png` · 1024×1024 · PNG RGBA.

- `sun-bright.png`: `A blazing star seen from space, turbulent plasma surface, bright golden-white core, long corona filaments and prominences, intense glow, centered sphere, transparent background, cinematic sci-fi painterly`.
- `sun-dimmed.png`: тот же ракурс; `a weakened dim star, darker orange-red surface with scarred dark patches and broken corona, faint glow, ominous`.
- `sun-frozen.png`: тот же ракурс; `a star frozen in crystalline ice, pale cyan-white surface covered by hexagonal frost lattice and ice shards, cold blue halo, still and silent`.

## 4. Врата — стадии стройки и разрушение (по желанию)

Готовые Врата уже есть: `assets/source/New assets/buildings/{race}/building.{race}.supreme-galactic-gates.png` (подключены). Нужны варианты в **том же ракурсе, масштабе и стиле**:

- `building.{race}.supreme-galactic-gates-construction.png` (1254×1254, RGBA): `the same alliance star gate building under construction: scaffolding, cranes and energy beams, open unfinished frame segments, the portal not yet lit, construction lights` + расовый словарь (см. «Общие правила»).
- `building.{race}.supreme-galactic-gates-ruined.png` (1254×1254, RGBA): `the same star gate building destroyed: cracked and collapsed frame, smoking debris, broken extinguished portal ring, scorch marks, sparks`.

## 5. Главное меню — фоновый кей-арт (по желанию)

Путь: `assets/source/menu/menu-background.png` · 1920×1080 · PNG/JPG без прозрачности.
Промт: `Epic wide space vista for a strategy game main menu: a giant glowing star on the right third with a faint ring of four colored crystals orbiting it (gold, cyan, violet, crimson), distant spiral galaxies, a dark planet horizon curving along the bottom, left 40% of the frame dark and calm for menu text, cinematic lighting, deep navy and black palette with warm sun highlights, no text`.

Вариации под расу (тот же кадр, другой акцент света): `menu-background-{aegis,synod,veyra}.png` — синий/зелёный/красный рефлекс на горизонте и силуэт флагмана расы вдали.

## 6. Экран итога кампании (по желанию)

Путь: `assets/source/menu/campaign-victory.png` и `campaign-defeat.png` · 1920×1080.
- Победа: `A colossal star gate activating in deep space, four solar crystals blazing in its sockets (gold, cyan, violet, crimson), a blinding white vortex in the center, fleets of ships silhouetted in front, triumphant cinematic composition, left half darker for overlay text`.
- Поражение: `The same star gate seen from afar belonging to an enemy, cold red light, our damaged fleet drifting in the foreground, somber cinematic mood, left half darker for overlay text`.

## 7. Обломки: «Найти обломки» и обломки у Солнца (по желанию)

Путь: `assets/source/debris/` · PNG RGBA.

- `debris-finder.png` (256×256): иконка кнопки «Найти обломки» во Вселенной. `Small square game UI icon, dark navy sci-fi tile with thin cyan frame, centered: a radar sweep arc over a scattered cluster of glowing metal ship fragments, cyan scan line, warm amber highlights on the fragments, clean bold silhouette readable at 24px, no text`.
- `sun-debris.png` (512×512): обломки, дрейфующие у Солнца (строка «Обломки у Солнца» в панели и список «Найти обломки»). `A drifting field of wrecked starship fragments and twisted hull plates silhouetted against the edge of a blazing golden star, embers and molten metal glints, debris lit from behind with orange rim light, centered composition, transparent background, dark sci-fi painterly style`.

---

## Куда это подключится

| Ассет | Где сейчас заглушка | Компонент |
|---|---|---|
| Кристаллы | процедурный SVG `CrystalGem` | `src/ui/sun-raid/SunRaidArt.tsx` |
| Иконка рейда | `20_bombardment.png` | `src/ui/sun-raid/SunRaidPanel.tsx`, лента рейсов `src/FleetWorkspacePortal.tsx` |
| Солнце | процедурный CSS `SunOrb` | `src/ui/sun-raid/SunRaidArt.tsx` |
| Стадии Врат | фильтры CSS поверх готовых Врат | `src/ZoneView.tsx`, `src/ui/sun-raid/GateDialog.tsx` |
| Фон меню | `starter/backgrounds/system_background.png` + CSS-горизонт | `src/ui/menu/MenuApp.tsx` |
| Итог кампании | CSS-лучи + Врата | `src/ui/menu/InGameOverlays.tsx` |
| «Найти обломки» | текстовый глиф ✦ | `src/UniverseView.tsx` |
| Обломки у Солнца | без картинки | `src/ui/sun-raid/SunRaidPanel.tsx`, `src/UniverseView.tsx` |
