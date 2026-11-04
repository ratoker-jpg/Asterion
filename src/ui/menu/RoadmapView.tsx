import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import raw from '../../../changelog/roadmap.json';
import { RAIL_PLANS_MARK, formatDay, formatRange, nextRow, pluralRu, railLayout, railPosition, roadmapStats, type EraBox, type RoadmapData, type RoadmapMilestone, type RoadmapPr } from './roadmap.ts';
import './roadmap.css';

const data = raw as unknown as RoadmapData;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const PLANS_ID = 'plans';

const STATUS_TAG: Record<RoadmapPr['status'], string | null> = { done: null, open: 'в работе', closed: 'не вошло в игру' };

type RowProps = { pr: RoadmapPr; milestone?: RoadmapMilestone; open: boolean; tabbable: boolean; at: number; onToggle: (n: number) => void; onFocusRow: (n: number) => void };

/** One mark on the line. Details exist in the page only while open. */
const Row = memo(function Row({ pr, milestone, open, tabbable, at, onToggle, onFocusRow }: RowProps) {
  const tag = STATUS_TAG[pr.status];
  const details = `roadmap-row-${pr.n}`;
  return (
    <li className={`rm-row is-${pr.status} ${milestone ? 'is-milestone' : ''} ${open ? 'is-open' : ''}`} style={{ '--rm-at': Math.min(at, 14) } as CSSProperties} data-qa-roadmap-entry={pr.n}>
      <button
        type="button"
        className="rm-row__head"
        aria-expanded={open}
        aria-controls={open ? details : undefined}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onToggle(pr.n)}
        onFocus={() => onFocusRow(pr.n)}
        data-qa-roadmap-row={pr.n}
      >
        <span className="rm-row__node" aria-hidden="true" />
        <span className="rm-row__date">{formatDay(pr.date)}</span>
        <span className="rm-row__title">
          {milestone ? <small>{milestone.title}</small> : null}
          <b>{pr.title}</b>
        </span>
        {tag ? <span className={`rm-row__tag is-${pr.status}`}>{tag}</span> : null}
        {pr.decision ? <span className="rm-row__decision-dot" aria-label="Есть решение владельца" /> : null}
        <span className="rm-row__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div id={details} className="rm-row__more" data-qa-roadmap-details={pr.n}>
          <div>
            <p>{pr.text}</p>
            {pr.decision ? <p className="rm-row__decision"><span>Решение владельца</span>{pr.decision}</p> : null}
            <p className="rm-row__meta">№{pr.n}{pr.version ? ` · версия ${pr.version}` : ''}</p>
          </div>
        </div>
      ) : null}
    </li>
  );
});

type RailTip = { at: number; title: string; sub: string };

/** The whole journey at a glance: every row a tick, every era a stretch, milestones as big marks. */
function Rail({ current, atPlans, pointerRef, fillRef, onEra, onMilestone, onPlans }: {
  current: number;
  atPlans: boolean;
  pointerRef: React.RefObject<HTMLDivElement | null>;
  fillRef: React.RefObject<HTMLDivElement | null>;
  onEra: (index: number) => void;
  onMilestone: (pr: number) => void;
  onPlans: () => void;
}) {
  const layout = useMemo(() => railLayout(data), []);
  const [tip, setTip] = useState<RailTip | null>(null);
  const [focusAt, setFocusAt] = useState(0);
  const eraRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const ticks = useMemo(() => {
    const path = (off: boolean) => layout.ticks.filter((tick) => tick.off === off).map((tick) => `M${(tick.at * 1000).toFixed(1)} 0V10`).join('');
    return { on: path(false), off: path(true) };
  }, [layout]);

  const onEraKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = Math.min(layout.eras.length - 1, Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)));
    setFocusAt(next);
    eraRefs.current[next]?.focus();
    onEra(next);
  };

  let side = 0;
  return (
    <div className="rm-rail" role="group" aria-label="Вся история игры: главы" data-qa-roadmap-rail onMouseLeave={() => setTip(null)}>
      <div className="rm-rail__base" aria-hidden="true" />
      <div ref={fillRef} className="rm-rail__fill" aria-hidden="true" />
      <svg className="rm-rail__ticks" viewBox="0 0 1000 10" preserveAspectRatio="none" aria-hidden="true">
        <path d={ticks.on} />
        <path className="is-off" d={ticks.off} />
      </svg>
      {layout.eras.map((era, index) => {
        const title = data.eras.find((entry) => entry.id === era.id)?.title ?? '';
        const sub = `Глава ${index + 1} · ${formatRange(era.first, era.last)} · ${era.count} ${pluralRu(era.count, ['запись', 'записи', 'записей'])}`;
        const middle = (era.from + era.to) / 2;
        return (
          <button
            key={era.id}
            ref={(element) => { eraRefs.current[index] = element; }}
            type="button"
            className={`rm-rail__era ${index === current && !atPlans ? 'is-on' : ''}`}
            style={{ left: `${era.from * 100}%`, width: `${(era.to - era.from) * 100}%` }}
            tabIndex={index === focusAt ? 0 : -1}
            aria-label={`${title}. ${sub}`}
            aria-current={index === current && !atPlans ? 'true' : undefined}
            onClick={() => { setFocusAt(index); onEra(index); }}
            onKeyDown={(event) => onEraKey(event, index)}
            onMouseEnter={() => setTip({ at: middle, title, sub })}
            onFocus={() => setTip({ at: middle, title, sub })}
            onBlur={() => setTip(null)}
            data-qa-roadmap-era-jump={era.id}
          >
            <i />
          </button>
        );
      })}
      {layout.marks.map((mark, index) => {
        const labelled = Boolean(mark.rail);
        const below = labelled && side++ % 2 === 1;
        return (
          <button
            key={mark.pr}
            type="button"
            className={`rm-rail__mark ${labelled ? 'is-labelled' : ''} ${mark.at < 0.06 ? 'is-start' : ''}`}
            style={{ left: `${mark.at * 100}%`, '--rm-at': index } as CSSProperties}
            tabIndex={-1}
            aria-label={`${mark.title}, ${formatDay(mark.date)}`}
            onClick={() => onMilestone(mark.pr)}
            onMouseEnter={() => setTip({ at: mark.at, title: mark.title, sub: formatDay(mark.date) })}
            data-qa-roadmap-mark={mark.pr}
          >
            <s />
            {labelled ? <span className={below ? 'is-below' : ''}>{mark.rail}</span> : null}
          </button>
        );
      })}
      <button
        type="button"
        className={`rm-rail__plans ${atPlans ? 'is-on' : ''}`}
        style={{ left: `${RAIL_PLANS_MARK * 100}%` }}
        aria-label="Дальше: планы"
        onClick={onPlans}
        onMouseEnter={() => setTip({ at: 0.97, title: 'Дальше', sub: 'планы, а не обещания' })}
        onFocus={() => setTip({ at: 0.97, title: 'Дальше', sub: 'планы, а не обещания' })}
        onBlur={() => setTip(null)}
        data-qa-roadmap-plans-jump
      >
        <s />
        <span>Дальше</span>
      </button>
      <div ref={pointerRef} className="rm-rail__pointer" aria-hidden="true"><i /></div>
      {tip ? (
        <div className="rm-rail__tip" style={{ left: `clamp(120px, ${tip.at * 100}%, calc(100% - 120px))` }} role="status" data-qa-roadmap-tip>
          <b>{tip.title}</b>
          <small>{tip.sub}</small>
        </div>
      ) : null}
    </div>
  );
}

function Stats() {
  const stats = roadmapStats(data);
  const items = [
    { value: stats.shipped, label: pluralRu(stats.shipped, ['доработка', 'доработки', 'доработок']) },
    { value: stats.days, label: pluralRu(stats.days, ['день', 'дня', 'дней']) },
    { value: stats.releases, label: pluralRu(stats.releases, ['выпуск', 'выпуска', 'выпусков']) },
  ];
  return (
    <div className="rm-stats" data-qa-roadmap-stats>
      {items.map((item, index) => (
        <div key={item.label} style={{ '--rm-at': index } as CSSProperties}><b>{item.value}</b><span>{item.label}</span></div>
      ))}
    </div>
  );
}

/** The story of the game. Opens at the very beginning; the line lights up as you read on. */
export default function RoadmapView({ statsSlot }: { statsSlot: HTMLElement | null }) {
  const rows = data.prs;
  const milestones = useMemo(() => new Map(data.milestones.map((entry) => [entry.pr, entry])), []);
  const eras = useMemo(() => data.eras.map((era) => {
    const list = rows.filter((pr) => pr.era === era.id);
    return { ...era, rows: list, marks: list.flatMap((pr) => { const mark = milestones.get(pr.n); return mark ? [{ ...mark, date: pr.date }] : []; }) };
  }), [rows, milestones]);
  const layout = useMemo(() => railLayout(data), []);
  const stats = useMemo(() => roadmapStats(data), []);

  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(rows[0]?.n ?? 0);
  const [current, setCurrent] = useState(0);
  const [atPlans, setAtPlans] = useState(false);
  const [entered, setEntered] = useState<ReadonlySet<string>>(() => new Set(eras[0] ? [eras[0].id] : []));

  const scrollRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const spineRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const plansRef = useRef<HTMLElement>(null);
  const boxesRef = useRef<EraBox[]>([]);
  const anchorRef = useRef<{ n: number; top: number } | null>(null);
  const frameRef = useRef(0);

  // Scrolling only moves transforms; React is touched when the chapter changes.
  const paint = useCallback(() => {
    frameRef.current = 0;
    const scroller = scrollRef.current;
    const flow = flowRef.current;
    if (!scroller || !flow) return;
    const position = railPosition(scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight, boxesRef.current);
    if (pointerRef.current) pointerRef.current.style.transform = `translateX(${(position.at * 100).toFixed(3)}%)`;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${position.at.toFixed(4)})`;
    if (spineRef.current) spineRef.current.style.transform = `scaleY(${Math.min(1, Math.max(0, (position.line - flow.offsetTop) / Math.max(flow.offsetHeight, 1))).toFixed(4)})`;
    setCurrent(position.era);
    setAtPlans(plansRef.current ? position.line >= plansRef.current.offsetTop - 1 : false);
  }, []);
  const schedule = useCallback(() => { if (!frameRef.current) frameRef.current = requestAnimationFrame(paint); }, [paint]);

  const measure = useCallback(() => {
    const flow = flowRef.current;
    if (!flow) return;
    boxesRef.current = layout.eras.flatMap((era) => {
      const section = flow.querySelector<HTMLElement>(`[data-qa-roadmap-era="${era.id}"]`);
      return section ? [{ top: section.offsetTop + flow.offsetTop, height: section.offsetHeight, from: era.from, to: era.to }] : [];
    });
    schedule();
  }, [layout, schedule]);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (flowRef.current) observer.observe(flowRef.current);
    return () => {
      observer.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [measure]);

  // A chapter plays its entrance once, a moment before it comes into view.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setEntered(new Set(eras.map((era) => era.id)));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      const fresh = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset.qaRoadmapEra ?? '');
      if (fresh.length) setEntered((known) => new Set([...known, ...fresh]));
      for (const entry of entries) if (entry.isIntersecting) observer.unobserve(entry.target);
    }, { root: scroller, rootMargin: '0px 0px 160px 0px' });
    scroller.querySelectorAll('[data-qa-roadmap-era]').forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [eras]);

  const scrollToTop = useCallback((top: number) => {
    scrollRef.current?.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, []);

  const jumpToEra = useCallback((index: number) => {
    const box = boxesRef.current[index];
    if (box) scrollToTop(index === 0 ? 0 : box.top);
  }, [scrollToTop]);

  const jumpToPlans = useCallback(() => {
    if (plansRef.current) scrollToTop(plansRef.current.offsetTop);
  }, [scrollToTop]);

  const rowElement = useCallback((n: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-qa-roadmap-entry="${n}"]`) ?? null, []);

  const toggle = useCallback((n: number) => {
    const element = rowElement(n);
    anchorRef.current = element ? { n, top: element.getBoundingClientRect().top } : null;
    setActive(n);
    setOpen((value) => (value === n ? null : n));
  }, [rowElement]);

  // A row closing above must not pull the one just opened out from under the pointer.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!scroller || !anchor) return;
    const element = rowElement(anchor.n);
    if (!element) return;
    scroller.scrollTop += element.getBoundingClientRect().top - anchor.top;
    if (open !== anchor.n) return;
    // Room for the details as they unfold (they grow to their full size right after this frame).
    const frame = requestAnimationFrame(() => {
      const box = element.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      const below = box.top + element.scrollHeight - view.bottom + 24;
      if (below > 0) scroller.scrollBy({ top: Math.min(below, box.top - view.top - 12), behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, rowElement]);

  const focusRow = useCallback((n: number) => {
    setActive(n);
    const button = scrollRef.current?.querySelector<HTMLElement>(`[data-qa-roadmap-row="${n}"]`);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, []);

  const openMilestone = useCallback((n: number) => {
    setActive(n);
    setOpen(n);
    requestAnimationFrame(() => {
      const element = rowElement(n);
      const scroller = scrollRef.current;
      if (!element || !scroller) return;
      scrollToTop(scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight * 0.22);
    });
  }, [rowElement, scrollToTop]);

  const onRowsKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-qa-roadmap-row')) return;
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    // From the row that has the focus: a focus event is not promised while the window itself has none.
    focusRow(nextRow(rows, Number(event.target.getAttribute('data-qa-roadmap-row')), event.key));
  };

  return (
    <div className="rm" data-qa-roadmap>
      {statsSlot ? createPortal(<Stats />, statsSlot) : null}
      <Rail current={current} atPlans={atPlans} pointerRef={pointerRef} fillRef={fillRef} onEra={jumpToEra} onMilestone={openMilestone} onPlans={jumpToPlans} />
      <div className="rm__view">
        <div ref={scrollRef} className="rm__scroll" onScroll={schedule} onKeyDown={onRowsKey} data-qa-roadmap-scroll>
          <div ref={flowRef} className="rm__flow">
            <div className="rm__spine" aria-hidden="true"><div ref={spineRef} /></div>
            {eras.map((era, index) => {
              const box = layout.eras[index];
              return (
                <section key={era.id} className={`rm-era ${entered.has(era.id) ? 'is-in' : ''}`} aria-labelledby={`roadmap-era-${era.id}`} data-qa-roadmap-era={era.id}>
                  <div className="rm-era__story">
                    <small>ГЛАВА {index + 1} ИЗ {eras.length}{box ? ` · ${formatRange(box.first, box.last).toUpperCase()}` : ''}</small>
                    <h3 id={`roadmap-era-${era.id}`}>{era.title}</h3>
                    <p>{era.story}</p>
                    {era.marks.length ? (
                      <ul className="rm-era__marks">
                        {era.marks.map((mark) => (
                          <li key={mark.pr}>
                            <button type="button" onClick={() => openMilestone(mark.pr)} data-qa-roadmap-milestone={mark.pr}>
                              <i aria-hidden="true" /><span>{mark.title}<small>{formatDay(mark.date)}</small></span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <ol className="rm-era__rows">
                    {era.rows.map((pr, at) => (
                      <Row key={pr.n} pr={pr} milestone={milestones.get(pr.n)} open={open === pr.n} tabbable={active === pr.n} at={at} onToggle={toggle} onFocusRow={setActive} />
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
          <section ref={plansRef} className="rm-era rm-plans is-in" aria-labelledby="roadmap-plans" data-qa-roadmap-plans={PLANS_ID}>
            <div className="rm-era__story">
              <small>ПЛАНЫ, А НЕ ОБЕЩАНИЯ</small>
              <h3 id="roadmap-plans">Дальше</h3>
              <p>Вот что сейчас на столе. Что-то передвинется, что-то появится заново: как и всё в этой истории, решается по ходу игры.</p>
            </div>
            <ul className="rm-plans__list">
              {data.plans.map((plan) => (
                <li key={plan.title} data-qa-roadmap-plan>
                  <i aria-hidden="true" />
                  <div><b>{plan.title}</b><p>{plan.text}</p></div>
                </li>
              ))}
            </ul>
          </section>
          <footer className="rm-end" data-qa-roadmap-end>
            <p>{stats.days} {pluralRu(stats.days, ['день', 'дня', 'дней'])} и {stats.shipped} {pluralRu(stats.shipped, ['доработка', 'доработки', 'доработок'])}: от первых картинок до этого экрана. История продолжается.</p>
            <small>
              Записано до №{data.lastPr} на {formatDay(data.updated)}. Предложено {stats.proposed}: {stats.shipped} в игре, {stats.notShipped} не вошли{stats.inWork ? `, ${stats.inWork} в работе` : ''}. Следующее обновление этой страницы — на №{data.refresh.nextAt}.
            </small>
          </footer>
        </div>
        <div className="rm__fade rm__fade--top" aria-hidden="true" />
        <div className="rm__fade rm__fade--bottom" aria-hidden="true" />
      </div>
    </div>
  );
}
