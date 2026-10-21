import type {
  OperationArchetype,
  OperationCategory,
  OperationIntelLevel,
  OperationLocation,
  OperationModifier,
  OperationObjective,
  OperationRewardPreview,
  OperationSource,
  OperationThreatTier,
} from './types.ts';

type OperationDefinition = {
  archetype: OperationArchetype;
  category: OperationCategory;
  title: string;
  briefing: string;
  objective: OperationObjective;
  source: OperationSource;
  location: OperationLocation;
  threat: OperationThreatTier | null;
  threatRange?: [OperationThreatTier, OperationThreatTier];
  intel: OperationIntelLevel;
  modifiers: OperationModifier[];
  rewardPreview: OperationRewardPreview;
};

export const OPERATION_MODIFIER_LABELS: Record<OperationModifier, string> = {
  sensor_interference: 'Помехи сенсоров',
  fortified_position: 'Усиленное боевое построение',
  unstable_signal: 'Нестабильная сигнатура',
  ion_storm: 'Ионные возмущения',
  unknown_contact: 'Неизвестный контакт',
};

export const OPERATION_SOURCE_LABELS: Record<OperationSource, string> = {
  patrol_scan: 'Патрульное сканирование',
  deep_scan: 'Глубокий скан',
  sensor_network: 'Сенсорная сеть',
  science_scan: 'Научное сканирование',
};

export const OPERATION_DEFINITIONS: Record<OperationArchetype, OperationDefinition> = {
  pirate_elimination: {
    archetype: 'pirate_elimination',
    category: 'combat',
    title: 'ПИРАТСКАЯ ЭСКАДРА',
    briefing: 'Патрульные сенсоры обнаружили мобильную пиратскую группу. Контакт подтверждён, противник сохраняет боевой порядок и не покидает систему.',
    objective: { label: 'Уничтожить вражескую эскадру' },
    source: 'patrol_scan',
    location: { kind: 'system', galaxy: 1, system: 7 },
    threat: 3,
    intel: 2,
    modifiers: ['sensor_interference'],
    rewardPreview: {},
  },
  derelict_recovery: {
    archetype: 'derelict_recovery',
    category: 'exploration',
    title: 'ЗАБРОШЕННЫЙ КОРАБЛЬ',
    briefing: 'После глубокого сканирования контакт классифицирован как дрейфующий корабль без подтверждённой активности экипажа. Остаточная энергетическая сигнатура нестабильна.',
    objective: { label: 'Исследовать и обезопасить объект' },
    source: 'deep_scan',
    location: { kind: 'coordinates', coordinates: '[1:12:8]' },
    threat: 2,
    intel: 3,
    modifiers: ['unstable_signal'],
    rewardPreview: {},
  },
  anomaly_scan: {
    archetype: 'anomaly_scan',
    category: 'science',
    title: 'ПРОСТРАНСТВЕННОЕ ИСКАЖЕНИЕ',
    briefing: 'Научные сенсоры зарегистрировали устойчивое локальное искажение. Контакт не классифицирован как противник; уровень отражает риск исследования, а не силу боевой группы.',
    objective: { label: 'Провести дистанционное сканирование искажения' },
    source: 'science_scan',
    location: { kind: 'abstract', label: 'Внешний сектор' },
    threat: 4,
    intel: 3,
    modifiers: ['ion_storm'],
    rewardPreview: {},
  },
};

export function getOperationDefinition(archetype: OperationArchetype) {
  return OPERATION_DEFINITIONS[archetype];
}
