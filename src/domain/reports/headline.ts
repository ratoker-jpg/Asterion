import { getFactionCombatEntity, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { getCombatFactionId, isCombatFactionId, type CombatFactionId } from '../combat/factions.ts';
import type { CombatEntityId } from '../combat/ids.ts';
import type { BattleReport, BattleStackSnapshot } from '../combat/report.ts';
import type { SpyReportSnapshot } from '../espionage/types.ts';
import { getStorageCapacities } from '../buildings/balance-v1.ts';
import { lootableAbove } from '../shield/shield.ts';
import type { ReportItem, ReportStatusTone } from './types.ts';

// «Сообщения» v3 (owner, 12.11.2026, concept r5/mail.html): every report opens
// with one big number and a line that explains it, and every list row carries
// one value in the colour of the outcome. Only numbers the game already has;
// nothing is invented.

/** Raid share of a store (application/attack.ts, calculateAttackLoot). */
const RAID_SHARE = 0.75;

export type ReportValue = {
  /** Raw amount, for checks and sorting; absent for a deadline. */
  amount?: number;
  /** What the player reads: «+312 млрд», «−1 600», «до 18:02». */
  text: string;
  tone: ReportStatusTone;
};

export type HeadlineContext = {
  /** True for the player's own owner id. */
  isMine?: (ownerId: string | null | undefined) => boolean;
  /** The player's race: its biggest hold counts the transports a raid needs. */
  playerFactionId?: string;
  /** Buildings of a spied planet (protected part of the stores). */
  targetBuildings?: (planetId: string) => Readonly<Record<string, number>> | undefined;
  /** Attack of all the player's ships, for «их флот сильнее в N раз». */
  ownFleetAttack?: number;
  /** World time the letters are read at. */
  now?: number;
};

export type BattleBalance = {
  /** The player's side, or the attacker's when the player did not fight. */
  side: 'attacker' | 'defender';
  loot: number;
  ownLoss: number;
  enemyLoss: number;
  /** loot − losses from the player's side: defenders lose the loot too. */
  profit: number;
  enemyWiped: boolean;
};

export type SpyRaid = {
  /** What one raid may take: 75 % of each store above its protected part. */
  lootable: number;
  transports?: { count: number; shipName: string };
  /** Attack of the target's fleet and defence the probe saw. */
  targetAttack: number | null;
  /** targetAttack / the player's attack; null when one side is unknown. */
  ratio: number | null;
};

const NBSP = ' ';
const whole = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Non-breaking groups, so a number never breaks mid-digits. */
function group(value: number) {
  return whole.format(value).replace(/\s/g, NBSP);
}

/**
 * Short amount: exact up to 99 999, then «780 тыс», «1,2 млн», «987,7 млрд»,
 * «12 трлн». The unit is glued with a non-breaking space.
 */
export function formatShortAmount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const unit = (divider: number, name: string) => {
    const scaled = abs / divider;
    return `${sign}${(scaled >= 100 ? whole : oneDecimal).format(scaled).replace(/\s/g, NBSP)}${NBSP}${name}`;
  };
  if (abs >= 1e12) return unit(1e12, 'трлн');
  if (abs >= 1e9) return unit(1e9, 'млрд');
  if (abs >= 1e6) return unit(1e6, 'млн');
  if (abs >= 1e5) return unit(1e3, 'тыс');
  return `${sign}${group(abs)}`;
}

/** «+312 млрд», «−47 млрд», «0». */
export function formatSignedAmount(value: number): string {
  if (!value) return '0';
  return value > 0 ? `+${formatShortAmount(value)}` : formatShortAmount(value);
}

export function toneOf(value: number): ReportStatusTone {
  return value > 0 ? 'success' : value < 0 ? 'danger' : 'neutral';
}

export function formatClock(ms: number) {
  return clock.format(new Date(ms));
}

// ---------------------------------------------------------------- battle

/** Battles store the race as an id or its name («Астеры»); pirates have no price list. */
function factionOf(race: string | undefined): CombatFactionId | null {
  if (!race || /pirat|пират/i.test(race)) return null;
  return getCombatFactionId(race);
}

function unitCost(factionId: CombatFactionId | null, entityId: string): number {
  if (!factionId) return 0;
  try {
    const cost = getFactionCombatEntity(factionId, entityId as CombatEntityId).cost;
    return (cost?.metal ?? 0) + (cost?.minerals ?? 0) + (cost?.gas ?? 0);
  } catch {
    return 0;
  }
}

/** What the destroyed units of one side cost (metal + minerals + gas). */
function lossValue(stacks: readonly BattleStackSnapshot[], factionId: CombatFactionId | null) {
  return stacks.reduce((total, stack) => total + Math.max(0, stack.destroyed || 0) * unitCost(stack.factionId ?? factionId, stack.entityId), 0);
}

export function battleBalance(report: BattleReport, isMine?: HeadlineContext['isMine']): BattleBalance {
  const side = isMine?.(report.defender.playerId) && !isMine(report.attacker.playerId) ? 'defender' : 'attacker';
  const loot = Math.max(0, (report.resources?.metal ?? 0) + (report.resources?.minerals ?? 0) + (report.resources?.gas ?? 0));
  const attackerLoss = lossValue([...report.attackerForce.stacks, ...(report.attackerForce.defenses ?? [])], factionOf(report.attacker.race));
  const defenderLoss = lossValue([...report.defenderForce.stacks, ...(report.defenderForce.defenses ?? [])], factionOf(report.defender.race));
  const ownLoss = side === 'attacker' ? attackerLoss : defenderLoss;
  const enemyLoss = side === 'attacker' ? defenderLoss : attackerLoss;
  const enemy = side === 'attacker' ? report.defenderForce : report.attackerForce;
  const enemyUnits = [...enemy.stacks, ...(enemy.defenses ?? [])];
  return {
    side,
    loot,
    ownLoss,
    enemyLoss,
    profit: (side === 'attacker' ? loot : -loot) - ownLoss,
    enemyWiped: report.roundCount > 0 && enemyUnits.length > 0 && enemyUnits.every((stack) => (stack.countAfter ?? 0) <= 0),
  };
}

// ---------------------------------------------------------------- espionage

function biggestHold(factionId: string | undefined) {
  if (!isCombatFactionId(factionId)) return null;
  return getFactionShipCatalog(factionId)
    .filter((ship) => (ship.ship?.cargo ?? 0) > 0)
    .sort((left, right) => (right.ship?.cargo ?? 0) - (left.ship?.cargo ?? 0))[0] ?? null;
}

function attackOf(factionId: string, values: Partial<Record<string, number>> | undefined): number {
  if (!isCombatFactionId(factionId)) return 0;
  return Object.entries(values ?? {}).reduce((total, [id, count]) => {
    if (id === 'spy-probe' || !(Number(count) > 0)) return total;
    try {
      return total + Number(count) * (getFactionCombatEntity(factionId, id as CombatEntityId).combat?.attack ?? 0);
    } catch {
      return total;
    }
  }, 0);
}

export function spyRaid(report: SpyReportSnapshot, context: HeadlineContext = {}): SpyRaid {
  const buildings = context.targetBuildings?.(report.targetPlanetId);
  const capacities = buildings ? getStorageCapacities(buildings) : undefined;
  const lootable = (['metal', 'minerals', 'gas'] as const).reduce((total, key) => {
    const stock = Math.max(0, report.resources[key] || 0);
    const capacity = capacities?.[key];
    return total + Math.floor(Math.min(stock * RAID_SHARE, capacity === undefined ? stock : lootableAbove(stock, capacity)));
  }, 0);
  const hold = biggestHold(context.playerFactionId);
  const cargo = hold?.ship?.cargo ?? 0;
  const seen = report.quality === 'full' ? attackOf(report.targetRaceId, report.fleet) : 0;
  const targetAttack = report.quality === 'basic' ? null : seen + attackOf(report.targetRaceId, report.defense);
  const own = context.ownFleetAttack;
  return {
    lootable,
    ...(hold && cargo > 0 && lootable > 0 ? { transports: { count: Math.ceil(lootable / cargo), shipName: hold.name } } : {}),
    targetAttack,
    ratio: targetAttack != null && own != null && own > 0 ? targetAttack / own : null,
  };
}

/** «2,4 раза», «1,5 раза», «12 раз». */
export function timesLabel(ratio: number) {
  const value = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  const text = oneDecimal.format(value).replace(/\s/g, NBSP);
  if (!Number.isInteger(value)) return `${text}${NBSP}раза`;
  const tens = value % 100;
  const ones = value % 10;
  return `${text}${NBSP}${tens >= 11 && tens <= 14 ? 'раз' : ones >= 2 && ones <= 4 ? 'раза' : 'раз'}`;
}

// ---------------------------------------------------------------- the row value

/** Gas extraction: the gas is the number, the scrap rides along («и ещё 1 200 обломков»). */
export function extractionYield(item: ReportItem): { gas: number; scrap: number } | null {
  const items = item.blocks?.resources?.filter((group) => group.tone === 'gain').flatMap((group) => group.items) ?? [];
  if (!items.length) return null;
  const sum = (kind: string) => items.filter((resource) => resource.kind === kind).reduce((total, resource) => total + resource.value, 0);
  return { gas: sum('gas'), scrap: sum('debris') };
}

function gainOf(item: ReportItem): number | null {
  const groups = item.blocks?.resources?.filter((resourceGroup) => resourceGroup.tone === 'gain') ?? [];
  if (!groups.length) return null;
  return groups.reduce((total, resourceGroup) => total + resourceGroup.items.filter((resource) => resource.kind !== 'energy').reduce((sum, resource) => sum + resource.value, 0), 0);
}

/**
 * The one value a list row shows on the right: the battle profit, what a raid
 * may take, what a flight brought, a letter's reply deadline. Null when the
 * report has no number worth a glance.
 */
export function reportRowValue(item: ReportItem, battle: BattleReport | null | undefined, context: HeadlineContext = {}): ReportValue | null {
  const deadline = item.letter?.deadlineAt;
  if (deadline !== undefined && (context.now === undefined || context.now < deadline)) return { text: `до ${formatClock(deadline)}`, tone: 'warning' };
  if (battle) {
    const balance = battleBalance(battle, context.isMine);
    return { amount: balance.profit, text: formatSignedAmount(balance.profit), tone: toneOf(balance.profit) };
  }
  if (item.spyReport) {
    const raid = spyRaid(item.spyReport, context);
    return { amount: raid.lootable, text: formatShortAmount(raid.lootable), tone: 'info' };
  }
  if (item.spyHunterNotice) return { text: '—', tone: 'danger' };
  if (item.source === 'gas-extraction') {
    const gas = extractionYield(item);
    if (gas) return { amount: gas.gas, text: gas.gas > 0 ? formatSignedAmount(gas.gas) : '0', tone: gas.gas > 0 ? 'success' : 'neutral' };
  }
  const gain = gainOf(item);
  if (gain != null) return { amount: gain, text: gain > 0 ? formatSignedAmount(gain) : '0', tone: gain > 0 ? 'success' : 'neutral' };
  return null;
}
