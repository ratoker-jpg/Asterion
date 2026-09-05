import synodSatelliteArt from '../../../assets/source/New assets/ship/synod/ship.synod.solar-satellite.png';
import synodSpyProbeArt from '../../../assets/source/New assets/ship/synod/ship.synod.spy-bot.png';
import synodTransportArt from '../../../assets/source/New assets/ship/synod/ship.synod.cargo-bot.png';
import synodMegatransportArt from '../../../assets/source/New assets/ship/synod/ship.synod.large-cargo-bot.png';
import synodColonizerArt from '../../../assets/source/New assets/ship/synod/ship.synod.colonizer-bot.png';
import synodRecyclerArt from '../../../assets/source/New assets/ship/synod/ship.synod.recycler.png';
import synodFighterArt from '../../../assets/source/New assets/ship/synod/ship.synod.fighter.png';
import synodInterceptorArt from '../../../assets/source/New assets/ship/synod/ship.synod.interceptor.png';
import synodShieldBotArt from '../../../assets/source/New assets/ship/synod/ship.synod.shield-bot.png';
import synodStarArmadaArt from '../../../assets/source/New assets/ship/synod/ship.synod.star-armada.png';
import synodGoliathArt from '../../../assets/source/New assets/ship/synod/ship.synod.goliath.png';
import synodBomberbotArt from '../../../assets/source/New assets/ship/synod/ship.synod.bomberbot.png';
import synodTitanArt from '../../../assets/source/New assets/ship/synod/ship.synod.titan.png';

import veyraSatelliteArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.organic-satellite.png';
import veyraSpyProbeArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.nox-mind.png';
import veyraTransportArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.transporter.png';
import veyraMegatransportArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.mega-transporter.png';
import veyraColonizerArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.settler.png';
import veyraRecyclerArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.recycler-drone.png';
import veyraNoxDartArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.nox-dart.png';
import veyraHornetArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.hornet.png';
import veyraAbsorberArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.absorber.png';
import veyraGhostArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.ghost.png';
import veyraNemesisArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.nemesis.png';
import veyraBomberArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.bomber.png';
import veyraNoxQueenArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.nox-queen.png';

import synodDefenseMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.defense-matrix.png';
import synodLaserMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.laser-matrix.png';
import synodIonMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.ion-matrix.png';
import synodPlasmaMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.plasma-matrix.png';
import synodLaserIonMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.laser-ion-matrix.png';
import synodPlasmaLaserMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.plasma-laser-matrix.png';
import synodIonPlasmaMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.ion-plasma-matrix.png';
import synodMatrixShieldArt from '../../../assets/source/New assets/defenses/synod/defense.synod.matrix-shield.png';
import synodPlanetaryMatrixArt from '../../../assets/source/New assets/defenses/synod/defense.synod.planetary-matrix.png';

import veyraNoxArcherArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.nox-archer.png';
import veyraLaserMatterArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.laser-matter.png';
import veyraIonWeaveArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.ion-weave.png';
import veyraPlasmaWeaveArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.plasma-weave.png';
import veyraLaserIonTurretArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.laser-ion-turret.png';
import veyraPlasmaLaserTurretArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.plasma-laser-turret.png';
import veyraIonPlasmaTurretArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.ion-plasma-turret.png';
import veyraChitinShieldArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.chitin-shield.png';
import veyraSurfaceShieldArt from '../../../assets/source/New assets/defenses/veyra/defense.veyra.surface-shield.png';

import {
  COMMANDER_COMBAT_CATALOG,
  DEFENSE_COMBAT_CATALOG,
  SHIP_COMBAT_CATALOG,
  getCombatEntity,
  type CatalogEntity,
} from './catalog.ts';
import type { CombatFactionId } from './factions.ts';
import type { CombatEntityId, DefenseId, ShipId } from './ids.ts';

type PresentationOverride = {
  id: CombatEntityId;
  name: string;
  role: string;
  art: string;
};

function applyOverrides<TId extends CombatEntityId>(
  base: readonly CatalogEntity<TId>[],
  overrides: readonly PresentationOverride[],
): readonly CatalogEntity<TId>[] {
  const byId = new Map(overrides.map((item) => [item.id, item]));
  return base.map((entity) => {
    const override = byId.get(entity.id);
    return override ? { ...entity, name: override.name, role: override.role, art: override.art } : entity;
  });
}

// These rosters are presentation bindings to the faction assets already present in Asterion.
// Until verified race-specific stat tables are available, each slot keeps its canonical
// mechanical ID and combat stats rather than inventing hidden faction coefficients.
const SYNOD_SHIPS = applyOverrides<ShipId>(SHIP_COMBAT_CATALOG, [
  { id: 'solar-satellite', name: 'Солнечный спутник', role: 'Орбитальный спутник Иларов', art: synodSatelliteArt },
  { id: 'spy-probe', name: 'Шпион-бот', role: 'Разведывательный бот Иларов', art: synodSpyProbeArt },
  { id: 'transporter', name: 'Грузовой бот', role: 'Транспорт Иларов', art: synodTransportArt },
  { id: 'mega-transporter', name: 'Большой грузовой бот', role: 'Тяжёлый транспорт Иларов', art: synodMegatransportArt },
  { id: 'colonizer', name: 'Колонизатор-бот', role: 'Колониальный бот Иларов', art: synodColonizerArt },
  { id: 'recycler', name: 'Переработчик', role: 'Переработчик Иларов', art: synodRecyclerArt },
  { id: 'scout', name: 'Истребитель', role: 'Лёгкий боевой корабль Иларов', art: synodFighterArt },
  { id: 'cruiser', name: 'Перехватчик', role: 'Боевой корабль Иларов', art: synodInterceptorArt },
  { id: 'defender', name: 'Щит-бот', role: 'Защитный корабль Иларов', art: synodShieldBotArt },
  { id: 'battleship', name: 'Звёздная армада', role: 'Тяжёлый корабль Иларов', art: synodStarArmadaArt },
  { id: 'destroyer', name: 'Голиаф', role: 'Тяжёлый штурмовой корабль Иларов', art: synodGoliathArt },
  { id: 'bomber', name: 'Бомбербот', role: 'Осадный корабль Иларов', art: synodBomberbotArt },
  { id: 'death-star', name: 'Титан', role: 'Сверхтяжёлый корабль Иларов', art: synodTitanArt },
]);

const VEYRA_SHIPS = applyOverrides<ShipId>(SHIP_COMBAT_CATALOG, [
  { id: 'solar-satellite', name: 'Органический спутник', role: 'Орбитальный организм Роя', art: veyraSatelliteArt },
  { id: 'spy-probe', name: 'Нокс-разум', role: 'Разведывательный организм Роя', art: veyraSpyProbeArt },
  { id: 'transporter', name: 'Транспортёр', role: 'Транспортный организм Роя', art: veyraTransportArt },
  { id: 'mega-transporter', name: 'Мегатранспортёр', role: 'Тяжёлый транспортный организм Роя', art: veyraMegatransportArt },
  { id: 'colonizer', name: 'Поселенец', role: 'Колонизационный организм Роя', art: veyraColonizerArt },
  { id: 'recycler', name: 'Дрон-переработчик', role: 'Переработчик Роя', art: veyraRecyclerArt },
  { id: 'scout', name: 'Нокс-дротик', role: 'Лёгкий боевой организм Роя', art: veyraNoxDartArt },
  { id: 'cruiser', name: 'Шершень', role: 'Боевой организм Роя', art: veyraHornetArt },
  { id: 'defender', name: 'Поглотитель', role: 'Защитный организм Роя', art: veyraAbsorberArt },
  { id: 'battleship', name: 'Призрак', role: 'Тяжёлый боевой организм Роя', art: veyraGhostArt },
  { id: 'destroyer', name: 'Немезида', role: 'Тяжёлый штурмовой организм Роя', art: veyraNemesisArt },
  { id: 'bomber', name: 'Бомбардировщик', role: 'Осадный организм Роя', art: veyraBomberArt },
  { id: 'death-star', name: 'Нокс-королева', role: 'Сверхтяжёлый организм Роя', art: veyraNoxQueenArt },
]);

const SYNOD_DEFENSES = applyOverrides<DefenseId>(DEFENSE_COMBAT_CATALOG, [
  { id: 'ballistic-turret', name: 'Защитная матрица', role: 'Базовая матрица Иларов', art: synodDefenseMatrixArt },
  { id: 'laser-turret', name: 'Лазерная матрица', role: 'Лазерная матрица Иларов', art: synodLaserMatrixArt },
  { id: 'ion-turret', name: 'Ионная матрица', role: 'Ионная матрица Иларов', art: synodIonMatrixArt },
  { id: 'plasma-turret', name: 'Плазменная матрица', role: 'Плазменная матрица Иларов', art: synodPlasmaMatrixArt },
  { id: 'laser-ion-battery', name: 'Лазер-ионная матрица', role: 'Комбинированная матрица Иларов', art: synodLaserIonMatrixArt },
  { id: 'plasma-laser-battery', name: 'Плазма-лазерная матрица', role: 'Комбинированная матрица Иларов', art: synodPlasmaLaserMatrixArt },
  { id: 'ion-plasma-battery', name: 'Ион-плазменная матрица', role: 'Комбинированная матрица Иларов', art: synodIonPlasmaMatrixArt },
  { id: 'tower-shield', name: 'Матричный щит', role: 'Щит Иларов', art: synodMatrixShieldArt },
  { id: 'planetary-shield', name: 'Планетарная матрица', role: 'Планетарный щит Иларов', art: synodPlanetaryMatrixArt },
]);

const VEYRA_DEFENSES = applyOverrides<DefenseId>(DEFENSE_COMBAT_CATALOG, [
  { id: 'ballistic-turret', name: 'Нокс-лучник', role: 'Базовая защитная форма Роя', art: veyraNoxArcherArt },
  { id: 'laser-turret', name: 'Лазерная материя', role: 'Лазерная защитная форма Роя', art: veyraLaserMatterArt },
  { id: 'ion-turret', name: 'Ионное плетение', role: 'Ионная защитная форма Роя', art: veyraIonWeaveArt },
  { id: 'plasma-turret', name: 'Плазменное плетение', role: 'Плазменная защитная форма Роя', art: veyraPlasmaWeaveArt },
  { id: 'laser-ion-battery', name: 'Лазер-ионная турель', role: 'Комбинированная форма Роя', art: veyraLaserIonTurretArt },
  { id: 'plasma-laser-battery', name: 'Плазма-лазерная турель', role: 'Комбинированная форма Роя', art: veyraPlasmaLaserTurretArt },
  { id: 'ion-plasma-battery', name: 'Ион-плазменная турель', role: 'Комбинированная форма Роя', art: veyraIonPlasmaTurretArt },
  { id: 'tower-shield', name: 'Хитиновый щит', role: 'Защитная оболочка Роя', art: veyraChitinShieldArt },
  { id: 'planetary-shield', name: 'Поверхностный щит', role: 'Планетарная оболочка Роя', art: veyraSurfaceShieldArt },
]);

const SHIPS_BY_FACTION: Record<CombatFactionId, readonly CatalogEntity<ShipId>[]> = {
  aegis: SHIP_COMBAT_CATALOG,
  synod: SYNOD_SHIPS,
  veyra: VEYRA_SHIPS,
};

const DEFENSES_BY_FACTION: Record<CombatFactionId, readonly CatalogEntity<DefenseId>[]> = {
  aegis: DEFENSE_COMBAT_CATALOG,
  synod: SYNOD_DEFENSES,
  veyra: VEYRA_DEFENSES,
};

export function getFactionShipCatalog(factionId: CombatFactionId) {
  return SHIPS_BY_FACTION[factionId];
}

export function getFactionDefenseCatalog(factionId: CombatFactionId) {
  return DEFENSES_BY_FACTION[factionId];
}

export function getFactionCombatEntity(factionId: CombatFactionId, entityId: CombatEntityId): CatalogEntity {
  return getFactionShipCatalog(factionId).find((entity) => entity.id === entityId)
    ?? getFactionDefenseCatalog(factionId).find((entity) => entity.id === entityId)
    ?? COMMANDER_COMBAT_CATALOG.find((entity) => entity.id === entityId)
    ?? getCombatEntity(entityId);
}
