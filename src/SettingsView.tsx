import { useEffect, useState, type ReactNode } from 'react';

import {
  applyDesktopPreferences,
  getDesktopDisplaySettings,
  isDesktopBridgeAvailable,
  subscribeDesktopDisplaySettings,
  type DesktopDisplaySettings,
} from './domain/settings/desktop.ts';
import {
  ASTERION_CAMPAIGN_KEY,
  ASTERION_PREFERENCES_KEY,
  DEFAULT_PREFERENCES,
  TEXT_SCALES,
  WINDOW_RESOLUTIONS,
  type AsterionPreferences,
} from './domain/settings/preferences.ts';
import './settings.css';

type SettingsSection = 'screen' | 'interface' | 'controls' | 'sound' | 'notifications' | 'system';

const SECTION_META: ReadonlyArray<{ id: SettingsSection; label: string; sub: string }> = [
  { id: 'screen', label: 'ЭКРАН', sub: 'Окно и разрешение' },
  { id: 'interface', label: 'ИНТЕРФЕЙС', sub: 'Текст, подсказки, анимации' },
  { id: 'controls', label: 'УПРАВЛЕНИЕ', sub: 'Текущие сочетания' },
  { id: 'sound', label: 'ЗВУК', sub: 'Резерв системы' },
  { id: 'notifications', label: 'УВЕДОМЛЕНИЯ', sub: 'Резерв системы' },
  { id: 'system', label: 'СОХРАНЕНИЕ / СИСТЕМА', sub: 'Хранилище и сброс' },
];

function SectionIcon({ id }: { id: SettingsSection }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (id === 'screen') return <svg viewBox="0 0 28 28" aria-hidden="true"><rect {...common} x="3" y="5" width="22" height="15" rx="1"/><path {...common} d="M9 24h10M14 20v4"/></svg>;
  if (id === 'interface') return <svg viewBox="0 0 28 28" aria-hidden="true"><rect {...common} x="4" y="4" width="20" height="20"/><path {...common} d="M4 10h20M10 10v14M13 14h7M13 18h5"/></svg>;
  if (id === 'controls') return <svg viewBox="0 0 28 28" aria-hidden="true"><circle {...common} cx="14" cy="14" r="9"/><circle {...common} cx="14" cy="14" r="3"/><path {...common} d="M14 2v5M14 21v5M2 14h5M21 14h5"/></svg>;
  if (id === 'sound') return <svg viewBox="0 0 28 28" aria-hidden="true"><path {...common} d="M5 12h5l6-5v14l-6-5H5v-4Z"/><path {...common} d="M20 10c2 2 2 6 0 8M23 7c4 4 4 10 0 14"/></svg>;
  if (id === 'notifications') return <svg viewBox="0 0 28 28" aria-hidden="true"><path {...common} d="M7 20h14l-2-3V12a5 5 0 0 0-10 0v5l-2 3ZM11 23h6"/></svg>;
  return <svg viewBox="0 0 28 28" aria-hidden="true"><path {...common} d="M6 4h13l3 3v17H6V4Z"/><path {...common} d="M10 4v7h8V4M10 19h8"/></svg>;
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="settings-panel"><header><div><small>ASTERION PREFERENCES</small><h2>{title}</h2></div>{note ? <span>{note}</span> : null}</header><div className="settings-panel__body">{children}</div></section>;
}

function Toggle({ value, onChange, onLabel = 'ВКЛ', offLabel = 'ВЫКЛ' }: { value: boolean; onChange: (value: boolean) => void; onLabel?: string; offLabel?: string }) {
  return <div className="settings-toggle" role="group"><button type="button" className={value ? 'active' : ''} onClick={() => onChange(true)}>{onLabel}</button><button type="button" className={!value ? 'active' : ''} onClick={() => onChange(false)}>{offLabel}</button></div>;
}

function ReservedBlock({ title, body }: { title: string; body: string }) {
  return <div className="settings-reserved"><span>RESERVED</span><strong>{title}</strong><p>{body}</p></div>;
}

export function SettingsView({ preferences, onChange, onReset }: {
  preferences: AsterionPreferences;
  onChange: (next: AsterionPreferences) => void;
  onReset: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>('screen');
  const [desktopState, setDesktopState] = useState<DesktopDisplaySettings | null>(null);
  const desktopAvailable = isDesktopBridgeAvailable();

  useEffect(() => {
    let cancelled = false;
    void getDesktopDisplaySettings().then((value) => { if (!cancelled) setDesktopState(value); });
    const unsubscribe = subscribeDesktopDisplaySettings((value) => {
      if (!cancelled) setDesktopState(value);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [desktopAvailable]);

  const patch = (next: Partial<AsterionPreferences>) => onChange({ ...preferences, ...next });
  const handleReset = () => {
    onReset();
    if (!desktopAvailable) return;
    void applyDesktopPreferences({ ...DEFAULT_PREFERENCES }, { force: true }).then((result) => {
      if (result.settings) setDesktopState(result.settings);
    });
  };

  return (
    <main className="settings-view">
      <header className="utility-view-heading">
        <div><small>СИСТЕМНЫЙ КОНТУР</small><h1>НАСТРОЙКИ</h1><p>Рабочие параметры устройства и интерфейса. Доступные изменения применяются сразу.</p></div>
        <div className={`utility-truth-badge ${desktopAvailable ? 'ready' : 'limited'}`}><i />{desktopAvailable ? 'DESKTOP BRIDGE' : 'WEB PREVIEW'}</div>
      </header>

      <div className="settings-layout">
        <aside className="settings-nav">
          {SECTION_META.map((item) => <button key={item.id} type="button" className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><span><SectionIcon id={item.id} /></span><div><strong>{item.label}</strong><small>{item.sub}</small></div></button>)}
        </aside>

        <div className="settings-content">
          {section === 'screen' ? <Panel title="ЭКРАН" note={desktopAvailable ? 'ELECTRON' : 'НЕДОСТУПНО В БРАУЗЕРЕ'}>
            <div className="settings-grid settings-grid--2">
              <label className="settings-field"><span><b>Режим окна</b><small>Управляет реальным Electron-окном.</small></span><select value={preferences.windowMode} disabled={!desktopAvailable} onChange={(event) => patch({ windowMode: event.target.value as AsterionPreferences['windowMode'] })}><option value="fullscreen">Полный экран</option><option value="windowed">Оконный режим</option></select></label>
              <label className="settings-field"><span><b>Разрешение окна</b><small>{preferences.windowMode === 'fullscreen' ? 'В fullscreen физическое разрешение монитора не меняется.' : 'Изменяет размер content area окна.'}</small></span><select value={preferences.windowResolution} disabled={!desktopAvailable || preferences.windowMode === 'fullscreen'} onChange={(event) => patch({ windowResolution: event.target.value as AsterionPreferences['windowResolution'] })}>{WINDOW_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution.replace('x', ' × ')}</option>)}</select></label>
            </div>
            <div className="settings-runtime-strip"><div><small>ТЕКУЩАЯ СРЕДА</small><strong>{desktopAvailable ? 'Asterion Desktop / Electron' : 'Web / GitHub Pages preview'}</strong></div><div><small>СОСТОЯНИЕ ОКНА</small><strong>{desktopState ? `${desktopState.fullscreen ? 'Полный экран' : 'Окно'} · ${desktopState.resolution.replace('x', '×')}` : desktopAvailable ? 'Синхронизация…' : 'Desktop API недоступен'}</strong></div><div><small>BASELINE</small><strong>1920 × 1080</strong></div></div>
          </Panel> : null}

          {section === 'interface' ? <Panel title="ИНТЕРФЕЙС" note="LIVE">
            <div className="settings-field settings-field--stack"><span><b>Размер текста</b><small>Масштабирует типографику по всему текущему интерфейсу, не изменяя геометрию базового stage.</small></span><div className="settings-scale-buttons">{TEXT_SCALES.map((scale) => <button type="button" key={scale} className={preferences.textScale === scale ? 'active' : ''} onClick={() => patch({ textScale: scale })}>{Math.round(scale * 100)}%</button>)}</div></div>
            <div className="settings-preview"><small>ПРЕДПРОСМОТР · {Math.round(preferences.textScale * 100)}%</small><strong>Командный интерфейс Asterion</strong><p>Ресурсы, таблицы и служебные подписи используют выбранный масштаб текста.</p></div>
            <div className="settings-grid settings-grid--2">
              <div className="settings-field"><span><b>Подсказки</b><small>Управляет централизованными tooltip-представлениями и поддержанными title-подсказками.</small></span><Toggle value={preferences.tooltipsEnabled} onChange={(value) => patch({ tooltipsEnabled: value })} /></div>
              <div className="settings-field"><span><b>Анимации</b><small>Снижает декоративные переходы и циклические эффекты без отключения функциональных индикаторов.</small></span><Toggle value={!preferences.reducedMotion} onChange={(value) => patch({ reducedMotion: !value })} onLabel="ВКЛ" offLabel="СНИЖЕНЫ" /></div>
            </div>
          </Panel> : null}

          {section === 'controls' ? <Panel title="УПРАВЛЕНИЕ" note="READ ONLY">
            <div className="hotkey-list"><div><kbd>F11</kbd><span><strong>Полный экран</strong><small>Переключает fullscreen в desktop-версии.</small></span><b>АКТИВНО</b></div><div><kbd>ESC</kbd><span><strong>Выход из полного экрана</strong><small>Работает только когда окно находится в fullscreen.</small></span><b>АКТИВНО</b></div></div>
            <ReservedBlock title="ПЕРЕНАЗНАЧЕНИЕ КЛАВИШ — ПОЗЖЕ" body="Полноценный rebinding engine в этом foundation не подключён. Неактивных кнопок настройки здесь нет." />
          </Panel> : null}

          {section === 'sound' ? <Panel title="ЗВУК" note="DEFERRED"><ReservedBlock title="АУДИОСИСТЕМА ЕЩЁ НЕ ПОДКЛЮЧЕНА" body="В текущем Asterion нет канонического audio runtime, поэтому громкость, музыка и эффекты не имитируются локальными ползунками." /></Panel> : null}

          {section === 'notifications' ? <Panel title="УВЕДОМЛЕНИЯ" note="DEFERRED"><ReservedBlock title="СИСТЕМА УВЕДОМЛЕНИЙ ЕЩЁ НЕ ПОДКЛЮЧЕНА" body="Текущий shell использует локальную строку состояния. Push, OS-уведомления, экономические и исследовательские alerts в этом PR не создаются." /></Panel> : null}

          {section === 'system' ? <Panel title="СОХРАНЕНИЕ / СИСТЕМА" note="LOCAL STORAGE">
            <div className="settings-system-grid"><div><small>КАМПАНИЯ</small><strong>Локальное автосохранение</strong><code>{ASTERION_CAMPAIGN_KEY}</code><p>Игровое состояние. Сбрасывается отдельной кнопкой «СБРОСИТЬ ПРОТОТИП».</p></div><div><small>НАСТРОЙКИ УСТРОЙСТВА</small><strong>Отдельное хранилище</strong><code>{ASTERION_PREFERENCES_KEY}</code><p>Размер текста, motion, подсказки и desktop window preferences не принадлежат кампании.</p></div></div>
            <button className="settings-reset-button" type="button" onClick={handleReset}><span>СБРОСИТЬ НАСТРОЙКИ</span><small>Кампания и прогресс не удаляются</small></button>
          </Panel> : null}
        </div>
      </div>

      <footer className="settings-footer"><span>Изменения интерфейса применяются сразу · fake Apply отсутствует</span><b>{Math.round(preferences.textScale * 100)}% TEXT</b></footer>
    </main>
  );
}
