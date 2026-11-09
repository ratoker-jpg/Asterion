/**
 * Clan names for bot-made alliances (owner rule 10.11.2026): names of real
 * top clans, with pathos and dignity, some in Latin. They have nothing to do
 * with the founder's nick. No two names share a root, and no name shares a
 * root with an NPC nick (see `world/name-stems.ts`). Every name fits
 * `ALLIANCE_NAME_MAX` (42); every tag is 2..5 readable letters, never
 * political.
 */
export type AllianceNameEntry = Readonly<{ name: string; tag: string }>;

const entry = (name: string, tag: string): AllianceNameEntry => ({ name, tag });

export const ALLIANCE_NAME_POOL: readonly AllianceNameEntry[] = [
  // One word
  entry('Империя', 'ИМП'), entry('Легион', 'ЛЕГ'), entry('Авангард', 'АВАН'), entry('Твердыня', 'ТВЕРД'),
  entry('Гегемония', 'ГЕГЕМ'), entry('Доминион', 'ДОМ'), entry('Династия', 'ДИН'), entry('Ополчение', 'ОПОЛ'),
  entry('Когорта', 'КОГ'), entry('Фаланга', 'ФАЛ'), entry('Цитадель', 'ЦИТ'), entry('Бастион', 'БАСТ'),
  entry('Синдикат', 'СИНД'), entry('Консорциум', 'КОНС'), entry('Триумвират', 'ТРИ'), entry('Конфедерация', 'КОНФ'),
  entry('Иерархия', 'ИЕР'), entry('Трибунал', 'ТРБ'), entry('Форпост', 'ФОРП'), entry('Утопия', 'УТОП'),
  entry('Орда', 'ОРДА'), entry('Застава', 'ЗАСТ'), entry('Гарнизон', 'ГАРН'), entry('Экспедиция', 'ЭКСП'),
  entry('Флагман', 'ФЛАГ'), entry('Регалия', 'РЕГАЛ'), entry('Меридиан', 'МЕРИД'), entry('Экватор', 'ЭКВА'),
  // Latin
  entry('Nova', 'NOVA'), entry('Ascendant', 'ASC'), entry('Concordia', 'CONC'), entry('Valentia', 'VAL'),
  entry('Ars Noctis', 'NOX'), entry('Ignis', 'IGN'), entry('Fortuna', 'FORT'), entry('Vindicta', 'VIND'),
  entry('Monarch', 'MNRH'), entry('Regnum', 'RGN'), entry('Apex', 'APEX'), entry('Vanitas', 'VAN'),
  entry('Veritas', 'VER'), entry('Primus', 'PRIM'), entry('Excelsior', 'EXC'), entry('Ultima Ratio', 'RATIO'),
  entry('Invicta', 'INV'), entry('Magnum Opus', 'OPUS'), entry('Obscura', 'OBS'), entry('Lux Perpetua', 'LUX'),
  entry('Iron Accord', 'IRON'), entry('Grim Harvest', 'GRIM'), entry('Warborn', 'WARB'), entry('Black Sun', 'BSUN'),
  entry('Cold Front', 'COLD'), entry('Far Shore', 'SHORE'), entry('High Ground', 'HIGH'), entry('Infinitum', 'INF'),
  entry('Equilibrium', 'EQL'), entry('Gravitas', 'GRAV'), entry('Momentum', 'MMT'), entry('Fidelis', 'FID'),
  entry('Halcyon', 'HAL'), entry('Eidolon', 'EIDO'), entry('Empyrean', 'EMP'), entry('Oblivion', 'OBL'),
  entry('Rubicon', 'RUBI'), entry('Aurum', 'AUR'), entry('Arcanum', 'ARC'), entry('Borealis', 'BOR'),
  // Order, union, brotherhood
  entry('Северный Альянс', 'СЕВЕР'), entry('Орден Саламандры', 'ОРДЕН'), entry('Братство Клинка', 'БРАТ'), entry('Гильдия Навигаторов', 'ГИЛЬД'),
  entry('Союз Свободных Миров', 'ССМ'), entry('Лига Маяков', 'ЛИГА'), entry('Коалиция Восьми', 'КОАЛ'), entry('Ковенант Пламени', 'КОВ'),
  entry('Дом Серебряной Луны', 'ЛУНА'), entry('Часовые Предела', 'ЧАСЫ'), entry('Дозор Окраин', 'ДОЗОР'), entry('Гвардия Чести', 'ГВАРД'),
  entry('Капитул Феникса', 'ФНКС'), entry('Совет Девяти', 'СОВЕТ'), entry('Круг Избранных', 'КРУГ'), entry('Ложа Хранителей', 'ЛОЖА'),
  entry('Сенат Галактики', 'СЕНАТ'), entry('Коллегия Архитекторов', 'КОЛЛ'), entry('Картель Туманности', 'КАРТ'), entry('Директория Восхода', 'ДИР'),
  entry('Дружина Князя', 'ДРУЖ'), entry('Эскадра Возмездия', 'ЭСК'), entry('Рать Великого Пути', 'РАТЬ'), entry('Флотилия Южных Морей', 'ФЛОТ'),
  entry('Корпус Вечной Мерзлоты', 'КОРП'), entry('Ассамблея Систем', 'СИСТ'), entry('Конгломерат Ядра', 'ЯДРО'), entry('Протекторат Сияния', 'ПРОТ'),
  // Adjective and noun
  entry('Пепельный Трон', 'ТРОН'), entry('Алая Заря', 'ЗАРЯ'), entry('Тёмная Материя', 'ТМ'), entry('Стальной Венец', 'ВЕНЕЦ'),
  entry('Небесный Щит', 'ЩИТ'), entry('Последний Рубеж', 'РУБЕЖ'), entry('Красный Горизонт', 'КГ'), entry('Тихая Гавань', 'ТИХАЯ'),
  entry('Хрустальный Шпиль', 'ШПИЛЬ'), entry('Золотой Век', 'ВЕК'), entry('Дети Эфира', 'ЭФИР'), entry('Высокий Замок', 'ЗАМОК'),
  entry('Сизая Мгла', 'МГЛА'), entry('Шёпот Бездны', 'ШЁПОТ'), entry('Длань Судьбы', 'ДЛАНЬ'), entry('Сердце Хаоса', 'СЕРД'),
  entry('Узы Крови', 'УЗЫ'), entry('Клятва Верности', 'КЛЯТВ'), entry('Наследие Древних', 'НАСЛ'), entry('Голос Глубин', 'ГЛУБ'),
  entry('Острие Копья', 'КОПЬЕ'), entry('Алмазный Кулак', 'КУЛАК'), entry('Медный Всадник', 'МЕДЬ'), entry('Надежда', 'НАДЖ'),
  entry('Повелители Времени', 'ВРЕМЯ'), entry('Вольные Торговцы', 'ВТ'), entry('Безымянные', 'БЕЗИМ'), entry('Обитель Покоя', 'ПОКОЙ'),
  entry('Звон Мечей', 'МЕЧИ'), entry('Око Шторма', 'ОКО'), entry('Серые Плащи', 'ПЛАЩ'), entry('Тайная Тропа', 'ТРОПА'),
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
