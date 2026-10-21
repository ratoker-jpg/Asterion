/**
 * Presentation classes of real operation rows: live pirate bases, unique
 * objects and anomalies. The old demo archetypes (raider group, unknown
 * signal) had no mechanics and were removed; old saves drop those records.
 */
export const OPERATION_ARCHETYPES = [
  'pirate_elimination',
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
  battleReportId?: string;
};

export type OperationsState = {
  items: OperationInstance[];
};
