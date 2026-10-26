/**
 * Interface art generated for the polish pass (docs/ui/CODEX_IMAGE_REQUESTS.md).
 * The picked variants live as display-sized WebP in src/assets/ui; the raw
 * 3-variant generations stay in assets/source/New assets/ui (not bundled).
 */
import galaxy01 from '../assets/ui/atlas/galaxy-01.webp';
import galaxy02 from '../assets/ui/atlas/galaxy-02.webp';
import galaxy03 from '../assets/ui/atlas/galaxy-03.webp';
import galaxy04 from '../assets/ui/atlas/galaxy-04.webp';
import galaxy05 from '../assets/ui/atlas/galaxy-05.webp';
import bannerAttack from '../assets/ui/missions/banner-attack.webp';
import bannerTransport from '../assets/ui/missions/banner-transport.webp';
import bannerRecycle from '../assets/ui/missions/banner-recycle.webp';
import bannerGas from '../assets/ui/missions/banner-gas.webp';
import bannerColonize from '../assets/ui/missions/banner-colonize.webp';
import bannerEspionage from '../assets/ui/missions/banner-espionage.webp';
import bannerExpedition from '../assets/ui/missions/banner-expedition.webp';
import bannerDeployment from '../assets/ui/missions/banner-deployment.webp';
import bannerSpaceFlight from '../assets/ui/missions/banner-space-flight.webp';
import bannerAid from '../assets/ui/missions/banner-aid.webp';
import bannerSunSupport from '../assets/ui/missions/banner-sun-support.webp';
import bannerPirateElimination from '../assets/ui/missions/banner-pirate-elimination.webp';
import emptyRepair from '../assets/ui/empty/empty-repair.webp';
import emptyBattles from '../assets/ui/empty/empty-battles.webp';
import emptyFlights from '../assets/ui/empty/empty-flights.webp';
import emptyReports from '../assets/ui/empty/empty-reports.webp';
import medal1 from '../assets/ui/rating/medal-1.webp';
import medal2 from '../assets/ui/rating/medal-2.webp';
import medal3 from '../assets/ui/rating/medal-3.webp';
import ratingBackdrop from '../assets/ui/rating/rating-backdrop.webp';
import settingsScreen from '../assets/ui/settings/screen.webp';
import settingsInterface from '../assets/ui/settings/interface.webp';
import settingsControls from '../assets/ui/settings/controls.webp';
import settingsSound from '../assets/ui/settings/sound.webp';
import settingsNotifications from '../assets/ui/settings/notifications.webp';
import settingsSave from '../assets/ui/settings/save.webp';
import settingsJournal from '../assets/ui/settings/journal.webp';

/** Galaxy N of the atlas uses ATLAS_GALAXIES[(N - 1) % 5]. */
export const ATLAS_GALAXIES = [galaxy01, galaxy02, galaxy03, galaxy04, galaxy05] as const;

/** Cinematic 4:1 banner per mission; the left 40 % is dark for overlaid text. */
export const MISSION_BANNERS: Readonly<Record<string, string>> = {
  attack: bannerAttack,
  'sun-attack': bannerAttack,
  transport: bannerTransport,
  recycle: bannerRecycle,
  gas: bannerGas,
  colonize: bannerColonize,
  espionage: bannerEspionage,
  'pirate-recon': bannerEspionage,
  'exploration-recon': bannerEspionage,
  expedition: bannerExpedition,
  deployment: bannerDeployment,
  'space-flight': bannerSpaceFlight,
  aid: bannerAid,
  'sun-support': bannerSunSupport,
  'pirate-elimination': bannerPirateElimination,
};

export const EMPTY_ART = { repair: emptyRepair, battles: emptyBattles, flights: emptyFlights, reports: emptyReports } as const;

export const RATING_MEDALS = [medal1, medal2, medal3] as const;
export const RATING_BACKDROP = ratingBackdrop;

export const SETTINGS_ICONS: Readonly<Record<string, string>> = {
  screen: settingsScreen,
  interface: settingsInterface,
  controls: settingsControls,
  sound: settingsSound,
  notifications: settingsNotifications,
  save: settingsSave,
  journal: settingsJournal,
};
