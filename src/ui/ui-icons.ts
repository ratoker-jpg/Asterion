/**
 * Report and score icons in the unified icon style (docs/art/STYLE.md, icons v2).
 * Same keys as `asterionAssetIntegrationAssets.reportIcons` / `.scoreIcons`, which still
 * hold the previous dark engraved set; every screen takes these instead so one menu never
 * mixes the two styles. Runtime WebP 96 px under public/assets/generated/ui-icons-v2/
 * (file names kept from the old set), sources in assets/source/ui/icons-v2/r-*.png, s-*.png.
 */
const BASE = './assets/generated/ui-icons-v2/';
const report = (file: string) => `${BASE}report-icons/${file}.webp`;
const score = (file: string) => `${BASE}score-icons/${file}.webp`;

export const REPORT_ICONS = {
  achievements: report('achievements'),
  alliances: report('alliances'),
  arena: report('arena'),
  battle: report('reports'),
  command: report('command-reports'),
  flights: report('flights'),
  profile: report('profile'),
  system: report('system'),
} as const;

export const SCORE_ICONS = {
  achievementPoints: score('achievement-trophy'),
  battlePoints: score('battle'),
  resourcePoints: score('resource-crystal'),
  totalPoints: score('overall-star'),
} as const;

export type ReportIconKey = keyof typeof REPORT_ICONS;
export type ScoreIconKey = keyof typeof SCORE_ICONS;
