/**
 * Clan names for bot-made alliances (owner request 09.11.2026). They have
 * nothing to do with the founder's nick: bold, ironic, pathos, meme, some
 * swearing. Every name fits `ALLIANCE_NAME_MAX` (42); every tag is 2..5
 * letters or digits without spaces.
 */
export type AllianceNameEntry = Readonly<{ name: string; tag: string }>;

const entry = (name: string, tag: string): AllianceNameEntry => ({ name, tag });

export const ALLIANCE_NAME_POOL: readonly AllianceNameEntry[] = [
  // Bold and pathos
  entry('Стальной Кулак', 'СТАЛЬ'), entry('Тёмный Рассвет', 'РАССВ'), entry('Орда Без Берегов', 'ОРДА'), entry('Железная Стая', 'СТАЯ'),
  entry('Последний Довод', 'ДОВОД'), entry('Багровый Прилив', 'ПРИЛ'), entry('Чёрные Паруса', 'ПАРУС'), entry('Кровь и Металл', 'КИМ'),
  entry('Гнев Пустоты', 'ГНЕВ'), entry('Холодный Огонь', 'ХОГОН'), entry('Волки Бездны', 'ВОЛК'), entry('Эскадрон Смерти', 'ЭСКСМ'),
  entry('Вечный Легион', 'ЛЕГИО'), entry('Сыны Пустоты', 'СЫНЫ'), entry('Пепел Империи', 'ПЕПЕЛ'), entry('Клинок Рассвета', 'КЛИН'),
  entry('Тени Сектора', 'ТЕНИ'), entry('Ржавая Корона', 'КОРОН'), entry('Алый Гамбит', 'ГАМБ'), entry('Серые Кардиналы', 'КАРД'),
  entry('Звёздные Мясники', 'МЯСО'), entry('Молот Орбиты', 'МОЛОТ'), entry('Каратели Туманности', 'КАРАТ'), entry('Горькая Победа', 'ПОБЕД'),
  entry('Ночные Ястребы', 'ЯСТРБ'), entry('Братство Обгоревших', 'БРАТ'), entry('Дикая Охота', 'ОХОТА'), entry('Железный Занавес', 'ЗАНАВ'),
  entry('Горизонт Событий', 'ГОРИЗ'), entry('Полярный Шторм', 'ШТОРМ'),
  // Ironic and humorous
  entry('Пельмени Судьбы', 'ПЕЛМ'), entry('Тапки и Бластеры', 'ТАПКИ'), entry('Мамкины Адмиралы', 'МАМКА'), entry('Союз Трезвых Штурманов', 'СТШ'),
  entry('Клуб Любителей Нагиба', 'КЛН'), entry('Дачники Галактики', 'ДАЧА'), entry('Орден Пивного Корсара', 'ПИВО'), entry('Отряд Нас Не Догонят', 'ННД'),
  entry('Ребята с Района', 'РАЙОН'), entry('Гаражный Кооператив', 'ГАРАЖ'), entry('Шашлык на Орбите', 'ШАШЛ'), entry('Борщ и Бомбы', 'БОРЩ'),
  entry('Дядя Вася и Ко', 'ДВК'), entry('Нам Всё Равно', 'НВР'), entry('Сидим Копим', 'КОПИМ'), entry('Мы Просто Мимо Шли', 'МИМО'),
  entry('Лига Лысых Орлов', 'ЛЛО'), entry('Огурцы Возмездия', 'ОГУР'), entry('Картофельный Фронт', 'КАРТ'), entry('Хомяки Апокалипсиса', 'ХОМЯК'),
  entry('Бабушкин Флот', 'БАБКА'), entry('Тётя Зоя Недовольна', 'ЗОЯ'), entry('Союз Вечно Опаздывающих', 'СВО'), entry('Полный Привод', 'ПРИВ'),
  entry('Святое Корыто', 'КОРЫТ'), entry('Кружок Юных Пиратов', 'КЮП'), entry('Колхоз Звёздный Путь', 'КОЛХ'), entry('Сантехники Вселенной', 'САНТ'),
  entry('Шаурма Без Лука', 'ШАУР'), entry('Дед Мороз и Дроны', 'ДЕДМ'),
  // Memes and gamer style
  entry('Нагибаторы 228', 'НАГИБ'), entry('Шапито Cosmos', 'ШАПИ'), entry('Три Топора', 'ТОПОР'), entry('Типа Клан', 'ТИПА'),
  entry('Клан Без Названия', 'БЕЗИМ'), entry('Ну Вы Поняли', 'НВП'), entry('Тест Тест Раз Два', 'ТЕСТ'), entry('Рак Пятится Назад', 'РАК'),
  entry('Прощай Молодость', 'ПМ'), entry('Тише Едешь Дальше Будешь', 'ТЕДБ'), entry('Бей Первым', 'БЕЙ'), entry('Не Баг а Фича', 'ФИЧА'),
  entry('Мясо На Мангале', 'МАНГ'), entry('Ёлки Палки', 'ЁЛКИ'), entry('Ой Всё', 'ОЙВСЁ'), entry('Ща Всё Будет', 'ЩАВСЁ'),
  entry('Эй Ты Там', 'ЭЙТЫ'), entry('Нуб Киллеры', 'НУБ'), entry('Про100 Клан', 'ПРО'), entry('Вайп Через Час', 'ВАЙП'),
  entry('Лузеры Победители', 'ЛУЗ'), entry('Легенды Без Ника', 'ЛЕГ'), entry('Рашим в Рашу', 'РАШ'), entry('ГГ ВП', 'ГГВП'),
  entry('Тильт Сектора', 'ТИЛЬТ'), entry('Донатим Врагам', 'ДОНАТ'), entry('Афк Но Страшные', 'АФК'), entry('Рейд на Рассвете', 'РЕЙД'),
  entry('Кармический Дубль', 'КАРМА'), entry('Гайд Не Читали', 'ГАЙД'),
  // Swearing, mild and rude
  entry('Пиздец Подкрался', 'ПИЗД'), entry('Хренов Легион', 'ХРЕН'), entry('Ебаный Флот', 'ЕФ'), entry('Нахер Всех', 'НАХЕР'),
  entry('Отвалите От Нас', 'ОТВАЛ'), entry('Злые Ублюдки', 'УБЛЮД'), entry('Сука Блин Клан', 'СУКА'), entry('Дерьмо и Палки', 'ДЕРЬМ'),
  entry('Жопа С Ушами', 'ЖОПА'), entry('Козлы Отпущения', 'КОЗЛЫ'), entry('Мудаки в Скафандрах', 'МУДАК'), entry('Охуевшие Пилоты', 'ОХУЕЛ'),
  entry('Блин Какой Клан', 'БЛИН'), entry('Хуже Не Бывает', 'ХУЖЕ'), entry('Говнари', 'ГОВНО'), entry('Пошли Вы Все', 'ПОШЛИ'),
  entry('Чё Смотришь', 'ЧЁСМ'), entry('Ёпрст Эскадра', 'ЁПРСТ'), entry('Идите Лесом', 'ЛЕСОМ'), entry('Падлы Орбитальные', 'ПАДЛА'),
  entry('Засранцы Сектора', 'ЗАСР'), entry('Бздуны Пустоты', 'БЗДУН'), entry('Тупые Но Много', 'ТУПЫЕ'), entry('Гопники в Космосе', 'ГОПНК'),
  entry('Злобные Хмыри', 'ХМЫРИ'), entry('Нахальный Флот', 'НАХАЛ'), entry('Скоты и Твари', 'СКОТ'), entry('Чёрт Знает Кто', 'ЧЗК'),
  entry('Адовы Сволочи', 'СВОЛО'), entry('Свинарник Нашего Района', 'СВИН'),
  // Latin, leetspeak, abbreviations
  entry('Iron Batya', 'IRON'), entry('Dark Pelmen', 'PELM'), entry('Zloy Legion', 'ZLOY'), entry('Nagib Corp', 'NAGIB'),
  entry('Hamlo Squad', 'HAMLO'), entry('Bydlo Team', 'BYDLO'), entry('Gopnik Fleet', 'GOP'), entry('Pipec Crew', 'PIPEC'),
  entry('Mudaki United', 'MUDAK'), entry('Kraken Brotherhood', 'KRKN'), entry('Dembel Order', 'DMBL'), entry('Batya Inc', 'BATYA'),
  entry('Tormoz Gang', 'TRMZ'), entry('Sibir Wolves', 'SIBIR'), entry('Ural Vikings', 'URAL'), entry('Black Borsch', 'BORSH'),
  entry('Sad Hamsters', 'SADH'), entry('Epic Fail Squad', 'FAIL'), entry('Cosmic Pelmeni', 'PLMN'), entry('N00b Slayers', 'N00B'),
  entry('Pr0 Gamers', 'PR0'), entry('Dead Inside Fleet', 'DEAD'), entry('Rage Quit Club', 'RAGE'), entry('Lag Lords', 'LAG'),
  entry('Hardbass Armada', 'HBASS'), entry('Vodka Vanguard', 'VODKA'), entry('Void Gopniks', 'VOID'), entry('Zhest Order', 'ZHEST'),
  entry('Real Pacani', 'PACAN'), entry('Casual Overlords', 'CASU'),
  // Sector, empire and space
  entry('Республика Пустых Складов', 'РПС'), entry('Империя Зла и Ко', 'ИЗК'), entry('Конфедерация Ржавых', 'КОНФ'), entry('Союз Разорённых', 'РАЗОР'),
  entry('Коалиция Недовольных', 'КОАЛ'), entry('Вольные Каторжане', 'КАТОР'), entry('Свободный Пояс', 'ПОЯС'), entry('Патруль Дальнего Края', 'КРАЙ'),
  entry('Сектор Газа и Ко', 'СГИК'), entry('Резервация Ионов', 'ИОНЫ'), entry('Нейтронный Блок', 'НЕЙТР'), entry('Орбитальные Бродяги', 'БРОД'),
  entry('Нищие Но Гордые', 'НИЩИЕ'), entry('Старый Космос', 'СТАРЫ'), entry('Новый Порядок Хаоса', 'НПХ'), entry('Красный Пояс Астероидов', 'КПА'),
  entry('Звёздная Артель', 'АРТЕЛ'), entry('Космический Профсоюз', 'ПРОФ'), entry('Бригада Тёмной Материи', 'БТМ'), entry('Консорциум Тихого Ужаса', 'КТУ'),
  entry('Гильдия Мёртвых Звёзд', 'ГМЗ'), entry('Секта Чёрной Дыры', 'СЕКТА'), entry('Дружина Квазара', 'ДРУЖ'), entry('Табор Межзвёздный', 'ТАБОР'),
  entry('Банда Малой Орбиты', 'БАНДА'), entry('Кочевники Пустоты', 'КОЧ'), entry('Рыцари Пустого Бака', 'БАК'), entry('Корпорация Хаос', 'ХАОС'),
] as const;

function hashKey(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return hash >>> 0;
}

const lower = (value: string) => value.toLocaleLowerCase('ru-RU');
const upper = (value: string) => value.toLocaleUpperCase('ru-RU');

/**
 * Picks a clan name and tag for a bot founder. Deterministic from `key`
 * (founder id), walks the pool from a hashed start until it finds a pair not
 * used yet and not containing the founder's nick. When the pool is used up it
 * numbers the pairs ("Орда 2"), so the answer always exists.
 */
export function pickNpcAllianceName(
  key: string,
  leaderNick: string,
  isTaken: (name: string, tag: string) => boolean,
  maxName = 42,
): AllianceNameEntry {
  const nick = lower(leaderNick.replace(/\s+/g, ''));
  const size = ALLIANCE_NAME_POOL.length;
  const start = hashKey(`npc-alliance-name:v1:${key}`) % size;
  const clashes = (candidate: AllianceNameEntry) => {
    const name = lower(candidate.name.replace(/\s+/g, ''));
    return nick.length >= 3 && (name.includes(nick) || nick.includes(name) || lower(candidate.tag) === nick);
  };
  for (let step = 0; step < size; step += 1) {
    const candidate = ALLIANCE_NAME_POOL[(start + step) % size]!;
    if (clashes(candidate) || isTaken(candidate.name, candidate.tag)) continue;
    return candidate;
  }
  for (let round = 2; round <= 999; round += 1) {
    for (let step = 0; step < size; step += 1) {
      const base = ALLIANCE_NAME_POOL[(start + step) % size]!;
      if (clashes(base)) continue;
      const ending = ` ${round}`;
      const name = `${base.name.slice(0, maxName - ending.length).trim()}${ending}`;
      const tag = `${base.tag.slice(0, 5 - String(round).length)}${round}`;
      if (!isTaken(name, tag)) return { name, tag };
    }
  }
  return { name: `Клан ${hashKey(key) % 100000}`, tag: `К${hashKey(key) % 10000}` };
}

export { upper as allianceTagKey, lower as allianceNameKey };
