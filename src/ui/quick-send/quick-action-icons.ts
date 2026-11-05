import type { QuickActionId } from '../../application/quick-actions.ts';
import { ACTION_ART } from '../actions/action-art.ts';

/** One round picture per quick action (owner's art set v2). */
export const QUICK_ACTION_ICONS: Record<QuickActionId, string> = {
  colonize: ACTION_ART.colonize,
  gas: ACTION_ART.gas,
  recycle: ACTION_ART.recycle,
  spy: ACTION_ART.espionage,
  attack: ACTION_ART.attack,
  transport: ACTION_ART.transport,
  deployment: ACTION_ART.deployment,
  'exploration-recon': ACTION_ART['probe-explore'],
  expedition: ACTION_ART.expedition,
  'exploration-attack': ACTION_ART['object-attack'],
  'pirate-recon': ACTION_ART['pirate-scout'],
  'pirate-elimination': ACTION_ART['pirate-raid'],
  'pirate-report': ACTION_ART['pirate-report'],
};
