import { useEffect, useRef, useState } from 'react';
import { CAMPAIGN_RESULT_ART } from '../sun-raid/sun-raid-assets.ts';
import { createPortal } from 'react-dom';
import type { CampaignResult } from '../../domain/sun-raid/types.ts';
import { formatPlayTime } from '../../domain/session/slots.ts';
import type { PlayerFactionId } from '../../domain/profile/types.ts';
import '../sun-raid/gate.css';
import { raceCard } from './race-catalog.ts';
import { GameUpdateRow } from './GameUpdateRow.tsx';
import './overlays.css';

type PauseMenuProps = {
  /** `slot`: a production save slot; `test`: the isolated Test Mode save. */
  variant: 'slot' | 'test';
  title: string;
  factionId: PlayerFactionId;
  playTimeMs: number;
  onResume: () => void;
  onSave: () => void;
  onRestart: () => void;
  onLoad?: () => void;
  onMainMenu?: () => void;
  onExport?: () => void;
  testSpeed?: { value: number; options: readonly number[]; onChange: (value: number) => void };
};

/** In-game menu (Esc / ≡): replaces the old one-click «↻» reset. Restarting always asks first. */
export function PauseMenu({ variant, title, factionId, playTimeMs, onResume, onSave, onRestart, onLoad, onMainMenu, onExport, testSpeed }: PauseMenuProps) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  const card = raceCard(factionId);
  const isTest = variant === 'test';
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

  const resetLabel = 'Сбросить текущее тестовое сохранение';
  return createPortal(
    <div className="igo-backdrop" onMouseDown={onResume} data-qa-pause-menu={variant}>
      <section className="igo-pause" role="dialog" aria-modal="true" aria-label="Меню игры" onMouseDown={(event) => event.stopPropagation()}>
        <img className="igo-pause__general" src={card.general} alt="" draggable={false} />
        <div className="igo-pause__copy">
          <small>{isTest ? 'TEST MODE · ' : 'ПАУЗА · '}{card.name.toUpperCase()}</small>
          <h2>{title}</h2>
          <p>{isTest ? 'Изолированное тестовое сохранение · ускоренное время' : `Наиграно ${formatPlayTime(playTimeMs)} · автосохранение включено`}</p>
          {confirmRestart ? (
            <div className="igo-confirm" role="alertdialog" aria-label={isTest ? 'Сбросить тестовое сохранение' : 'Начать заново'}>
              <b>{isTest ? 'Сбросить тестовое сохранение?' : 'Начать кампанию заново?'}</b>
              <span>{isTest
                ? 'Тестовый мир будет пересоздан с новой раскладкой объектов. Производственные слоты не затрагиваются.'
                : 'Мир будет создан заново по тем же настройкам и сиду. Весь прогресс этого слота будет потерян.'}</span>
              <div>
                <button type="button" className="igo-btn igo-btn--danger" onClick={onRestart} data-qa-pause-restart-confirm>{isTest ? 'СБРОСИТЬ' : 'НАЧАТЬ ЗАНОВО'}</button>
                <button type="button" className="igo-btn" onClick={() => setConfirmRestart(false)}>ОТМЕНА</button>
              </div>
            </div>
          ) : (
            <nav className="igo-pause__nav">
              <button ref={firstRef} type="button" className="igo-btn igo-btn--primary" onClick={onResume} data-qa-pause="resume">ПРОДОЛЖИТЬ</button>
              <button type="button" className="igo-btn" onClick={onSave} data-qa-pause="save">СОХРАНИТЬ СЕЙЧАС</button>
              {onLoad ? <button type="button" className="igo-btn" onClick={onLoad} data-qa-pause="load">ЗАГРУЗИТЬ ИГРУ</button> : null}
              {onExport ? <button type="button" className="igo-btn" onClick={onExport} data-qa-pause="export">ЭКСПОРТ СОХРАНЕНИЯ (JSON)</button> : null}
              {testSpeed ? (
                <div className="igo-speed" role="group" aria-label="Скорость тестового времени">
                  <small>УСКОРЕНИЕ ВРЕМЕНИ</small>
                  <div>{testSpeed.options.map((option) => (
                    <button key={option} type="button" className={option === testSpeed.value ? 'is-on' : ''} aria-pressed={option === testSpeed.value} onClick={() => testSpeed.onChange(option)}>×{option}</button>
                  ))}</div>
                </div>
              ) : null}
              {isTest ? (
                <button type="button" className="igo-btn igo-btn--danger" onClick={() => setConfirmRestart(true)} data-qa-pause="restart" data-qa-reset-progress aria-label={resetLabel} title={resetLabel}>СБРОСИТЬ ТЕСТОВОЕ СОХРАНЕНИЕ</button>
              ) : (
                <button type="button" className="igo-btn igo-btn--danger" onClick={() => setConfirmRestart(true)} data-qa-pause="restart">НАЧАТЬ ЗАНОВО</button>
              )}
              {onMainMenu ? <button type="button" className="igo-btn" onClick={onMainMenu} data-qa-pause="menu">{isTest ? 'ВЫЙТИ ИЗ TEST MODE · ГЛАВНОЕ МЕНЮ' : 'В ГЛАВНОЕ МЕНЮ'}</button> : null}
            </nav>
          )}
          {confirmRestart ? null : <GameUpdateRow variant="pause" />}
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
export function CampaignResultOverlay({ result, playTimeMs, onStay, onNewGame, onMainMenu }: ResultProps) {
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { stayRef.current?.focus(); }, []);
  return createPortal(
    <div className={`igo-result ${result.playerWon ? 'is-victory' : 'is-defeat'}`} role="dialog" aria-modal="true" aria-label={result.playerWon ? 'Победа' : 'Поражение'} data-qa-campaign-result={result.playerWon ? 'victory' : 'defeat'}>
      {/* Key art: the activated Gate (victory) or the enemy's Gate over our battered fleet (defeat). */}
      <img className="igo-result__art" src={result.playerWon ? CAMPAIGN_RESULT_ART.victory : CAMPAIGN_RESULT_ART.defeat} alt="" draggable={false} />
      <div className="igo-result__shade" aria-hidden="true" />
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
