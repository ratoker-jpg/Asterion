import { useEffect, useState, useSyncExternalStore } from 'react';
import { downloadJournal, getActiveJournalCampaign, readJournal } from './ui/player-journal-store.ts';
import { botJournalAvailable, downloadBotJournal } from './ui/bot-journal-store.ts';
import { getDesktopBridge } from './domain/settings/desktop.ts';
import { AUDIO_VOLUME_MAX, AUDIO_VOLUME_MIN, createDefaultAudioPreferences, type AudioChannel } from './domain/settings/audio.ts';
import { audio, playSound } from './audio/engine.ts';
import { useAudioPreferences } from './audio/hooks.ts';
import { SETTINGS_ICONS } from './ui/ui-art.ts';
import { isFrameMeterEnabled, setFrameMeterEnabled, subscribeFrameMeter } from './ui/frame-meter-overlay.ts';
import { CloudSettingsPanel } from './ui/menu/CloudSettingsPanel.tsx';
import { AmountSlider } from './ui/AmountSlider.tsx';
import { GameSelect } from './ui/GameSelect.tsx';
import type { SoundId } from './audio/sounds.ts';
import { SettingsHead, SettingsSwitch } from './ui/settings/SettingsParts.tsx';
import { TYPOGRAPHY_MAX, TYPOGRAPHY_MIN, TYPOGRAPHY_STEP, updateTypographyScale } from './domain/settings/preferences.ts';
import { TYPOGRAPHY_KEYS, WINDOW_PRESETS, type TypographyKey, type UiPreferencesV2 } from './domain/settings/types.ts';

/*
 * «Настройки» (old-screens redo, 12.11.2026). Grouped by what the player comes for:
 * sound, text size, the window and smoothness, the cloud world, the journals.
 * The old «Управление» and «Уведомления» placeholders had nothing behind them and
 * are gone; the real keys are listed under «Экран». «Сохранение» (one reset
 * button) became «Сбросить всё» at the foot of the rail, with a confirmation.
 */

type SettingsSection = 'sound' | 'interface' | 'screen' | 'cloud' | 'journal';

const sections: readonly { id: SettingsSection; label: string; hint: string; icon: string }[] = [
  { id: 'sound', label: 'Звук', hint: 'Громкость, музыка', icon: 'sound' },
  { id: 'interface', label: 'Размер текста', hint: 'Крупнее, мельче', icon: 'interface' },
  { id: 'screen', label: 'Экран', hint: 'Окно, кадры, клавиши', icon: 'screen' },
  { id: 'cloud', label: 'Облачный мир', hint: 'Мир на сервере', icon: 'save' },
  { id: 'journal', label: 'Журналы', hint: 'Для разбора партии', icon: 'journal' },
];

/** What each text size changes, in the player's words, and a sample shown at that size. */
const textMeta: Record<TypographyKey, { label: string; where: string; sample: string }> = {
  hud: { label: 'Верхняя панель', where: 'Ресурсы, планета и время вверху экрана', sample: 'Металл 15 880' },
  pageTitle: { label: 'Заголовки экранов', where: '«Операции», «Флоты», «Командование»', sample: 'Операции' },
  sectionTitle: { label: 'Заголовки блоков', where: 'Названия частей экрана', sample: 'Доступные операции' },
  body: { label: 'Основной текст', where: 'Описания, письма, отчёты', sample: 'Флот вернулся с грузом.' },
  table: { label: 'Числа и таблицы', where: 'Ресурсы, рейтинг, бои', sample: '482 910 · 155 240' },
  control: { label: 'Кнопки', where: 'Надписи на кнопках и вкладках', sample: 'Отправить флот' },
  secondary: { label: 'Подписи', where: 'Мелкие пояснения под названиями', sample: 'Уровень 7 · 3 мин' },
  helper: { label: 'Подсказки и пояснения', where: 'Всплывающие подсказки и советы', sample: 'Зонд покажет чужой флот.' },
};

const TEXT_PRESETS = [
  { value: 100, label: 'Обычный' },
  { value: 125, label: 'Крупный' },
  { value: 145, label: 'Очень крупный' },
] as const;

type SettingsViewProps = {
  preferences: UiPreferencesV2;
  onPreferencesChange: (preferences: UiPreferencesV2) => void;
  onReset: () => void;
  /** «menu»: opened from the main menu, which already shows the «Настройки» title. */
  variant?: 'game' | 'menu';
};

export function SettingsView({ preferences, onPreferencesChange, onReset, variant = 'game' }: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>('sound');
  const [confirmReset, setConfirmReset] = useState(false);
  const sound = useAudioPreferences();
  const desktopAvailable = useDesktopAvailable();

  const resetAll = () => {
    onReset();
    audio.setPreferences(createDefaultAudioPreferences());
    setFrameMeterEnabled(false);
    setConfirmReset(false);
  };

  const sizes = TYPOGRAPHY_KEYS.map((key) => preferences.typography[key]);
  const sameSize = sizes.every((value) => value === sizes[0]) ? sizes[0] : null;
  const badge: Record<SettingsSection, string | null> = {
    sound: sound.muted ? 'выкл.' : `${sound.master}%`,
    interface: sameSize === null ? 'свой' : `${sameSize}%`,
    screen: desktopAvailable ? (preferences.display.mode === 'fullscreen' ? 'весь экран' : preferences.display.preset.replace('x', '×')) : null,
    cloud: null,
    journal: null,
  };

  return (
    <div className={`utility-view settings-view-v2 set-view${variant === 'menu' ? ' set-view--menu' : ''}`}>
      <aside className="set-panel set-rail">
        {variant === 'game' ? <h1>Настройки</h1> : null}
        <p className="set-rail-note">Хранятся на этом компьютере и не меняют ход партии.</p>
        <nav className="set-tabs" aria-label="Разделы настроек">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? 'active' : ''}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => { setSection(item.id); setConfirmReset(false); }}
              data-qa-settings-section={item.id}
            >
              <img src={SETTINGS_ICONS[item.icon] ?? SETTINGS_ICONS.save} alt="" draggable={false} />
              <span>
                <span className="set-tab-top">
                  <b>{item.label}</b>
                  {badge[item.id] ? <em className={`set-badge${item.id === 'sound' && sound.muted ? ' is-off' : ''}`}>{badge[item.id]}</em> : null}
                </span>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className={`set-reset${confirmReset ? ' is-asking' : ''}`} data-qa-settings-reset-box>
          {confirmReset ? (
            <>
              <strong>Сбросить всё?</strong>
              <span>Звук, размер текста, режим окна и счётчик кадров вернутся к исходным. Облачный мир, журналы и партия не меняются.</span>
              <div className="set-actions">
                <button type="button" className="danger-fill" onClick={resetAll} data-qa-settings-reset-confirm>Сбросить</button>
                <button type="button" onClick={() => setConfirmReset(false)} data-qa-settings-reset-cancel>Отмена</button>
              </div>
            </>
          ) : (
            <button type="button" className="set-link" onClick={() => setConfirmReset(true)} data-qa-settings-reset>Сбросить всё по умолчанию</button>
          )}
        </div>
      </aside>

      <main className="set-panel set-content" data-qa-scroll="settings-content" data-qa-settings-current={section}>
        {section === 'sound' ? <SoundPanel />
          : section === 'interface' ? <TextPanel preferences={preferences} onPreferencesChange={onPreferencesChange} />
          : section === 'screen' ? <ScreenPanel preferences={preferences} onPreferencesChange={onPreferencesChange} desktopAvailable={desktopAvailable} />
          : section === 'cloud' ? <CloudSettingsPanel />
          : <JournalPanel />}
      </main>
    </div>
  );
}

function useDesktopAvailable() {
  const [available, setAvailable] = useState(() => Boolean(getDesktopBridge()));
  useEffect(() => { setAvailable(Boolean(getDesktopBridge())); }, []);
  return available;
}

const soundMeta: Record<AudioChannel, { label: string; where: string; sample: SoundId }> = {
  master: { label: 'Общая громкость', where: 'Все звуки и музыка вместе', sample: 'confirm' },
  music: { label: 'Музыка', where: 'Фоновая музыка в меню и в партии', sample: 'info' },
  effects: { label: 'События', where: 'Окна, отчёты, тревоги', sample: 'success' },
  interface: { label: 'Нажатия', where: 'Кнопки, вкладки, наведение', sample: 'tab' },
};

/** Sound applies at once and is stored apart from the interface preferences. */
function SoundPanel() {
  const preferences = useAudioPreferences();
  const update = (patch: Partial<typeof preferences>) => audio.setPreferences({ ...preferences, ...patch });
  const defaults = createDefaultAudioPreferences();
  const isDefault = (Object.keys(soundMeta) as AudioChannel[]).every((channel) => preferences[channel] === defaults[channel]) && preferences.muted === defaults.muted;
  return (
    <section className="set-section" data-qa-sound-settings>
      <SettingsHead
        title="Звук"
        text="Громкость меняется сразу, пока вы двигаете ползунок."
        aside={<button type="button" className="set-link" disabled={isDefault} onClick={() => audio.setPreferences(defaults)}>Вернуть громкость по умолчанию</button>}
      />
      <div className="set-tile set-tile--row">
        <div className="set-tile-text">
          <strong>Звук в игре</strong>
          <span>{preferences.muted ? 'Сейчас тихо. Громкость каналов сохранится до включения.' : 'Музыка, события и нажатия звучат.'}</span>
        </div>
        <div className="set-actions">
          <button type="button" data-sfx="none" disabled={preferences.muted} onClick={() => playSound('success')}>Проверить</button>
          <SettingsSwitch on={!preferences.muted} onChange={(next) => update({ muted: !next })} label="Звук в игре" qa="sound" data-sfx="none" data-qa-sound-mute />
        </div>
      </div>
      <div className={`set-list${preferences.muted ? ' is-muted' : ''}`}>
        {(Object.keys(soundMeta) as AudioChannel[]).map((channel) => {
          const meta = soundMeta[channel];
          const value = preferences[channel];
          return (
            <div className="set-row set-row--sound" key={channel} data-qa-sound-channel={channel}>
              <div className="set-row-label"><strong>{meta.label}</strong><small>{meta.where}</small></div>
              <AmountSlider compact value={value} min={AUDIO_VOLUME_MIN} max={AUDIO_VOLUME_MAX} step={5} label={`Громкость: ${meta.label}`} onChange={(next) => update({ [channel]: next })} qa={`sound-${channel}`} />
              <output className="set-value">{value}%</output>
              <button type="button" className="set-mini" data-sfx="none" disabled={preferences.muted} onClick={() => playSound(meta.sample)} aria-label={`Послушать: ${meta.label}`}>Послушать</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TextPanel({ preferences, onPreferencesChange }: { preferences: UiPreferencesV2; onPreferencesChange: (preferences: UiPreferencesV2) => void }) {
  const setScale = (key: TypographyKey, value: number) => onPreferencesChange(updateTypographyScale(preferences, key, value));
  const setAll = (value: number) => {
    const typography = Object.fromEntries(TYPOGRAPHY_KEYS.map((key) => [key, value])) as UiPreferencesV2['typography'];
    onPreferencesChange({ ...preferences, typography });
  };
  const sizes = TYPOGRAPHY_KEYS.map((key) => preferences.typography[key]);
  const same = sizes.every((value) => value === sizes[0]) ? sizes[0] : null;
  return (
    <section className="set-section">
      <SettingsHead title="Размер текста" text={`Каждый вид текста меняется отдельно, от ${TYPOGRAPHY_MIN}% до ${TYPOGRAPHY_MAX}%. Образец в строке сразу показывает новый размер.`} />
      <div className="set-tile set-tile--row">
        <div className="set-tile-text">
          <strong>Весь текст сразу</strong>
          <span>{same === null ? 'Сейчас размеры разные — выберите один для всего текста.' : `Сейчас весь текст ${same}%.`}</span>
        </div>
        <div className="set-seg" role="group" aria-label="Размер всего текста">
          {TEXT_PRESETS.map((preset) => (
            <button key={preset.value} type="button" className={same === preset.value ? 'active' : ''} aria-pressed={same === preset.value} onClick={() => setAll(preset.value)} data-qa-text-preset={preset.value}>
              {preset.label} <small>{preset.value}%</small>
            </button>
          ))}
        </div>
      </div>
      <div className="set-list">
        {TYPOGRAPHY_KEYS.map((key) => {
          const meta = textMeta[key];
          const value = preferences.typography[key];
          return (
            <div className="set-row set-row--text typography-row-v2" key={key} data-qa-typography-row={key}>
              <div className="set-row-label"><strong>{meta.label}</strong><small>{meta.where}</small></div>
              <div className={`set-sample set-sample--${key}`} aria-hidden="true"><span>{meta.sample}</span></div>
              <AmountSlider compact value={value} min={TYPOGRAPHY_MIN} max={TYPOGRAPHY_MAX} step={TYPOGRAPHY_STEP} label={meta.label} onChange={(next) => setScale(key, next)} qa={`text-${key}`} />
              <output className="set-value">{value}%</output>
              {/* Only when the size differs from the default: a plain «Вернуть 100%», nothing at 100%. */}
              <span className="set-row-reset">
                {value !== 100 ? <button type="button" className="set-mini typography-reset-v2" onClick={() => setScale(key, 100)} aria-label={`Вернуть 100%: ${meta.label}`}>Вернуть 100%</button> : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ScreenPanel({ preferences, onPreferencesChange, desktopAvailable }: {
  preferences: UiPreferencesV2;
  onPreferencesChange: (preferences: UiPreferencesV2) => void;
  desktopAvailable: boolean;
}) {
  const [message, setMessage] = useState('');
  const updateDisplay = async (next: UiPreferencesV2['display']) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      const state = await bridge.setDisplay(next);
      onPreferencesChange({ ...preferences, display: next });
      setMessage(state.mode === 'fullscreen' ? 'Игра на весь экран.' : `Игра в окне ${state.width} × ${state.height}.`);
    } catch {
      setMessage('Не получилось сменить режим окна. Попробуйте ещё раз или нажмите F11.');
    }
  };
  const windowed = preferences.display.mode === 'windowed';
  return (
    <section className="set-section">
      <SettingsHead title="Экран" text="Окно игры, плавность картинки и клавиши. Разрешение монитора не меняется." />
      <div className="set-grid">
        <div className="set-tile" data-qa-settings-window>
          <div className="set-tile-text">
            <strong>Окно игры</strong>
            <span>{desktopAvailable
              ? (message || 'Меняется сразу. F11 тоже переключает весь экран и окно.')
              : 'Работает в приложении Asterion для Windows. В браузере окном управляет сам браузер.'}</span>
          </div>
          <div className="set-seg" role="group" aria-label="Режим окна">
            <button type="button" className={!windowed ? 'active' : ''} aria-pressed={!windowed} disabled={!desktopAvailable} onClick={() => void updateDisplay({ ...preferences.display, mode: 'fullscreen' })} data-qa-display-mode="fullscreen">Весь экран</button>
            <button type="button" className={windowed ? 'active' : ''} aria-pressed={windowed} disabled={!desktopAvailable} onClick={() => void updateDisplay({ ...preferences.display, mode: 'windowed' })} data-qa-display-mode="windowed">В окне</button>
          </div>
          <div className="set-field" data-qa-settings-window-size>
            <span>Размер окна{desktopAvailable && !windowed ? ' — сначала выберите «В окне»' : ''}</span>
            <GameSelect
              label="Размер окна"
              value={preferences.display.preset}
              disabled={!desktopAvailable || !windowed}
              options={WINDOW_PRESETS.map((preset) => ({ value: preset, label: preset.replace('x', ' × ') }))}
              onChange={(value) => void updateDisplay({ mode: 'windowed', preset: value as UiPreferencesV2['display']['preset'] })}
            />
          </div>
        </div>
        <FrameMeterTile />
        <div className="set-tile" data-qa-settings-keys>
          <div className="set-tile-text">
            <strong>Клавиши</strong>
            <span>Переназначить их пока нельзя.</span>
          </div>
          <dl className="set-keys">
            <div><dt><kbd>Esc</kbd></dt><dd>Меню игры. Если открыто окно — закрыть его.</dd></div>
            <div><dt><kbd>F11</kbd></dt><dd>Весь экран или окно (в приложении для Windows).</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function FrameMeterTile() {
  const on = useSyncExternalStore(subscribeFrameMeter, isFrameMeterEnabled);
  return (
    <div className="set-tile" data-qa-frame-meter-card>
      <div className="set-tile-text">
        <strong>Счётчик кадров</strong>
        <span>Маленькая панель в углу: кадры в секунду, самый долгий кадр за 5 секунд и сколько кадров не успели за 8,3 мс. Выключенный счётчик ничего не считает.</span>
      </div>
      <SettingsSwitch on={on} onChange={setFrameMeterEnabled} label="Счётчик кадров" qa="frame-meter" />
      <p className="set-note" data-qa-frame-meter-hint>Для 120 кадров в секунду окно игры должно стоять на мониторе 120 Гц.</p>
    </div>
  );
}

/** Owner request: export what the player did in this campaign so bots can learn from it. */
function JournalPanel() {
  const [count, setCount] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const campaign = getActiveJournalCampaign();
  useEffect(() => {
    if (!campaign) return;
    readJournal(campaign).then((entries) => setCount(entries.length)).catch(() => setCount(null));
  }, [campaign]);
  return (
    <section className="set-section" data-qa-player-journal>
      <SettingsHead title="Журналы" text="Файлы для разбора партии: по ним боты учатся играть сильнее. На игру журналы не влияют и хранятся отдельно от сохранения." />
      <div className="set-grid">
        <div className="set-tile">
          <div className="set-tile-text">
            <strong>Журнал игрока</strong>
            <span>Ваши действия в этой партии: стройки, наука, флот, полёты с грузом, колонии, союз. Раз в игровой час — снимок вашего положения.</span>
          </div>
          <dl className="set-facts">
            <div><dt>Записей</dt><dd>{campaign ? (count === null ? '—' : count.toLocaleString('ru-RU')) : 'нет открытой партии'}</dd></div>
          </dl>
          <div className="set-actions">
            <button type="button" className="primary" disabled={!campaign} onClick={() => {
              if (!campaign) return;
              downloadJournal(campaign, {}).then((total) => setMessage(`Сохранён файл: ${total.toLocaleString('ru-RU')} записей.`)).catch(() => setMessage('Не удалось прочитать журнал.'));
            }} data-qa-player-journal-download>Скачать журнал</button>
          </div>
          {message ? <p className="set-note" role="status">{message}</p> : null}
          {!campaign ? <p className="set-note">Откройте партию, чтобы скачать её журнал.</p> : null}
        </div>
        <BotJournalTile campaign={campaign} />
      </div>
    </section>
  );
}

/** Owner request 31.10.2026: what the strongest bots chose and why, from a file next to the save. */
function BotJournalTile({ campaign }: { campaign: string | null }) {
  const [message, setMessage] = useState('');
  const available = botJournalAvailable();
  return (
    <div className="set-tile" data-qa-bot-journal>
      <div className="set-tile-text">
        <strong>Журнал ботов</strong>
        <span>Десять сильнейших ботов: что выбрали, какие 2–3 варианта взвешивали и почему отказались, когда сменили стиль игры. Последние 3 игровых дня; пока вас нет, его пишет облачный сервер.</span>
      </div>
      <div className="set-actions">
        <button type="button" disabled={!campaign || !available} onClick={() => {
          if (!campaign) return;
          downloadBotJournal(campaign).then((total) => setMessage(`Сохранён файл: ${total.toLocaleString('ru-RU')} записей.`)).catch(() => setMessage('Не удалось прочитать журнал ботов.'));
        }} data-qa-bot-journal-download>Скачать журнал ботов</button>
      </div>
      {!available ? <p className="set-note">Журнал ботов ведёт только приложение Asterion для Windows.</p> : null}
      {message ? <p className="set-note" role="status">{message}</p> : null}
    </div>
  );
}
