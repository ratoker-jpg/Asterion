import { CURRENT_PLAYER_DISPLAY_NAME, CURRENT_PLAYER_ID } from '../rating/fixtures.ts';
import { CURRENT_COMMAND_ALLIANCE_ID } from '../command/selectors.ts';
import type { AllianceAccent, AllianceEmblemGlyph, AllianceProfile } from '../command/types.ts';
import type { PlayerFactionId, PlayerProfileAlliance, PlayerProfileState } from './types.ts';

const MAX_PROFILE_TEXT = 96;
const FACTION_IDS: readonly PlayerFactionId[] = ['aegis', 'synod', 'veyra'];
const EMBLEM_GLYPHS: readonly AllianceEmblemGlyph[] = ['starforge', 'orbit', 'vanguard'];
const EMBLEM_ACCENTS: readonly AllianceAccent[] = ['cyan', 'amber', 'violet'];
export const CURRENT_PLAYER_FACTION_ID: PlayerFactionId = 'aegis';
export const CURRENT_PLAYER_ALLIANCE_ID = CURRENT_COMMAND_ALLIANCE_ID;

export const PLAYER_FACTION_LABELS: Record<PlayerFactionId, string> = {
  aegis: 'Астеры',
  synod: 'Илары',
  veyra: 'Рой',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_PROFILE_TEXT)
    : fallback;
}

function parseEmblem(value: unknown) {
  if (!isRecord(value)) return null;
  const glyph = value.glyph;
  const accent = value.accent;
  if (!EMBLEM_GLYPHS.includes(glyph as AllianceEmblemGlyph) || !EMBLEM_ACCENTS.includes(accent as AllianceAccent)) return null;
  return { glyph: glyph as AllianceEmblemGlyph, accent: accent as AllianceAccent };
}

function parseAlliance(value: unknown, allianceId: string): PlayerProfileAlliance | null {
  if (!isRecord(value)) return null;
  const id = normalizedText(value.id, allianceId);
  const name = normalizedText(value.name, '');
  const tag = normalizedText(value.tag, '');
  const emblem = parseEmblem(value.emblem);
  if (!name || !tag || !emblem || id !== allianceId) return null;
  return { id, name, tag, emblem };
}

export function createDefaultPlayerProfileState(): PlayerProfileState {
  return {
    playerId: CURRENT_PLAYER_ID,
    displayName: CURRENT_PLAYER_DISPLAY_NAME,
    factionId: CURRENT_PLAYER_FACTION_ID,
    allianceId: null,
    alliance: null,
    protectionMode: false,
  };
}

export function migratePlayerProfileState(value: unknown): PlayerProfileState {
  const defaults = createDefaultPlayerProfileState();
  if (!isRecord(value)) return defaults;

  const playerId = normalizedText(value.playerId, defaults.playerId);
  const displayName = normalizedText(value.displayName, defaults.displayName);
  const factionId = FACTION_IDS.includes(value.factionId as PlayerFactionId)
    ? value.factionId as PlayerFactionId
    : defaults.factionId;
  const candidateAllianceId = normalizedText(value.allianceId, '');
  const alliance = candidateAllianceId ? parseAlliance(value.alliance, candidateAllianceId) : null;

  return {
    playerId,
    displayName,
    factionId,
    allianceId: alliance ? candidateAllianceId : null,
    alliance,
    protectionMode: value.protectionMode === true,
  };
}

export function playerFactionLabel(factionId: PlayerFactionId) {
  return PLAYER_FACTION_LABELS[factionId];
}

export function syncPlayerProfileWithFaction(profile: PlayerProfileState, factionId: PlayerFactionId): PlayerProfileState {
  return { ...profile, factionId };
}

export function syncPlayerProfileWithAlliance(
  profile: PlayerProfileState,
  alliance: Pick<AllianceProfile, 'name' | 'tag' | 'emblem'>,
): PlayerProfileState {
  const name = normalizedText(alliance.name, '');
  const tag = normalizedText(alliance.tag, '');
  if (!name || !tag) return { ...profile, allianceId: null, alliance: null };

  return {
    ...profile,
    allianceId: CURRENT_PLAYER_ALLIANCE_ID,
    alliance: {
      id: CURRENT_PLAYER_ALLIANCE_ID,
      name,
      tag,
      emblem: { glyph: alliance.emblem.glyph, accent: alliance.emblem.accent },
    },
  };
}
