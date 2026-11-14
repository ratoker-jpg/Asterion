/**
 * Planet looks a player can pick in the planet editor, by id (the art lives
 * in the UI layer). NPCs choose their colonies' looks from the same list,
 * except the alliance looks, which only an alliance leader may wear.
 *
 * Ids never change once shipped: saves store them. Old saves keep loading
 * because every id ever shipped stays in the catalogue.
 */
import type { AllianceRole } from '../command/types.ts';

export const DEFAULT_COLONY_SKIN = 'colonized';

/** How rare a look is: the editor's three sections. */
export type PlanetSkinTier = 'common' | 'rare' | 'alliance';

/** The editor's rubrics inside a section. */
export type PlanetSkinGroup = 'classic' | 'worlds' | 'seasons' | 'ruined' | 'artificial' | 'crystal' | 'exotic' | 'alliance';

export interface PlanetSkinMeta {
  readonly id: string;
  readonly label: string;
  readonly tier: PlanetSkinTier;
  readonly group: PlanetSkinGroup;
}

export const PLANET_SKIN_GROUPS: readonly { id: PlanetSkinGroup; tier: PlanetSkinTier; label: string }[] = [
  { id: 'classic', tier: 'common', label: 'Классика' },
  { id: 'worlds', tier: 'common', label: 'Миры' },
  { id: 'seasons', tier: 'common', label: 'Погода и сезоны' },
  { id: 'ruined', tier: 'rare', label: 'Мёртвые и разрушенные' },
  { id: 'artificial', tier: 'rare', label: 'Искусственные' },
  { id: 'crystal', tier: 'rare', label: 'Кристаллы и металл' },
  { id: 'exotic', tier: 'rare', label: 'Экзотика' },
  { id: 'alliance', tier: 'alliance', label: 'Облики союза' },
];

const tierOf = (group: PlanetSkinGroup): PlanetSkinTier => PLANET_SKIN_GROUPS.find((entry) => entry.id === group)!.tier;
const skin = (id: string, label: string, group: PlanetSkinGroup): PlanetSkinMeta => ({ id, label, tier: tierOf(group), group });

/** Every look, in the editor's order. */
export const PLANET_SKIN_CATALOG = [
  // Классика: the nine starter looks.
  skin('colonized', 'Колония', 'classic'),
  skin('terran', 'Терран', 'classic'),
  skin('oceanic', 'Океан', 'classic'),
  skin('desert', 'Пустыня', 'classic'),
  skin('ice', 'Ледяная', 'classic'),
  skin('volcanic', 'Вулкан', 'classic'),
  skin('toxic', 'Токсичная', 'classic'),
  skin('barren', 'Каменная', 'classic'),
  skin('gas', 'Газовый гигант', 'classic'),
  // Миры.
  skin('skin-026', 'Изумрудная', 'worlds'),
  skin('skin-asterion-07', 'Терра Прима', 'worlds'),
  skin('skin-asterion-06', 'Дюны', 'worlds'),
  skin('skin-asterion-04', 'Древо', 'worlds'),
  skin('skin-030', 'Янтарный гигант', 'worlds'),
  skin('ps-jungle', 'Джунгли', 'worlds'),
  skin('ps-savanna', 'Саванна', 'worlds'),
  skin('ps-archipelago', 'Архипелаг', 'worlds'),
  skin('ps-tundra', 'Тундра', 'worlds'),
  skin('ps-canyon', 'Каньоны', 'worlds'),
  skin('ps-saltflat', 'Солончак', 'worlds'),
  skin('ps-swamp', 'Топи', 'worlds'),
  skin('ps-highland', 'Нагорье', 'worlds'),
  skin('ps-oasis', 'Оазис', 'worlds'),
  skin('ps-glacier', 'Ледник', 'worlds'),
  skin('ps-crater', 'Кратерная', 'worlds'),
  skin('ps-rust', 'Ржавая', 'worlds'),
  // Погода и сезоны.
  skin('skin-027', 'Полярная', 'seasons'),
  skin('skin-asterion-08', 'Снежная', 'seasons'),
  skin('skin-asterion-02', 'Око бури', 'seasons'),
  skin('ps-autumn', 'Осень', 'seasons'),
  skin('ps-winter', 'Зима', 'seasons'),
  skin('ps-blossom', 'Цветение', 'seasons'),
  skin('ps-storm', 'Шторм', 'seasons'),
  skin('ps-monsoon', 'Муссон', 'seasons'),
  skin('ps-duststorm', 'Пыльная буря', 'seasons'),
  skin('ps-aurora', 'Сияние', 'seasons'),
  skin('ps-fog', 'Туманная', 'seasons'),
  // Мёртвые и разрушенные.
  skin('skin-032', 'Тлеющая', 'ruined'),
  skin('skin-asterion-09', 'Лёд и пламя', 'ruined'),
  skin('ps-ash', 'Пепельная', 'ruined'),
  skin('ps-cold-dead', 'Остывшая', 'ruined'),
  skin('ps-tidal', 'Приливная', 'ruined'),
  skin('ps-shattered', 'Расколотая', 'ruined'),
  skin('ps-scarred', 'Поле битвы', 'ruined'),
  skin('ps-cracked-ice', 'Треснувший лёд', 'ruined'),
  // Искусственные.
  skin('skin-012', 'Механоид', 'artificial'),
  skin('skin-028', 'Орбитальный пояс', 'artificial'),
  skin('skin-asterion-01', 'Бастион', 'artificial'),
  skin('ps-ecumenopolis', 'Город-планета', 'artificial'),
  skin('ps-forge', 'Кузня', 'artificial'),
  skin('ps-hexshell', 'Панцирь', 'artificial'),
  skin('ps-terraform', 'Терраформинг', 'artificial'),
  // Кристаллы и металл.
  skin('skin-asterion-05', 'Хрустальная', 'crystal'),
  skin('skin-002', 'Янтарная буря', 'crystal'),
  skin('ps-crystal', 'Кристальная', 'crystal'),
  skin('ps-pearl', 'Жемчужная', 'crystal'),
  skin('ps-obsidian', 'Обсидиан', 'crystal'),
  skin('ps-mercury', 'Ртутная', 'crystal'),
  // Экзотика.
  skin('skin-003', 'Магматическая', 'exotic'),
  skin('skin-005', 'Радужный гигант', 'exotic'),
  skin('skin-011', 'Живой риф', 'exotic'),
  skin('skin-015', 'Улей', 'exotic'),
  skin('skin-016', 'Багровые жилы', 'exotic'),
  skin('skin-asterion-03', 'Терновая', 'exotic'),
  skin('ps-biolum', 'Сияющий лес', 'exotic'),
  skin('ps-fungal', 'Грибница', 'exotic'),
  skin('ps-plasma', 'Плазма', 'exotic'),
  skin('ps-gas-teal', 'Бирюзовый гигант', 'exotic'),
  skin('ps-gas-rose', 'Розовый гигант', 'exotic'),
  skin('ps-geyser', 'Гейзеры', 'exotic'),
  // Облики союза: только глава союза.
  skin('ally-citadel', 'Цитадель союза', 'alliance'),
  skin('ally-banner', 'Знамя', 'alliance'),
  skin('ally-throne', 'Престол', 'alliance'),
  skin('ally-crimson', 'Алый штандарт', 'alliance'),
  skin('ally-crown', 'Корона', 'alliance'),
  skin('ally-aegis', 'Эгида', 'alliance'),
  skin('ally-beacon', 'Маяк союза', 'alliance'),
  skin('ally-sigil', 'Печать', 'alliance'),
] as const satisfies readonly PlanetSkinMeta[];

export type PlanetSkinId = (typeof PLANET_SKIN_CATALOG)[number]['id'];

/** Every id a save may hold. */
export const PLANET_SKIN_IDS: readonly PlanetSkinId[] = PLANET_SKIN_CATALOG.map((entry) => entry.id);

/** Looks anyone may wear: NPC colonies pick from these. */
export const PUBLIC_PLANET_SKIN_IDS: readonly PlanetSkinId[] = PLANET_SKIN_CATALOG
  .filter((entry) => entry.tier !== 'alliance').map((entry) => entry.id);

/**
 * The 30 looks shipped before 14.11.2026, in their old order. Planets nobody
 * has scouted get a stable pick from this list by coordinate; a longer list
 * would repaint them all.
 */
export const LEGACY_PLANET_SKIN_IDS: readonly PlanetSkinId[] = [
  'colonized', 'terran', 'oceanic', 'desert', 'ice', 'volcanic', 'toxic', 'barren', 'gas',
  'skin-002', 'skin-003', 'skin-005', 'skin-011', 'skin-012', 'skin-015', 'skin-016',
  'skin-026', 'skin-027', 'skin-028', 'skin-030', 'skin-032',
  'skin-asterion-01', 'skin-asterion-02', 'skin-asterion-03', 'skin-asterion-04', 'skin-asterion-05',
  'skin-asterion-06', 'skin-asterion-07', 'skin-asterion-08', 'skin-asterion-09',
];

const KNOWN = new Map<string, PlanetSkinMeta>(PLANET_SKIN_CATALOG.map((entry) => [entry.id, entry]));

export function isPlanetSkinId(value: unknown): value is PlanetSkinId {
  return typeof value === 'string' && KNOWN.has(value);
}

export function planetSkinMeta(id: string | undefined): PlanetSkinMeta | undefined {
  return id ? KNOWN.get(id) : undefined;
}

export function isAlliancePlanetSkin(id: string | undefined): boolean {
  return planetSkinMeta(id)?.tier === 'alliance';
}

/** Who may pick a look: alliance looks need the alliance leader, the rest are open to all. */
export function canPickPlanetSkin(id: string, allianceRole: AllianceRole | null | undefined): boolean {
  const meta = planetSkinMeta(id);
  if (!meta) return false;
  return meta.tier !== 'alliance' || allianceRole === 'leader';
}

/**
 * The look a planet shows. An alliance look stays in the save, but while its
 * owner is not the alliance leader (left, was removed, handed over the lead)
 * the planet shows the default «Колония»; it comes back if they lead again.
 * Unknown ids also fall back to the default.
 */
export function displayedPlanetSkinId(id: string | undefined, allianceRole: AllianceRole | null | undefined): PlanetSkinId {
  if (!isPlanetSkinId(id)) return DEFAULT_COLONY_SKIN;
  return canPickPlanetSkin(id, allianceRole) ? id : DEFAULT_COLONY_SKIN;
}
