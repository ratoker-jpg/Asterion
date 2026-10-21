import aegisCard from '../../../assets/source/generated-factions-v1/factions/aegis_card_bg.png';
import synodCard from '../../../assets/source/generated-factions-v1/factions/synod_card_bg.png';
import veyraCard from '../../../assets/source/generated-factions-v1/factions/veyra_card_bg.png';
import aegisEmblem from '../../../assets/source/generated-factions-v1/factions/aegis_emblem.png';
import synodEmblem from '../../../assets/source/generated-factions-v1/factions/synod_emblem.png';
import veyraEmblem from '../../../assets/source/generated-factions-v1/factions/veyra_emblem.png';
import aegisHero from '../../../assets/source/generated-factions-v1/factions/aegis_hero.png';
import synodHero from '../../../assets/source/generated-factions-v1/factions/synod_hero.png';
import veyraHero from '../../../assets/source/generated-factions-v1/factions/veyra_hero.png';
import { getFactionShipCatalog } from '../../domain/combat/faction-catalog.ts';
import type { ShipId } from '../../domain/combat/ids.ts';
import { CANONICAL_STARTING_FLEET_BY_FACTION } from '../../domain/fleet/runtime.ts';
import { FACTION_GENERAL_ASSETS } from '../../domain/profile/faction-assets.ts';
import type { PlayerFactionId } from '../../domain/profile/types.ts';

export type RaceCard = {
  id: PlayerFactionId;
  name: string;
  /** Nemexia card heading, translated. */
  people: string;
  tagline: string;
  traits: readonly string[];
  ability: { name: string; text: string };
  accent: string;
  general: string;
  background: string;
  emblem: string;
  flagship: string;
  roster: Array<{ id: ShipId; name: string; count: number; art: string }>;
};

function roster(factionId: PlayerFactionId): RaceCard['roster'] {
  const catalog = getFactionShipCatalog(factionId);
  return (Object.entries(CANONICAL_STARTING_FLEET_BY_FACTION[factionId]) as [ShipId, number][])
    .filter(([, count]) => count > 0)
    .map(([id, count]) => {
      const entity = catalog.find((item) => item.id === id);
      return { id, count, name: entity?.name ?? id, art: entity?.art ?? '' };
    });
}

/**
 * Race cards of «Новая игра» (Nemexia `choose_race.php`, §1 of the menu audit).
 * Ability lines quote the canon; the wizard never promises more than the code does.
 */
export const RACE_CARDS: readonly RaceCard[] = [
  {
    id: 'aegis',
    name: 'Астеры',
    people: 'Конфедерация людей',
    tagline: 'Скорость и манёвр. Флот, который успевает первым.',
    traits: ['Самые быстрые корабли в игре', 'Самый хитрый пиратский корабль', 'Гибкий универсальный ростер'],
    ability: { name: 'Возрождение', text: 'Сильнейшие корпуса возвращаются в строй после боя.' },
    accent: '#5f9bff',
    general: FACTION_GENERAL_ASSETS.aegis,
    background: aegisCard,
    emblem: aegisEmblem,
    flagship: aegisHero,
    roster: roster('aegis'),
  },
  {
    id: 'synod',
    name: 'Илары',
    people: 'Союз Тертетов',
    tagline: 'Баланс и броня. Порядок, который не ломается.',
    traits: ['Сильные и сбалансированные корабли', 'Самый прочный щитовой корабль', 'Надёжная оборона колоний'],
    ability: { name: 'Мега-мощь', text: 'Синхронный удар всего флота в решающий момент.' },
    accent: '#3fdc86',
    general: FACTION_GENERAL_ASSETS.synod,
    background: synodCard,
    emblem: synodEmblem,
    flagship: synodHero,
    roster: roster('synod'),
  },
  {
    id: 'veyra',
    name: 'Рой',
    people: 'Ноксис',
    tagline: 'Медленно. Неотвратимо. Улей растёт из каждой потери.',
    traits: ['Медленные, но смертоносные корабли', 'Слабые особи мутируют в сильных', 'Вдвое больше разведчиков на старте'],
    ability: { name: 'Заморозка', text: 'Шмели сковывают вражеские стеки — те пропускают атаку.' },
    accent: '#ff5468',
    general: FACTION_GENERAL_ASSETS.veyra,
    background: veyraCard,
    emblem: veyraEmblem,
    flagship: veyraHero,
    roster: roster('veyra'),
  },
];

export function raceCard(id: PlayerFactionId): RaceCard {
  return RACE_CARDS.find((card) => card.id === id) ?? RACE_CARDS[0]!;
}
