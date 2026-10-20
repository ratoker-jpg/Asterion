import { SOLAR_CRYSTALS } from '../../domain/sun-raid/config.ts';
import type { BattleReport } from '../../domain/combat/report.ts';
import type { SunReportExtension } from '../../application/sun-raid.ts';
import { CrystalGem, SunOrb } from './SunRaidArt.tsx';
import './sun-raid-art.css';

/** Extra lines of a Sun raid battle report: brightness change and the 70% crystal roll. */
export function SunReportStrip({ report }: { report: BattleReport }) {
  const sun = (report as BattleReport & { sunRaid?: SunReportExtension }).sunRaid;
  if (!sun) return null;
  const roll = sun.crystalRoll;
  const crystalText = !roll
    ? 'Кристалл не разыгрывается: рейд отражён'
    : roll.skipped
      ? 'Все четыре кристалла уже собраны — бросок не проводится'
      : roll.success && roll.crystal
        ? `Кристалл выпал (шанс ${Math.round(roll.chance * 100)}%): ${SOLAR_CRYSTALS[roll.crystal].name}`
        : `Кристалл не выпал (шанс ${Math.round(roll.chance * 100)}%)`;
  return (
    <section className="sun-report-strip" data-qa-sun-report>
      <SunOrb brightness={sun.brightnessAfter} baseEfficiency={Math.max(sun.brightnessBefore, sun.brightnessAfter)} frozen={sun.frozen} size={64} />
      <div>
        <small>РЕЙД НА СОЛНЦЕ [{sun.galaxy}:{String(sun.system).padStart(2, '0')}] · [{sun.allianceTag}] · флотов атаки {sun.attackers}, защиты {sun.defenders}</small>
        <b>Яркость {sun.brightnessBefore}% → {sun.brightnessAfter}%{sun.frozen ? ' · Солнце заморожено' : ''}</b>
        <span>{crystalText}</span>
      </div>
      {roll?.success && roll.crystal ? <CrystalGem id={roll.crystal} size={40} /> : null}
    </section>
  );
}
