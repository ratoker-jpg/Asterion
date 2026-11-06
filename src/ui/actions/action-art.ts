/**
 * Round action pictures (owner's art set v2, 06.11.2026): one full-tile
 * painting per action, readable from 48 px. Sources: assets v2
 * «action-medallions», resized to 192 px webp.
 */
import aid from '../../assets/ui/actions/aid.webp';
import attack from '../../assets/ui/actions/attack.webp';
import colonize from '../../assets/ui/actions/colonize.webp';
import deployment from '../../assets/ui/actions/deployment.webp';
import espionage from '../../assets/ui/actions/espionage.webp';
import expedition from '../../assets/ui/actions/expedition.webp';
import gas from '../../assets/ui/actions/gas.webp';
import objectAttack from '../../assets/ui/actions/object-attack.webp';
import objectCard from '../../assets/ui/actions/object-card.webp';
import pirateRaid from '../../assets/ui/actions/pirate-raid.webp';
import pirateReport from '../../assets/ui/actions/pirate-report.webp';
import pirateScout from '../../assets/ui/actions/pirate-scout.webp';
import probeExplore from '../../assets/ui/actions/probe-explore.webp';
import profile from '../../assets/ui/actions/profile.webp';
import recycle from '../../assets/ui/actions/recycle.webp';
import showOnMap from '../../assets/ui/actions/show-on-map.webp';
import spaceFlight from '../../assets/ui/actions/space-flight.webp';
import sunSupport from '../../assets/ui/actions/sun-support.webp';
import transport from '../../assets/ui/actions/transport.webp';
import atlasAlly from '../../assets/ui/actions/atlas/ally.webp';
import atlasEnemy from '../../assets/ui/actions/atlas/enemy.webp';
import atlasNeutral from '../../assets/ui/actions/atlas/neutral.webp';
import atlasSelf from '../../assets/ui/actions/atlas/self.webp';

export const ACTION_ART = {
  aid, attack, colonize, deployment, espionage, expedition, gas,
  'object-attack': objectAttack, 'object-card': objectCard,
  'pirate-raid': pirateRaid, 'pirate-report': pirateReport, 'pirate-scout': pirateScout,
  'probe-explore': probeExplore, profile, recycle, 'show-on-map': showOnMap,
  'space-flight': spaceFlight, 'sun-support': sunSupport, transport,
} as const;

export type ActionArtId = keyof typeof ACTION_ART;

/** «Звёздный атлас» backdrops, tinted by how the player relates to the owner. */
export const ATLAS_BACKDROPS = { self: atlasSelf, ally: atlasAlly, enemy: atlasEnemy, neutral: atlasNeutral } as const;
