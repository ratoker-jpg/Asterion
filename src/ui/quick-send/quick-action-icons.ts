import type { QuickActionId } from '../../application/quick-actions.ts';
import missionTransportIcon from '../../../assets/source/mission-icons-v1/01_transport.png';
import missionEspionageIcon from '../../../assets/source/mission-icons-v1/02_espionage.png';
import missionAttackIcon from '../../../assets/source/mission-icons-v1/03_attack.png';
import missionDeploymentIcon from '../../../assets/source/mission-icons-v1/04_deployment.png';
import missionColonizeIcon from '../../../assets/source/mission-icons-v1/05_colonize.png';
import missionRecycleIcon from '../../../assets/source/mission-icons-v1/06_recycle.png';
import missionGasIcon from '../../../assets/source/mission-icons-v1/07_gas_harvest.png';
import missionPirateEliminationIcon from '../../../assets/source/mission-icons-v1/10_pirate_elimination.png';
import missionExpeditionIcon from '../../../assets/source/mission-icons-v1/31_expedition.png';

/** The fleet screen's mission icons, one per quick action. */
export const QUICK_ACTION_ICONS: Record<QuickActionId, string> = {
  colonize: missionColonizeIcon,
  gas: missionGasIcon,
  recycle: missionRecycleIcon,
  spy: missionEspionageIcon,
  attack: missionAttackIcon,
  transport: missionTransportIcon,
  deployment: missionDeploymentIcon,
  'exploration-recon': missionEspionageIcon,
  expedition: missionExpeditionIcon,
  'exploration-attack': missionAttackIcon,
  'pirate-recon': missionEspionageIcon,
  'pirate-elimination': missionPirateEliminationIcon,
  'pirate-report': missionEspionageIcon,
};
