export const COMMANDER_IDS = [
  'corsair',
  'hunter',
  'executioner',
  'juggernaut',
  'typhoon',
  'viper',
  'phantom',
  'scorpion',
  'annihilator',
  'reanimator',
  'argo',
  'judge',
  'polias',
] as const;

export type CommanderId = (typeof COMMANDER_IDS)[number];

export type CommanderAbilityDefinition = {
  commanderId: CommanderId;
  commanderName: string;
  ability: string;
  description: string;
  ratePerLevel: string;
  implementationStatus: 'catalog-only';
  note?: string;
};

export const COMMANDER_ABILITIES: Readonly<Record<CommanderId, CommanderAbilityDefinition>> = {
  annihilator: {
    commanderId: 'annihilator',
    commanderName: 'Аннигилятор',
    ability: 'Форсированное разрушение',
    description: 'Увеличивает вероятность разрушения здания или планетарной структуры.',
    ratePerLevel: '+0,5% за уровень',
    implementationStatus: 'catalog-only',
  },
  corsair: {
    commanderId: 'corsair',
    commanderName: 'Корсар',
    ability: 'Форсированное пиратство',
    description: 'Увеличивает возможную добычу в Пиратском рейде.',
    ratePerLevel: '+1,25% за уровень',
    implementationStatus: 'catalog-only',
  },
  reanimator: {
    commanderId: 'reanimator',
    commanderName: 'Реаниматор',
    ability: 'Восстановление',
    description: 'Даёт шанс восстановить потерянные корабли на поле боя.',
    ratePerLevel: '+0,4% за уровень',
    implementationStatus: 'catalog-only',
    note: 'Справка Nemexia также указывает ограничение: до 15 кораблей за ход.',
  },
  viper: {
    commanderId: 'viper',
    commanderName: 'Вайпер',
    ability: 'Критический удар',
    description: 'Увеличивает вероятность критического удара.',
    ratePerLevel: '+0,075% за уровень',
    implementationStatus: 'catalog-only',
  },
  scorpion: {
    commanderId: 'scorpion',
    commanderName: 'Скорпион',
    ability: 'Парализующий',
    description: 'Увеличивает вероятность парализующего эффекта против противника.',
    ratePerLevel: '+0,1% за уровень',
    implementationStatus: 'catalog-only',
  },
  phantom: {
    commanderId: 'phantom',
    commanderName: 'Фантом',
    ability: 'Разрушение',
    description: 'Увеличивает шанс отменить атаку противника.',
    ratePerLevel: '+0,75% за уровень',
    implementationStatus: 'catalog-only',
  },
  hunter: {
    commanderId: 'hunter',
    commanderName: 'Охотник',
    ability: 'Охота',
    description: 'Увеличивает вероятность обнаружения шпионов.',
    ratePerLevel: '+1,75% за уровень',
    implementationStatus: 'catalog-only',
  },
  typhoon: {
    commanderId: 'typhoon',
    commanderName: 'Тайфун',
    ability: 'Форсаж',
    description: 'Увеличивает скорость полёта флота.',
    ratePerLevel: '+0,1% за уровень',
    implementationStatus: 'catalog-only',
  },
  executioner: {
    commanderId: 'executioner',
    commanderName: 'Палач',
    ability: 'Форсированная атака',
    description: 'Увеличивает урон флота.',
    ratePerLevel: '+0,15% за уровень',
    implementationStatus: 'catalog-only',
  },
  juggernaut: {
    commanderId: 'juggernaut',
    commanderName: 'Джаггернаут',
    ability: 'Повышенные жизни',
    description: 'Увеличивает запас жизни кораблей флота.',
    ratePerLevel: '+0,15% за уровень',
    implementationStatus: 'catalog-only',
  },
  argo: {
    commanderId: 'argo',
    commanderName: 'Арго',
    ability: 'Инженерное дело Отступников',
    description: 'Усиливает специальный эффект против Отступников и грузоподъёмность.',
    ratePerLevel: '+1% за уровень',
    implementationStatus: 'catalog-only',
  },
  judge: {
    commanderId: 'judge',
    commanderName: 'Судья',
    ability: 'Наказание',
    description: 'Снижает броню противника.',
    ratePerLevel: '−0,15% брони противника за уровень',
    implementationStatus: 'catalog-only',
  },
  polias: {
    commanderId: 'polias',
    commanderName: 'Полиас',
    ability: 'Patronage',
    description: 'Снижает вероятность разрушения защищаемой планеты.',
    ratePerLevel: '−0,25% вероятности разрушения планеты за уровень',
    implementationStatus: 'catalog-only',
    note: 'В исходном названии Nemexia используется Polias; в Asterion отображается «Полиас».',
  },
};

export const COMMANDER_LIST = COMMANDER_IDS.map((id) => COMMANDER_ABILITIES[id]);

export function isCommanderId(value: unknown): value is CommanderId {
  return typeof value === 'string' && (COMMANDER_IDS as readonly string[]).includes(value);
}
