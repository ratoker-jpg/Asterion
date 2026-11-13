
import type { SpyHunterNotice, SpyReportSnapshot } from '../espionage/types.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { ShipId } from '../combat/ids.ts';
import type { ExplorationReconOccupant } from '../exploration/ledger.ts';
import type { PirateReconReport } from '../pirates/recon-report.ts';

export type OrdinaryShipId = Exclude<ShipId, 'solar-satellite'>;

/** Overpopulation attrition loss; includes burned solar satellites. */
export type OverpopulationShipLoss = {
  shipId: ShipId;
  count: number;
};

/** Final, persisted summary emitted once when a planet's overpopulation episode ends. */
export type OverpopulationEpisodeReport = {
  id: string;
  planetId: string;
  planetName: string;
  factionId: CombatFactionId;
  populationBefore: number;
  populationAfter: number;
  capacity: number;
  episodeStartedAt: number;
  episodeEndedAt: number;
  removedShips: OverpopulationShipLoss[];
};

/** Persisted summary of one recycler mission arrival. */
export type RecyclerArrivalReport = {
  id: `recycler-arrival:${string}`;
  flightId: string;
  coordinate: { galaxy: number; system: number; position: number };
  arrivedAtMs: number;
  collectedDebris: number;
  remainingOrbitalDebris: number;
};

/** Persisted result of one gas-extraction mission arrival. */
export type GasExtractionArrivalReport = {
  id: `gas-extraction-arrival:${string}`;
  flightId: string;
  coordinate: { galaxy: number; system: number; position: number };
  arrivalAt: number;
  outcome: 'found' | 'missed';
  gasCollected: number;
  scrapCollected: number;
};

export type ReportCategory =
  | 'personal'
  | 'system'
  | 'battle'
  | 'command'
  | 'arena'
  | 'flights'
  | 'alliances'
  | 'achievements';

export type ReportFilter = 'all' | 'unread' | 'saved';
export type ReportStatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';
export type ReportSource = 'combat' | 'operations' | 'command' | 'espionage' | 'overpopulation' | 'recycling' | 'gas-extraction' | 'pirate-recon' | 'pirate-mission' | 'exploration' | 'flights' | 'letter';

export type ReportDetail = {
  label: string;
  value: string;
};

export type ReportAction = {
  kind: 'open_fleets' | 'simulate_battle' | 'recall_spy';
  label: string;
  missionId?: string;
};

export type ReportCoordinate = { galaxy: number; system: number; position: number };

/** Where a report happened: planet name and coordinates (the coordinates open the map). */
export type ReportPlace = {
  name?: string;
  coordinate?: ReportCoordinate;
  planetId?: string;
  ownerId?: string;
  /** Pirate contact cycle: the map opens the pirate contact instead of a plain coordinate. */
  pirateContactKey?: string;
};

/** The outcome in one word with its tone: «Победа», «Пусто», «Доставлено»… */
export type ReportResultWord = { label: string; tone: ReportStatusTone };

export type ReportPortrait =
  | { kind: 'faction'; factionId: string }
  | { kind: 'pirate' }
  | { kind: 'art'; src: string }
  | { kind: 'crest'; allianceId: string }
  | { kind: 'initial'; text: string };

/** One side of a report (block «Участники»): attacker, defender, target, sender… */
export type ReportSide = {
  key: string;
  role: string;
  name: string;
  meta?: string;
  place?: ReportPlace;
  portrait?: ReportPortrait;
  outcome?: 'winner' | 'loser' | 'draw';
  population?: { before: number | null; after: number | null };
  /** Short facts under the side: bonuses it fought with (sciences, commander), level, capacity… */
  facts?: ReportFact[];
};

/** One unit line of «Корабли» or «Постройки / Оборона / Науки». */
export type ReportUnit = {
  key: string;
  name: string;
  art?: string;
  /** Under the name: level or role. */
  note?: string;
  count?: number | null;
  lost?: number | null;
  /** Share of the population (pirate recon gives no counts). */
  percent?: number;
  /** Commander ability shown on hover. */
  ability?: { title: string; body: string; effect: string; note?: string };
};

export type ReportUnitGroup = {
  key: string;
  title: string;
  units: ReportUnit[];
  total?: string;
  /** Shown instead of units when there are none, or when they were not revealed. */
  empty?: string;
  hidden?: boolean;
  tone?: 'loss';
};

export type ReportResourceKind = 'metal' | 'minerals' | 'gas' | 'debris' | 'energy';
export type ReportResource = { kind: ReportResourceKind; label: string; value: number };
export type ReportResourceGroup = {
  key: string;
  title: string;
  items: ReportResource[];
  tone?: 'gain' | 'loss' | 'neutral';
  empty?: string;
};

export type ReportFact = { label: string; value: string };

/** One battle round in «Подробности». */
export type ReportRound = { index: number; facts: ReportFact[] };

/** Block data a source adapter fills; the sheet builder adds header and actions. */
export type ReportBlocks = {
  /** One line under the title; empty when the blocks already say everything. */
  summary?: string;
  place?: ReportPlace;
  result?: ReportResultWord;
  sides?: ReportSide[];
  ships?: ReportUnitGroup[];
  resources?: ReportResourceGroup[];
  assets?: ReportUnitGroup[];
  details?: ReportFact[];
};

/** «Личные»: who wrote the letter. */
export type LetterSender =
  | { kind: 'alliance'; name: string; tag?: string; allianceId?: string }
  | { kind: 'player'; ownerId: string; name: string; factionId?: string; alliance?: { name: string; tag: string; allianceId: string } };

/** An answer button of a letter: a link into a screen, or «Принять» / «Отказаться» of a bot letter. */
export type LetterAnswerKind = 'open_command' | 'open_fleets' | 'accept' | 'decline';
export type LetterAnswer = { kind: LetterAnswerKind; label: string; primary?: boolean };

/**
 * `bot-*`: letters the bots write (domain/npc/letters.ts, application/npc-letters.ts).
 * Their answers act on the game: see `LetterRef`.
 */
export type PersonalLetterKind = 'application-answer' | 'application-incoming' | 'bot-joint-strike' | 'bot-help-request' | 'bot-ally-offer' | 'bot-reply' | (string & {});

/** What «Принять» / «Отказаться» of a bot letter act on. */
export type LetterRef = { kind: 'joint-strike' | 'help-request' | 'ally-offer'; id: string };

export type PersonalLetter = {
  id: string;
  kind: PersonalLetterKind;
  sender: LetterSender;
  subject: string;
  text: string;
  at: number;
  /** The letter's state in one word: «Принята», «Отклонена», «Новая»… */
  result: ReportResultWord;
  /** At most two. */
  answers: LetterAnswer[];
  /** What the answers act on (an application id, an invitation id). */
  subjectRef?: string;
  /** Bot letters: the object «Принять» / «Отказаться» are applied to. */
  ref?: LetterRef;
  /** Where the letter points on the map (the target of a strike, the planet under attack). */
  place?: ReportPlace;
  /** Until when the answer (or the promised fleet) is still useful; the header shows it big. */
  deadlineAt?: number;
  /** Help requests: when the attackers reach the planet (the defence must be there before). */
  arriveBy?: number;
  /** Help requests: who attacks the sender. */
  attacker?: { name: string; ownerId?: string; factionId?: string };
};

export type ReportItem = {
  id: string;
  source: ReportSource;
  category: ReportCategory;
  typeLabel: string;
  title: string;
  preview: string;
  body: string;
  timestamp?: string;
  statusLabel: string;
  statusTone: ReportStatusTone;
  participantNames: string[];
  planetNames: string[];
  coordinates: string[];
  details: ReportDetail[];
  battleReportId?: string;
  operationId?: string;
  commandOperationId?: string;
  spyReport?: SpyReportSnapshot;
  spyHunterNotice?: SpyHunterNotice;
  /** Who held the unique object when the probe arrived (exploration recon only). */
  occupantRecon?: ExplorationReconOccupant;
  overpopulationReport?: OverpopulationEpisodeReport;
  pirateReconReport?: PirateReconReport;
  action?: ReportAction;
  secondaryAction?: ReportAction;
  /** Structured blocks of the one report format (header place, sides, ships, resources…). */
  blocks?: ReportBlocks;
  /** The player's flight behind this report (repeat it from the report). */
  flightId?: string;
  /** Nothing happened (empty collection): a short row in the list. */
  brief?: boolean;
  /** «Личные» letter. */
  letter?: PersonalLetter;
};

export type ReportsState = {
  readIds: string[];
  hiddenIds: string[];
  /** «Отметить все прочитанными»: every message not newer than this ISO time is read. */
  readUpTo?: string;
  /** Optional for backwards compatibility with existing save envelopes. */
  overpopulationReports?: OverpopulationEpisodeReport[];
  /** Optional for backwards compatibility with existing save envelopes. */
  recyclerArrivalReports?: RecyclerArrivalReport[];
  /** Optional for backwards compatibility with existing save envelopes. */
  gasExtractionArrivalReports?: GasExtractionArrivalReport[];
};

export type ReportsCategoryKey = ReportCategory;

export type ReportQuery = {
  category: ReportsCategoryKey;
  filter: ReportFilter;
  search: string;
  /** The message open in the reading pane stays in «Непрочитанные» while it is open. */
  keepId?: string;
};

export type ReportCategoryCounts = Record<ReportsCategoryKey, number>;
export type ReportUnreadCounts = Record<ReportsCategoryKey, number>;
