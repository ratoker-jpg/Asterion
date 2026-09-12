# Phase 6 — инвентарь канонических кораблей

Источник истины для этого changeset — сохранённые HTML-страницы публичного репозитория `ratoker-jpg/Nemexia_auto_v2`, commit `a5aa72739113a328be104d761cd664cb4d0a7853`:

`saved_pages/312313/Корабли`

Проверены все 39 страниц: три папки по 13 HTML-файлов. Папки соответствуют `RACE_ID=1` (синие Астеры), `RACE_ID=2` (зелёные Илары) и `RACE_ID=3` (красный Рой). `_files`-каталоги с ресурсами страниц в число записей не входят.

## Inventory: 39 source → ID → race records

До изменения все записи потребляли общую механику `src/domain/combat/catalog.ts`; `faction-catalog.ts` менял только presentation-поля. Текущий потребитель для каждой строки ниже: `faction-catalog → FleetWorkspacePortal / ShipyardView / spaceport-upgrades`. Новое поле — запись в типизированном `FACTION_SHIP_MECHANICS[faction][id]`, из которой выбранная фракция получает `cost`, `population`, `combat`, `ship` и `construction`.

| Источник | Внутренний ID | Раса | Текущий потребитель | Поля до | Новое поле |
|---|---|---|---|---|---|
| `Корабли Синяя раса/page_2026-07-22_20-31-04.html` — Транспортировщик | `transporter` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.transporter` |
| `Корабли Синяя раса/page_2026-07-22_20-31-11.html` — Мегатранспортировщик | `mega-transporter` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.mega-transporter` |
| `Корабли Синяя раса/page_2026-07-22_20-31-18.html` — Скаут | `scout` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.scout` |
| `Корабли Синяя раса/page_2026-07-22_20-31-27.html` — Крейсер | `cruiser` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.cruiser` |
| `Корабли Синяя раса/page_2026-07-22_20-31-36.html` — Защитник | `defender` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.defender` |
| `Корабли Синяя раса/page_2026-07-22_20-31-43.html` — Боевой корабль | `battleship` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.battleship` |
| `Корабли Синяя раса/page_2026-07-22_20-31-55.html` — Разрушитель | `destroyer` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.destroyer` |
| `Корабли Синяя раса/page_2026-07-22_20-32-03.html` — Бомбардировщик | `bomber` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.bomber` |
| `Корабли Синяя раса/page_2026-07-22_20-32-12.html` — Звезда смерти | `death-star` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.death-star` |
| `Корабли Синяя раса/page_2026-07-22_20-32-20.html` — Колонизатор | `colonizer` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.colonizer` |
| `Корабли Синяя раса/page_2026-07-22_20-32-28.html` — Переработчик | `recycler` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.recycler` |
| `Корабли Синяя раса/page_2026-07-22_20-32-35.html` — Шпионский зонд | `spy-probe` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.spy-probe` |
| `Корабли Синяя раса/page_2026-07-22_20-32-43.html` — Солнечный спутник | `solar-satellite` | Астеры | catalog → fleet/shipyard/spaceport | общий catalog | `aegis.solar-satellite` |
| `Корабли Зеленная раса/page_2026-07-22_20-37-45.html` — Товарный бот | `transporter` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.transporter` |
| `Корабли Зеленная раса/page_2026-07-22_20-37-52.html` — Большой товарный бот | `mega-transporter` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.mega-transporter` |
| `Корабли Зеленная раса/page_2026-07-22_20-38-00.html` — Истребитель | `scout` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.scout` |
| `Корабли Зеленная раса/page_2026-07-22_20-38-08.html` — Перехватчик | `cruiser` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.cruiser` |
| `Корабли Зеленная раса/page_2026-07-22_20-38-20.html` — Бот Щит | `defender` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.defender` |
| `Корабли Зеленная раса/page_2026-07-22_20-38-27.html` — Звездная Армада | `battleship` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.battleship` |
| `Корабли Зеленная раса/page_2026-07-22_20-38-35.html` — Голиаф | `destroyer` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.destroyer` |
| `Корабли Зеленная раса/page_2026-07-22_20-38-44.html` — БомберБот | `bomber` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.bomber` |
| `Корабли Зеленная раса/page_2026-07-22_20-38-54.html` — Титан | `death-star` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.death-star` |
| `Корабли Зеленная раса/page_2026-07-22_20-39-04.html` — Бот колонизатор | `colonizer` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.colonizer` |
| `Корабли Зеленная раса/page_2026-07-22_20-39-12.html` — Переработчик | `recycler` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.recycler` |
| `Корабли Зеленная раса/page_2026-07-22_20-39-20.html` — Шпионский бот | `spy-probe` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.spy-probe` |
| `Корабли Зеленная раса/page_2026-07-22_20-39-35.html` — Солнечный спутник | `solar-satellite` | Илары | catalog → fleet/shipyard/spaceport | общий catalog | `synod.solar-satellite` |
| `Корабли Рой Красные/page_2026-07-22_20-17-15.html` — Транспортировщик | `transporter` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.transporter` |
| `Корабли Рой Красные/page_2026-07-22_20-17-22.html` — Мегатранспортировщик | `mega-transporter` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.mega-transporter` |
| `Корабли Рой Красные/page_2026-07-22_20-17-29.html` — Нокс Дарт | `scout` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.scout` |
| `Корабли Рой Красные/page_2026-07-22_20-17-43.html` — Абсорбатор | `cruiser` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.cruiser` |
| `Корабли Рой Красные/page_2026-07-22_20-18-01.html` — Немезис | `defender` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.defender` |
| `Корабли Рой Красные/page_2026-07-22_20-18-10.html` — Призрак | `battleship` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.battleship` |
| `Корабли Рой Красные/page_2026-07-22_20-18-17.html` — Шмель | `destroyer` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.destroyer` |
| `Корабли Рой Красные/page_2026-07-22_20-18-24.html` — Бомбардировщик | `bomber` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.bomber` |
| `Корабли Рой Красные/page_2026-07-22_20-18-32.html` — Нокс Царица | `death-star` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.death-star` |
| `Корабли Рой Красные/page_2026-07-22_20-19-03.html` — Поселенец | `colonizer` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.colonizer` |
| `Корабли Рой Красные/page_2026-07-22_20-19-09.html` — Трутень Переработчик | `recycler` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.recycler` |
| `Корабли Рой Красные/page_2026-07-22_20-19-17.html` — Нокс разум | `spy-probe` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.spy-probe` |
| `Корабли Рой Красные/page_2026-07-22_20-19-25.html` — Органический спутник | `solar-satellite` | Рой | catalog → fleet/shipyard/spaceport | общий catalog | `veyra.solar-satellite` |

## Маппинг полей

- `Цена` → `cost.metal / cost.minerals / cost.gas` без пересчёта.
- `Статистика: Ангар` → `population` Asterion: это занимаемое население, а не число кораблей в очереди.
- `Статистика: Атака / Жизнь / Тип оружия / Тип брони (процент)` → `combat.attack / life / weaponType / armorType / armorStrength`.
- `Статистика: Грузоподъемность / Скорость / Расход топлива` → `ship.cargo / speed / fuel`.
- `Время` → `construction.time` как базовое время производства одной единицы; коэффициенты ускорения применяются только расчётами runtime/preview.
- `Требование` → `construction.requiredShipyardLevel` и `construction.requirements`; исходная строка требования сохраняется.
- У страниц спутника нет строк `Грузоподъемность`, `Скорость` и `Расход топлива`: `ship` намеренно отсутствует, а UI показывает `—`.

Проверка сопоставления сделана по порядку страниц, названию страницы/контрольным именам и текущим `SHIP_IDS`; автоматическое сравнение 39 страниц с реестром после нормализации HTML-сущностей дало `checked=39 mismatches=0` для числовых полей, механики, требований и provenance.

## Что осталось UNKNOWN

- В HTML есть блоки специальных умений (`Игнорирование брони`, `Сокрушение`, `Бонусные жизни`, `Улучшенная броня`, `Возрождение`/`Мега сила`, `Артиллерия`, `Детонация`, `Уничтожение планеты`, `Заморажение`). `CombatEntityDefinition` не имеет поля для этих эффектов, а боевой runtime их не вычисляет, поэтому они не превращены в выдуманные числовые модификаторы и остаются `UNKNOWN` для отдельного follow-up.
- Поля приоритетных целей, дополнительного и штрафного урона из источника не подключались: текущая модель не поддерживает их как эти канонические эффекты.
- В нескольких страницах Роя источник требует наличие кораблей в количестве (`Транспортировщик · 1`, `Нокс Дарт · 1/2/3`, `Немезис · 1`, `Нокс разум · 20`); текущая модель умеет проверять только уровни зданий/науки. Все исходные строки сохранены с `· количество N`; preview помечает их `unresolved-catalog-requirement`, `valueKind: quantity`, `currentLevel: null` и не подменяет количество уровнем. В частности, для `veyra.destroyer` сохранено `Немезис · количество 1`.

## Подтверждённые одинаковые значения

Одинаковые значения не получаются через fallback: они записаны в каждой расовой записи и проверяются сравнением всех 39 записей. Полностью совпадающие наборы импортированных полей подтверждены для:

- `colonizer`: Астеры = Илары;
- `recycler`: Астеры = Рой;
- `spy-probe`: Астеры = Рой;
- `solar-satellite`: у всех трёх рас совпадают стоимость, population, атака, жизнь, время и требование верфи; тип брони расовый, а transport-трейт отсутствует у всех трёх страниц.

Остальные расхождения намеренно сохранены в `FACTION_SHIP_MECHANICS`; действующие формулы боевого расчёта, баланс улучшений, бонусы космодрома и промышленной фабрики не изменялись.
