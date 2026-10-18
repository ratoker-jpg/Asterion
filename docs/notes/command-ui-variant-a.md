# Командование — UI вариант A «Брифинг»

Заметка для следующих PR. Здесь описано, как устроен экран и как добавлять новые вкладки и экраны в том же стиле
(дипломатия, рейд на Солнце и т. п.).
Утверждённые макеты: `D:\Desktop\Asterion\designs\command-2026-10-18\` (вариант A: `screens/A-*.png`,
интерактивный `command-concepts.html#v=A`). Образец стиля — окно «Операции», вариант A (`src/operations-a.css`).

## Что сделано в этом PR

- `src/CommandView.tsx` переписан только в части разметки. Домен, селекторы, `CommandActions`, правила и все `data-qa-*` прежние.
- `src/command.css` написан заново: всё лежит под `.cmdA`. Старые классы, на которые завязаны QA и другие экраны,
  оставлены на тех же элементах: `.command-view`, `.command-view__status`, `.command-tabs`, `.command-content`,
  `.command-journal`, `.command-locked`, `.command-editor-form`, `.command-chip-row`, `.command-accent-dot`, `.command-emblem`.
- Вкладки перестроены:

  | ключ (`data-qa-command-tab`) | подпись | что внутри |
  |---|---|---|
  | `overview` | ШТАБ | слева **журнал союза** (перенесён из «Совместных операций»), справа досье союза |
  | `members` | СОСТАВ | список участников, справа досье участника и действия руководства |
  | `applications` | ЗАЯВКИ | входящие заявки и история решений, справа досье кандидата со сравнением со средним по союзу |
  | `requests` | ПОМОЩЬ | слева запросы союзников и свои запросы, справа форма нового запроса |
  | `alliances` | СОЮЗЫ | каталог, справа досье выбранного союза |
  | `operations` | ОПЕРАЦИИ | заглушки «Рейд на Солнце» и «Дипломатия» (обе в одной вкладке) |

  Вкладка `diplomacy` удалена: дипломатия теперь внутри `operations`. Состояния без союза, без Палаты управления
  и диалоги (создание, настройки, выход, исключение, передача лидерства) сделаны в той же системе.
- `App.tsx` передаёт новый необязательный проп `ownerFactions` (`commandOwnerFactions`). Расы берутся из тех же
  профилей владельцев, что использует Вселенная: игрок — `state.profile.factionId`, Бот 01 —
  `createUniverseNpcOwnerProfile().raceId` (`veyra` = Рой), а в Test Mode Ира Вель —
  `TEST_MODE_ALLY_PLANET_FIXTURE.owner.raceId` (раса игрока, Астеры). Названия рас: `aegis` — Астеры,
  `synod` — Илары, `veyra` — Рой. Если раса неизвестна, показываются инициалы, а не выдуманная раса.
- Исправлена потеря прогресса при нескольких открытых окнах игры. `App.tsx` пишет сохранение целиком при каждом
  изменении состояния, а ресурсы тикают постоянно, поэтому второе, устаревшее окно затирало свежий прогресс
  (только что построенная «Палата управления» снова становилась 0, и Командование опять требовало её построить).
  Теперь окно слушает событие `storage` по своему ключу сохранения, перечитывает сохранение (`persistence.read()`)
  и не пишет принятое состояние обратно.
- QA обновлены под новую раскладку: `electron/command-journal-qa.cjs` (журнал на «Штабе», солнце и дипломатия
  в «Операциях») и `electron/resource-assets-qa.cjs` (вкладка по `data-qa`, а не по тексту).

## Каркас экрана (как собрать любую новую вкладку)

```
<main.command-view.cmdA data-qa-command-state>
  <header.cmdA-top>            заголовок · .command-view__status (strong = «Имя [TAG]») · nav.command-tabs
  <div.command-feedback>       тост ошибки поверх контента (absolute, не сдвигает раскладку)
  <section.command-content>
    <div.cmdA-grid>            две колонки: clamp(320px,25%,440px) | 1fr
      <ListPanel>              слева: kicker, title, count, tools (поиск), прокручиваемый список, footer (тест-кнопки)
      <Dossier footer=…>       справа: тело с Hero + Tiles + блоками, внизу закреплённая панель действий
```

Готовые компоненты в `CommandView.tsx`:

- `ListPanel` — левая колонка. Элементы списка: `li.cmdA-item` (или `button.cmdA-item`), цвет полоски задаётся
  переменной `--k`. Состояния: `.is-selected`, `.is-clickable`, `.is-own`. Внутри: иконка, `.cmdA-item-main`
  (`strong` + `span`), справа `time`, `.cmdA-item-score` или `.cmdA-item-action`.
- `Dossier` — правая колонка; `footer` = `FootStatus` слева и `.command-actions` с кнопками справа.
- `Hero art={…}` + `HeroTitle chips title` — большой арт слева, заголовок и чипы справа. Варианты арта:
  `.cmdA-art--hall` (здание Палаты + герб), `--general` (генерал расы), `--monogram` (инициалы, если раса неизвестна),
  `--emblem` (большой герб союза), `--resource` (иконка ресурса + мега-транспорт), `--sun` (солнце).
- `Tiles items=[{icon,label,value,sub,tone}]` — ряд плиток (колонок столько же, сколько плиток).
- `Chip tone` (`cy`, `am`, `ok`, `bad`, `vi`, `solid`), `Medal kind` (иконки очков), `MissionTile`, `Avatar`,
  `PersonArt`, `ScoreGrid`, `MembersBar`, `Stub`.
- Кнопки — обычный `<button>` с классами `primary`, `amber`, `danger`, `cmdA-lg`. Стиль общий, отдельные классы кнопкам не нужны.

### Как добавить вкладку

1. Добавить ключ в `CommandTab` и `TAB_LABELS`; при необходимости — бейдж в `badges` внутри `CommandView`.
2. Написать `XxxTab` с `<div className="cmdA-grid">` + `ListPanel` + `Dossier` и подключить её в ветке рендера `command-content`.
3. Все данные брать из домена и селекторов (`src/domain/command/*`, `src/application/*`), в UI ничего не придумывать.
   Если данных нет — честная заглушка `Stub` без кнопок внутри.
4. Новые элементы помечать `data-qa-*`, существующие атрибуты не переименовывать.

### Как довести заглушки до настоящих экранов

- **Дипломатия.** Типы `RelationStatus` / `DiplomaticRelation` уже есть в `domain/command/types.ts`.
  Лучше вынести её в отдельную вкладку `diplomacy`: слева список союзов с чипом статуса (палитра — в `DIPLOMACY_STATUSES`),
  справа досье отношений с действиями «объявить войну», «перемирие» в футере. Заглушку `Stub qa="diplomacy"` в
  `OperationsTab` тогда удалить, а в `command-journal-qa.cjs` (шаг 5) заменить проверку заглушки на проверку экрана.
- **Рейд на Солнце.** Каркас уже готов: `OperationsTab`, арт `--sun`, ряд кораблей `.cmdA-ghost-fleet`
  (`SUN_RAID_SHIPS` берёт арт из `getCombatEntity`). Когда появится механика: слева список операций союза
  (активные, набор, завершённые), справа досье с вкладом участников и кнопкой участия в футере. Внутри
  `[data-qa-sun-raid]` сейчас не должно быть кнопок — QA это проверяет; при реализации нужно поменять и тест.
- **Раса участников.** Новые владельцы (будущие игроки и NPC) появятся на экране с расой, как только их добавят
  в `commandOwnerFactions` в `App.tsx`. Тогда аватары, портреты генералов и чипы «РАСА» включатся сами.
- **Онлайн и активность** намеренно не показываются: QA запрещает `ONLINE|НЕ В СЕТИ|АКТИВЕН`, и это правило конфиденциальности.

## Стиль и подводные камни

- Токены — только `--ut-*` из `src/asterion-unified-theme.css`: cyan `#56d9f2`, amber, danger, positive,
  радиусы 18/13/9/10 и шкала шрифтов 18/14/12/11.
- `GlobalTypographyController` размечает все текстовые узлы и через `body [data-asterion-typography=…] … !important`
  прижимает их к шкале. Крупные числа и заголовки (плитки 18px, заголовок героя 28px, названия) должны идти
  с `!important` — так же сделано в «Операциях A». Без этого всё станет 12px.
- Тени артов — от одного источника света снизу справа, за зрителем: `drop-shadow(-8px -10px 14px rgba(0,0,0,.6))`.
- Иконки миссий (`33_trade_convoy` = «Помощь союзу», `08_sun_support` = рейд на Солнце) — готовые плитки со своей рамкой:
  `.cmdA-mtile` с `object-fit: cover`, без второй рамки.
- Экран занимает весь workspace без прокрутки страницы (`.workspace--command:has(> .cmdA) { overflow: hidden }`);
  прокручиваются только список (`.cmdA-list-scroll`) и тело досье (`.cmdA-dossier-body`).

## Ассеты

| что | откуда |
|---|---|
| медали очков | `asterionAssetIntegrationAssets.scoreIcons` (`overall-star`, `resource-crystal`, `battle`, `achievement-trophy`) |
| иконки разделов | `asterionAssetIntegrationAssets.reportIcons` (`alliances`, `profile`, `flights`, `arena`) |
| лица рас | `asterionAssetIntegrationAssets.battleFactionIcons` |
| генералы | `getFactionGeneralAsset` (`domain/profile/faction-assets.ts`) |
| ресурсы | `ResourceIcon` (`ui/resources`) |
| Палата управления | проп `hall.art` (здание расы игрока) |
| транспорт / корабли | `getCombatEntity('transporter' / 'mega-transporter' / …).art` |
| солнце | `assets/source/battle-report-v2/battle-sun-transparent-v1.png` |
| иконка «Командование» | `src/assets/ui/header-icons/command.png` |

## Проверки

```
npm run test:command
npm run build
npm run test:command-ui
npm run test:command-aid-ui
npm run test:command-journal-ui
npm run test:resource-assets-ui
npm run test:production-test-isolation-ui
npm run test:reports-ui
```

Съёмка всех состояний с dev-сервера на порту 5177: `designs/command-2026-10-18/tools/capture-impl.cjs`
(запуск: `npx electron <путь>` из worktree).
