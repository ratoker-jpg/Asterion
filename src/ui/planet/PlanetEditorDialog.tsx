import { useMemo, useState, type FormEvent } from 'react';
import type { AllianceRole } from '../../domain/command/types.ts';
import { PLANET_SKIN_GROUPS, canPickPlanetSkin, displayedPlanetSkinId, isAlliancePlanetSkin, type PlanetSkinGroup, type PlanetSkinTier } from '../../domain/universe/planet-skins.ts';
import { planetSkinById, planetSkins, type PlanetSkinArt } from '../../planet-skin-art.ts';
import './planet-editor.css';

/** Cards per page: 5 × 3, so a page never scrolls and loads at most 15 small pictures. */
export const PLANET_SKIN_PAGE_SIZE = 15;

const TIER_LABEL: Record<PlanetSkinTier, string> = { common: 'Обычный', rare: 'Редкий', alliance: 'Союз' };
const TIER_HEADING: Record<PlanetSkinTier, string> = { common: 'ОБЫЧНЫЕ', rare: 'РЕДКИЕ', alliance: 'СОЮЗ' };
const ROLE_LABEL: Record<AllianceRole, string> = { leader: 'глава', deputy: 'заместитель', member: 'участник' };

export interface PlanetEditorDialogProps {
  planetName: string;
  coords: string;
  status: string;
  /** The look saved on the planet (may be an alliance look the player can no longer show). */
  skinId: string;
  allianceRole: AllianceRole | null;
  allianceName?: string;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onSaveName: () => void;
  onChooseSkin: (skin: PlanetSkinArt) => void;
  onClose: () => void;
}

const groupSkins = (group: PlanetSkinGroup) => planetSkins.filter((skin) => skin.group === group);

export function PlanetEditorDialog({
  planetName, coords, status, skinId, allianceRole, allianceName, editingName,
  onEditingNameChange, onSaveName, onChooseSkin, onClose,
}: PlanetEditorDialogProps) {
  const saved = planetSkinById(skinId);
  const shown = planetSkinById(displayedPlanetSkinId(skinId, allianceRole));
  const [focusId, setFocusId] = useState<string>(saved.id);
  const [group, setGroup] = useState<PlanetSkinGroup>(saved.group);
  const items = useMemo(() => groupSkins(group), [group]);
  const pageCount = Math.max(1, Math.ceil(items.length / PLANET_SKIN_PAGE_SIZE));
  const [page, setPage] = useState(() => Math.floor(Math.max(0, groupSkins(saved.group).findIndex((skin) => skin.id === saved.id)) / PLANET_SKIN_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(safePage * PLANET_SKIN_PAGE_SIZE, (safePage + 1) * PLANET_SKIN_PAGE_SIZE);
  const focus = planetSkinById(focusId);
  const focusOpen = canPickPlanetSkin(focus.id, allianceRole);
  const focusIsShown = focus.id === shown.id;
  const groupMeta = PLANET_SKIN_GROUPS.find((entry) => entry.id === group)!;
  const hiddenAllianceSkin = isAlliancePlanetSkin(saved.id) && saved.id !== shown.id;

  const pickGroup = (next: PlanetSkinGroup) => { setGroup(next); setPage(0); };
  const submitName = (event: FormEvent) => { event.preventDefault(); onSaveName(); };
  const lockReason = allianceRole
    ? `Выбрать может только глава союза. Вы ${ROLE_LABEL[allianceRole]}${allianceName ? ` союза «${allianceName}»` : ' союза'}.`
    : 'Выбрать может только глава союза. Вступите в союз или создайте свой.';

  let tierShown: PlanetSkinTier | null = null;
  return (
    <section className="skin-picker-modal planet-editor-v6" role="dialog" aria-modal="true" aria-label="Редактировать планету" onMouseDown={(event) => event.stopPropagation()}>
      <header className="pe-head">
        <img className="pe-head-art" src={shown.thumb} alt="" width={56} height={56} decoding="async" />
        <div className="pe-head-title">
          <small>РЕДАКТИРОВАТЬ ПЛАНЕТУ</small>
          <h2 title={planetName}>{planetName}</h2>
          <p>{coords} · {status}</p>
        </div>
        <form className="pe-name" onSubmit={submitName}>
          <label htmlFor="planet-name-input" className="pe-visually-hidden">Название планеты</label>
          <input
            id="planet-name-input"
            value={editingName}
            maxLength={28}
            autoComplete="off"
            spellCheck={false}
            placeholder="Название планеты"
            onChange={(event) => onEditingNameChange(event.target.value)}
          />
          <button type="submit">СОХРАНИТЬ</button>
          <small>2–28 символов. Видно в шапке, на планете и во Вселенной.</small>
        </form>
        <button type="button" data-asterion-close aria-label="Закрыть редактор планеты" title="Закрыть редактор планеты" onClick={onClose}>×</button>
      </header>

      <div className="pe-body">
        <nav className="pe-rail" aria-label="Рубрики обликов">
          {PLANET_SKIN_GROUPS.map((entry) => {
            const heading = entry.tier !== tierShown ? TIER_HEADING[entry.tier] : null;
            tierShown = entry.tier;
            return (
              <div key={entry.id} className="pe-rail-item">
                {heading ? <span className={`pe-rail-heading pe-tier-${entry.tier}`}>{heading}</span> : null}
                <button type="button" data-qa-skin-group={entry.id} aria-pressed={group === entry.id} className={group === entry.id ? 'is-on' : ''} onClick={() => pickGroup(entry.id)}>
                  <span>{entry.label}</span><i>{groupSkins(entry.id).length}</i>
                </button>
              </div>
            );
          })}
        </nav>

        <section className="pe-catalog" aria-label={groupMeta.label}>
          <div className="pe-catalog-head">
            <h3>{groupMeta.label}</h3>
            {pageCount > 1 ? <span>Страница {safePage + 1} из {pageCount}</span> : <span>{items.length} обликов</span>}
          </div>
          <div className="pe-grid">
            {pageItems.map((skin) => {
              const open = canPickPlanetSkin(skin.id, allianceRole);
              const isShown = skin.id === shown.id;
              const state = isShown ? 'на планете' : open ? 'доступен' : 'закрыт';
              return (
                <button
                  key={skin.id}
                  type="button"
                  data-qa-planet-skin={skin.id}
                  data-state={isShown ? 'current' : open ? 'open' : 'locked'}
                  aria-pressed={focusId === skin.id}
                  aria-label={`${skin.label}, ${state}`}
                  className={['pe-card', focusId === skin.id ? 'is-focus' : '', isShown ? 'is-current' : '', open ? '' : 'is-locked', `pe-tier-${skin.tier}`].filter(Boolean).join(' ')}
                  onClick={() => setFocusId(skin.id)}
                  onDoubleClick={() => { if (open && !isShown) onChooseSkin(skin); }}
                >
                  <img src={skin.thumb} alt="" width={84} height={84} loading="lazy" decoding="async" draggable={false} />
                  <span>{skin.label}</span>
                </button>
              );
            })}
          </div>
          {pageCount > 1 ? (
            <div className="pe-pager">
              <button type="button" aria-label="Предыдущая страница" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹</button>
              {Array.from({ length: pageCount }, (_, index) => (
                <button key={index} type="button" aria-label={`Страница ${index + 1}`} aria-current={index === safePage ? 'page' : undefined} className={index === safePage ? 'is-on' : ''} onClick={() => setPage(index)}>{index + 1}</button>
              ))}
              <button type="button" aria-label="Следующая страница" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>›</button>
            </div>
          ) : null}
        </section>

        <aside className="pe-detail" aria-live="polite">
          <h3>ПРЕДПРОСМОТР</h3>
          <div className={`pe-stage pe-tier-${focus.tier}`}>
            <img key={focus.id} src={focus.art} alt={focus.label} decoding="async" draggable={false} className={focusOpen ? '' : 'is-locked'} />
          </div>
          <div className="pe-detail-title">
            <strong title={focus.label}>{focus.label}</strong>
            <span className={`pe-tag pe-tier-${focus.tier}`}>{TIER_LABEL[focus.tier]}</span>
          </div>
          <p className="pe-detail-state">Сейчас на планете: <b>{shown.label}</b></p>
          {hiddenAllianceSkin ? (
            <p className="pe-note">Облик «{saved.label}» скрыт: вы больше не глава союза. Станете главой снова, и он вернётся.</p>
          ) : null}
          {!focusOpen ? (
            <>
              <p className="pe-lock" data-qa-skin-lock>Облик союза. {lockReason}</p>
              <button type="button" className="pe-apply" disabled>ЗАКРЫТ</button>
            </>
          ) : focusIsShown ? (
            <button type="button" className="pe-apply is-done" disabled>ВЫБРАН</button>
          ) : (
            <button type="button" className="pe-apply" data-qa-skin-apply onClick={() => onChooseSkin(focus)}>ПРИМЕНИТЬ ОБЛИК</button>
          )}
          <small className="pe-help">Облик меняет только вид планеты, не её свойства.</small>
        </aside>
      </div>
    </section>
  );
}
