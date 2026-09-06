import { useEffect, useMemo, useState } from 'react';
import { getDesktopBridge } from './domain/settings/desktop.ts';
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

type SettingsSection = 'screen' | 'interface' | 'controls' | 'sound' | 'notifications' | 'save';

const sections: readonly { id: SettingsSection; label: string; subtitle: string }[] = [
  { id: 'screen', label: 'ЭКРАН', subtitle: 'Режим окна' },
  { id: 'interface', label: 'ИНТЕРФЕЙС', subtitle: 'Типографика' },
  { id: 'controls', label: 'УПРАВЛЕНИЕ', subtitle: 'Клавиши' },
  { id: 'sound', label: 'ЗВУК', subtitle: 'Аудиосистема' },
  { id: 'notifications', label: 'УВЕДОМЛЕНИЯ', subtitle: 'Системные сигналы' },
  { id: 'save', label: 'СОХРАНЕНИЕ', subtitle: 'Настройки интерфейса' },
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
            >
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
          <UnavailablePanel eyebrow="АУДИО" title="ЗВУК" body="Звуковая система пока недоступна. Настройки появятся после её подключения." />
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
