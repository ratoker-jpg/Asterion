import type { BuildAvailability } from './domain/buildings/resource-zone.ts';

const costLabels = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
  energy: 'Энергия',
} as const;

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);

export type QuickUpgradeView = {
  enabled: boolean;
  /** «Улучшить» once the building stands or is queued, «Построить» for an empty slot — the modal's own wording. */
  verb: 'Улучшить' | 'Построить';
  targetLevel: number | null;
  ariaLabel: string;
  title: string;
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
    return {
      enabled: false,
      verb,
      targetLevel,
      ariaLabel: `${buildingName}: максимальный уровень`,
      title: reason ?? 'Достигнут максимальный уровень.',
    };
  }

  const action = `${verb} ${buildingName} до ур. ${targetLevel}`;
  const cost = availability.cost
    ? (Object.keys(costLabels) as (keyof typeof costLabels)[])
      .map((key) => {
        const missing = availability.missing[key];
        return `${costLabels[key]} ${formatNumber(availability.cost?.[key] ?? 0)}${missing ? ` (не хватает ${formatNumber(missing)})` : ''}`;
      })
      .join(' · ')
    : null;
  const status = availability.canBuild ? `Свободно слотов: ${freeSlots}.` : (reason ?? 'Действие недоступно.');
  return {
    enabled: availability.canBuild,
    verb,
    targetLevel,
    ariaLabel: availability.canBuild ? action : `${action}: недоступно. ${status}`,
    title: [action, cost, status].filter(Boolean).join('\n'),
  };
}
