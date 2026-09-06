import type { ScienceCatalogDefinition, ScienceId, ScienceSectionId } from './types.ts';

export const SCIENCE_SECTIONS: readonly { id: ScienceSectionId; label: string }[] = [
  { id: 'basic', label: 'Основные науки' },
  { id: 'advanced', label: 'Высокотехнологичные науки' },
  { id: 'expert', label: 'Экспертные науки' },
  { id: 'additional', label: 'Дополнительные науки' },
];

const costs = (metal: number, minerals: number, gas: number, energy = 0) => ({ metal, minerals, gas, energy });
const req = (scienceId: ScienceId, level: number) => ({ scienceId, level });

export const SCIENCE_CATALOG: readonly ScienceCatalogDefinition[] = [
  { id: 1, section: 'basic', name: 'Физика', sourceName: 'Физика', description: 'Повышает доход энергии на 5%', artSlug: 'technology.shared.physics.png', capturedLevel: 6, capturedNextLevel: 7, capturedCost: costs(64000, 32000, 5000), capturedTime: '02:08:59', laboratoryLevel: 1, prerequisites: [] },
  { id: 2, section: 'basic', name: 'Химия', sourceName: 'Химия', description: 'Снижает потребление газа при отправке экипажей на 5%', artSlug: 'technology.shared.chemistry.png', capturedLevel: 5, capturedNextLevel: 6, capturedCost: costs(12800, 6400, 1600), capturedTime: '00:16:58', laboratoryLevel: 3, prerequisites: [] },
  { id: 3, section: 'basic', name: 'Математика', sourceName: 'Математика', description: 'Повышает доход ресурсов на 5%', artSlug: 'technology.shared.mathematics.png', capturedLevel: 6, capturedNextLevel: 7, capturedCost: costs(64000, 25600, 4000), capturedTime: '00:32:52', laboratoryLevel: 1, prerequisites: [] },
  { id: 4, section: 'basic', name: 'Астрономия', sourceName: 'Астрономия', description: 'Повышает скорость кораблей на 10%', artSlug: 'technology.shared.astronomy.png', capturedLevel: 6, capturedNextLevel: 7, capturedCost: costs(32000, 0, 32000), capturedTime: '00:54:47', laboratoryLevel: 2, prerequisites: [] },

  { id: 5, section: 'advanced', name: 'Шпионаж', sourceName: 'Шпионаж', description: 'Разблокирует разведку', artSlug: 'technology.shared.espionage.png', capturedLevel: 4, capturedNextLevel: 5, capturedCost: costs(800, 1600, 800), capturedTime: '00:23:08', laboratoryLevel: 4, prerequisites: [req(4, 2)] },
  { id: 6, section: 'advanced', name: 'Компьютерные системы', sourceName: 'Компьютерные системы', description: 'Повышает количество возможных полетов на 1.5', artSlug: 'technology.shared.computer-systems.png', capturedLevel: 2, capturedNextLevel: 3, capturedCost: costs(0, 1000, 2000), capturedTime: '00:04:28', laboratoryLevel: 4, prerequisites: [req(4, 1)] },
  { id: 7, section: 'advanced', name: 'Броня кораблей', sourceName: 'Броня кораблей', description: 'Повышает запас здоровья всех юнитов на 10%', artSlug: 'technology.shared.ship-armor.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(100, 50, 0), capturedTime: '00:04:06', laboratoryLevel: 5, prerequisites: [req(1, 4)], combatTechnologyId: 'shipArmor' },
  { id: 8, section: 'advanced', name: 'Топливные элементы', sourceName: 'Топливные элементы', description: 'Повышает скорость кораблей на 15%', artSlug: 'technology.shared.fuel-cells.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(500, 1000, 200), capturedTime: '00:01:54', laboratoryLevel: 6, prerequisites: [req(2, 4)] },
  { id: 9, section: 'advanced', name: 'Реактивные двигатели', sourceName: 'Реактивные двигатели', description: 'Повышает скорость кораблей на 15%', artSlug: 'technology.shared.jet-engines.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(0, 1000, 500), capturedTime: '00:07:35', laboratoryLevel: 7, prerequisites: [req(2, 6), req(7, 5)] },
  { id: 10, section: 'advanced', name: 'Лазерная наука', sourceName: 'Лазерная наука', description: 'Повышает урон от лазерных атак всех юнитов на 15%', artSlug: 'technology.shared.laser-science.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(200, 100, 0), capturedTime: '00:01:35', laboratoryLevel: 8, prerequisites: [req(3, 3)], combatTechnologyId: 'laserScience' },
  { id: 11, section: 'advanced', name: 'Ионная наука', sourceName: 'Ионная наука', description: 'Повышает урон от ионных атак всех юнитов на 15%', artSlug: 'technology.shared.ion-science.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(500, 250, 50), capturedTime: '00:03:10', laboratoryLevel: 8, prerequisites: [req(3, 5), req(10, 5)], combatTechnologyId: 'ionScience' },
  { id: 12, section: 'advanced', name: 'Плазменная наука', sourceName: 'Плазменная наука', description: 'Повышает урон от плазменных атак всех юнитов на 15%', artSlug: 'technology.shared.plasma-science.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(1000, 1000, 1000), capturedTime: '00:04:44', laboratoryLevel: 8, prerequisites: [req(3, 7), req(10, 10), req(11, 5)], combatTechnologyId: 'plasmaScience' },
  { id: 13, section: 'advanced', name: 'Экология', sourceName: 'Экология', description: 'Повышает доход озона на 250', artSlug: 'technology.shared.ecology.png', capturedLevel: 10, capturedNextLevel: 11, capturedCost: costs(115330, 86498, 28833), capturedTime: '02:11:42', laboratoryLevel: 4, prerequisites: [req(1, 3), req(2, 3)] },

  { id: 14, section: 'expert', name: 'Гиперпространство', sourceName: 'Гиперпространство', description: 'Повышает скорость кораблей на 20%', artSlug: 'technology.shared.hyperspace.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(2500, 3750, 1500), capturedTime: '00:09:10', laboratoryLevel: 10, prerequisites: [req(9, 3)] },
  { id: 15, section: 'expert', name: 'Параллельные вселенные', sourceName: 'Параллельные вселенные', description: 'Разблокирует строительство кораблей мастера', artSlug: 'technology.shared.parallel-universes.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(0, 0, 0, 250000), capturedTime: '205:24:00', laboratoryLevel: 15, prerequisites: [req(1, 10), req(3, 10), req(4, 15)] },
  { id: 17, section: 'expert', name: 'Улучшенное строительство', sourceName: 'Улучшенное строительство', description: 'Снижает ресурсную стоимость построек на 1%', artSlug: 'technology.shared.improved-construction.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(10000, 5000, 0), capturedTime: '00:26:33', laboratoryLevel: 4, prerequisites: [req(1, 5), req(3, 5)] },
  { id: 21, section: 'expert', name: 'Лёгкая броня', sourceName: 'Легкая Броня', description: 'Повышает легкую броню всех юнитов на 1%', artSlug: 'technology.shared.light-armor.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(1000, 500, 250), capturedTime: '00:03:19', laboratoryLevel: 8, prerequisites: [req(10, 2)], combatTechnologyId: 'lightArmor' },
  { id: 22, section: 'expert', name: 'Средняя броня', sourceName: 'Средняя Броня', description: 'Повышает среднюю броню всех юнитов на 2%', artSlug: 'technology.shared.medium-armor.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(1300, 650, 325), capturedTime: '00:03:19', laboratoryLevel: 9, prerequisites: [req(11, 2)], combatTechnologyId: 'mediumArmor' },
  { id: 23, section: 'expert', name: 'Тяжёлая броня', sourceName: 'Тяжелая Броня', description: 'Повышает тяжелую броню всех юнитов на 3%', artSlug: 'technology.shared.heavy-armor.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(1600, 800, 400), capturedTime: '00:03:19', laboratoryLevel: 10, prerequisites: [req(12, 2)], combatTechnologyId: 'heavyArmor' },

  { id: 18, section: 'additional', name: 'Пробивающая атака', sourceName: 'Пробивающая атака', description: 'Повышает атаку кораблей на 5%', artSlug: 'technology.shared.piercing-attack.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(50000, 25000, 5000), capturedTime: '00:28:03', laboratoryLevel: 20, prerequisites: [req(10, 10), req(11, 7), req(12, 5)], combatTechnologyId: 'piercingAttack' },
  { id: 19, section: 'additional', name: 'Маневренная защита', sourceName: 'Маневренная защита', description: 'Повышает запас прочности кораблей на 5%', artSlug: 'technology.shared.maneuver-defense.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(0, 50000, 5000), capturedTime: '00:28:03', laboratoryLevel: 20, prerequisites: [req(7, 10), req(23, 5)], combatTechnologyId: 'maneuverDefense' },
  { id: 20, section: 'additional', name: 'Критический удар', sourceName: 'Критический удар', description: 'Повышает шансы на критическую атаку на 1%', artSlug: 'technology.shared.critical-hit.png', capturedLevel: 0, capturedNextLevel: 1, capturedCost: costs(50000, 30000, 0), capturedTime: '00:28:03', laboratoryLevel: 20, prerequisites: [req(10, 7), req(11, 7), req(12, 7)], combatTechnologyId: 'criticalHit' },
];

export const ADDITIONAL_SCIENCE_HINT = 'Имейте в виду, что вы можете исследовать только 1 направление из списка.';

export function findScience(id: ScienceId) {
  return SCIENCE_CATALOG.find((science) => science.id === id) ?? null;
}
