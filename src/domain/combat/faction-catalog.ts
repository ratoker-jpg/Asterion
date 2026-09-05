import synodSatelliteArt from '../../../assets/source/New assets/ship/synod/ship.synod.satellite.png';
import synodSpyProbeArt from '../../../assets/source/New assets/ship/synod/ship.synod.spy-probe.png';
import synodTransportArt from '../../../assets/source/New assets/ship/synod/ship.synod.transport.png';
import synodMegatransportArt from '../../../assets/source/New assets/ship/synod/ship.synod.megatransport.png';
import synodColonizerArt from '../../../assets/source/New assets/ship/synod/ship.synod.colonizer.png';
import synodRecyclerArt from '../../../assets/source/New assets/ship/synod/ship.synod.recycler.png';
import synodFighterArt from '../../../assets/source/New assets/ship/synod/ship.synod.fighter.png';
import synodCruiserArt from '../../../assets/source/New assets/ship/synod/ship.synod.cruiser.png';
import synodAssaultShipArt from '../../../assets/source/New assets/ship/synod/ship.synod.assault-ship.png';
import synodBattleshipArt from '../../../assets/source/New assets/ship/synod/ship.synod.battleship.png';
import synodDestroyerArt from '../../../assets/source/New assets/ship/synod/ship.synod.destroyer.png';
import synodBomberArt from '../../../assets/source/New assets/ship/synod/ship.synod.bomber.png';
import synodTitanArt from '../../../assets/source/New assets/ship/synod/ship.synod.titan.png';

import veyraSatelliteArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.satellite.png';
import veyraSpyProbeArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.spy-probe.png';
import veyraTransportArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.transport.png';
import veyraMegatransportArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.megatransport.png';
import veyraColonizerArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.colonizer.png';
import veyraRecyclerArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.recycler.png';
import veyraGlideArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.glide.png';
import veyraCruiserArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.cruiser.png';
import veyraGuardianArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.guardian.png';
import veyraBattleshipArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.battleship.png';
import veyraDestroyerArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.destroyer.png';
import veyraBomberArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.bomber.png';
import veyraLeviathanArt from '../../../assets/source/New assets/ship/veyra/ship.veyra.leviathan.png';

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
  type CatalogEntity,
} from './catalog.ts';
import type { CombatFactionId } from './factions.ts';
import type { CombatEntityId, DefenseId, ShipId } from './ids.ts';

/**
 * Faction rosters are a presentation layer over the canonical mechanical IDs.
 * This lets the simulator display the correct faction art/name without inventing
 * unsourced faction stat tables. Resolver v1 still consumes the canonical stats.
 */
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

const SYNOD_SHIPS = applyOverrides<ShipId>(SHIP_COMBAT_CATALOG, [
  { id: 'solar-satellite', name: 'Спутник', role: 'Орбитальный спутник Иларов', art: synodSatelliteArt },
  { id: 'spy-probe', name: 'Зонд', role: 'Разведывательный зонд Иларов', art: synodSpyProbeArt },
  { id: 'transporter', name: 'Транспорт', role: 'Транспортировщик Иларов', art: synodTransportArt },
  { id: 'mega-transporter', name: 'Мегатранспорт', role: 'Тяжёлый транспортировщик Иларов', art: synodMegatransportArt },
  { id: 'colonizer', name: 'Колонизатор', role: 'Колониальный корабль Иларов', art: synodColonizerArt },
  { id: 'recycler', name: 'Переработчик', role: 'Переработчик обломков Иларов', art: synodRecyclerArt },
  { id: 'scout', name: 'Истребитель', role: 'Лёгкий боевой корабль Иларов', art: synodFighterArt },
  { id: 'cruiser', name: 'Крейсер', role: 'Боевой крейсер Иларов', art: synodCruiserArt },
  { id: 'defender', name: 'Штурмовой корабль', role: 'Штурмовой корабль Иларов', art: synodAssaultShipArt },
  { id: 'battleship', name: 'Линкор', role: 'Линкор Иларов', art: synodBattleshipArt },
  { id: 'destroyer', name: 'Разрушитель', role: 'Тяжёлый корабль Иларов', art: synodDestroyerArt },
  { id: 'bomber', name: 'Бомбардировщик', role: 'Бомбардировщик Иларов', art: synodBomberArt },
  { id: 'death-star', name: 'Титан', role: 'Сверхтяжёлый корабль Иларов', art: synodTitanArt },
]);

const VEYRA_SHIPS = applyOverrides<ShipId>(SHIP_COMBAT_CATALOG, [
  { id: 'solar-satellite', name: 'Органический спутник', role: 'Орбитальный организм Роя', art: veyraSatelliteArt },
  { id: 'spy-probe', name: 'Зонд Роя', role: 'Разведывательный организм', art: veyraSpyProbeArt },
  { id: 'transporter', name: 'Транспорт Роя', role: 'Транспортный организм', art: veyraTransportArt },
  { id: 'mega-transporter', name: 'Мегатранспорт Роя', role: 'Тяжёлый транспортный организм', art: veyraMegatransportArt },
  { id: 'colonizer', name: 'Колонизатор Роя', role: 'Колонизационный организм', art: veyraColonizerArt },
  { id: 'recycler', name: 'Переработчик Роя', role: 'Организм-переработчик', art: veyraRecyclerArt },
  { id: 'scout', name: 'Глайд', role: 'Лёгкий боевой организм Роя', art: veyraGlideArt },
  { id: 'cruiser', name: 'Крейсер Роя', role: 'Боевой организм', art: veyraCruiserArt },
  { id: 'defender', name: 'Страж', role: 'Защитный организм Роя', art: veyraGuardianArt },
  { id: 'battleship', name: 'Линкор Роя', role: 'Тяжёлый боевой организм', art: veyraBattleshipArt },
  { id: 'destroyer', name: 'Разрушитель Роя', role: 'Тяжёлый штурмовой организм', art: veyraDestroyerArt },
  { id: 'bomber', name: 'Бомбардировщик Роя', role: 'Осадный организм', art: veyraBomberArt },
  { id: 'death-star', name: 'Левиафан', role: 'Сверхтяжёлый организм Роя', art: veyraLeviathanArt },
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
  { id: 'laser-turret', name: 'Лазерная ткань', role: 'Лазерная защитная форма Роя', art: veyraLaserMatterArt },
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
    ?? SHIP_COMBAT_CATALOG.find((entity) => entity.id === entityId)
    ?? DEFENSE_COMBAT_CATALOG.find((entity) => entity.id === entityId)
    ?? COMMANDER_COMBAT_CATALOG[0];
}
