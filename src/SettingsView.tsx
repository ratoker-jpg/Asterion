import { useEffect, useMemo, useState } from 'react';
import { downloadJournal, getActiveJournalCampaign, readJournal } from './ui/player-journal-store.ts';
import { getDesktopBridge } from './domain/settings/desktop.ts';
import { AUDIO_VOLUME_MAX, AUDIO_VOLUME_MIN, createDefaultAudioPreferences, type AudioChannel } from './domain/settings/audio.ts';
import { audio, playSound } from './audio/engine.ts';
import { useAudioPreferences } from './audio/hooks.ts';
import { SETTINGS_ICONS } from './ui/ui-art.ts';
import { CloudSettingsPanel } from './ui/menu/CloudSettingsPanel.tsx';
import './ui/menu/cloud.css';
import type { SoundId } from './audio/sounds.ts';
import {
  TYPOGRAPHY_MAX,
  TYPOGRAPHY_MIN,
  TYPOGRAPHY_STEP,
  updateTypographyScale,
} from './domain/settings/preferences.ts';
import {
  TYPOGRAPHY_KEYS,
  WINDOW_PRESETS,
  type TypographyKey,
  type UiPreferencesV2,
} from './domain/settings/types.ts';

type SettingsSection = 'screen' | 'interface' | 'controls' | 'sound' | 'notifications' | 'save' | 'cloud' | 'journal';

const sections: readonly { id: SettingsSection; label: string; subtitle: string }[] = [
  { id: 'screen', label: 'ЭКРАН', subtitle: 'Режим окна' },
  { id: 'interface', label: 'ИНТЕРФЕЙС', subtitle: 'Типографика' },
  { id: 'controls', label: 'УПРАВЛЕНИЕ', subtitle: 'Клавиши' },
  { id: 'sound', label: 'ЗВУК', subtitle: 'Аудиосистема' },
  { id: 'notifications', label: 'УВЕДОМЛЕНИЯ', subtitle: 'Системные сигналы' },
  { id: 'save', label: 'СОХРАНЕНИЕ', subtitle: 'Настройки интерфейса' },
  { id: 'cloud', label: 'ОБЛАЧНЫЙ МИР', subtitle: 'Сервер и резервные копии' },
  { id: 'journal', label: 'ЖУРНАЛ ИГРОКА', subtitle: 'Ваши действия в JSON' },
];

const typographyMeta: Record<TypographyKey, { label: string; sample: string }> = {
  hud: { label: 'HUD / верхняя панель', sample: 'МЕТАЛЛ 15 880 · HELION 01 · ФЛОТЫ' },
  pageTitle: { label: 'Заголовки экранов', sample: 'НАСТРОЙКИ' },
  sectionTitle: { label: 'Заголовки секций', sample: 'ТИПОГРАФИКА' },
  body: { label: 'Основной текст', sample: 'Основной текст игровых экранов и описаний.' },
  table: { label: 'Таблицы и значения', sample: '37  ·  482 910  ·  155 240' },
  control: { label: 'Кнопки и элементы управления', sample: 'ПОКАЗАТЬ МОЮ ПОЗИЦИЮ' },
  secondary: { label: 'Вторичные подписи', sample: 'Экспериментальный центр · уровень 7' },
  helper: { label: 'Подсказки и пояснения', sample: 'Изменение этой категории не влияет на HUD и основной текст.' },
};

type SettingsViewProps = {
  preferences: UiPreferencesV2;
  onPreferencesChange: (preferences: UiPreferencesV2) => void;
  onReset: () => void;
};

export function SettingsView({ preferences, onPreferencesChange, onReset }: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>('interface');
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [displayMessage, setDisplayMessage] = useState('');

  useEffect(() => {
    setDesktopAvailable(Boolean(getDesktopBridge()));
  }, []);

  const setScale = (key: TypographyKey, value: number) => {
    onPreferencesChange(updateTypographyScale(preferences, key, value));
  };

  const applyPreset = (kind: 'standard' | 'large' | 'readable') => {
    const value = kind === 'standard' ? 100 : kind === 'large' ? 125 : 145;
    const typography = Object.fromEntries(TYPOGRAPHY_KEYS.map((key) => [key, value])) as UiPreferencesV2['typography'];
    onPreferencesChange({ ...preferences, typography });
  };

  const updateDisplay = async (next: UiPreferencesV2['display']) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      const state = await bridge.setDisplay(next);
      onPreferencesChange({ ...preferences, display: next });
      setDisplayMessage(state.mode === 'fullscreen'
        ? 'Полноэкранный режим включён.'
        : `Оконный режим: ${state.width}×${state.height}.`);
    } catch {
      setDisplayMessage('Не удалось применить режим окна.');
    }
  };

  return (
    <div className="utility-view settings-view-v2">
      <aside className="settings-nav-v2">
        <div className="settings-brand-v2">
          <small className="utility-secondary">СИСТЕМНОЕ МЕНЮ</small>
          <h1 className="utility-page-title">НАСТРОЙКИ</h1>
          <p className="utility-helper">Параметры интерфейса хранятся отдельно от прогресса кампании.</p>
        </div>
        <nav aria-label="Разделы настроек">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`utility-control ${section === item.id ? 'active' : ''}`}
              onClick={() => setSection(item.id)}
              data-qa-settings-section={item.id}
            >
              <img className="settings-nav-icon-v2" src={SETTINGS_ICONS[item.id] ?? SETTINGS_ICONS.save} alt="" draggable={false} />
              <span>{item.label}</span>
              <small className="utility-secondary">{item.subtitle}</small>
              <b>›</b>
            </button>
          ))}
        </nav>
      </aside>

      <main className="settings-content-v2" data-qa-scroll="settings-content">
        {section === 'interface' ? (
          <TypographyPanel preferences={preferences} setScale={setScale} applyPreset={applyPreset} />
        ) : section === 'screen' ? (
          <section className="settings-panel-v2">
            <PanelHeading eyebrow="ОТОБРАЖЕНИЕ" title="ЭКРАН" description="Режим окна меняет только окно Asterion и не меняет физическое разрешение монитора." />
            <div className="settings-grid-v2">
              <div className="settings-card-v2">
                <h3 className="utility-section-title">РЕЖИМ ОКНА</h3>
                <p className="utility-body-text">Переключение доступно в приложении Asterion. В браузере эти параметры недоступны.</p>
                <div className="settings-segment-v2">
                  <button type="button" className={`utility-control ${preferences.display.mode === 'fullscreen' ? 'active' : ''}`} disabled={!desktopAvailable} onClick={() => void updateDisplay({ ...preferences.display, mode: 'fullscreen' })}>ПОЛНЫЙ ЭКРАН</button>
                  <button type="button" className={`utility-control ${preferences.display.mode === 'windowed' ? 'active' : ''}`} disabled={!desktopAvailable} onClick={() => void updateDisplay({ ...preferences.display, mode: 'windowed' })}>ОКОННЫЙ</button>
                </div>
                <label className="settings-select-v2">
                  <span className="utility-secondary">РАЗМЕР ОКНА</span>
                  <select
                    className="utility-control"
                    disabled={!desktopAvailable || preferences.display.mode !== 'windowed'}
                    value={preferences.display.preset}
                    onChange={(event: { target: { value: string } }) => void updateDisplay({ mode: 'windowed', preset: event.target.value as UiPreferencesV2['display']['preset'] })}
                  >
                    {WINDOW_PRESETS.map((preset) => <option key={preset} value={preset}>{preset.replace('x', ' × ')}</option>)}
                  </select>
                </label>
                <small className="utility-helper">{desktopAvailable ? (displayMessage || 'F11 и Escape продолжают работать как раньше.') : 'Доступно в приложении Asterion для Windows.'}</small>
              </div>
            </div>
          </section>
        ) : section === 'controls' ? (
          <UnavailablePanel eyebrow="УПРАВЛЕНИЕ" title="КЛАВИШИ" body="Текущие системные клавиши продолжают работать. Полное переназначение клавиш будет подключено отдельным этапом." />
        ) : section === 'sound' ? (
          <SoundPanel />
        ) : section === 'journal' ? (
          <JournalPanel />
        ) : section === 'cloud' ? (
          <CloudSettingsPanel heading={(props) => <PanelHeading {...props} />} />
        ) : section === 'notifications' ? (
          <UnavailablePanel eyebrow="СИСТЕМНЫЕ СИГНАЛЫ" title="УВЕДОМЛЕНИЯ" body="Системные уведомления пока недоступны. Настройки появятся после их подключения." />
        ) : (
          <section className="settings-panel-v2">
            <PanelHeading eyebrow="ХРАНЕНИЕ" title="НАСТРОЙКИ ИНТЕРФЕЙСА" description="Сброс этого раздела не затрагивает ресурсы, кампанию, флот, операции и отчёты." />
            <div className="settings-reset-card-v2">
              <div>
                <h3 className="utility-section-title">СБРОСИТЬ НАСТРОЙКИ</h3>
                <p className="utility-body-text">Вернуть типографику и режим окна к значениям по умолчанию.</p>
                <small className="utility-helper">Прогресс кампании не изменяется.</small>
              </div>
              <button type="button" className="utility-control danger" onClick={onReset}>СБРОСИТЬ НАСТРОЙКИ</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function TypographyPanel({
  preferences,
  setScale,
  applyPreset,
}: {
  preferences: UiPreferencesV2;
  setScale: (key: TypographyKey, value: number) => void;
  applyPreset: (kind: 'standard' | 'large' | 'readable') => void;
}) {
  return (
    <section className="settings-panel-v2">
      <PanelHeading eyebrow="ИНТЕРФЕЙС" title="ТИПОГРАФИКА" description="Каждый тип текста настраивается отдельно и не меняет размер других категорий." />

      <div className="settings-presets-v2">
        <span className="utility-secondary">ПРЕСЕТЫ</span>
        <button type="button" className="utility-control" onClick={() => applyPreset('standard')}>СТАНДАРТ</button>
        <button type="button" className="utility-control" onClick={() => applyPreset('large')}>КРУПНЫЙ ТЕКСТ</button>
        <button type="button" className="utility-control" onClick={() => applyPreset('readable')}>МАКС. ЧИТАЕМОСТЬ</button>
      </div>

      <div className="typography-layout-v2">
        <div className="typography-controls-v2">
          {TYPOGRAPHY_KEYS.map((key) => {
            const value = preferences.typography[key];
            return (
              <div className="typography-row-v2" key={key}>
                <div>
                  <strong className="utility-section-title">{typographyMeta[key].label}</strong>
                  <small className="utility-helper">{TYPOGRAPHY_MIN}% — {TYPOGRAPHY_MAX}% · шаг {TYPOGRAPHY_STEP}%</small>
                </div>
                <div className="typography-stepper-v2">
                  <button type="button" className="utility-control" aria-label={`Уменьшить ${typographyMeta[key].label}`} onClick={() => setScale(key, value - TYPOGRAPHY_STEP)}>−</button>
                  <output className="utility-data-text">{value}%</output>
                  <button type="button" className="utility-control" aria-label={`Увеличить ${typographyMeta[key].label}`} onClick={() => setScale(key, value + TYPOGRAPHY_STEP)}>+</button>
                </div>
                <input
                  aria-label={`Масштаб: ${typographyMeta[key].label}`}
                  type="range"
                  min={TYPOGRAPHY_MIN}
                  max={TYPOGRAPHY_MAX}
                  step={TYPOGRAPHY_STEP}
                  value={value}
                  onChange={(event: { target: { value: string } }) => setScale(key, Number(event.target.value))}
                />
                <button type="button" className="utility-control typography-reset-v2" onClick={() => setScale(key, 100)}>100%</button>
              </div>
            );
          })}
        </div>

        <aside className="typography-preview-v2">
          <span className="utility-secondary">ПРЕДПРОСМОТР</span>
          <div className="preview-hud-v2">{typographyMeta.hud.sample}</div>
          <div className="preview-page-title-v2">{typographyMeta.pageTitle.sample}</div>
          <div className="preview-section-title-v2">{typographyMeta.sectionTitle.sample}</div>
          <p className="preview-body-v2">{typographyMeta.body.sample}</p>
          <div className="preview-table-v2">{typographyMeta.table.sample}</div>
          <button type="button" className="preview-control-v2">{typographyMeta.control.sample}</button>
          <div className="preview-secondary-v2">{typographyMeta.secondary.sample}</div>
          <div className="preview-helper-v2">{typographyMeta.helper.sample}</div>
        </aside>
      </div>
    </section>
  );
}

const audioChannelMeta: Record<AudioChannel, { label: string; hint: string; sample: SoundId }> = {
  master: { label: 'Общая громкость', hint: 'Все звуки игры', sample: 'confirm' },
  music: { label: 'Музыка', hint: 'Фоновая партитура меню и кампании', sample: 'info' },
  effects: { label: 'События', hint: 'Экраны, окна, отчёты, тревоги', sample: 'success' },
  interface: { label: 'Интерфейс', hint: 'Клики, вкладки, наведение', sample: 'tab' },
};

/** Sound settings apply at once and are stored apart from the interface preferences. */
function SoundPanel() {
  const preferences = useAudioPreferences();
  const update = (patch: Partial<typeof preferences>) => audio.setPreferences({ ...preferences, ...patch });
  return (
    <section className="settings-panel-v2" data-qa-sound-settings>
      <PanelHeading eyebrow="АУДИО" title="ЗВУК" description="Все звуки и музыка синтезируются игрой на лету. Громкость применяется сразу и хранится отдельно от кампании." />
      <div className="settings-presets-v2">
        <span className="utility-secondary">{preferences.muted ? 'ЗВУК ВЫКЛЮЧЕН' : 'ЗВУК ВКЛЮЧЁН'}</span>
        <button type="button" className={`utility-control ${preferences.muted ? 'active' : ''}`} data-sfx="none" onClick={() => update({ muted: !preferences.muted })} data-qa-sound-mute>
          {preferences.muted ? 'ВКЛЮЧИТЬ ЗВУК' : 'ВЫКЛЮЧИТЬ ЗВУК'}
        </button>
        <button type="button" className="utility-control" data-sfx="none" onClick={() => playSound('success')}>ПРОВЕРИТЬ</button>
        <button type="button" className="utility-control" onClick={() => audio.setPreferences(createDefaultAudioPreferences())}>ПО УМОЛЧАНИЮ</button>
      </div>
      <div className="typography-controls-v2 sound-controls-v2">
        {(Object.keys(audioChannelMeta) as AudioChannel[]).map((channel) => {
          const meta = audioChannelMeta[channel];
          const value = preferences[channel];
          return (
            <div className="typography-row-v2 sound-row-v2" key={channel} data-qa-sound-channel={channel}>
              <div>
                <strong className="utility-section-title">{meta.label}</strong>
                <small className="utility-helper">{meta.hint}</small>
              </div>
              <output className="utility-data-text">{value}%</output>
              <input
                aria-label={`Громкость: ${meta.label}`}
                type="range"
                min={AUDIO_VOLUME_MIN}
                max={AUDIO_VOLUME_MAX}
                step={5}
                value={value}
                disabled={preferences.muted}
                onChange={(event: { target: { value: string } }) => update({ [channel]: Number(event.target.value) })}
                onPointerUp={() => playSound(meta.sample)}
              />
              <button type="button" className="utility-control typography-reset-v2" data-sfx="none" disabled={preferences.muted} onClick={() => playSound(meta.sample)}>ТЕСТ</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Owner request: export everything the player did in this campaign so NPC play can be studied and improved. */
function JournalPanel() {
  const [count, setCount] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const campaign = getActiveJournalCampaign();
  useEffect(() => {
    if (!campaign) return;
    readJournal(campaign).then((entries) => setCount(entries.length)).catch(() => setCount(null));
  }, [campaign]);
  return (
    <section className="settings-panel-v2" data-qa-player-journal>
      <PanelHeading eyebrow="ИЗУЧЕНИЕ ИГРЫ" title="ЖУРНАЛ ИГРОКА" description="Игра записывает ваши действия в этой кампании: стройки, науку, заказы флота, полёты с целью, составом и грузом, отзывы, колонии, союз — и раз в час игрового времени снимок вашего положения. Журнал хранится отдельно от сохранения и не влияет на игру." />
      <div className="settings-reset-card-v2">
        <div>
          <h3 className="utility-section-title">ЗАПИСЕЙ: {count ?? '—'}</h3>
          <p className="utility-body-text">Скачайте файл после партии и передайте его для разбора: по нему NPC учатся играть как опытный игрок.</p>
          {message ? <small className="utility-helper">{message}</small> : null}
        </div>
        <button type="button" className="utility-control" disabled={!campaign} onClick={() => {
          if (!campaign) return;
          downloadJournal(campaign, {}).then((total) => setMessage(`Файл с ${total} записями сохранён.`)).catch(() => setMessage('Не удалось прочитать журнал.'));
        }} data-qa-player-journal-download>СКАЧАТЬ ЖУРНАЛ (JSON)</button>
      </div>
    </section>
  );
}

function PanelHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="settings-panel-heading-v2">
      <small className="utility-secondary">{eyebrow}</small>
      <h2 className="utility-section-title">{title}</h2>
      <p className="utility-body-text">{description}</p>
    </header>
  );
}

function UnavailablePanel({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <section className="settings-panel-v2">
      <PanelHeading eyebrow={eyebrow} title={title} description={body} />
      <div className="settings-disabled-card-v2">
        <span className="settings-disabled-icon-v2">◇</span>
        <div>
          <strong className="utility-section-title">ПОКА НЕДОСТУПНО</strong>
          <p className="utility-body-text">Параметры появятся здесь только вместе с реальной системой.</p>
        </div>
        <button type="button" className="utility-control" disabled>НЕДОСТУПНО</button>
      </div>
    </section>
  );
}
