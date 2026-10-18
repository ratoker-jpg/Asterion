import { useRef, useState, type CSSProperties } from 'react';

import {
  ALLIANCE_DESCRIPTION_MAX,
  ALLIANCE_MOTTO_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_TAG_MAX,
} from '../../domain/command/catalog.ts';
import { crestLabel, DEFAULT_ALLIANCE_CREST } from '../../domain/command/crest.ts';
import { cloneEmblem, suggestAllianceTag } from '../../domain/command/emblem.ts';
import type { AllianceCrest, AllianceSettingsInput } from '../../domain/command/types.ts';
import { CrestConstructor } from './crest/CrestConstructor';
import { Dialog } from './Dialog';
import { ACCENT_COLORS, EmblemGlyph } from './EmblemGlyph';
import { applyRichMark, renderRichText, type RichMark } from './rich-text';

type Result = { ok: true; message?: string } | { ok: false; message: string };

/**
 * «Студия союза»: the single editor used to found an alliance and to edit it.
 * Left — a live preview (crest, name, tag, motto, formatted description, the
 * catalog row); right — the basics, the description with formatting, and the
 * crest card that opens the full-window «Конструктор герба» (Orbital Houses).
 */
export function AllianceEditor({ title, submitLabel, initial, onSubmit, onClose }: {
  title: string;
  submitLabel: string;
  initial: AllianceSettingsInput;
  onSubmit: (settings: AllianceSettingsInput) => Result;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AllianceSettingsInput>({ ...initial, emblem: cloneEmblem(initial.emblem) });
  const [crestOpen, setCrestOpen] = useState(false);
  // A new alliance follows its name until the player edits the tag by hand.
  const [tagAuto, setTagAuto] = useState(!initial.tag);
  const [error, setError] = useState('');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const set = (patch: Partial<AllianceSettingsInput>) => { setDraft((current) => ({ ...current, ...patch })); setError(''); };
  // Applying a crest keeps the legacy fields untouched and mirrors the colour into
  // `accent`, which still tints the alliance UI (motto, glow).
  const applyCrest = (crest: AllianceCrest) => { set({ emblem: { ...draft.emblem, accent: crest.color, crest } }); setCrestOpen(false); };
  const setName = (name: string) => set(tagAuto ? { name, tag: suggestAllianceTag(name).slice(0, ALLIANCE_TAG_MAX) } : { name });
  const submit = () => {
    const result = onSubmit(draft);
    if (result.ok) onClose();
    else setError(result.message);
  };
  const mark = (kind: RichMark) => {
    const field = descriptionRef.current;
    const start = field?.selectionStart ?? draft.description.length;
    const end = field?.selectionEnd ?? draft.description.length;
    const next = applyRichMark(draft.description, start, end, kind);
    if (next.text.length > ALLIANCE_DESCRIPTION_MAX) { setError(`Описание — максимум ${ALLIANCE_DESCRIPTION_MAX} символов вместе с разметкой.`); return; }
    set({ description: next.text });
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(next.start, next.end); });
  };

  const accent = ACCENT_COLORS[draft.emblem.accent];
  const crest = draft.emblem.crest;
  const tagText = draft.tag.trim().toUpperCase() || 'TAG';

  if (crestOpen) {
    return (
      <Dialog title="Конструктор герба" onClose={() => setCrestOpen(false)} size="crest">
        <CrestConstructor initial={crest ?? { ...DEFAULT_ALLIANCE_CREST, color: draft.emblem.accent }} onApply={applyCrest} onBack={() => setCrestOpen(false)} />
      </Dialog>
    );
  }

  return (
    <Dialog title={title} onClose={onClose} size="studio">
      <div className="command-editor cmdA-studio">
        <aside className="command-editor-preview cmdA-studio-preview" style={{ '--command-emblem': accent } as CSSProperties}>
          <small>ПРЕДПРОСМОТР</small>
          <EmblemGlyph emblem={draft.emblem} />
          <strong>{draft.name.trim() || 'Название союза'}</strong>
          <span>[{tagText}]</span>
          <p className="cmdA-studio-motto">{draft.motto.trim() ? `«${draft.motto.trim()}»` : 'Девиз союза'}</p>
          <div className="cmdA-studio-desc">{draft.description.trim() ? renderRichText(draft.description) : <em>Описание союза</em>}</div>
          <div className="cmdA-studio-row" aria-hidden="true">
            <EmblemGlyph compact emblem={draft.emblem} />
            <div><b>{draft.name.trim() || 'Название союза'} <i>[{tagText}]</i></b><small>Так союз выглядит в каталоге</small></div>
          </div>
        </aside>

        <div className="command-editor-form cmdA-studio-form">
          <section className="cmdA-studio-section">
            <h4>Основное</h4>
            <div className="cmdA-studio-grid">
              <label><span>НАЗВАНИЕ · 3–{ALLIANCE_NAME_MAX}</span><input value={draft.name} maxLength={ALLIANCE_NAME_MAX} onChange={(event) => setName(event.target.value)} data-qa-alliance-name /></label>
              <label className="cmdA-tag-field">
                <span>ТЕГ · 2–{ALLIANCE_TAG_MAX}{tagAuto ? ' · ИЗ НАЗВАНИЯ' : ''}</span>
                <div>
                  <input value={draft.tag} maxLength={ALLIANCE_TAG_MAX} onChange={(event) => { setTagAuto(false); set({ tag: event.target.value }); }} data-qa-alliance-tag />
                  <button type="button" className={tagAuto ? 'is-on' : ''} title="Сформировать тег из названия" onClick={() => { setTagAuto(true); set({ tag: suggestAllianceTag(draft.name).slice(0, ALLIANCE_TAG_MAX) }); }} data-qa-tag-auto>АВТО</button>
                </div>
              </label>
              <label className="wide"><span>ДЕВИЗ · ДО {ALLIANCE_MOTTO_MAX}</span><input value={draft.motto} maxLength={ALLIANCE_MOTTO_MAX} onChange={(event) => set({ motto: event.target.value })} /></label>
            </div>
          </section>

          <section className="cmdA-studio-section">
            <h4>Описание <small>{draft.description.length} / {ALLIANCE_DESCRIPTION_MAX}</small></h4>
            <div className="cmdA-format-bar" role="toolbar" aria-label="Форматирование описания">
              <button type="button" title="Жирный" onClick={() => mark('bold')} data-qa-format="bold"><b>Ж</b></button>
              <button type="button" title="Курсив" onClick={() => mark('italic')} data-qa-format="italic"><i>К</i></button>
              <button type="button" title="Подчёркнутый" onClick={() => mark('underline')} data-qa-format="underline"><u>Ч</u></button>
              <span>Выделите текст и нажмите кнопку</span>
            </div>
            <textarea ref={descriptionRef} value={draft.description} maxLength={ALLIANCE_DESCRIPTION_MAX} rows={3} onChange={(event) => set({ description: event.target.value })} data-qa-alliance-description />
          </section>

          <section className="cmdA-studio-section cmdA-crest-card">
            <h4>Герб союза</h4>
            <div className="cmdA-crest-card-body">
              <button type="button" className="cmdA-crest-card-preview" onClick={() => setCrestOpen(true)} aria-label="Открыть конструктор герба"><EmblemGlyph emblem={draft.emblem} /></button>
              <div className="cmdA-crest-card-text">
                {crest ? (
                  <>
                    <b>{crestLabel('glyphs', crest.glyph)}</b>
                    <dl>
                      <div><dt>Цвет</dt><dd>{crestLabel('colors', crest.color)}</dd></div>
                      <div><dt>Рамка</dt><dd>{crestLabel('frames', crest.frame)}</dd></div>
                      <div><dt>Эмаль</dt><dd>{crestLabel('fields', crest.field)}</dd></div>
                      <div><dt>Узор</dt><dd>{crestLabel('patterns', crest.pattern)}</dd></div>
                    </dl>
                  </>
                ) : (
                  <>
                    <b>Прежний герб</b>
                    <p>Он остаётся без изменений, пока вы не соберёте новый герб «Орбитальных домов» в конструкторе.</p>
                  </>
                )}
              </div>
              <button type="button" className="primary cmdA-crest-card-open" onClick={() => setCrestOpen(true)} data-qa-crest-open>КОНСТРУКТОР ГЕРБА</button>
            </div>
          </section>

          {error ? <div className="command-error" role="alert" data-qa-command-error>{error}</div> : null}
          <div className="command-actions">
            <button type="button" className="danger" onClick={onClose}>ОТМЕНА</button>
            <button type="button" className="primary" onClick={submit} data-qa-alliance-submit>{submitLabel}</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
