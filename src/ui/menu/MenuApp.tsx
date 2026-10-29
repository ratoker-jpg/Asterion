import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { menuBackground } from '../sun-raid/sun-raid-assets.ts';
import { SettingsView } from '../../SettingsView';
import {
  applyTypographyPreferences,
  persistPreferences,
  readPreferences,
  resetPreferences,
} from '../../domain/settings/preferences.ts';
import type { UiPreferencesV2 } from '../../domain/settings/types.ts';
import { formatPlayTime, selectContinueSlot, sortSlotsByRecent, type SaveSlotIndex, type SaveSlotMeta } from '../../domain/session/slots.ts';
import { CAMPAIGN_SPEED_LABELS } from '../../domain/world/config.ts';
import { SAVE_SCHEMA_VERSION } from '../../application/persistence.ts';
import {
  deleteSaveSlot,
  duplicateSaveSlot,
  exportSaveSlot,
  importSaveSlot,
  inspectSlot,
  readSlotIndex,
  renameSaveSlot,
  type SlotHealth,
} from '../../application/slots.ts';
import { CrystalSet } from '../sun-raid/SunRaidArt.tsx';
import { RACE_CARDS, raceCard } from './race-catalog.ts';
import { NewGameWizard } from './NewGameWizard.tsx';
import { GameUpdateRow } from './GameUpdateRow.tsx';
import { isDesktopShell, quitDesktopApp, type MenuScreen } from './session.ts';
import type { SolarCrystalId } from '../../domain/sun-raid/config.ts';
import { useMusic } from '../../audio/hooks.ts';
import { usePointerDepth } from './pointer-depth.ts';
import './menu.css';
import './menu-motion.css';

function useMenuScale() {
  const calc = () => Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const [scale, setScale] = useState(calc);
  useEffect(() => {
    const onResize = () => setScale(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

const CRYSTALS: readonly SolarCrystalId[] = ['crystal-1', 'crystal-2', 'crystal-3', 'crystal-4'];

function dateLabel(ms: number) {
  return new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** A slot the health gate refused to open; its data is left untouched. */
export type SlotEntryProblem = { slotName: string; message: string };

type MenuAppProps = {
  initialScreen: MenuScreen;
  onEnterSlot: (slot: SaveSlotMeta) => void;
  entryProblem?: SlotEntryProblem | null;
  onDismissEntryProblem?: () => void;
};

/** Main menu, «Новая игра», «Загрузить игру» and settings, on the same 1920×1080 stage as the game. */
export function MenuApp({ initialScreen, onEnterSlot, entryProblem = null, onDismissEntryProblem }: MenuAppProps) {
  const scale = useMenuScale();
  useMusic('menu');
  const viewportRef = useRef<HTMLDivElement>(null);
  usePointerDepth(viewportRef);
  const [screen, setScreen] = useState<MenuScreen>(initialScreen);
  const [index, setIndex] = useState<SaveSlotIndex>(() => readSlotIndex());
  const continueSlot = selectContinueSlot(index);
  const [themeFaction, setThemeFaction] = useState(continueSlot?.factionId ?? 'aegis');

  useEffect(() => {
    document.documentElement.dataset.faction = themeFaction;
  }, [themeFaction]);
  useEffect(() => {
    if (screen === 'main') setThemeFaction(continueSlot?.factionId ?? 'aegis');
  }, [screen, continueSlot?.factionId]);

  const refresh = useCallback(() => setIndex(readSlotIndex()), []);
  // The load screen must show the refused slot as broken: re-read the index and health.
  useEffect(() => { if (entryProblem) refresh(); }, [entryProblem, refresh]);

  // Race art is large: warm the cache while the player reads the main menu.
  useEffect(() => {
    for (const card of RACE_CARDS) {
      for (const src of [card.general, card.background, card.emblem, card.flagship, menuBackground(card.id)]) {
        const image = new Image();
        image.decoding = 'async';
        image.src = src;
      }
    }
  }, []);

  return (
    <div className="menu-viewport" ref={viewportRef} data-qa-menu={screen}>
      <div className="menu-stage" style={{ '--menu-scale': scale } as CSSProperties} data-faction={themeFaction}>
        {/* Key art per race: the planet horizon and the crystal-ringed star are part of the image. */}
        <div className="menu-bg" aria-hidden="true" style={{ backgroundImage: `url(${menuBackground(themeFaction)})` }} data-qa-menu-bg={themeFaction} />
        <div className="menu-stars" aria-hidden="true" />
        {screen === 'main' ? (
          <MainMenuScreen continueSlot={continueSlot} slotCount={index.slots.length} onNavigate={setScreen} onContinue={() => continueSlot && onEnterSlot(continueSlot)} />
        ) : screen === 'load' ? (
          <LoadGameScreen index={index} onBack={() => setScreen('main')} onLoad={onEnterSlot} onChanged={refresh} />
        ) : screen === 'new' ? (
          <NewGameWizard onBack={() => setScreen('main')} onThemeChange={setThemeFaction} onCreated={onEnterSlot} />
        ) : (
          <MenuSettingsScreen onBack={() => setScreen('main')} />
        )}
        {entryProblem ? (
          <ConfirmDialog
            eyebrow="СОХРАНЕНИЕ НЕ ОТКРЫТО"
            title={`Кампания «${entryProblem.slotName}» не загружена`}
            text={`${entryProblem.message} Данные слота не изменены. В разделе «Загрузить игру» его можно экспортировать в файл или удалить.`}
            confirmLabel="К СОХРАНЕНИЯМ"
            cancelLabel="ЗАКРЫТЬ"
            onConfirm={() => { onDismissEntryProblem?.(); setScreen('load'); }}
            onCancel={() => onDismissEntryProblem?.()}
          />
        ) : null}
      </div>
    </div>
  );
}

function MenuBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`menu-brand ${compact ? 'menu-brand--compact' : ''}`}>
      <small>ЗВЁЗДНАЯ СТРАТЕГИЯ · ОДИНОЧНАЯ КАМПАНИЯ</small>
      <strong aria-label="Asterion">ASTERION</strong>
      <i aria-hidden="true" />
    </div>
  );
}

type MainMenuScreenProps = {
  continueSlot: SaveSlotMeta | null;
  slotCount: number;
  onNavigate: (screen: MenuScreen) => void;
  onContinue: () => void;
};

function MainMenuScreen({ continueSlot, slotCount, onNavigate, onContinue }: MainMenuScreenProps) {
  const desktop = isDesktopShell();
  const items: Array<{ id: string; label: string; hint: string; disabled?: boolean; action: () => void; primary?: boolean }> = [
    { id: 'continue', label: 'Продолжить', hint: continueSlot ? `${continueSlot.name} · ${raceCard(continueSlot.factionId).name}` : 'Нет сохранённых кампаний', disabled: !continueSlot, action: onContinue, primary: Boolean(continueSlot) },
    { id: 'new', label: 'Новая игра', hint: 'Раса, мир, скорость партии', action: () => onNavigate('new'), primary: !continueSlot },
    { id: 'load', label: 'Загрузить игру', hint: slotCount ? `Слотов: ${slotCount}` : 'Импорт сохранения из файла', action: () => onNavigate('load') },
    { id: 'settings', label: 'Настройки', hint: 'Экран, интерфейс, шрифты', action: () => onNavigate('settings') },
    ...(desktop ? [{ id: 'quit', label: 'Выход', hint: 'Закрыть Asterion', action: quitDesktopApp }] : []),
  ];
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);

  return (
    <main className="menu-main">
      <section className="menu-main__left">
        <MenuBrand />
        <nav className="menu-nav" aria-label="Главное меню">
          {items.map((item, position) => (
            <button
              key={item.id}
              ref={position === items.findIndex((candidate) => !candidate.disabled) ? firstRef : undefined}
              type="button"
              className={`menu-nav__item ${item.primary ? 'is-primary' : ''}`}
              disabled={item.disabled}
              onClick={item.action}
              data-qa-menu-action={item.id}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                const at = buttons.indexOf(event.currentTarget);
                buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
              }}
            >
              <span className="menu-nav__index">{String(position + 1).padStart(2, '0')}</span>
              <span className="menu-nav__copy"><b>{item.label}</b><small>{item.hint}</small></span>
              <span className="menu-nav__chevron" aria-hidden="true" />
            </button>
          ))}
        </nav>
        <footer className="menu-foot">
          <GameUpdateRow variant="menu" />
          <span>Сохранения хранятся локально · схема {SAVE_SCHEMA_VERSION}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>Enter</kbd> подтвердить</span>
        </footer>
      </section>
      <section className="menu-main__right">
        {continueSlot ? <ContinueShowcase slot={continueSlot} onContinue={onContinue} /> : <RaceTeaser onStart={() => onNavigate('new')} />}
      </section>
    </main>
  );
}

function ContinueShowcase({ slot, onContinue }: { slot: SaveSlotMeta; onContinue: () => void }) {
  const card = raceCard(slot.factionId);
  return (
    <article className="menu-showcase" data-faction={slot.factionId} data-qa-continue-card>
      <img className="menu-showcase__bg" src={card.background} alt="" draggable={false} />
      <img className="menu-showcase__general" src={card.general} alt="" draggable={false} />
      <div className="menu-showcase__copy">
        <small>ПОСЛЕДНЯЯ КАМПАНИЯ</small>
        <h2>{slot.name}</h2>
        <p className="menu-race-chip"><img src={card.emblem} alt="" />{card.name} · {slot.playerName}</p>
        <dl className="menu-showcase__stats">
          <div><dt>Наиграно</dt><dd>{formatPlayTime(slot.playTimeMs)}</dd></div>
          <div><dt>Планеты</dt><dd>{slot.summary.planets}</dd></div>
          <div><dt>Галактики</dt><dd>{slot.summary.galaxyCount}</dd></div>
          <div><dt>Скорость</dt><dd>{CAMPAIGN_SPEED_LABELS[slot.campaignSpeed].label}</dd></div>
        </dl>
        <div className="menu-showcase__crystals">
          <small>КРИСТАЛЛЫ СОЛНЦ</small>
          <CrystalSet owned={CRYSTALS.slice(0, slot.summary.crystals)} size={26} />
        </div>
        <p className="menu-showcase__date">Сохранено {dateLabel(slot.updatedAt)}{slot.summary.victory ? ' · Врата построены' : ''}</p>
        <button type="button" className="menu-btn menu-btn--primary menu-btn--wide" onClick={onContinue} data-qa-continue>ПРОДОЛЖИТЬ КАМПАНИЮ</button>
      </div>
    </article>
  );
}

function RaceTeaser({ onStart }: { onStart: () => void }) {
  return (
    <article className="menu-teaser">
      <div className="menu-teaser__row">
        {RACE_CARDS.map((card) => (
          <figure key={card.id} className="menu-teaser__figure" data-faction={card.id}>
            <img src={card.general} alt="" draggable={false} />
            <figcaption>{card.name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="menu-teaser__copy">
        <h2>Три стороны. Тысячи Солнц. Одни Врата.</h2>
        <p>Выберите расу, настройте мир и соберите четыре солнечных кристалла. Достроенные Врата — победа в кампании.</p>
        <button type="button" className="menu-btn menu-btn--primary" onClick={onStart}>НАЧАТЬ НОВУЮ ИГРУ</button>
      </div>
    </article>
  );
}

function ScreenHeader({ title, eyebrow, onBack, children }: { title: string; eyebrow: string; onBack: () => void; children?: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.menu-modal')) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  return (
    <header className="menu-screen-head">
      <button type="button" className="menu-back" onClick={onBack} aria-label="Назад в главное меню" data-qa-menu-back><span aria-hidden="true">←</span>НАЗАД</button>
      <div className="menu-screen-head__title"><small>{eyebrow}</small><h1>{title}</h1></div>
      <div className="menu-screen-head__tools">{children}</div>
    </header>
  );
}

type LoadGameScreenProps = { index: SaveSlotIndex; onBack: () => void; onLoad: (slot: SaveSlotMeta) => void; onChanged: () => void };

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function LoadGameScreen({ index, onBack, onLoad, onChanged }: LoadGameScreenProps) {
  const slots = useMemo(() => sortSlotsByRecent(index.slots), [index.slots]);
  const health = useMemo(() => new Map(slots.map((slot) => [slot.id, inspectSlot(slot, SAVE_SCHEMA_VERSION)])), [slots]);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SaveSlotMeta | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const result = (outcome: { ok: boolean; error?: string }, success: string) => {
    setMessage(outcome.ok ? { tone: 'ok', text: success } : { tone: 'error', text: outcome.error ?? 'Не удалось выполнить действие.' });
    onChanged();
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const imported = importSaveSlot(text, SAVE_SCHEMA_VERSION);
    result(imported, `Импортировано: ${imported.ok ? imported.slot?.name : ''}`);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <main className="menu-screen menu-load" data-qa-load-screen>
      <ScreenHeader eyebrow="СОХРАНЕНИЯ" title="ЗАГРУЗИТЬ ИГРУ" onBack={onBack}>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importFile(event.target.files?.[0])} data-qa-import-input />
        <button type="button" className="menu-btn" onClick={() => fileRef.current?.click()} data-qa-import>ИМПОРТ ИЗ ФАЙЛА</button>
      </ScreenHeader>
      {message ? <p className={`menu-message menu-message--${message.tone}`} role="status">{message.text}</p> : null}
      {slots.length ? (
        <ul className="menu-slots" aria-label="Слоты сохранения">
          {slots.map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              active={slot.id === index.activeSlotId}
              health={health.get(slot.id) ?? { status: 'missing' }}
              renaming={renaming?.id === slot.id ? renaming.name : null}
              onRenameStart={() => setRenaming({ id: slot.id, name: slot.name })}
              onRenameChange={(name) => setRenaming({ id: slot.id, name })}
              onRenameCommit={() => { if (renaming) result(renameSaveSlot(slot.id, renaming.name), 'Слот переименован.'); setRenaming(null); }}
              onRenameCancel={() => setRenaming(null)}
              onLoad={() => onLoad(slot)}
              onDuplicate={() => result(duplicateSaveSlot(slot.id), 'Создана копия слота.')}
              onExport={() => {
                const exported = exportSaveSlot(slot.id);
                if (exported.ok) downloadText(exported.fileName, exported.text);
                setMessage(exported.ok ? { tone: 'ok', text: `Файл ${exported.fileName} сохранён.` } : { tone: 'error', text: exported.error });
              }}
              onDelete={() => setConfirmDelete(slot)}
            />
          ))}
        </ul>
      ) : (
        <div className="menu-empty"><h2>Сохранений пока нет</h2><p>Начните новую игру или импортируйте файл сохранения.</p></div>
      )}
      {confirmDelete ? (
        <ConfirmDialog
          title="Удалить сохранение?"
          text={`Кампания «${confirmDelete.name}» будет удалена без возможности восстановления. Сначала можно сделать экспорт в файл.`}
          confirmLabel="УДАЛИТЬ"
          danger
          onConfirm={() => { result(deleteSaveSlot(confirmDelete.id), 'Слот удалён.'); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </main>
  );
}

type SlotCardProps = {
  slot: SaveSlotMeta;
  active: boolean;
  health: SlotHealth;
  renaming: string | null;
  onRenameStart: () => void;
  onRenameChange: (name: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onLoad: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
};

function SlotCard({ slot, active, health, renaming, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel, onLoad, onDuplicate, onExport, onDelete }: SlotCardProps) {
  const card = raceCard(slot.factionId);
  const loadable = health.status === 'ok';
  const problem = health.status === 'broken' ? `Повреждено: ${health.reason}` : health.status === 'newer' ? `Создано новой версией (схема ${health.schemaVersion})` : health.status === 'missing' ? 'Данные слота отсутствуют' : null;
  return (
    <li className={`menu-slot ${active ? 'is-active' : ''} ${problem ? 'is-broken' : ''}`} data-faction={slot.factionId} data-qa-slot={slot.id}>
      <div className="menu-slot__art">
        <img className="menu-slot__bg" src={card.background} alt="" draggable={false} />
        <img className="menu-slot__general" src={card.general} alt="" draggable={false} />
      </div>
      <div className="menu-slot__body">
        <div className="menu-slot__head">
          {renaming !== null ? (
            <form onSubmit={(event) => { event.preventDefault(); onRenameCommit(); }} className="menu-slot__rename">
              <input autoFocus value={renaming} maxLength={40} onChange={(event) => onRenameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onRenameCancel(); } }} aria-label="Новое название" />
              <button type="submit" className="menu-btn menu-btn--small">OK</button>
            </form>
          ) : <h3 title={slot.name}>{slot.name}</h3>}
          {active ? <span className="menu-tag">ПОСЛЕДНЯЯ</span> : null}
        </div>
        <p className="menu-race-chip"><img src={card.emblem} alt="" />{card.name} · {slot.playerName}</p>
        <dl className="menu-slot__stats">
          <div><dt>Сохранено</dt><dd>{dateLabel(slot.updatedAt)}</dd></div>
          <div><dt>Наиграно</dt><dd>{formatPlayTime(slot.playTimeMs)}</dd></div>
          <div><dt>Планеты</dt><dd>{slot.summary.planets}</dd></div>
          <div><dt>Мир</dt><dd>{slot.summary.galaxyCount} гал. · {slot.summary.npcCount} NPC</dd></div>
          <div><dt>Скорость</dt><dd>{CAMPAIGN_SPEED_LABELS[slot.campaignSpeed].label}</dd></div>
          <div><dt>Версия</dt><dd>схема {slot.schemaVersion}</dd></div>
        </dl>
        <div className="menu-slot__crystals"><CrystalSet owned={CRYSTALS.slice(0, slot.summary.crystals)} size={18} />{slot.summary.victory ? <b>ПОБЕДА</b> : null}</div>
        {problem ? <p className="menu-slot__problem" role="status">{problem}</p> : null}
        <div className="menu-slot__actions">
          <button type="button" className="menu-btn menu-btn--primary" disabled={!loadable} onClick={onLoad} data-qa-slot-load={slot.id}>ЗАГРУЗИТЬ</button>
          <button type="button" className="menu-btn" onClick={onRenameStart} disabled={renaming !== null}>ПЕРЕИМЕНОВАТЬ</button>
          <button type="button" className="menu-btn" onClick={onDuplicate} disabled={!loadable}>КОПИЯ</button>
          <button type="button" className="menu-btn" onClick={onExport} disabled={health.status === 'missing'}>ЭКСПОРТ</button>
          <button type="button" className="menu-btn menu-btn--danger" onClick={onDelete} data-qa-slot-delete={slot.id}>УДАЛИТЬ</button>
        </div>
      </div>
    </li>
  );
}

export function ConfirmDialog({ title, text, confirmLabel, cancelLabel = 'ОТМЕНА', eyebrow = 'ПОДТВЕРЖДЕНИЕ', danger = false, onConfirm, onCancel }: { title: string; text: string; confirmLabel: string; cancelLabel?: string; eyebrow?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div className="menu-modal" role="presentation" onMouseDown={onCancel}>
      <section className="menu-modal__card" role="alertdialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <small>{eyebrow}</small>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="menu-modal__actions">
          <button type="button" className={`menu-btn ${danger ? 'menu-btn--danger' : 'menu-btn--primary'}`} onClick={onConfirm} data-qa-confirm-yes>{confirmLabel}</button>
          <button ref={cancelRef} type="button" className="menu-btn" onClick={onCancel} data-qa-confirm-no>{cancelLabel}</button>
        </div>
      </section>
    </div>
  );
}

function MenuSettingsScreen({ onBack }: { onBack: () => void }) {
  const [preferences, setPreferences] = useState<UiPreferencesV2>(() => readPreferences());
  useEffect(() => { applyTypographyPreferences(preferences); }, [preferences]);
  return (
    <main className="menu-screen menu-settings">
      <ScreenHeader eyebrow="ПАРАМЕТРЫ" title="НАСТРОЙКИ" onBack={onBack} />
      <div className="menu-settings__body">
        <SettingsView
          preferences={preferences}
          onPreferencesChange={(next) => { setPreferences(next); persistPreferences(next); }}
          onReset={() => setPreferences(resetPreferences())}
        />
      </div>
    </main>
  );
}
