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

import type { CommanderAbilityTraits } from './types.ts';

export type CommanderAbilityDefinition = CommanderAbilityTraits & {
  commanderId: CommanderId;
  commanderName: string;
  implementationStatus: 'implemented' | 'catalog-only';
  note?: string;
};

export type CommanderCombatEffectKind =
  | 'attack-bonus'
  | 'life-bonus'
  | 'armor-debuff'
  | 'critical'
  | 'paralyze'
  | 'cancel-attack'
  | 'reanimator';

export type CommanderCombatEffect = {
  kind: CommanderCombatEffectKind;
  ratePerLevel: number;
  cap?: number;
  status: 'confirmed' | 'inferred';
  note: string;
};

export const COMMANDER_ABILITIES: Readonly<Record<CommanderId, CommanderAbilityDefinition>> = {
  annihilator: {
    commanderId: 'annihilator',
    commanderName: 'Аннигилятор',
    ability: 'Форсированное разрушение',
    description: 'Увеличивает шанс уничтожить здание противника.',
    ratePerLevel: '+0,5% за уровень',
    implementationStatus: 'catalog-only',
  },
  corsair: {
    commanderId: 'corsair',
    commanderName: 'Корсар',
    ability: 'Форсированное пиратство',
    description: 'Увеличивает возможный процент украденных ресурсов за Пиратский рейд.',
    ratePerLevel: '+1,25% за уровень',
    implementationStatus: 'catalog-only',
  },
  reanimator: {
    commanderId: 'reanimator',
    commanderName: 'Реаниматор',
    ability: 'Восстановление',
    description: 'Даёт шанс восстановить потерянные корабли прямо на поле боя.',
    ratePerLevel: '+0,4% за уровень',
    implementationStatus: 'implemented',
    note: 'Справка Nemexia также указывает ограничение: до 15 кораблей за ход.',
  },
  viper: {
    commanderId: 'viper',
    commanderName: 'Вайпер',
    ability: 'Критический удар',
    description: 'Увеличивает вероятность критического удара.',
    ratePerLevel: '+0,075% за уровень',
    implementationStatus: 'implemented',
  },
  scorpion: {
    commanderId: 'scorpion',
    commanderName: 'Скорпион',
    ability: 'Парализующий',
    description: 'Увеличивает шанс парализовать корабли противника.',
    ratePerLevel: '+0,1% за уровень',
    implementationStatus: 'implemented',
  },
  phantom: {
    commanderId: 'phantom',
    commanderName: 'Фантом',
    ability: 'Разрушение',
    description: 'Даёт шанс отменить атаку противника.',
    ratePerLevel: '+0,75% за уровень',
    implementationStatus: 'implemented',
  },
  hunter: {
    commanderId: 'hunter',
    commanderName: 'Охотник',
    ability: 'Охота',
    description: 'Увеличивает шанс обнаружить вражеских шпионов.',
    ratePerLevel: '+1,75% за уровень',
    implementationStatus: 'catalog-only',
  },
  typhoon: {
    commanderId: 'typhoon',
    commanderName: 'Тайфун',
    ability: 'Форсаж',
    description: 'Увеличивает скорость полёта.',
    ratePerLevel: '+0,1% за уровень',
    implementationStatus: 'catalog-only',
  },
  executioner: {
    commanderId: 'executioner',
    commanderName: 'Палач',
    ability: 'Форсированная атака',
    description: 'Увеличивает урон от атаки флота.',
    ratePerLevel: '+0,15% за уровень',
    implementationStatus: 'implemented',
  },
  juggernaut: {
    commanderId: 'juggernaut',
    commanderName: 'Джаггернаут',
    ability: 'Повышенные жизни',
    description: 'Увеличивает жизненные очки кораблей флота.',
    ratePerLevel: '+0,15% за уровень',
    implementationStatus: 'implemented',
  },
  argo: {
    commanderId: 'argo',
    commanderName: 'Арго',
    ability: 'Инженерное дело Отступников',
    description: 'Даёт дополнительные очки усовершенствования в боях с Отступниками и увеличивает грузоподъёмность кораблей.',
    ratePerLevel: '+1% за уровень',
    implementationStatus: 'catalog-only',
  },
  judge: {
    commanderId: 'judge',
    commanderName: 'Судья',
    ability: 'Наказание',
    description: 'Уменьшает показатель брони всех вражеских юнитов.',
    ratePerLevel: '−0,15% брони противника за уровень',
    implementationStatus: 'implemented',
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

export const COMMANDER_COMBAT_EFFECTS: Readonly<Partial<Record<CommanderId, CommanderCombatEffect>>> = {
  executioner: { kind: 'attack-bonus', ratePerLevel: 0.0015, status: 'confirmed', note: '+0.15% атаки всех своих боевых стеков за уровень.' },
  juggernaut: { kind: 'life-bonus', ratePerLevel: 0.0015, status: 'confirmed', note: '+0.15% жизни всех своих боевых стеков за уровень.' },
  judge: { kind: 'armor-debuff', ratePerLevel: 0.0015, status: 'confirmed', note: '−0.15 процентного пункта брони вражеских сущностей за уровень.' },
  viper: { kind: 'critical', ratePerLevel: 0.00075, status: 'confirmed', note: '+0.075% шанса критического залпа за уровень.' },
  scorpion: { kind: 'paralyze', ratePerLevel: 0.001, status: 'confirmed', note: '+0.1% шанса парализовать ближайшую атаку цели за уровень.' },
  phantom: { kind: 'cancel-attack', ratePerLevel: 0.0075, status: 'inferred', note: '+0.75% шанса отменить ближайшую атаку цели за уровень.' },
  reanimator: { kind: 'reanimator', ratePerLevel: 0.004, cap: 15, status: 'inferred', note: '+0.4% шанса восстановить до 15 кораблей в конце своей фазы.' },
};

export function getCommanderCombatEffect(id: CommanderId | null | undefined) {
  return id ? COMMANDER_COMBAT_EFFECTS[id] ?? null : null;
}

export const COMMANDER_LIST = COMMANDER_IDS.map((id) => COMMANDER_ABILITIES[id]);

/**
 * Numeric per-level rates (in percent) behind the localized ratePerLevel
 * strings. Needed by tooltips that show the computed figure
 * (rate × level), e.g. Hunter 20 → «+35% (1,75% × 20)».
 */
export const COMMANDER_ABILITY_NUMERIC_RATES: Readonly<Record<CommanderId, number>> = {
  annihilator: 0.5,
  corsair: 1.25,
  reanimator: 0.4,
  viper: 0.075,
  scorpion: 0.1,
  phantom: 0.75,
  hunter: 1.75,
  typhoon: 0.1,
  executioner: 0.15,
  juggernaut: 0.15,
  argo: 1,
  judge: -0.15,
  polias: -0.25,
};

const EFFECT_PERCENT_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

function signedPercent(value: number): string {
  const formatted = EFFECT_PERCENT_FORMAT.format(Math.abs(value));
  if (value > 0) return `+${formatted}%`;
  if (value < 0) return `−${formatted}%`;
  return `0%`;
}

/**
 * Human-readable computed ability figure for a commander at a given level:
 * «+35% (1,75% × 20)». Negative rates (armor debuff, planet protection)
 * keep their sign in both the rate and the total.
 */
export function formatCommanderAbilityEffect(id: CommanderId, level: number): string {
  const rate = COMMANDER_ABILITY_NUMERIC_RATES[id] ?? 0;
  const safeLevel = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0));
  return `${signedPercent(rate * safeLevel)} (${signedPercent(rate)} × ${safeLevel})`;
}

export function isCommanderId(value: unknown): value is CommanderId {
  return typeof value === 'string' && (COMMANDER_IDS as readonly string[]).includes(value);
}
