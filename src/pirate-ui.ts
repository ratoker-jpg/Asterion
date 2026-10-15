import type { UniverseCoordinate } from './domain/universe/types.ts';

/** Read-only UI projection of one authoritative pirate contact cycle. */
export type PirateContactPresentation = {
  contactCycleKey: string;
  coordinate: UniverseCoordinate;
  cycleIndex: number;
  expiresAt: number;
  remainingMs: number;
  statusLabel: string;
  statusTone: 'active' | 'inactive';
  recon: {
    enabled: boolean;
    disabledReason: string | null;
  };
  elimination: {
    enabled: boolean;
    disabledReason: string | null;
  };
  latestReportId: string | null;
};

export type PirateSystemSelection = Pick<UniverseCoordinate, 'galaxy' | 'system'>;
