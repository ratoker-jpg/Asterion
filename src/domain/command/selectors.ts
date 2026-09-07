import type { AllianceEmblem, CommandState } from './types.ts';

export const CURRENT_COMMAND_ALLIANCE_ID = 'alliance-current';

export type CurrentAllianceIdentity = {
  id: string;
  name: string;
  tag: string;
  emblem: AllianceEmblem;
  glyph: AllianceEmblem['glyph'];
};

export function selectCurrentAlliance(state: Pick<CommandState, 'alliance'>): CurrentAllianceIdentity {
  const alliance = state.alliance;
  const emblem = { glyph: alliance.emblem.glyph, accent: alliance.emblem.accent };

  return {
    id: CURRENT_COMMAND_ALLIANCE_ID,
    name: alliance.name.trim(),
    tag: alliance.tag.trim().toUpperCase(),
    emblem,
    glyph: emblem.glyph,
  };
}
