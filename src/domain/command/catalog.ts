import type { AllianceEmblem } from './types.ts';

export const MAX_ALLIANCE_MEMBERS = 15;
export const REAPPLY_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const LEADER_ABSENCE_MS = 24 * 60 * 60 * 1000;
/**
 * `touchMember` writes at most this often per member, so presence never churns the save
 * (every write rewrites the whole save). Far below the 24 h absence threshold.
 */
export const ACTIVITY_TOUCH_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_RESOLVED_APPLICATIONS = 100;
/**
 * Deputy rules (owner request 09.11.2026; every number here is PROPOSED, balance is the owner's call).
 * One deputy per alliance, as before. A deputy is named as soon as the alliance has `DEPUTY_MIN_MEMBERS` members
 * and the candidate has been in it for `DEPUTY_MIN_TENURE_MS`; later the post is re-checked every
 * `DEPUTY_REPICK_INTERVAL_MS`: a challenger whose rank beats the sitting deputy's by `DEPUTY_SWITCH_MARGIN` takes it.
 * Rank = `DEPUTY_WEIGHT_CONTRIBUTION` * (aid delivered / best in the alliance) + `DEPUTY_WEIGHT_POINTS` * (points /
 * best in the alliance). One rule for the player and the bots.
 */
export const DEPUTY_MIN_MEMBERS = 3;
export const DEPUTY_MIN_TENURE_MS = 30 * 60 * 1000;
export const DEPUTY_MIN_DELIVERED_UNITS = 0;
export const DEPUTY_REPICK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEPUTY_SWITCH_MARGIN = 1.25;
export const DEPUTY_WEIGHT_CONTRIBUTION = 0.6;
export const DEPUTY_WEIGHT_POINTS = 0.4;
/** How eagerly a bot leader acts on it: the first appointment is urgent, a re-pick is a routine matter. */
export const DEPUTY_APPOINT_WEIGHT = 0.9;
export const DEPUTY_REPICK_WEIGHT = 0.5;
/** Leavers remembered in the save: a bounded list, the oldest drop first. */
export const MAX_DEPARTURES = 40;

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

/**
 * Test Mode only: Bot 01 (the universe NPC, race Рой) leads its own alliance so
 * diplomacy can be checked against a real second alliance. It is a managed
 * fixture — the bot takes no decisions; Test Mode buttons act for it.
 */
export const TEST_BOT_FIXTURE_ID = 'test-command-bot01-v1' as const;
export const TEST_BOT_ALLIANCE_ID = 'alliance-test-bot01-v1';
/** Same id as the universe NPC owner (`UNIVERSE_NPC_OWNER_ID`). */
export const TEST_BOT_OWNER_ID = 'npc-bot-01';
export const TEST_BOT_DISPLAY_NAME = 'Бот 01';
export const TEST_BOT_ALLIANCE_PROFILE = {
  name: 'Рой Ноктиса',
  tag: 'NOX',
  motto: 'Улей помнит каждого.',
  description: 'Тестовый союз Бота 01 для проверки **дипломатии**: объявления войны и __перемирия__.',
  emblem: { glyph: 'blades', accent: 'crimson', shape: 'hex', field: 'rays', fieldColor: 'crimson' },
} as const;

/** War and truce timing (concept §8): a truce may be offered 3 h after the war began and 3 h after a rejection. */
export const TRUCE_OFFER_DELAY_MS = 3 * 60 * 60 * 1000;
