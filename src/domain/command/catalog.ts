import type { AllianceEmblem } from './types.ts';

export const MAX_ALLIANCE_MEMBERS = 15;
export const REAPPLY_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const LEADER_ABSENCE_MS = 24 * 60 * 60 * 1000;
/** `touchMember` writes at most this often per member so a 1 s UI clock does not churn the save. */
export const ACTIVITY_TOUCH_INTERVAL_MS = 60 * 1000;
export const MAX_RESOLVED_APPLICATIONS = 100;

export const ALLIANCE_NAME_MIN = 3;
export const ALLIANCE_NAME_MAX = 42;
export const ALLIANCE_TAG_MIN = 2;
export const ALLIANCE_TAG_MAX = 8;
export const ALLIANCE_MOTTO_MAX = 72;
export const ALLIANCE_DESCRIPTION_MAX = 220;

export const DEFAULT_ALLIANCE_EMBLEM: AllianceEmblem = { glyph: 'starforge', accent: 'cyan' };

/** Identifies the Test Mode seed alliance. Production saves drop any record carrying this marker. */
export const TEST_COMMAND_DEFAULT_FIXTURE_ID = 'test-command-default-v1' as const;
export const TEST_FIXTURE_ALLIANCE_ID = 'alliance-test-helion-v1';

/** Managed Test Mode ally. Its owner id is shared with the universe ally-planet fixture. */
export const TEST_ALLY_OWNER_ID = 'member-ira-vel';
export const TEST_ALLY_DISPLAY_NAME = 'Ира Вель';

export const TEST_FIXTURE_ALLIANCE_PROFILE = {
  name: 'Содружество Гелион',
  tag: 'HLN',
  motto: 'Единый курс. Общая орбита.',
  description: 'Тестовый союз для проверки Командования. Состав: игрок и Ира Вель.',
  emblem: DEFAULT_ALLIANCE_EMBLEM,
} as const;
