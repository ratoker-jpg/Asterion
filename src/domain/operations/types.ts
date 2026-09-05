export const OPERATION_ARCHETYPES = [
  'pirate_elimination',
  'pirate_outpost',
  'unknown_signal',
  'derelict_recovery',
  'anomaly_scan',
] as const;

export type OperationArchetype = (typeof OPERATION_ARCHETYPES)[number];
export type OperationId = string;
export type OperationCategory = 'combat' | 'discovery' | 'exploration' | 'science';
export type OperationState = 'available' | 'active' | 'completed';
export type OperationThreatTier = 1 | 2 | 3 | 4 | 5 | 6;
export type OperationIntelLevel = 0 | 1 | 2 | 3;
export type OperationSource = 'patrol_scan' | 'deep_scan' | 'sensor_network' | 'science_scan';
export type OperationModifier =
  | 'sensor_interference'
  | 'fortified_position'
  | 'unstable_signal'
  | 'ion_storm'
  | 'unknown_contact';

export type OperationLocation =
  | { kind: 'system'; galaxy: number; system: number }
  | { kind: 'coordinates'; coordinates: string }
  | { kind: 'abstract'; label: string };

export type OperationObjective = {
  label: string;
};

export type OperationRewardPreview = {
  metal?: number;
  minerals?: number;
  gas?: number;
  labels?: string[];
};

export type OperationInstance = {
  id: OperationId;
  archetype: OperationArchetype;
  category: OperationCategory;
  title: string;
  briefing: string;
  state: OperationState;
  threat: OperationThreatTier | null;
  threatRange?: [OperationThreatTier, OperationThreatTier];
  intel: OperationIntelLevel;
  source: OperationSource;
  location: OperationLocation;
  objective: OperationObjective;
  modifiers: OperationModifier[];
  rewardPreview: OperationRewardPreview;
  originSignalId?: OperationId;
  battleReportId?: string;
};

export type OperationsState = {
  items: OperationInstance[];
};
