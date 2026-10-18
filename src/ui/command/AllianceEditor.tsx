import { useRef, useState, type CSSProperties } from 'react';

import {
  ALLIANCE_DESCRIPTION_MAX,
  ALLIANCE_MOTTO_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_TAG_MAX,
} from '../../domain/command/catalog.ts';
import { EMBLEM_ACCENTS, EMBLEM_FIELD_COLORS, EMBLEM_FIELDS, EMBLEM_GLYPHS, EMBLEM_SHAPES, suggestAllianceTag } from '../../domain/command/emblem.ts';
import type { AllianceEmblem, AllianceSettingsInput } from '../../domain/command/types.ts';
import { Dialog } from './Dialog';
import {
  ACCENT_COLORS,
  ACCENT_LABELS,
  EmblemGlyph,
  FIELD_COLOR_LABELS,
  FIELD_COLORS,
  FIELD_LABELS,
  FieldSwatch,
  GLYPH_LABELS,
  SHAPE_LABELS,
  ShapeSwatch,
} from './EmblemGlyph';
import { applyRichMark, renderRichText, type RichMark } from './rich-text';

type Result = { ok: true; message?: string } | { ok: false; message: string };

/**
 * «Студия союза»: the single editor used to found an alliance and to edit it.
 * Left — a live preview (crest, name, tag, motto, formatted description, the
 * catalog row); right — the basics, the description with formatting, and the
 * coat-of-arms constructor (shape, field pattern, field colour, sign, sign colour).
 */
export function AllianceEditor({ title, submitLabel, initial, onSubmit, onClose }: {
  title: string;
  submitLabel: string;
  initial: AllianceSettingsInput;
  onSubmit: (settings: AllianceSettingsInput) => Result;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AllianceSettingsInput>({ ...initial, emblem: { ...initial.emblem } });
  // A new alliance follows its name until the player edits the tag by hand.
  const [tagAuto, setTagAuto] = useState(!initial.tag);
  const [error, setError] = useState('');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const set = (patch: Partial<AllianceSettingsInput>) => { setDraft((current) => ({ ...current, ...patch })); setError(''); };
  const setEmblem = (patch: Partial<AllianceEmblem>) => set({ emblem: { ...draft.emblem, ...patch } });
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
  const fieldColor = FIELD_COLORS[draft.emblem.fieldColor ?? 'abyss'];
  const tagText = draft.tag.trim().toUpperCase() || 'TAG';

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

          <section className="cmdA-studio-section">
            <h4>Конструктор герба</h4>
            <div className="command-emblem-row cmdA-crest-rows">
              <div><small>ЗНАК</small><div className="command-chip-row">
                {EMBLEM_GLYPHS.map((glyph) => (
                  <button key={glyph} type="button" aria-label={`Знак ${glyph}`} title={GLYPH_LABELS[glyph]} className={draft.emblem.glyph === glyph ? 'selected' : ''} onClick={() => setEmblem({ glyph })}><EmblemGlyph compact emblem={{ glyph, accent: draft.emblem.accent }} /></button>
                ))}
              </div></div>
              <div><small>ФОРМА</small><div className="cmdA-option-row">
                {EMBLEM_SHAPES.map((shape) => (
                  <button key={shape} type="button" title={SHAPE_LABELS[shape]} aria-label={`Форма: ${SHAPE_LABELS[shape]}`} className={(draft.emblem.shape ?? 'shield') === shape ? 'selected' : ''} onClick={() => setEmblem({ shape })} data-qa-emblem-shape={shape}><ShapeSwatch shape={shape} accent={accent} fieldColor={fieldColor} /><span>{SHAPE_LABELS[shape]}</span></button>
                ))}
              </div></div>
              <div><small>УЗОР ФОНА</small><div className="cmdA-option-row">
                {EMBLEM_FIELDS.map((field) => (
                  <button key={field} type="button" title={FIELD_LABELS[field]} aria-label={`Узор: ${FIELD_LABELS[field]}`} className={(draft.emblem.field ?? 'solid') === field ? 'selected' : ''} onClick={() => setEmblem({ field })} data-qa-emblem-field={field}><FieldSwatch field={field} accent={accent} fieldColor={fieldColor} /><span>{FIELD_LABELS[field]}</span></button>
                ))}
              </div></div>
              <div className="cmdA-crest-colors">
                <div><small>ЦВЕТ ФОНА</small><div className="cmdA-dot-row">
                  {EMBLEM_FIELD_COLORS.map((color) => (
                    <button key={color} type="button" aria-label={`Фон: ${FIELD_COLOR_LABELS[color]}`} title={FIELD_COLOR_LABELS[color]} className={`cmdA-field-dot ${(draft.emblem.fieldColor ?? 'abyss') === color ? 'selected' : ''}`} style={{ '--cmdA-dot': FIELD_COLORS[color] } as CSSProperties} onClick={() => setEmblem({ fieldColor: color })} data-qa-emblem-field-color={color} />
                  ))}
                </div></div>
                <div><small>ЦВЕТ ЗНАКА</small><div className="command-chip-row command-chip-row--accents">
                  {EMBLEM_ACCENTS.map((accentKey) => (
                    <button key={accentKey} type="button" aria-label={ACCENT_LABELS[accentKey]} title={ACCENT_LABELS[accentKey]} className={`command-accent-dot ${draft.emblem.accent === accentKey ? 'selected' : ''}`} style={{ '--command-accent-dot': ACCENT_COLORS[accentKey] } as CSSProperties} onClick={() => setEmblem({ accent: accentKey })} />
                  ))}
                </div></div>
              </div>
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
