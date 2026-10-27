import type { NpcProfile, NpcTraits } from '../domain/npc/types.ts';
import type { AllianceAccent, AllianceCrest, AllianceEmblem, AllianceRecord, CommandState } from '../domain/command/types.ts';
import { defaultPatternOpacity, parseCrest, CREST_GLYPH_SCALE } from '../domain/command/crest.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import { updateAllianceSettings } from '../domain/command/membership.ts';
import { DEFAULT_COLONY_SKIN, PLANET_SKIN_IDS, type PlanetSkinId } from '../domain/universe/planet-skins.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';

/**
 * What NPCs choose for themselves, as a player does in the planet editor and
 * the alliance crest constructor (owner rules 26.10.2026, decisions 12 and 14):
 * colony names and looks, and their alliances' crests. Everything is a pure
 * function of the owner's character, its seed and public facts, so the same
 * campaign gives the same names on every run and old saves get them once.
 */

function hash(key: string): number {
  let value = 2166136261;
  for (let index = 0; index < key.length; index += 1) value = Math.imul(value ^ key.charCodeAt(index), 16777619);
  return value >>> 0;
}

function pick<T>(list: readonly T[], key: string): T {
  return list[hash(key) % list.length]!;
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export type NpcNamingStyle = 'military' | 'trade' | 'science' | 'frontier' | 'mythic';

/** The owner's naming taste follows its strongest leaning; an owner with none leans to myth. */
export function npcNamingStyle(traits: NpcTraits): NpcNamingStyle {
  const scores: [NpcNamingStyle, number][] = [
    ['military', 0.6 * unit(traits.aggression) + 0.4 * unit(traits.militaryFocus)],
    ['trade', 0.7 * unit(traits.economyFocus) + 0.3 * unit(traits.cooperation)],
    ['science', 0.7 * unit(traits.scienceFocus) + 0.3 * unit(traits.planningHorizon)],
    ['frontier', 0.7 * unit(traits.expansionFocus) + 0.3 * unit(traits.operationsInterest)],
  ];
  const [style, score] = scores.reduce((best, item) => item[1] > best[1] ? item : best);
  return score >= 0.55 ? style : 'mythic';
}

const NAME_PARTS: Readonly<Record<NpcNamingStyle, readonly [readonly string[], readonly string[]]>> = {
  military: [['Бастион', 'Форпост', 'Цитадель', 'Рубеж', 'Застава', 'Крепость', 'Плацдарм', 'Арсенал'],
    ['Гром', 'Клинок', 'Феникс', 'Молот', 'Ястреб', 'Ворон', 'Титан', 'Страж', 'Шторм', 'Север']],
  trade: [['Гавань', 'Порт', 'Пристань', 'Фактория', 'Ярмарка', 'Биржа', 'Причал'],
    ['Лира', 'Янтарь', 'Шёлк', 'Злато', 'Опал', 'Медь', 'Корица', 'Сапфир', 'Жемчуг', 'Аметист']],
  science: [['Станция', 'Обсерватория', 'Лаборатория', 'Архив', 'Купол', 'Институт'],
    ['Квант', 'Сигма', 'Дельта', 'Гамма', 'Омега', 'Вектор', 'Импульс', 'Спектр', 'Фотон', 'Парсек']],
  frontier: [['Новый', 'Дальний', 'Тихий', 'Вольный', 'Ясный', 'Последний', 'Северный'],
    ['Предел', 'Берег', 'Край', 'Рассвет', 'Горизонт', 'Путь', 'Простор', 'Приют', 'Исток', 'Рубеж']],
  mythic: [['Ортия', 'Келена', 'Таврида', 'Элея', 'Миррея', 'Аркадия', 'Лемурия', 'Ирида', 'Селеста', 'Альтея', 'Никея', 'Фарос', 'Тирея', 'Калида', 'Эфира', 'Гелика'],
    ['']],
};

const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function coordinateKey(coordinate: UniverseCoordinate): string {
  return `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;
}

/**
 * A colony name in the owner's style, unique among the names already taken in
 * the world (case-insensitive). The draw is seeded by the owner and the
 * colony's coordinate, so it does not depend on the order colonies appear in.
 */
export function npcColonyName(profile: Pick<NpcProfile, 'privateSeed' | 'ownerId' | 'traits'>, coordinate: UniverseCoordinate,
  taken: ReadonlySet<string>): string {
  const style = npcNamingStyle(profile.traits);
  const [first, second] = NAME_PARTS[style];
  const base = `npc-colony-name:v1:${profile.ownerId}:${profile.privateSeed}:${coordinateKey(coordinate)}`;
  const free = (name: string) => !taken.has(name.toLocaleLowerCase('ru-RU'));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const name = [pick(first, `${base}:a:${attempt}`), pick(second, `${base}:b:${attempt}`)].filter(Boolean).join(' ');
    if (free(name)) return name;
  }
  const name = [pick(first, `${base}:a:0`), pick(second, `${base}:b:0`)].filter(Boolean).join(' ');
  return [...ROMAN.map((numeral) => `${name} ${numeral}`), `${name} ${coordinate.system}-${coordinate.position}`].find(free)
    ?? `${name} ${coordinateKey(coordinate)}`;
}

const STYLE_SKINS: Readonly<Record<NpcNamingStyle, readonly PlanetSkinId[]>> = {
  military: ['volcanic', 'barren', 'toxic', 'skin-005', 'skin-016', 'skin-asterion-03'],
  trade: ['terran', 'oceanic', 'desert', 'skin-002', 'skin-026', 'skin-asterion-01'],
  science: ['ice', 'gas', 'skin-011', 'skin-030', 'skin-asterion-05', 'skin-asterion-07'],
  frontier: ['desert', 'ice', 'terran', 'skin-012', 'skin-027', 'skin-asterion-02'],
  mythic: ['oceanic', 'gas', 'skin-003', 'skin-015', 'skin-028', 'skin-032'],
};

/** A look from the player's editor list, preferring the owner's style, never one its other planets wear. */
export function npcColonySkin(profile: Pick<NpcProfile, 'privateSeed' | 'ownerId' | 'traits'>, coordinate: UniverseCoordinate,
  worn: ReadonlySet<string>): PlanetSkinId {
  const base = `npc-colony-skin:v1:${profile.ownerId}:${profile.privateSeed}:${coordinateKey(coordinate)}`;
  const preferred = STYLE_SKINS[npcNamingStyle(profile.traits)].filter((skin) => !worn.has(skin));
  if (preferred.length) return pick(preferred, base);
  const rest = PLANET_SKIN_IDS.filter((skin) => skin !== DEFAULT_COLONY_SKIN && !worn.has(skin));
  return rest.length ? pick(rest, base) : pick(PLANET_SKIN_IDS.filter((skin) => skin !== DEFAULT_COLONY_SKIN), base);
}

function takenNames(state: SaveState): Set<string> {
  const names = new Set<string>();
  for (const target of Object.values(state.espionage?.targets ?? {})) names.add(target.name.toLocaleLowerCase('ru-RU'));
  for (const planet of Object.values(state.planets)) names.add(planet.name.toLocaleLowerCase('ru-RU'));
  return names;
}

/** Name and look an NPC gives a colony it has just founded. */
export function npcColonyIdentity(state: SaveState, ownerId: string, coordinate: UniverseCoordinate): { name: string; skin: PlanetSkinId } | null {
  const profile = state.npc?.profiles[ownerId];
  if (!profile) return null;
  const worn = new Set(Object.values(state.espionage?.targets ?? {}).filter((target) => target.ownerId === ownerId && target.skin)
    .map((target) => target.skin!));
  return { name: npcColonyName(profile, coordinate, takenNames(state)), skin: npcColonySkin(profile, coordinate, worn) };
}

const LEGACY_COLONY_NAME = /^Колония \d+-\d+$/;

/**
 * Older saves: NPC colonies still called «Колония система-позиция» with the
 * default look get their owner's name and look once, colonies in id order.
 * Homeworlds and anything already named are left alone.
 */
function migrateLegacyColonies(state: SaveState): SaveState {
  if (!state.espionage?.targets || !state.npc) return state;
  const targets = { ...state.espionage.targets };
  let changed = false;
  for (const id of Object.keys(targets).sort()) {
    const target = targets[id]!;
    if (target.kind !== 'npc' || id === `${target.ownerId}-planet` || target.skin || !LEGACY_COLONY_NAME.test(target.name)) continue;
    const identity = npcColonyIdentity({ ...state, espionage: { ...state.espionage, targets } }, target.ownerId, target.coordinate);
    if (!identity) continue;
    targets[id] = { ...target, name: identity.name, skin: identity.skin };
    changed = true;
  }
  return changed ? { ...state, espionage: { ...state.espionage, targets } } : state;
}

export type NpcAllianceCourse = 'aggressive' | 'trade' | 'defensive' | 'explorers';

/** An alliance's course: the leaning its NPC members share, averaged over their characters. */
export function npcAllianceCourse(members: readonly NpcTraits[]): NpcAllianceCourse {
  const mean = (read: (traits: NpcTraits) => number) => members.reduce((sum, traits) => sum + unit(read(traits)), 0) / Math.max(1, members.length);
  const scores: [NpcAllianceCourse, number][] = [
    ['aggressive', mean((t) => 0.6 * t.aggression + 0.4 * t.militaryFocus)],
    ['trade', mean((t) => 0.6 * t.economyFocus + 0.4 * t.cooperation)],
    ['defensive', mean((t) => 0.5 * (1 - t.riskTolerance) + 0.3 * t.militaryFocus + 0.2 * t.persistence)],
    ['explorers', mean((t) => 0.6 * t.scienceFocus + 0.4 * t.operationsInterest)],
  ];
  return scores.reduce((best, item) => item[1] > best[1] ? item : best)[0];
}

const COURSE_HERALDRY: Readonly<Record<NpcAllianceCourse, {
  frames: readonly AllianceCrest['frame'][]; fields: readonly AllianceCrest['field'][]; patterns: readonly AllianceCrest['pattern'][];
  glyphs: readonly AllianceCrest['glyph'][]; colors: readonly AllianceAccent[]; legacyGlyph: AllianceEmblem['glyph'];
}>> = {
  aggressive: { frames: ['pennant', 'diamond'], fields: ['crimson', 'abyss'], patterns: ['chevron', 'per-bend'],
    glyphs: ['blades', 'trident', 'phoenix', 'leviathan'], colors: ['crimson', 'amber'], legacyGlyph: 'blades' },
  trade: { frames: ['orbital', 'hex'], fields: ['bronze', 'forest'], patterns: ['per-fess', 'rays'],
    glyphs: ['compass', 'nexus', 'comet', 'crown'], colors: ['amber', 'emerald'], legacyGlyph: 'orbit' },
  defensive: { frames: ['aegis', 'octagon'], fields: ['navy', 'abyss'], patterns: ['quarterly', 'per-pale', 'none'],
    glyphs: ['citadel', 'anvil', 'eye'], colors: ['silver', 'cyan'], legacyGlyph: 'vanguard' },
  explorers: { frames: ['hex', 'orbital'], fields: ['royal', 'navy'], patterns: ['constellation', 'rays'],
    glyphs: ['nova', 'eye', 'comet', 'nexus'], colors: ['violet', 'cyan'], legacyGlyph: 'starforge' },
};

export type NpcHeraldryBasis = Readonly<{ course: NpcAllianceCourse; leaderOwnerId: string; atWar: boolean }>;

/**
 * The crest an NPC leadership builds in the constructor for its alliance. It
 * changes only with its reasons (owner rule 14): a new leader draws it anew,
 * a war crosses it and turns it crimson, a change of course redraws it.
 */
export function npcAllianceEmblem(allianceId: string, basis: NpcHeraldryBasis): AllianceEmblem {
  const parts = COURSE_HERALDRY[basis.course];
  const key = `npc-crest:v1:${allianceId}:${basis.leaderOwnerId}:${basis.course}`;
  const pattern = basis.atWar ? 'saltire' : pick(parts.patterns, `${key}:pattern`);
  const color = basis.atWar ? 'crimson' : pick(parts.colors, `${key}:color`);
  const crest = parseCrest({
    version: 2,
    frame: pick(parts.frames, `${key}:frame`),
    field: pick(parts.fields, `${key}:field`),
    pattern,
    patternOpacity: pattern === 'none' ? 0.24 : defaultPatternOpacity(pattern),
    glyph: pick(parts.glyphs, `${key}:glyph`),
    color,
    glyphScale: CREST_GLYPH_SCALE.default,
    rotation: 0,
    mirrorX: hash(`${key}:mirror`) % 2 === 1,
    offsetX: 0,
    offsetY: 0,
  });
  return { glyph: parts.legacyGlyph, accent: color, ...(crest ? { crest } : {}) };
}

/** The public facts and member characters an alliance's crest follows; null for an alliance not led by an NPC. */
export function npcHeraldryBasis(command: CommandState, alliance: AllianceRecord, profiles: Readonly<Record<string, NpcProfile>>): NpcHeraldryBasis | null {
  if (!profiles[alliance.leaderOwnerId]) return null;
  const members = alliance.members.map((member) => profiles[member.ownerId]?.traits).filter((traits): traits is NpcTraits => Boolean(traits));
  const atWar = selectAllianceRelations(command, alliance.id).some((relation) => relation.status === 'war');
  return { course: npcAllianceCourse(members), leaderOwnerId: alliance.leaderOwnerId, atWar };
}

function sameEmblem(left: AllianceEmblem, right: AllianceEmblem): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The leader (or deputy) sets the crest through the same settings command the
 * player's constructor uses; nothing happens when it already matches.
 */
export function applyNpcAllianceHeraldry(command: CommandState, actorOwnerId: string, profiles: Readonly<Record<string, NpcProfile>>): CommandState {
  const alliance = command.alliances.find((item) => item.members.some((member) => member.ownerId === actorOwnerId));
  if (!alliance || (alliance.leaderOwnerId !== actorOwnerId && alliance.deputyOwnerId !== actorOwnerId)) return command;
  const basis = npcHeraldryBasis(command, alliance, profiles);
  if (!basis) return command;
  const emblem = npcAllianceEmblem(alliance.id, basis);
  if (sameEmblem(alliance.emblem, emblem)) return command;
  const result = updateAllianceSettings(command, actorOwnerId, {
    name: alliance.name, tag: alliance.tag, motto: alliance.motto, description: alliance.description, emblem,
  });
  return result.ok ? result.state : command;
}

/**
 * Older saves: NPC-led alliances still wearing the legacy emblem (no crest)
 * get their crest once at load. Alliances with a crest are left for their
 * leadership to change when a reason comes.
 */
function migrateLegacyAllianceEmblems(state: SaveState): SaveState {
  const profiles = state.npc?.profiles;
  if (!profiles) return state;
  let command = state.command;
  for (const alliance of state.command.alliances) {
    if (alliance.emblem.crest || !profiles[alliance.leaderOwnerId]) continue;
    command = applyNpcAllianceHeraldry(command, alliance.leaderOwnerId, profiles);
  }
  return command === state.command ? state : { ...state, command };
}

/** Load-time migration of everything NPCs choose for themselves. */
export function migrateNpcSelfChosenIdentity(state: SaveState): SaveState {
  return migrateLegacyAllianceEmblems(migrateLegacyColonies(state));
}
