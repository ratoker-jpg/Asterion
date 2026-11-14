import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

import {
  ALLIANCE_DESCRIPTION_MAX,
  MAX_ALLIANCE_MEMBERS,
  ALLIANCE_MOTTO_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_TAG_MAX,
} from '../../domain/command/catalog.ts';
import { CREST_COLORS, CREST_GLYPHS, crestLabel } from '../../domain/command/crest.ts';
import { suggestAllianceTag } from '../../domain/command/emblem.ts';
import { emblemFromCrest, FOUNDING_PRESETS, randomFoundingCrest } from '../../domain/command/founding.ts';
import type { AllianceCrest, AllianceSettingsInput } from '../../domain/command/types.ts';
import { CrestConstructor } from './crest/CrestConstructor';
import { OrbitalCrest } from './crest/OrbitalCrest';
import { Dialog } from './Dialog';
import { ACCENT_COLORS, EmblemGlyph } from './EmblemGlyph';
import { applyRichMark, renderRichText, type RichMark } from './rich-text';
import './alliance-founding.css';

type Result = { ok: true; message?: string } | { ok: false; message: string };
type Step = 1 | 2 | 3;

/** The player's capital as the galaxy map shows it: where the alliance tag appears first. */
export type FoundingCapital = Readonly<{ planetName: string; ownerName: string; art: string }>;

const STEPS: ReadonlyArray<readonly [Step, string]> = [[1, 'Знамя'], [2, 'О союзе'], [3, 'Основание']];
const sameLook = (left: AllianceCrest, right: AllianceCrest) => left.frame === right.frame && left.field === right.field && left.glyph === right.glyph && left.color === right.color && left.pattern === right.pattern;

/**
 * «Основание союза» (concept «Достижения, титулы и облик», section 8): the
 * banner first — a large crest from the first second, six ready looks, the
 * sign, the alliance colour, name, tag and motto; then the description; then a
 * summary with the founding button. The right column shows how others will
 * see the alliance: the catalog row, the tag on the galaxy map, a letter.
 */
export function AllianceFounding({ leaderName, capital, validate, onSubmit, onClose }: {
  leaderName: string;
  capital?: FoundingCapital;
  /** The game's own settings check (lengths, tag letters, unique name and tag); null when fine. */
  validate: (settings: AllianceSettingsInput) => string | null;
  onSubmit: (settings: AllianceSettingsInput) => Result;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [crest, setCrest] = useState<AllianceCrest>(() => ({ ...FOUNDING_PRESETS[0]! }));
  const [name, setNameRaw] = useState('');
  const [tag, setTag] = useState('');
  const [tagAuto, setTagAuto] = useState(true);
  const [motto, setMotto] = useState('');
  const [description, setDescription] = useState('');
  const [tuning, setTuning] = useState(false);
  const [error, setError] = useState('');
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const settings: AllianceSettingsInput = { name, tag, motto, description, emblem: emblemFromCrest(crest) };
  const accent = ACCENT_COLORS[crest.color];
  const shownName = name.trim() || 'Название союза';
  const shownTag = tag.trim().toUpperCase() || 'ТЕГ';
  const shownMotto = motto.trim();
  const touch = () => setError('');
  const setName = (value: string) => { setNameRaw(value); if (tagAuto) setTag(suggestAllianceTag(value).slice(0, ALLIANCE_TAG_MAX)); touch(); };
  const pickCrest = (next: AllianceCrest) => { setCrest({ ...next }); touch(); };

  const bannerError = () => validate({ ...settings, description: '' });
  const go = (next: Step) => {
    if (next > 1 && step === 1) {
      const problem = bannerError();
      if (problem) { setError(problem); return; }
    }
    setError('');
    setStep(next);
  };
  const submit = () => {
    const problem = validate(settings);
    if (problem) { setError(problem); return; }
    const result = onSubmit(settings);
    if (result.ok) onClose();
    else setError(result.message);
  };
  const mark = (kind: RichMark) => {
    const field = descriptionRef.current;
    const start = field?.selectionStart ?? description.length;
    const end = field?.selectionEnd ?? description.length;
    const next = applyRichMark(description, start, end, kind);
    if (next.text.length > ALLIANCE_DESCRIPTION_MAX) { setError(`Описание — максимум ${ALLIANCE_DESCRIPTION_MAX} символов вместе с разметкой.`); return; }
    setDescription(next.text);
    touch();
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(next.start, next.end); });
  };

  if (tuning) {
    return (
      <Dialog title="Тонкая настройка герба" onClose={() => setTuning(false)} size="crest">
        <CrestConstructor initial={crest} onApply={(next) => { pickCrest(next); setTuning(false); }} onBack={() => setTuning(false)} />
      </Dialog>
    );
  }

  const rail = (
    <nav className="founding-rail" aria-label="Шаги основания">
      {STEPS.map(([id, label]) => (
        <button key={id} type="button" className={`${step === id ? 'is-on' : ''} ${step > id ? 'is-done' : ''}`} aria-current={step === id ? 'step' : undefined} onClick={() => go(id)} data-qa-founding-rail={id}>
          <i>{step > id ? '✓' : id}</i>{label}
        </button>
      ))}
    </nav>
  );

  return (
    <Dialog title="Основание союза" onClose={onClose} size="founding" headerExtra={rail}>
      <div className="founding" style={{ '--founding-accent': accent } as CSSProperties} data-qa-founding data-qa-founding-step={step}>
        <aside className="founding-hero">
          <EmblemGlyph emblem={settings.emblem} />
          <strong data-qa-founding-hero-name>{shownName}</strong>
          <span className="founding-tag">[{shownTag}]</span>
          {shownMotto ? <p className="founding-motto">«{shownMotto}»</p> : <p className="founding-motto is-empty">Девиз союза</p>}
          <div className="founding-hero-actions">
            <button type="button" onClick={() => pickCrest(randomFoundingCrest())} data-qa-crest-random>Случайный герб</button>
            <button type="button" onClick={() => setTuning(true)} data-qa-crest-open>Тонкая настройка</button>
          </div>
        </aside>

        <div className="founding-main">
          {step === 1 ? (
            <>
              <Field label="Готовые образы — с них удобно начать" hint="или соберите свой ниже">
                <div className="founding-picks founding-picks--presets">
                  {FOUNDING_PRESETS.map((preset, index) => (
                    <button key={index} type="button" className={sameLook(preset, crest) ? 'is-on' : ''} aria-label={`Образ ${index + 1}: ${crestLabel('glyphs', preset.glyph)}, ${crestLabel('colors', preset.color)}`} aria-pressed={sameLook(preset, crest)} onClick={() => pickCrest(preset)} data-qa-preset={index}>
                      <OrbitalCrest crest={preset} size={74} />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Знак" hint={`${CREST_GLYPHS.length} знаков`}>
                <div className="founding-picks founding-picks--glyphs">
                  {CREST_GLYPHS.map((glyph) => (
                    <button key={glyph} type="button" className={crest.glyph === glyph ? 'is-on' : ''} aria-label={crestLabel('glyphs', glyph)} aria-pressed={crest.glyph === glyph} data-tip={crestLabel('glyphs', glyph)} onClick={() => pickCrest({ ...crest, glyph })} data-qa-glyph={glyph}>
                      <OrbitalCrest crest={{ ...crest, glyph, rotation: 0, mirrorX: false, offsetX: 0, offsetY: 0 }} size={46} />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Цвет союза — им окрашены знак, тег и девиз">
                <div className="founding-colors">
                  {CREST_COLORS.map((color) => (
                    <button key={color} type="button" className={crest.color === color ? 'is-on' : ''} aria-pressed={crest.color === color} style={{ '--swatch': ACCENT_COLORS[color] } as CSSProperties} onClick={() => pickCrest({ ...crest, color })} data-qa-color={color}>
                      {crestLabel('colors', color)}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="founding-two">
                <Field label="Название" hint={`${name.length} / ${ALLIANCE_NAME_MAX}`}>
                  <input value={name} maxLength={ALLIANCE_NAME_MAX} placeholder="от 3 знаков" onChange={(event) => setName(event.target.value)} data-qa-alliance-name />
                </Field>
                <Field label="Тег" hint={tagAuto ? 'из названия' : `до ${ALLIANCE_TAG_MAX}`}>
                  <div className="founding-tag-field">
                    <input value={tag} maxLength={ALLIANCE_TAG_MAX} onChange={(event) => { setTagAuto(false); setTag(event.target.value); touch(); }} data-qa-alliance-tag />
                    <button type="button" className={tagAuto ? 'is-on' : ''} aria-label="Сформировать тег из названия" aria-pressed={tagAuto} onClick={() => { setTagAuto(true); setTag(suggestAllianceTag(name).slice(0, ALLIANCE_TAG_MAX)); touch(); }} data-qa-tag-auto>Авто</button>
                  </div>
                </Field>
              </div>
              <Field label="Девиз" hint={`${motto.length} / ${ALLIANCE_MOTTO_MAX}`}>
                <input value={motto} maxLength={ALLIANCE_MOTTO_MAX} placeholder="по желанию" onChange={(event) => { setMotto(event.target.value); touch(); }} data-qa-alliance-motto />
              </Field>
            </>
          ) : step === 2 ? (
            <>
              <Field label="Описание — его прочтут те, кто выбирает союз" hint={`${description.length} / ${ALLIANCE_DESCRIPTION_MAX}`}>
                <div className="cmdA-format-bar" role="toolbar" aria-label="Форматирование описания">
                  <button type="button" aria-label="Жирный" data-tip="Жирный" onClick={() => mark('bold')} data-qa-format="bold"><b>Ж</b></button>
                  <button type="button" aria-label="Курсив" data-tip="Курсив" onClick={() => mark('italic')} data-qa-format="italic"><i>К</i></button>
                  <button type="button" aria-label="Подчёркнутый" data-tip="Подчёркнутый" onClick={() => mark('underline')} data-qa-format="underline"><u>Ч</u></button>
                  <span>Выделите текст и нажмите кнопку</span>
                </div>
                <textarea ref={descriptionRef} value={description} maxLength={ALLIANCE_DESCRIPTION_MAX} rows={4} placeholder="Кого вы ищете, чем союз занимается, как помогаете друг другу" onChange={(event) => { setDescription(event.target.value); touch(); }} data-qa-alliance-description />
              </Field>
              <Field label="Карточка союза — так её видят в каталоге">
                <div className="founding-card">
                  <EmblemGlyph emblem={settings.emblem} />
                  <div>
                    <b>{shownName} <i>[{shownTag}]</i></b>
                    {shownMotto ? <p className="founding-motto">«{shownMotto}»</p> : null}
                    <div className="founding-card-desc">{description.trim() ? renderRichText(description) : <em>Описание союза появится здесь.</em>}</div>
                    <small>Глава: {leaderName} · 1 из {MAX_ALLIANCE_MEMBERS} · набор открыт</small>
                  </div>
                </div>
              </Field>
            </>
          ) : (
            <>
              <Field label="Сводка">
                <dl className="founding-summary" data-qa-founding-summary>
                  <div><dt>Название</dt><dd>{shownName}</dd></div>
                  <div><dt>Тег</dt><dd className="is-accent">[{shownTag}]</dd></div>
                  <div><dt>Девиз</dt><dd>{shownMotto ? `«${shownMotto}»` : <em>без девиза</em>}</dd></div>
                  <div><dt>Герб</dt><dd>{crestLabel('glyphs', crest.glyph)} · {crestLabel('frames', crest.frame)} · {crestLabel('fields', crest.field)} · {crestLabel('colors', crest.color)}</dd></div>
                  <div><dt>Описание</dt><dd>{description.trim() ? renderRichText(description) : <em>без описания</em>}</dd></div>
                </dl>
              </Field>
              <Field label="Что будет сразу после основания">
                <ul className="founding-next">
                  <li><b>Знамя поднимется</b><span>союз появится в каталоге, тег — у ваших планет на карте</span></li>
                  <li><b>Боты начнут присматриваться</b><span>первый экран союза покажет, кому он подходит, и позовёт их</span></li>
                  <li><b>Откроется облик главы</b><span>планету-столицу можно одеть в облик союза</span></li>
                </ul>
              </Field>
            </>
          )}
        </div>

        <aside className="founding-seen" aria-label="Так союз увидят другие">
          <h4>Так союз увидят другие</h4>
          <Field label="Каталог союзов">
            <div className="founding-seen-row">
              <EmblemGlyph compact emblem={settings.emblem} />
              <div><b>{shownName}</b><small>[{shownTag}] · 1 из {MAX_ALLIANCE_MEMBERS} · набор открыт</small></div>
              <span className="founding-new">новый</span>
            </div>
          </Field>
          {capital ? (
            <Field label="Галактика — ваша столица">
              <div className="founding-seen-map">
                <span className="founding-planet"><img src={capital.art} alt="" draggable={false} /><i>[{shownTag}]</i></span>
                <div><b>{capital.planetName} · {capital.ownerName}</b><small>тег союза рядом с вашими планетами</small></div>
              </div>
            </Field>
          ) : null}
          <Field label="Письмо от союза">
            <div className="founding-seen-row">
              <EmblemGlyph compact emblem={settings.emblem} />
              <div><b>[{shownTag}] {shownName}</b><small>{shownMotto ? `«${shownMotto}»` : 'девиз появится здесь'}</small></div>
            </div>
          </Field>
        </aside>
      </div>

      <footer className="founding-foot">
        {error ? <div className="command-error" role="alert" data-qa-command-error>{error}</div> : <span>Создание бесплатно. Название, герб и девиз глава сможет изменить в любой момент.</span>}
        <div className="command-actions">
          {step === 1 ? <button type="button" onClick={onClose}>Отмена</button> : <button type="button" onClick={() => go((step - 1) as Step)} data-qa-founding-back>Назад</button>}
          {step === 1 ? <button type="button" className="primary" onClick={() => go(2)} data-qa-founding-next>Далее: о союзе</button> : null}
          {step === 2 ? <button type="button" className="primary" onClick={() => go(3)} data-qa-founding-next>Далее: основание</button> : null}
          {step === 3 ? <button type="button" className="primary" onClick={submit} data-qa-alliance-submit>Основать союз</button> : null}
        </div>
      </footer>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="founding-field">
      <div className="founding-label"><span>{label}</span>{hint ? <small>{hint}</small> : null}</div>
      {children}
    </section>
  );
}
