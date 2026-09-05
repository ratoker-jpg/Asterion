import type {
  OperationArchetype,
  OperationCategory,
  OperationInstance,
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
  fortified_position: 'Усиленная позиция',
  unstable_signal: 'Нестабильный сигнал',
  ion_storm: 'Ионная буря',
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
    briefing: 'Сенсоры обнаружили враждебную эскадру в пределах системы.',
    objective: { label: 'Уничтожить вражескую эскадру' },
    source: 'patrol_scan',
    location: { kind: 'system', galaxy: 1, system: 7 },
    threat: 3,
    intel: 2,
    modifiers: ['sensor_interference'],
    rewardPreview: { metal: 2100, minerals: 900, gas: 300 },
  },
  pirate_outpost: {
    archetype: 'pirate_outpost',
    category: 'combat',
    title: 'ПИРАТСКИЙ ОПОРНЫЙ ПУНКТ',
    briefing: 'Обнаружена укреплённая враждебная позиция. Боевые параметры позиции пока не изменяют resolver.',
    objective: { label: 'Ликвидировать опорный пункт' },
    source: 'sensor_network',
    location: { kind: 'system', galaxy: 1, system: 12 },
    threat: 5,
    intel: 3,
    modifiers: ['fortified_position'],
    rewardPreview: { metal: 4200, minerals: 2200, gas: 900 },
  },
  unknown_signal: {
    archetype: 'unknown_signal',
    category: 'discovery',
    title: 'НЕИЗВЕСТНЫЙ СИГНАЛ',
    briefing: '',
    objective: { label: '' },
    source: 'deep_scan',
    location: { kind: 'abstract', label: 'Глубокий космос' },
    threat: null,
    threatRange: [2, 4],
    intel: 0,
    modifiers: ['unknown_contact', 'unstable_signal'],
    rewardPreview: {},
  },
  derelict_recovery: {
    archetype: 'derelict_recovery',
    category: 'exploration',
    title: 'ЗАБРОШЕННЫЙ КОРАБЛЬ',
    briefing: 'Сигнал классифицирован как заброшенный корабль. Объект доступен для дальнейшей операции.',
    objective: { label: 'Исследовать и обезопасить объект' },
    source: 'deep_scan',
    location: { kind: 'coordinates', coordinates: '[1:12:8]' },
    threat: 2,
    intel: 3,
    modifiers: ['unstable_signal'],
    rewardPreview: { metal: 1400, minerals: 1600, gas: 700 },
  },
  anomaly_scan: {
    archetype: 'anomaly_scan',
    category: 'science',
    title: 'ПРОСТРАНСТВЕННАЯ АНОМАЛИЯ',
    briefing: 'Сенсоры зарегистрировали устойчивое пространственное искажение, доступное для исследования.',
    objective: { label: 'Провести сканирование аномалии' },
    source: 'science_scan',
    location: { kind: 'abstract', label: 'Внешний сектор' },
    threat: 4,
    intel: 3,
    modifiers: ['ion_storm'],
    rewardPreview: { minerals: 1800, gas: 1200, labels: ['Исследовательские данные'] },
  },
};

function cloneLocation(location: OperationLocation): OperationLocation {
  if (location.kind === 'system') return { ...location };
  if (location.kind === 'coordinates') return { ...location };
  return { ...location };
}

function cloneReward(reward: OperationRewardPreview): OperationRewardPreview {
  return {
    ...reward,
    labels: reward.labels ? [...reward.labels] : undefined,
  };
}

function instantiate(id: string, archetype: OperationArchetype): OperationInstance {
  const definition = OPERATION_DEFINITIONS[archetype];
  return {
    id,
    archetype,
    category: definition.category,
    title: definition.title,
    briefing: definition.briefing,
    state: 'available',
    threat: definition.threat,
    threatRange: definition.threatRange ? [...definition.threatRange] : undefined,
    intel: definition.intel,
    source: definition.source,
    location: cloneLocation(definition.location),
    objective: { ...definition.objective },
    modifiers: [...definition.modifiers],
    rewardPreview: cloneReward(definition.rewardPreview),
  };
}

export function createDefaultOperationInstances(): OperationInstance[] {
  return [
    instantiate('op-pirate-patrol-01', 'pirate_elimination'),
    instantiate('op-pirate-outpost-01', 'pirate_outpost'),
    instantiate('op-signal-derelict-01', 'unknown_signal'),
    instantiate('op-anomaly-01', 'anomaly_scan'),
  ];
}

export function createDerelictReveal(signalId: string): OperationInstance {
  const revealed = instantiate(signalId, 'derelict_recovery');
  return {
    ...revealed,
    originSignalId: signalId,
  };
}

export function getOperationDefinition(archetype: OperationArchetype) {
  return OPERATION_DEFINITIONS[archetype];
}
