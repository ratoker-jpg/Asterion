import type { CombatFactionId } from './factions.ts';
import type { ShipId } from './ids.ts';

/**
 * The ship production-time columns from
 * ASTERION_BALANCE_V1_TIME_REBALANCED/корабли/{Астеры,Илары,Рой}/00_TIME_REBALANCED.md.
 *
 * These are the published `Новое 2%/шт.` values. They replace only the base
 * ship construction time; the shipyard and industrial-factory factors are
 * applied later by the normal production-duration calculation.
 */
export const FACTION_SHIP_BASE_PRODUCTION_TIMES: Readonly<
  Record<CombatFactionId, Readonly<Record<ShipId, string>>>
> = {
  aegis: {
    'solar-satellite': '00:00:03',
    'spy-probe': '00:00:01',
    transporter: '00:00:12',
    'mega-transporter': '00:00:24',
    colonizer: '00:01:10',
    recycler: '00:00:50',
    scout: '00:00:24',
    cruiser: '00:00:31',
    defender: '00:00:42',
    battleship: '00:01:06',
    destroyer: '00:01:36',
    bomber: '00:01:06',
    'death-star': '03:30:00',
  },
  synod: {
    'solar-satellite': '00:00:03',
    'spy-probe': '00:00:01',
    transporter: '00:00:12',
    'mega-transporter': '00:00:56',
    colonizer: '00:01:10',
    recycler: '00:01:10',
    scout: '00:00:16',
    cruiser: '00:00:22',
    defender: '00:00:49',
    battleship: '00:00:57',
    destroyer: '00:01:30',
    bomber: '00:01:00',
    'death-star': '03:04:30',
  },
  veyra: {
    'solar-satellite': '00:00:03',
    'spy-probe': '00:00:01',
    transporter: '00:00:24',
    'mega-transporter': '00:00:32',
    colonizer: '00:01:10',
    recycler: '00:00:50',
    scout: '00:00:12',
    cruiser: '00:00:09',
    defender: '00:00:21',
    battleship: '00:00:44',
    destroyer: '00:00:54',
    bomber: '00:01:03',
    'death-star': '01:36:00',
  },
};

export const ORDINARY_UPGRADE_SHIP_IDS = [
  'transporter',
  'mega-transporter',
  'scout',
  'cruiser',
  'defender',
  'battleship',
  'destroyer',
  'bomber',
  'death-star',
] as const satisfies readonly ShipId[];

export type OrdinaryUpgradeShipId = (typeof ORDINARY_UPGRADE_SHIP_IDS)[number];

/**
 * The `Время 2%` columns from the same three Time Rebalanced ship files.
 * Array index 0 is the published level 1 transition, i.e. 0 → 1; index 9 is
 * 9 → 10. Utility ships are intentionally absent because they have no
 * published Factory upgrades table.
 */
export const FACTION_SHIP_UPGRADE_TIMES: Readonly<
  Record<CombatFactionId, Readonly<Record<OrdinaryUpgradeShipId, readonly string[]>>>
> = {
  aegis: {
    transporter: ['00:03:00', '00:03:45', '00:04:41', '00:05:52', '00:07:19', '00:09:09', '00:11:27', '00:14:18', '00:17:53', '00:22:21'],
    'mega-transporter': ['00:03:36', '00:04:30', '00:05:38', '00:07:02', '00:08:47', '00:10:59', '00:13:44', '00:17:10', '00:21:27', '00:26:49'],
    scout: ['00:03:00', '00:04:12', '00:05:53', '00:08:14', '00:11:31', '00:16:08', '00:22:35', '00:31:37', '00:44:16', '01:01:59'],
    cruiser: ['00:03:12', '00:04:29', '00:06:16', '00:08:47', '00:12:18', '00:17:13', '00:24:06', '00:33:44', '00:47:14', '01:06:07'],
    defender: ['00:03:24', '00:04:46', '00:06:40', '00:09:20', '00:13:04', '00:18:17', '00:25:36', '00:35:50', '00:50:11', '01:10:15'],
    battleship: ['00:03:36', '00:05:02', '00:07:03', '00:09:53', '00:13:50', '00:19:22', '00:27:06', '00:37:57', '00:53:08', '01:14:23'],
    destroyer: ['00:04:12', '00:05:53', '00:08:14', '00:11:31', '00:16:08', '00:22:35', '00:31:37', '00:44:16', '01:01:59', '01:26:47'],
    bomber: ['00:03:54', '00:05:28', '00:07:39', '00:10:42', '00:14:59', '00:20:59', '00:29:22', '00:41:07', '00:57:33', '01:20:35'],
    'death-star': ['00:12:00', '00:16:48', '00:23:31', '00:32:56', '00:46:06', '01:04:32', '01:30:21', '02:06:30', '02:57:06', '04:07:56'],
  },
  synod: {
    transporter: ['00:03:00', '00:03:45', '00:04:41', '00:05:52', '00:07:19', '00:09:09', '00:11:27', '00:14:18', '00:17:53', '00:22:21'],
    'mega-transporter': ['00:03:36', '00:04:30', '00:05:38', '00:07:02', '00:08:47', '00:10:59', '00:13:44', '00:17:10', '00:21:27', '00:26:49'],
    scout: ['00:03:00', '00:04:12', '00:05:53', '00:08:14', '00:11:31', '00:16:08', '00:22:35', '00:31:37', '00:44:16', '01:01:59'],
    cruiser: ['00:03:12', '00:04:29', '00:06:16', '00:08:47', '00:12:18', '00:17:13', '00:24:06', '00:33:44', '00:47:14', '01:06:07'],
    defender: ['00:03:24', '00:04:46', '00:06:40', '00:09:20', '00:13:04', '00:18:17', '00:25:36', '00:35:50', '00:50:11', '01:10:15'],
    battleship: ['00:03:36', '00:05:02', '00:07:03', '00:09:53', '00:13:50', '00:19:22', '00:27:06', '00:37:57', '00:53:08', '01:14:23'],
    destroyer: ['00:04:12', '00:05:53', '00:08:14', '00:11:31', '00:16:08', '00:22:35', '00:31:37', '00:44:16', '01:01:59', '01:26:47'],
    bomber: ['00:03:54', '00:05:28', '00:07:39', '00:10:42', '00:14:59', '00:20:59', '00:29:22', '00:41:07', '00:57:33', '01:20:35'],
    'death-star': ['00:10:48', '00:15:07', '00:21:10', '00:29:38', '00:41:29', '00:58:05', '01:21:19', '01:53:51', '02:39:23', '03:43:08'],
  },
  veyra: {
    transporter: ['00:03:00', '00:03:45', '00:04:41', '00:05:52', '00:07:19', '00:09:09', '00:11:27', '00:14:18', '00:17:53', '00:22:21'],
    'mega-transporter': ['00:03:36', '00:04:30', '00:05:38', '00:07:02', '00:08:47', '00:10:59', '00:13:44', '00:17:10', '00:21:27', '00:26:49'],
    scout: ['00:02:24', '00:03:22', '00:04:42', '00:06:35', '00:09:13', '00:12:54', '00:18:04', '00:25:18', '00:35:25', '00:49:35'],
    cruiser: ['00:03:00', '00:04:12', '00:05:53', '00:08:14', '00:11:31', '00:16:08', '00:22:35', '00:31:37', '00:44:16', '01:01:59'],
    defender: ['00:03:12', '00:04:29', '00:06:16', '00:08:47', '00:12:18', '00:17:13', '00:24:06', '00:33:44', '00:47:14', '01:06:07'],
    battleship: ['00:03:24', '00:04:46', '00:06:40', '00:09:20', '00:13:04', '00:18:17', '00:25:36', '00:35:50', '00:50:11', '01:10:15'],
    destroyer: ['00:03:36', '00:05:02', '00:07:03', '00:09:53', '00:13:50', '00:19:22', '00:27:06', '00:37:57', '00:53:08', '01:14:23'],
    bomber: ['00:03:36', '00:05:02', '00:07:03', '00:09:53', '00:13:50', '00:19:22', '00:27:06', '00:37:57', '00:53:08', '01:14:23'],
    'death-star': ['00:09:36', '00:13:26', '00:18:49', '00:26:21', '00:36:53', '00:51:38', '01:12:17', '01:41:12', '02:21:41', '03:18:21'],
  },
};

export function parseTimeRebalancedDurationMs(value: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid Time Rebalanced duration: ${value}`);
  const [, hours, minutes, seconds] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1_000;
}
