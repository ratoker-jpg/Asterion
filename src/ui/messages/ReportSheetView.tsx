import type { ReactNode } from 'react';

import { FactionGeneralPortrait } from '../FactionGeneralPortrait.tsx';
import { EmblemGlyph } from '../command/EmblemGlyph.tsx';
import { ResourceIcon } from '../resources/ResourceIcon.tsx';
import pirateWarlordArt from '../../../assets/source/characters/pirates/pirate_warlord.png';
import { asterionAssetIntegrationAssets } from '../../assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { getFactionCombatEntity } from '../../domain/combat/faction-catalog.ts';
import type { CommandState } from '../../domain/command/types.ts';
import type { ExplorationState } from '../../domain/exploration/ledger.ts';
import { formatReportCoordinate, letterSenderPortrait, roundsLabel, type ReportSheet } from '../../domain/reports/sheet.ts';
import type {
  ReportCategory,
  ReportFact,
  ReportItem,
  ReportPlace,
  ReportPortrait,
  ReportResourceGroup,
  ReportSide,
  ReportUnit,
  ReportUnitGroup,
} from '../../domain/reports/types.ts';
import type { UniverseCoordinate } from '../../domain/universe/types.ts';
import { getPiratePlanetArt } from '../../pirate-planet-art.ts';
import { EXPLORATION_ARTS } from '../../exploration-art.ts';

const numberFormat = new Intl.NumberFormat('ru-RU');
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export type UniverseTarget = { coordinate: UniverseCoordinate; planetId?: string; ownerId?: string };

type OpenPlace = (place: ReportPlace) => void;

const GLYPH_KEY: Record<ReportCategory, keyof typeof asterionAssetIntegrationAssets.reportIcons> = {
  personal: 'profile', system: 'system', battle: 'battle', command: 'command', arena: 'arena',
  flights: 'flights', alliances: 'alliances', achievements: 'achievements',
};

export function ReportGlyph({ kind }: { kind: ReportCategory }) {
  return <img className="reports-glyph-image" src={asterionAssetIntegrationAssets.reportIcons[GLYPH_KEY[kind]]} alt="" aria-hidden="true" draggable={false} />;
}

export function formatReportDate(timestamp?: string) {
  return timestamp ? dateTimeFormat.format(new Date(timestamp)) : 'Сейчас';
}

/** Same deterministic variant→art mapping as the Universe and Operations screens. */
function explorationArt(sheet: ReportSheet, exploration?: ExplorationState): string | null {
  const coordinate = sheet.place?.coordinate;
  if (!exploration || !coordinate || (sheet.kind !== 'exploration-recon' && sheet.kind !== 'expedition')) return null;
  const contact = Object.values(exploration.contacts)
    .filter((entry) => entry.coordinate.galaxy === coordinate.galaxy && entry.coordinate.system === coordinate.system && entry.coordinate.position === coordinate.position)
    .sort((a, b) => b.appearedAt - a.appearedAt)[0];
  if (!contact) return null;
  const arts = EXPLORATION_ARTS[contact.kind];
  return arts[contact.kind === 'anomaly' ? contact.variant - 1 : contact.variant + 2] ?? arts[0] ?? null;
}

/** The picture of the report in the list and in the header. */
export function ReportArtwork({ item, command }: { item: ReportItem; command?: CommandState }) {
  if (item.letter) return <Portrait portrait={letterSenderPortrait(item.letter.sender)} command={command} />;
  if (item.spyReport) return <img src={getFactionCombatEntity(item.spyReport.targetRaceId, 'spy-probe').art} alt="" aria-hidden="true" draggable={false} />;
  if (item.pirateReconReport) {
    const cycle = item.pirateReconReport.contactCycleKey.split(':');
    return <img src={getPiratePlanetArt(Number(cycle[2]), Number(cycle[3]))} alt="" aria-hidden="true" draggable={false} />;
  }
  return <ReportGlyph kind={item.category} />;
}

function PlaceLink({ place, onOpen }: { place: ReportPlace; onOpen?: OpenPlace }) {
  if (!place.coordinate) return place.name ? <span className="reports-sheet-place__name">{place.name}</span> : null;
  const text = formatReportCoordinate(place.coordinate);
  return <>
    {place.name ? <span className="reports-sheet-place__name">{place.name}</span> : null}
    <button type="button" className="reports-v3-coord" disabled={!onOpen} aria-label={`${place.name ? `${place.name} ` : ''}${text}: открыть на карте`} onClick={() => onOpen?.(place)}>{text}{onOpen ? <span aria-hidden="true"> ↗</span> : null}</button>
  </>;
}

function Portrait({ portrait, command }: { portrait?: ReportPortrait; command?: CommandState }) {
  if (!portrait) return <span className="reports-sheet-portrait reports-sheet-portrait--empty" aria-hidden="true" />;
  if (portrait.kind === 'pirate') return <span className="reports-sheet-portrait"><span className="faction-general-portrait" data-faction="pirates"><img src={pirateWarlordArt} alt="" /></span></span>;
  if (portrait.kind === 'faction') return <span className="reports-sheet-portrait"><FactionGeneralPortrait factionId={portrait.factionId} /></span>;
  if (portrait.kind === 'art') return <span className="reports-sheet-portrait"><img src={portrait.src} alt="" /></span>;
  if (portrait.kind === 'crest') {
    const alliance = command?.alliances.find((candidate) => candidate.id === portrait.allianceId);
    return <span className="reports-sheet-portrait reports-sheet-portrait--crest">{alliance ? <EmblemGlyph emblem={alliance.emblem} /> : <ReportGlyph kind="alliances" />}</span>;
  }
  return <span className="reports-sheet-portrait reports-sheet-portrait--initial" aria-hidden="true">{portrait.text.toLocaleUpperCase('ru-RU')}</span>;
}

function Block({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className={`reports-sheet-block reports-sheet-block--${id}`} data-report-block={id} aria-label={title}>
    <header className="reports-sheet-block__head"><h3>{title}</h3>{aside ? <span>{aside}</span> : null}</header>
    {children}
  </section>;
}

function FactList({ facts, className = '' }: { facts: readonly ReportFact[]; className?: string }) {
  return <dl className={`reports-sheet-facts ${className}`}>{facts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

function SideCard({ side, command, onOpen }: { side: ReportSide; command?: CommandState; onOpen?: OpenPlace }) {
  const before = side.population?.before;
  const after = side.population?.after;
  return <article className={`reports-battle-side reports-battle-side--${side.key} ${side.outcome ? `reports-battle-side--${side.outcome}` : ''}`}>
    <div className="reports-battle-general-art"><Portrait portrait={side.portrait} command={command} /></div>
    <div className="reports-battle-side-copy">
      <small>{side.role}</small>
      <strong>{side.name}</strong>
      {side.meta ? <span>{side.meta}</span> : null}
      {side.place?.coordinate ? <span className="reports-sheet-side-place"><PlaceLink place={{ ...side.place, name: undefined }} onOpen={onOpen} /></span> : null}
    </div>
    {side.population ? <div className="reports-battle-population"><small>Население</small><span><b>{before == null ? '—' : numberFormat.format(before)}</b><i aria-hidden="true">→</i><b>{after == null ? '—' : numberFormat.format(after)}</b></span></div> : null}
    {before != null && before > 0 && after != null ? <div className="reports-battle-population-bar" role="meter" aria-label="Оставшееся население" aria-valuemin={0} aria-valuemax={before} aria-valuenow={Math.max(0, Math.min(before, after))}><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, after / before))})` }} /></div> : null}
    {side.facts?.length ? <FactList facts={side.facts} className="reports-sheet-facts--side" /> : null}
  </article>;
}

function UnitRow({ unit, qa }: { unit: ReportUnit; qa?: Record<string, string> }) {
  const inspected = Boolean(unit.ability);
  return <article className={`spy-report-entity ${inspected ? 'spy-report-entity--inspected' : ''} ${unit.lost ? 'has-loss' : ''}`} tabIndex={inspected ? 0 : undefined} {...qa}>
    <span className="reports-v2-art reports-v2-entity-art">{unit.art ? <img src={unit.art} alt="" /> : null}</span>
    <div><strong>{unit.name}</strong>{unit.note ? <span>{unit.note}</span> : null}</div>
    {unit.percent != null
      ? <strong className="reports-sheet-unit-share">{unit.percent}%</strong>
      : <span className="reports-sheet-unit-count">
        <b>{unit.count == null ? '—' : numberFormat.format(unit.count)}</b>
        {unit.lost ? <em aria-label={`Потеряно ${numberFormat.format(unit.lost)}`}>−{numberFormat.format(unit.lost)}</em> : null}
      </span>}
    {unit.ability ? <span className="spy-entity-tooltip" role="tooltip"><strong>{unit.ability.title}</strong><span>{unit.ability.body}</span><b>Эффект: {unit.ability.effect}</b>{unit.ability.note ? <small>{unit.ability.note}</small> : null}</span> : null}
  </article>;
}

function UnitGroups({ groups, item }: { groups: readonly ReportUnitGroup[]; item: ReportItem }) {
  return <div className="reports-sheet-groups">{groups.map((group) => {
    const occupant = group.key === 'occupant-fleet' && item.occupantRecon;
    const pirate = group.key === 'pirate-composition';
    const groupQa: Record<string, string> = occupant ? { 'data-qa-occupant-report': item.occupantRecon!.ownerId, 'data-quality': item.occupantRecon!.quality } : {};
    return <div className={`reports-sheet-group ${group.tone === 'loss' ? 'reports-sheet-group--loss' : ''} ${occupant ? 'reports-occupant' : ''}`} key={group.key} data-report-group={group.key} {...groupQa}>
      <header><strong>{group.title}</strong>{group.total ? <span>{group.total}</span> : null}</header>
      {group.units.length
        ? <div className={`spy-report-entity-grid ${pirate ? 'pirate-recon-report-list' : ''}`}>{group.units.map((unit) => <UnitRow key={unit.key} unit={unit} qa={
          group.key === 'overpopulation-loss' ? { 'data-qa-overpopulation-loss': unit.key } : pirate ? { 'data-qa-pirate-recon-ship': unit.name } : undefined
        } />)}</div>
        : <p className={`spy-report-empty ${group.hidden ? 'is-hidden' : ''}`} {...(occupant && group.hidden ? { 'data-qa-occupant-fleet-hidden': '' } : {})}>{group.empty ?? 'Нет данных.'}</p>}
    </div>;
  })}</div>;
}

function ResourceGroups({ groups }: { groups: readonly ReportResourceGroup[] }) {
  return <div className="reports-sheet-groups reports-sheet-groups--resources">{groups.map((group) => <div className={`reports-sheet-group reports-sheet-group--${group.tone ?? 'neutral'}`} key={group.key} data-report-group={group.key}>
    <header><strong>{group.title}</strong></header>
    {group.items.length
      ? <div className="reports-sheet-resources">{group.items.map((resource) => <div className={`reports-v3-res reports-v3-res--${resource.kind}`} key={`${resource.kind}-${resource.label}`}>
        <ResourceIcon kind={resource.kind} /><span><small>{resource.label}</small><b>{group.tone === 'loss' ? '−' : ''}{numberFormat.format(resource.value)}</b></span>
      </div>)}</div>
      : <p className="spy-report-empty">{group.empty ?? 'Ничего.'}</p>}
  </div>)}</div>;
}

export function ReportSheetView({ item, sheet, exploration, command, onOpenUniverseTarget, onOpenPirateUniverse, lead }: {
  item: ReportItem;
  sheet: ReportSheet;
  exploration?: ExplorationState;
  command?: CommandState;
  onOpenUniverseTarget?: (target: UniverseTarget) => void;
  onOpenPirateUniverse?: (coordinate: UniverseCoordinate, contactCycleKey: string) => void;
  /** Extra strip above the header (the Sun raid strip of a Sun battle). */
  lead?: ReactNode;
}) {
  const openPlace: OpenPlace | undefined = onOpenUniverseTarget || onOpenPirateUniverse ? (place) => {
    if (!place.coordinate) return;
    if (place.pirateContactKey && onOpenPirateUniverse) onOpenPirateUniverse(place.coordinate, place.pirateContactKey);
    else onOpenUniverseTarget?.({ coordinate: place.coordinate, planetId: place.planetId, ownerId: place.ownerId });
  } : undefined;
  const legacy = sheet.kind === 'battle' || sheet.kind === 'spy' || sheet.kind === 'overpopulation' || sheet.kind === 'pirate-recon' ? sheet.kind : 'generic';
  const qa: Record<string, string> = {};
  if (item.spyReport) qa['data-qa-spy-report'] = item.spyReport.id;
  if (item.overpopulationReport) qa['data-qa-overpopulation-report'] = item.overpopulationReport.id;
  if (item.pirateReconReport) qa['data-qa-pirate-recon-report'] = item.pirateReconReport.id;
  if (item.letter) qa['data-qa-letter'] = item.letter.kind;
  const art = explorationArt(sheet, exploration);
  const details = sheet.details.length || sheet.rounds.length || sheet.sections?.length;
  const assetsTitle = sheet.assets.length && sheet.assets.every((group) => group.key.startsWith('defense')) ? 'Оборона' : 'Постройки, оборона, науки';
  return (
    <article className={`reports-dossier reports-sheet reports-dossier--${legacy} reports-v2-tone-${sheet.result.tone}`} data-report-sheet={sheet.kind} {...qa}>
      {lead}
      <header className="reports-dossier-heading">
        <div className="reports-dossier-heading__icon reports-v2-art">{art ? <img src={art} alt="" aria-hidden="true" draggable={false} /> : <ReportArtwork item={item} />}</div>
        <div className="reports-dossier-heading__copy">
          <small className="reports-sheet-kind">{sheet.typeLabel}</small>
          <h2 data-report-title>{sheet.title}</h2>
          {sheet.place ? <p className="reports-sheet-place"><PlaceLink place={sheet.place} onOpen={openPlace} /></p> : null}
        </div>
        <div className="reports-dossier-heading__status">
          <span className={`reports-sheet-result reports-status reports-status--${sheet.result.tone}`} data-report-result>{sheet.result.label}</span>
          <time data-report-time dateTime={sheet.time}>{formatReportDate(sheet.time)}</time>
        </div>
      </header>
      {sheet.summary ? <p className="reports-sheet-summary">{sheet.summary}</p> : null}
      {sheet.sides.length ? <Block id="sides" title={sheet.kind === 'letter' ? 'Отправитель' : 'Участники'}>
        <div className={`reports-sheet-sides reports-sheet-sides--${sheet.sides.length}`}>
          {sheet.sides.map((side, index) => <SideCard key={side.key + index} side={side} command={command} onOpen={openPlace} />)}
        </div>
      </Block> : null}
      {sheet.resources.length ? <Block id="resources" title="Ресурсы"><ResourceGroups groups={sheet.resources} /></Block> : null}
      {sheet.ships.length ? <Block id="ships" title="Корабли"><UnitGroups groups={sheet.ships} item={item} /></Block> : null}
      {sheet.assets.length ? <Block id="assets" title={assetsTitle}><UnitGroups groups={sheet.assets} item={item} /></Block> : null}
      {details ? <details className="reports-sheet-details" data-report-block="details">
        <summary><span>Подробности</span>{sheet.rounds.length ? <small>{roundsLabel(sheet.rounds.length)}</small> : null}</summary>
        <div className="reports-sheet-details__body">
          {sheet.details.length ? <FactList facts={sheet.details} /> : null}
          {sheet.sections?.length ? <div className="reports-sheet-sections">{sheet.sections.map((section) => <section key={section.title} className="reports-sheet-section">
            <strong>{section.title}</strong>
            <FactList facts={section.facts} className="reports-sheet-facts--round" />
          </section>)}</div> : null}
          {sheet.rounds.length ? <ol className="reports-sheet-rounds">{sheet.rounds.map((round) => <li key={round.index}>
            <strong>Раунд {round.index}</strong>
            <FactList facts={round.facts} className="reports-sheet-facts--round" />
          </li>)}</ol> : null}
        </div>
      </details> : null}
    </article>
  );
}
