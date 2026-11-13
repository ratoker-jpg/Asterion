# Пробы стиля — пакет 1 (иконки шапки)

Сгенерировано 14.11.2026 через `codex-image` (`gen.cjs`). В игру не подключены. Codex отдаёт 1254×1254 PNG с прозрачностью.

## header-fleets.png

`--transparent --size 1024x1024`, ~85 с.

```
Game UI navigation icon for a dark sci-fi space strategy game, 1024x1024, transparent background. Subject: the 'Fleets' tab - a compact arrowhead formation of three sleek warships in three-quarter view, sculpted from dark gunmetal with engraved panel lines, cyan-teal enamel inlays, soft cyan engine glow and thin warm bronze trim on the edges. It must belong to one family of engraved metal-and-enamel emblem icons: dark steel, cyan glow, restrained gold accents, painterly-realistic rendering with soft rim light from the upper left. Centered, fills about 80% of the canvas, clean bold silhouette readable at 24 pixels. No background plate, no circle frame, no text, no letters, no logos, not imitating any existing game or brand.
```

Вывод: стиль верный, альфа чистая. При 24 px тёмный металл на тёмной шапке читается хуже старой яркой иконки, поэтому в базу пакета добавлена строка про контраст.

## header-metal.png

`--transparent --size 1024x1024`.

```
Game UI icon for a dark sci-fi space strategy game, 1024x1024, transparent background. Subject: a stack of three brushed steel ingots with bevelled edges, cool light-grey metal (resource color: steel grey), small cyan enamel inlay on the top ingot. It must belong to one family of engraved metal-and-enamel emblem icons: engraved panel lines, cyan-teal enamel inlays and soft cyan glow, thin warm bronze trim, painterly-realistic rendering with soft rim light from the upper left. High contrast: bright highlights and a light rim on the outer edge so the silhouette reads on a near-black header bar. Centered, fills about 80% of the canvas, bold clean silhouette readable at 24 pixels. No background plate, no circle frame, no text, no letters, no numbers, no logos, not imitating any existing game or brand.
```

Вывод: со строкой про контраст силуэт читается и при 24 px, материал совпадает с `report-icons`. Эта база и пошла в пакет 1.

## compare-old-new.jpg

Слева направо: старая и новая «Флоты», старый и новый «Металл»; 128, 48 и 24 px на тёмной полосе шапки.
