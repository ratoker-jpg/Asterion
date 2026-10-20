import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignResult } from '../../domain/sun-raid/types.ts';
import { SOLAR_CRYSTAL_IDS } from '../../domain/sun-raid/config.ts';
import { formatPlayTime } from '../../domain/session/slots.ts';
import type { PlayerFactionId } from '../../domain/profile/types.ts';
import { GateArt } from '../sun-raid/SunRaidArt.tsx';
import { GATE_BUILDING_ART } from '../sun-raid/gate-art.ts';
import '../sun-raid/gate.css';
import { raceCard } from './race-catalog.ts';
import './overlays.css';

type PauseMenuProps = {
  slotName: string;
  factionId: PlayerFactionId;
  playTimeMs: number;
  onResume: () => void;
  onSave: () => void;
  onLoad: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
};

/** In-game menu (Esc / ≡): replaces the old one-click «↻» reset. Restarting asks first. */
export function PauseMenu({ slotName, factionId, playTimeMs, onResume, onSave, onLoad, onRestart, onMainMenu }: PauseMenuProps) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  const card = raceCard(factionId);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (confirmRestart) setConfirmRestart(false);
      else onResume();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmRestart, onResume]);

  return createPortal(
    <div className="igo-backdrop" onMouseDown={onResume} data-qa-pause-menu>
      <section className="igo-pause" role="dialog" aria-modal="true" aria-label="Меню игры" onMouseDown={(event) => event.stopPropagation()}>
        <img className="igo-pause__general" src={card.general} alt="" draggable={false} />
        <div className="igo-pause__copy">
          <small>ПАУЗА · {card.name.toUpperCase()}</small>
          <h2>{slotName}</h2>
          <p>Наиграно {formatPlayTime(playTimeMs)} · автосохранение включено</p>
          {confirmRestart ? (
            <div className="igo-confirm" role="alertdialog" aria-label="Начать заново">
              <b>Начать кампанию заново?</b>
              <span>Мир будет создан заново по тем же настройкам и сиду. Весь прогресс этого слота будет потерян.</span>
              <div>
                <button type="button" className="igo-btn igo-btn--danger" onClick={onRestart} data-qa-pause-restart-confirm>НАЧАТЬ ЗАНОВО</button>
                <button type="button" className="igo-btn" onClick={() => setConfirmRestart(false)}>ОТМЕНА</button>
              </div>
            </div>
          ) : (
            <nav className="igo-pause__nav">
              <button ref={firstRef} type="button" className="igo-btn igo-btn--primary" onClick={onResume} data-qa-pause="resume">ПРОДОЛЖИТЬ</button>
              <button type="button" className="igo-btn" onClick={onSave} data-qa-pause="save">СОХРАНИТЬ СЕЙЧАС</button>
              <button type="button" className="igo-btn" onClick={onLoad} data-qa-pause="load">ЗАГРУЗИТЬ ИГРУ</button>
              <button type="button" className="igo-btn igo-btn--danger" onClick={() => setConfirmRestart(true)} data-qa-pause="restart">НАЧАТЬ ЗАНОВО</button>
              <button type="button" className="igo-btn" onClick={onMainMenu} data-qa-pause="menu">В ГЛАВНОЕ МЕНЮ</button>
            </nav>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

type ResultProps = {
  result: CampaignResult;
  factionId: PlayerFactionId;
  playTimeMs: number;
  onStay: () => void;
  onNewGame: () => void;
  onMainMenu: () => void;
};

/** End of the campaign: the Gate is complete. Written to the save before it is shown. */
export function CampaignResultOverlay({ result, factionId, playTimeMs, onStay, onNewGame, onMainMenu }: ResultProps) {
  const card = raceCard(factionId);
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { stayRef.current?.focus(); }, []);
  return createPortal(
    <div className={`igo-result ${result.playerWon ? 'is-victory' : 'is-defeat'}`} role="dialog" aria-modal="true" aria-label={result.playerWon ? 'Победа' : 'Поражение'} data-qa-campaign-result={result.playerWon ? 'victory' : 'defeat'}>
      <div className="igo-result__rays" aria-hidden="true" />
      <div className="igo-result__gate">
        <div className={`gate-hero is-${result.playerWon ? 'completed' : 'destroyed'}`}>
          <GateArt crystals={SOLAR_CRYSTAL_IDS} progress={100} status={result.playerWon ? 'completed' : 'destroyed'} size={420} />
          <img className="gate-hero__building" src={GATE_BUILDING_ART[factionId]} alt="" draggable={false} />
        </div>
      </div>
      {result.playerWon ? <img className="igo-result__general" src={card.general} alt="" draggable={false} /> : null}
      <div className="igo-result__copy">
        <small>ИТОГ КАМПАНИИ</small>
        <h1>{result.playerWon ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}</h1>
        <p>{result.playerWon
          ? `${result.winnerName} достроил Звёздные Врата на планете ${result.hostPlanetName}. Галактика признаёт вашу победу.`
          : `${result.winnerName} достроил Звёздные Врата раньше вас. Кампания завершена.`}</p>
        <dl>
          <div><dt>Держатель Врат</dt><dd>{result.winnerName}</dd></div>
          <div><dt>Глава / планета</dt><dd>{result.hostOwnerName} · {result.hostPlanetName}</dd></div>
          <div><dt>Завершено</dt><dd>{new Date(result.at).toLocaleString('ru-RU')}</dd></div>
          <div><dt>Наиграно</dt><dd>{formatPlayTime(playTimeMs)}</dd></div>
        </dl>
        <div className="igo-result__actions">
          <button ref={stayRef} type="button" className="igo-btn" onClick={onStay} data-qa-result-stay>ОСТАТЬСЯ В МИРЕ</button>
          <button type="button" className="igo-btn igo-btn--primary" onClick={onNewGame} data-qa-result-new>НОВАЯ ИГРА</button>
          <button type="button" className="igo-btn" onClick={onMainMenu}>ГЛАВНОЕ МЕНЮ</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
