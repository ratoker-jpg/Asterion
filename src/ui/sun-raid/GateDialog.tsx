import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import gateIcon from '../../../assets/source/mission-icons-v1/29_wormhole_expedition.png';
import { SUN_RAID_CONFIG, SOLAR_CRYSTALS } from '../../domain/sun-raid/config.ts';
import { gateProgressPercent, holderKey } from '../../domain/sun-raid/rules.ts';
import { scaleRuntimeDuration, type RuntimeMode } from '../../domain/runtime/mode.ts';
import type { SaveState } from '../../application/contracts.ts';
import { currentSunRaidState, selectGateContext } from '../../application/sun-raid.ts';
import { CrystalSet, GateArt } from './SunRaidArt.tsx';
import { GATE_BUILDING_ART } from './gate-art.ts';
import './gate.css';

function duration(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours} ч ${String(minutes).padStart(2, '0')} мин` : `${minutes} мин ${String(seconds).padStart(2, '0')} с`;
}

type GateDialogProps = {
  state: SaveState;
  planetId: string;
  now: number;
  mode: RuntimeMode;
  testTimeScale: number;
  onClose: () => void;
  onStart: () => void;
  onTestAssault?: () => void;
  onOpenSuns: () => void;
};

/** «Звёздные Врата» in the military zone: four crystals → 12 h → campaign victory. */
export function GateDialog({ state, planetId, now, mode, testTimeScale, onClose, onStart, onTestAssault, onOpenSuns }: GateDialogProps) {
  const context = selectGateContext(state, now);
  const sunRaid = currentSunRaidState(state);
  const gate = context.gate;
  const building = gate?.status === 'building';
  const progress = gate ? (gate.status === 'completed' ? 100 : gateProgressPercent(gate, now)) : 0;
  const cooldown = sunRaid.gateCooldowns[holderKey(context.holder)];
  const planet = state.planets[planetId];
  const buildTime = scaleRuntimeDuration(SUN_RAID_CONFIG.gateBuildMs, mode, testTimeScale);
  const elsewhere = building && gate.hostPlanetId !== planetId;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const statusLine = !gate
    ? 'Врата не заложены'
    : gate.status === 'building'
      ? `Строятся на ${gate.hostPlanetName} · ${Math.floor(progress)}% · осталось ${duration(gate.completesAt - now)}`
      : gate.status === 'completed'
        ? `Достроены ${new Date(gate.endedAt ?? gate.completesAt).toLocaleString('ru-RU')} — кампания завершена`
        : gate.status === 'destroyed'
          ? `Разрушены (${gate.destroyedBy?.ownerName ?? 'враг'})${gate.destroyedBy?.crystal ? ` · похищен ${SOLAR_CRYSTALS[gate.destroyedBy.crystal].name}` : ''}`
          : 'Стройка отменена';

  return createPortal(
    <div className="gate-backdrop" onMouseDown={onClose}>
      <section className="gate-dialog" role="dialog" aria-modal="true" aria-labelledby="gate-dialog-title" onMouseDown={(event) => event.stopPropagation()} data-qa-gate-dialog={gate?.status ?? 'none'}>
        <button ref={closeRef} type="button" className="gate-close" data-asterion-close aria-label="Закрыть Врата" onClick={onClose}>×</button>
        <div className="gate-dialog__art">
          <div className={`gate-hero is-${gate?.status === 'cancelled' ? 'idle' : gate?.status ?? 'idle'}`}>
            <GateArt crystals={building || gate?.status === 'completed' ? gate!.crystals : context.crystals} progress={progress} status={gate?.status === 'cancelled' ? 'idle' : gate?.status ?? 'idle'} size={380} />
            <img className="gate-hero__building" src={GATE_BUILDING_ART[state.profile.factionId]} alt="" draggable={false} />
          </div>
          <div className="gate-dialog__progress" aria-label={`Прогресс ${Math.floor(progress)}%`}>
            <b>{Math.floor(progress)}%</b>
            <small>{building ? duration(gate.completesAt - now) : gate?.status === 'completed' ? 'ДОСТРОЕНО' : `${duration(buildTime)} стройки`}</small>
          </div>
        </div>
        <div className="gate-dialog__copy">
          <small className="gate-dialog__eyebrow"><img src={gateIcon} alt="" />ВОЕННАЯ ЗОНА · {planet?.name ?? '—'}</small>
          <h2 id="gate-dialog-title">Звёздные Врата</h2>
          <p className="gate-dialog__lead">Четыре разных солнечных кристалла открывают Врата. Достроенные Врата — победа в кампании для их держателя.</p>
          <dl className="gate-dialog__facts">
            <div><dt>Держатель</dt><dd>{context.holderName}</dd></div>
            <div><dt>Статус</dt><dd data-qa-gate-status>{statusLine}</dd></div>
            <div><dt>Время стройки</dt><dd>{duration(buildTime)} · бонусы стройки не ускоряют</dd></div>
            {cooldown && cooldown > now ? <div><dt>Перезапуск</dt><dd>через {duration(cooldown - now)}</dd></div> : null}
          </dl>
          <section className="gate-dialog__crystals">
            <small>КРИСТАЛЛЫ · {context.crystals.length} / 4 {building ? '· заблокированы стройкой' : ''}</small>
            <CrystalSet owned={context.crystals} size={44} locked={building} />
          </section>
          <ul className="gate-dialog__rules">
            <li>Строит глава союза на своей планете; одиночка — на своей, если сам собрал 4 кристалла.</li>
            <li>Глава ушёл — стройка переходит заместителю (или новому главе союза).</li>
            <li>Штурм с разрушением Врат: нападающий забирает 1 кристалл, остальные остаются у держателя.</li>
            <li>Ход стройки (25/50/75/90%) видят все игроки.</li>
          </ul>
          {elsewhere ? <p className="gate-dialog__note">Врата вашего союза строятся на планете {gate.hostPlanetName} ({gate.hostOwnerName}).</p> : null}
          {!building && gate?.status !== 'completed' && context.reason ? <p className="gate-dialog__note" role="note">{context.reason}</p> : null}
          <div className="gate-dialog__actions">
            {!building && gate?.status !== 'completed' ? (
              <button type="button" className="gate-btn gate-btn--primary" disabled={!context.canStart} onClick={onStart} data-qa-gate-start>НАЧАТЬ СТРОИТЕЛЬСТВО</button>
            ) : null}
            <button type="button" className="gate-btn" onClick={onOpenSuns}>РЕЙДЫ НА СОЛНЦА</button>
            {mode === 'test' && building && onTestAssault ? <button type="button" className="gate-btn gate-btn--danger" onClick={onTestAssault} data-qa-gate-test-assault>ТЕСТ: ШТУРМ БОТА 01</button> : null}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
