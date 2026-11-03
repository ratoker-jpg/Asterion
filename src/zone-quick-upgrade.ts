import type { BuildAvailability } from './domain/buildings/resource-zone.ts';

const costLabels = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
  energy: 'Энергия',
} as const;

export type QuickCostKey = keyof typeof costLabels;

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);

export type QuickUpgradeCost = {
  key: QuickCostKey;
  label: string;
  amount: number;
  /** How much the player is short of; 0 when there is enough. */
  missing: number;
};

export type QuickUpgradeView = {
  enabled: boolean;
  /** «Улучшить» once the building stands or is queued, «Построить» for an empty slot — the modal's own wording. */
  verb: 'Улучшить' | 'Построить';
  targetLevel: number | null;
  ariaLabel: string;
  /** Action headline for the tooltip, e.g. «Улучшить до ур. 16». */
  heading: string;
  /** Non-zero costs of the next level. */
  costs: QuickUpgradeCost[];
  /** The tooltip's last line: free slots when allowed, otherwise the reason. */
  status: string;
  /** Plain-text version of the whole tooltip (one line per block). */
  summary: string;
};

/**
 * Text for the quick «+» button on a building tile. It only reads the same
 * evaluateBuildingBuild() result the building dialog shows; queueing still goes
 * through the dialog's onBuild command, so no game rule lives here.
 * `reason` is the availability reason already localized for the player's race.
 */
export function describeQuickUpgrade(
  buildingName: string,
  availability: BuildAvailability,
  freeSlots: number,
  reason: string | null = availability.reason,
): QuickUpgradeView {
  const verb = availability.currentLevel > 0 || availability.projectedLevel > 0 ? 'Улучшить' : 'Построить';
  const targetLevel = availability.nextLevel;
  if (targetLevel == null) {
    const status = reason ?? 'Достигнут максимальный уровень.';
    return {
      enabled: false,
      verb,
      targetLevel,
      ariaLabel: `${buildingName}: максимальный уровень`,
      heading: 'Максимальный уровень',
      costs: [],
      status,
      summary: status,
    };
  }

  const action = `${verb} ${buildingName} до ур. ${targetLevel}`;
  const costs: QuickUpgradeCost[] = availability.cost
    ? (Object.keys(costLabels) as QuickCostKey[])
      .map((key) => ({ key, label: costLabels[key], amount: availability.cost?.[key] ?? 0, missing: availability.missing[key] ?? 0 }))
      .filter((cost) => cost.amount > 0)
    : [];
  const costLine = costs
    .map((cost) => `${cost.label} ${formatNumber(cost.amount)}${cost.missing ? ` (не хватает ${formatNumber(cost.missing)})` : ''}`)
    .join(' · ');
  const status = availability.canBuild ? `Свободно слотов: ${freeSlots}.` : (reason ?? 'Действие недоступно.');
  return {
    enabled: availability.canBuild,
    verb,
    targetLevel,
    ariaLabel: availability.canBuild ? action : `${action}: недоступно. ${status}`,
    heading: `${verb} до ур. ${targetLevel}`,
    costs,
    status,
    summary: [action, costLine, status].filter(Boolean).join('\n'),
  };
}

export const formatQuickAmount = formatNumber;
