/** Achievement data currently supported by the first development slice. */
export const ACHIEVEMENT_CATEGORIES = [
  { id: 'growth', name: 'Развитие', icon: 'growth' },
  { id: 'war', name: 'Флот и бои', icon: 'war' },
  { id: 'intel', name: 'Разведка', icon: 'intel' },
  { id: 'space', name: 'Космос и пираты', icon: 'space' },
  { id: 'ally', name: 'Союз', icon: 'ally' },
  { id: 'sun', name: 'Солнце и Врата', icon: 'sun' },
  { id: 'round', name: 'Подвиги раунда', icon: 'round' },
  { id: 'chronicle', name: 'Летопись', icon: 'chronicle' },
] as const;

// Academic remains pending until “full branch level 10” is precisely defined.
// Canonical science sections are not equivalent: Expert includes science 15
// capped at level 1, while Additional (18–20) is mutually exclusive by direction.
export const DEVELOPMENT_ACHIEVEMENTS = [
  { id: 'first-stone', cat: 'growth', kind: 'milestone', tier: 'b', points: 5, name: 'Первый камень', how: 'Построить первое здание', goal: 1 },
  { id: 'builder', cat: 'growth', kind: 'milestone', tier: 'b', points: 10, name: 'Строитель', how: 'Поднять любое здание до 15 уровня', goal: 15 },
  { id: 'architect', cat: 'growth', kind: 'milestone', tier: 's', points: 25, name: 'Зодчий', how: 'Поднять любое здание до 25 уровня', goal: 25 },
  { id: 'scholar', cat: 'growth', kind: 'milestone', tier: 'b', points: 10, name: 'Учёный', how: 'Завершить 10 уровней исследований', goal: 10 },
  { id: 'bridge', cat: 'growth', kind: 'milestone', tier: 's', points: 20, name: 'На мостике', how: 'Улучшить любого командира до 10 уровня', goal: 10 },
  { id: 'empire-architect', cat: 'growth', kind: 'milestone', tier: 'g', points: 50, name: 'Архитектор империи', how: 'Сумма уровней зданий одной планеты — 300', goal: 300 },
  { id: 'colonist', cat: 'growth', kind: 'milestone', tier: 'b', points: 10, name: 'Колонист', how: 'Заселить вторую планету', goal: 2 },
  { id: 'power-grid', cat: 'growth', kind: 'milestone', tier: 'b', points: 15, name: 'Энергетик', how: 'Запас энергии 10 000 на одной планете', goal: 10_000 },
  { id: 'founder', cat: 'ally', kind: 'milestone', tier: 'b', points: 10, name: 'Основатель', how: 'Создать союз', goal: 1 },
] as const;

export type DevelopmentAchievement = (typeof DEVELOPMENT_ACHIEVEMENTS)[number];
export type DevelopmentAchievementId = DevelopmentAchievement['id'];
export type AchievementTier = DevelopmentAchievement['tier'];

/** One-time actions proven by authoritative player events and copied saves. */
export const PLAYER_EVENT_ACHIEVEMENT_IDS = ['first-stone', 'founder'] as const;
export type PlayerEventAchievementId = (typeof PLAYER_EVENT_ACHIEVEMENT_IDS)[number];
export type PlayerAchievementProofs = Partial<Record<PlayerEventAchievementId, number>>;

/** Rank thresholds are from the approved achievement concept. */
export const ACHIEVEMENT_RANKS = [
  { at: 0, name: 'Новобранец' },
  { at: 100, name: 'Лейтенант' },
  { at: 250, name: 'Капитан' },
  { at: 500, name: 'Коммандер' },
  { at: 800, name: 'Командор' },
  { at: 1_200, name: 'Адмирал' },
  { at: 1_800, name: 'Гранд-адмирал' },
  { at: 2_600, name: 'Легенда' },
] as const;

export type AchievementRank = (typeof ACHIEVEMENT_RANKS)[number];
