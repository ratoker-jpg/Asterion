import type { AllianceIdentity, AllianceRatingEntry, PlayerRatingEntry } from './types.ts';

const CALLSIGNS = ['Vega', 'Orion', 'Helios', 'Nyx', 'Astra', 'Kepler', 'Titan', 'Nova', 'Cygnus', 'Draco', 'Altair', 'Rigel'];
const ALLIANCE_TAGS = ['ARC', 'NEX', 'VOID', 'AUR', 'ION', 'HEX', 'SOL', 'DRK'];

export const CURRENT_PLAYER_ID = 'player-current';

export function createPlayerRatingEntries(): PlayerRatingEntry[] {
  return Array.from({ length: 84 }, (_, index) => {
    const standing = index + 1;
    const resourcePoints = 1_150_000 - index * 8_170;
    const battlePoints = 610_000 - index * 3_910;
    const isCurrentPlayer = standing === 37;
    return {
      id: isCurrentPlayer ? CURRENT_PLAYER_ID : `player-${String(standing).padStart(3, '0')}`,
      rank: standing,
      name: isCurrentPlayer ? 'Aster Prime' : `${CALLSIGNS[index % CALLSIGNS.length]}-${String(standing).padStart(2, '0')}`,
      race: (['aster', 'cyber', 'xeno'] as const)[index % 3],
      allianceTag: standing % 7 === 0 ? null : ALLIANCE_TAGS[index % ALLIANCE_TAGS.length],
      achievementPoints: Math.max(0, 98_000 - index * 713),
      resourcePoints,
      battlePoints,
      totalPoints: resourcePoints + battlePoints,
      isCurrentPlayer,
    };
  });
}

export function createAllianceRatingEntries(currentAlliance?: AllianceIdentity | null): AllianceRatingEntry[] {
  const base = Array.from({ length: 42 }, (_, index): AllianceRatingEntry => {
    const standing = index + 1;
    const alliancePoints = 420_000 - index * 6_270;
    const totalPoints = 9_800_000 - index * 122_500;
    return {
      id: `alliance-${String(standing).padStart(3, '0')}`,
      rank: standing,
      name: `${['Astral Concord', 'Void Assembly', 'Ion Pact', 'Helix Union', 'Solar Guard', 'Nexus Ring'][index % 6]} ${standing}`,
      tag: ALLIANCE_TAGS[index % ALLIANCE_TAGS.length],
      level: Math.max(1, 18 - Math.floor(index / 3)),
      alliancePoints,
      totalPoints,
      isCurrentAlliance: false,
    };
  });

  if (!currentAlliance?.name?.trim() || !currentAlliance.tag?.trim()) return base;
  const slot = 15;
  return base.map((entry, index) => index === slot
    ? { ...entry, id: 'alliance-current', name: currentAlliance.name.trim(), tag: currentAlliance.tag.trim(), isCurrentAlliance: true }
    : entry);
}
