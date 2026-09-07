import type { AllianceEmblem } from '../command/types.ts';

export type PlayerFactionId = 'aegis' | 'synod' | 'veyra';

export type PlayerProfileAlliance = {
  id: string;
  name: string;
  tag: string;
  emblem: AllianceEmblem;
};

export type PlayerProfileState = {
  playerId: string;
  displayName: string;
  factionId: PlayerFactionId;
  allianceId: string | null;
  alliance: PlayerProfileAlliance | null;
  protectionMode: boolean;
};

