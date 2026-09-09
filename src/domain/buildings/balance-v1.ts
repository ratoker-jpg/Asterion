/**
 * Asterion Balance v1 — the single source of truth for building transitions.
 *
 * Each row describes the transition into the target level. The max-level row
 * is still a real transition row: it carries the final cost/time and is only
 * marked separately in metadata so the UI can show the completed limit.
 */

export const RESOURCE_BUILDING_ROLES = [
  'metal-production-1', 'metal-production-2', 'metal-production-3',
  'mineral-production-1', 'mineral-production-2',
  'gas-production-1', 'gas-production-2', 'basic-energy', 'advanced-energy', 'hangar',
] as const;

export const INDUSTRY_BUILDING_ROLES = [
  'construction', 'advanced-factory', 'metal-storage', 'mineral-storage', 'gas-storage',
  'recycling', 'trade-center',
] as const;

export const MILITARY_BUILDING_ROLES = [
  'shipyard', 'research', 'spaceport', 'planetary-government',
] as const;

export const BUILDING_ROLES = [
  ...RESOURCE_BUILDING_ROLES, ...INDUSTRY_BUILDING_ROLES, ...MILITARY_BUILDING_ROLES,
] as const;

export type ResourceBuildingRole = (typeof RESOURCE_BUILDING_ROLES)[number];
export type IndustryBuildingRole = (typeof INDUSTRY_BUILDING_ROLES)[number];
export type MilitaryBuildingRole = (typeof MILITARY_BUILDING_ROLES)[number];
export type BuildingRole = (typeof BUILDING_ROLES)[number];
export type BuildingZone = 'resource' | 'industry' | 'military';
export type BuildingFaction = 'aegis' | 'synod' | 'veyra';
export type ResourceKey = 'metal' | 'minerals' | 'gas' | 'energy';
export type ProductionResource = Exclude<ResourceKey, 'energy'>;
export type ResourceCost = Record<ResourceKey, number>;

export type BalanceEffect =
  | { kind: 'resource-income'; resource: ProductionResource; amountPerHour: number; label: string }
  | { kind: 'energy-income'; amountPerHour: number; label: string }
  | { kind: 'hangar-capacity'; bonus: number; total: number; label: string }
  | { kind: 'construction-time-factor'; factorPercent: number; label: string }
  | { kind: 'production-time-factor'; factorPercent: number; label: string }
  | { kind: 'unit-production-time-factor'; factorPercent: number; label: string }
  | { kind: 'storage-capacity'; resource: ProductionResource; capacity: number; label: string }
  | { kind: 'recycling'; efficiencyPercent: number; debrisPerSecond: number; label: string }
  | { kind: 'module'; label: string };

export type BalanceRow = {
  targetLevel: number;
  cost: ResourceCost | null;
  rawTimeMs: number | null;
  effect: BalanceEffect;
  source: 'zip' | 'approved-md' | 'derived-series' | 'max-level';
};

// Compact, checked-in representation of the final race-independent numeric tables.
// Fields are metal/minerals/gas/energy/rawTimeMs/effect values. Hangar and recycling
// use two effect values; max-level rows retain their final transition cost/time.
// Base construction times come from ASTERION_BALANCE_V1_TIME_REBALANCED/строения;
// the Астеры, Илары and Рой tables are numerically identical.
const METAL_PRODUCTION = '24,10,0,1,2000,150;36,15,0,16,2000,210;54,23,0,17,2000,290;81,34,0,19,4000,410;122,51,0,21,6000,580;182,76,0,23,8000,810;273,114,0,25,10000,1130;410,171,0,28,15000,1580;615,256,0,31,21000,2210;923,384,0,34,29000,3100;1384,577,0,37,40000,3870;2076,865,0,41,56000,4840;3114,1297,0,45,77000,6050;4671,1946,0,49,108000,7570;7006,2919,0,54,142000,9460;10509,4379,0,60,183000,11820;15764,6568,0,66,238000,14780;23646,9853,0,72,273000,18470;35469,14779,0,80,402000,23090;53204,22168,0,87,410000,28860;79806,33253,0,96,679000,31750;119709,49879,0,106,815000,34920;179564,74818,0,116,979000,38420;269346,112227,0,128,1175000,42260;404019,168341,0,141,1408000,46480;606028,252512,0,155,1692000,51130;909042,378768,0,171,2029000,56250;1363563,568151,0,187,2435000,61870;2045345,852227,0,207,2923000,68060;3068017,1278340,0,374,3506000,74860';
const MINERAL_PRODUCTION = '24,12,0,1,2000,150;36,18,0,24,2000,210;54,27,0,26,4000,290;81,41,0,28,4000,410;122,61,0,31,6000,580;182,91,0,34,8000,810;273,137,0,38,13000,1130;410,205,0,42,17000,1580;615,308,0,46,23000,2210;923,461,0,50,33000,3100;1384,692,0,55,46000,3870;2076,1038,0,61,65000,4840;3114,1557,0,67,92000,6050;4671,2335,0,74,127000,7570;7006,3503,0,81,167000,9460;10509,5255,0,89,217000,11820;15764,7882,0,98,281000,14780;23646,11823,0,108,365000,18470;35469,17735,0,119,475000,23090;53204,26602,0,131,619000,28860;79806,39903,0,144,804000,31750;119709,59855,0,158,965000,34920;179564,89782,0,174,1156000,38420;269346,134673,0,192,1388000,42260;404019,202009,0,211,1388000,46480;606028,303014,0,232,1998000,51130;909042,454521,0,255,2398000,56250;1363563,681782,0,282,2877000,61870;2045345,1022672,0,309,3454000,68060;3068017,1534008,0,561,4144000,74860';
const GAS_PRODUCTION = '112,35,0,2,6000,100;168,53,0,10,6000,140;252,79,0,13,10000,200;378,118,0,16,13000,270;567,177,0,20,17000,380;851,266,0,25,21000,540;1276,399,0,32,27000,750;1914,598,0,40,35000,1050;2870,897,0,50,46000,1480;4306,1346,0,62,58000,2070;6458,2018,0,77,77000,2580;9688,3027,0,97,100000,3230;14532,4541,0,121,129000,4040;21797,6812,0,151,169000,5040;32696,10218,0,189,219000,6310;49044,15326,0,236,285000,7880;73566,22989,0,295,371000,9850;110349,34484,0,369,483000,12310;165524,51726,0,462,627000,15390;248286,77589,0,577,817000,19240;372429,116384,0,289,1060000,21170;558643,174576,0,317,1379000,23280;837965,261864,0,349,1794000,25610;1256947,392796,0,384,2331000,28170;1885421,589194,0,422,3029000,30990;2828131,883791,0,464,3940000,34090;4242196,1325686,0,511,5121000,37500;6363294,1988530,0,562,6656000,41250;9544942,2982794,0,618,8654000,45370;14317412,4474191,0,1123,11250000,49910';
const BASIC_ENERGY = '75,30,0,0,4000,60;113,45,0,0,6000,120;169,68,0,0,8000,200;253,101,0,0,10000,300;380,152,0,0,13000,420;570,228,0,0,17000,630;854,342,0,0,23000,870;1281,513,0,0,29000,1140;1922,769,0,0,38000,1440;2883,1153,0,0,50000,1770;4325,1730,0,0,65000,2210;6487,2595,0,0,83000,2690;9731,3892,0,0,108000,3210;14596,5839,0,0,142000,3770;21895,8758,0,0,183000,4370;32842,13137,0,0,240000,5170;49263,19705,0,0,313000,6020;73895,29558,0,0,404000,6920;110842,44337,0,0,527000,7870;166263,66505,0,0,685000,8870;249394,99758,0,0,890000,10130;374091,149637,0,0,1156000,11450;561137,224455,0,0,1504000,12830;841706,336682,0,0,1956000,14270;1262558,505023,0,0,2542000,15770;1893838,757535,0,0,3304000,17590;2840756,1136303,0,0,4296000,19480;4261135,1704454,0,0,5583000,21440;6391702,2556681,0,0,7260000,23470;9587553,3835021,0,0,9438000,25570';
const ADVANCED_ENERGY = '1500,500,250,0,27000,100;2250,750,375,0,35000,200;3375,1125,563,0,48000,350;5063,1688,844,0,60000,550;7594,2531,1266,0,79000,800;11391,3797,1898,0,104000,1100;17086,5695,2848,0,135000,1450;25629,8543,4271,0,175000,1850;38443,12814,6407,0,227000,2300;57665,19222,9611,0,296000,2800;86498,28833,14416,0,385000,3350;129746,43249,21624,0,500000,3950;194620,64873,32437,0,650000,4600;291929,97310,48655,0,846000,5300;437894,145965,72982,0,1098000,6050;656841,218947,109473,0,1429000,6850;985261,328420,164210,0,1856000,7700;1477892,492631,246315,0,2415000,8600;2216838,738946,369473,0,3140000,9550;3325257,1108419,554209,0,4081000,10550';
const HANGAR = '200,35,0,2,6000,70,120;30,5,0,26,6000,105,155;60,11,0,29,10000,158,208;120,21,0,32,13000,236,286;240,42,0,35,17000,354,404;481,84,0,39,21000,532,582;961,168,0,42,27000,797,847;1922,336,0,47,35000,1196,1246;3844,673,0,51,46000,1794,1844;7689,1346,0,56,58000,2691,2741;15377,2691,0,62,77000,3364,3414;30755,5382,0,68,100000,4205,4255;61509,10764,0,75,129000,5256,5306;123019,21528,0,83,169000,6570,6620;246038,43057,0,91,219000,8212,8262;492075,86113,0,100,285000,10265,10315;984150,172226,0,110,371000,12832,12882;1968300,344453,0,110,483000,16040,16090;3936600,688905,0,110,627000,20050,20100;7873200,1377810,0,110,817000,25062,25112';
const CONSTRUCTION = '400,120,200,3,6000,98;600,180,300,3,6000,96;900,270,450,3,8000,93;1350,405,675,4,10000,90;2025,608,1013,4,15000,86;3038,911,1519,5,17000,83;4556,1367,2278,6,21000,80;6834,2050,3417,7,27000,77;10252,3075,5126,8,33000,75;15377,4613,7689,9,42000,72;23066,6920,11533,10,52000,69;34599,10380,17300,12,65000,67;51899,15570,25949,13,81000,64;77848,23354,38924,16,102000,62;116772,35032,58386,18,127000,60;175158,52547,87579,21,158000,58;262736,78821,131368,24,198000,56;394105,118231,197052,28,248000,53;591157,177347,295578,33,310000,50;886735,266021,443368,37,388000,48';
const ADVANCED_FACTORY = '1000000,500000,100000,200,340000,-5;1500000,750000,150000,200,681000,-10;2250000,1125000,225000,250,852000,-15;3375000,1687500,337500,250,1065000,-20;5062500,2531250,506250,300,1329000,-23';
const METAL_STORAGE = '2000,0,0,1,19000,50000;3000,0,0,1,23000,130040;4500,0,0,2,29000,250080;6750,0,0,2,35000,430120;10125,0,0,2,46000,700160;15188,0,0,2,56000,1105200;22781,0,0,3,71000,1712740;34172,0,0,3,90000,2624030;51258,0,0,4,110000,3990945;76887,0,0,4,140000,6041298;107641,0,0,5,173000,9116806;150698,0,0,6,217000,13422503;210977,0,0,6,271000,19450461;295368,0,0,7,338000,27889588;413515,0,0,9,423000,39704348;537570,0,0,10,529000,56244997;698841,0,0,11,660000,77747829;908493,0,0,13,827000,105701498;1181041,0,0,15,1033000,142041256;1535353,0,0,17,1292000,450000000';
const MINERAL_STORAGE = '1500,500,0,1,19000,50000;2250,750,0,1,25000,110040;3375,1125,0,2,31000,200080;5063,1688,0,2,38000,335120;7594,2531,0,2,48000,537660;11391,3797,0,2,60000,841450;17086,5695,0,3,75000,1297115;25629,8543,0,3,94000,1980593;38443,12814,0,4,117000,3005789;57665,19222,0,4,146000,4543563;80731,28833,0,5,181000,6850205;113023,43249,0,6,227000,10079487;158233,64873,0,6,283000,14600466;221526,97310,0,7,356000,20929821;310136,145965,0,9,444000,29790901;403177,218947,0,10,556000,42196398;524131,328420,0,11,694000,58323532;681370,492631,0,13,867000,79288794;885781,738946,0,15,1085000,106543622;1151515,1108419,0,17,1356000,300000000';
const GAS_STORAGE = '2000,0,0,1,19000,50000;3000,0,0,2,23000,130040;4500,0,0,2,29000,250080;6750,0,0,2,35000,430120;10125,0,0,2,46000,700160;15188,0,0,3,56000,1105200;22781,0,0,3,71000,1712740;34172,0,0,4,90000,2624030;51258,0,0,4,110000,3990945;76887,0,0,5,140000,6041298;107641,0,0,5,173000,9116806;150698,0,0,6,217000,13422503;210977,0,0,7,271000,19450461;295368,0,0,8,338000,27889588;413515,0,0,10,423000,39704348;537570,0,0,11,529000,56244997;698841,0,0,13,660000,77747829;908493,0,0,15,827000,105701498;1181041,0,0,17,1033000,142041256;1535353,0,0,19,1292000,189282930';
const RECYCLING = '22150,14500,5000,11,340000,75,7;33225,21750,7500,13,681000,80,12;49838,32625,11250,15,852000,85,18;74756,48938,16875,17,1065000,90,25;112134,73406,25313,20,1329000,95,33;168202,110109,37969,23,1663000,100,42;252302,165164,56953,26,2079000,105,52;378454,247746,85430,30,2598000,110,63;567680,371619,128145,34,3248000,115,85;851520,557429,192217,40,4058000,120,98';
const TRADE_CENTER = '5000,3500,100,2,60000,0;7500,5250,150,3,119000,0;11250,7875,225,3,148000,0;16875,11813,338,4,185000,0;25313,17719,506,4,233000,0;37969,26578,759,7,292000,0;56953,39867,1139,9,363000,0;85430,59801,1709,12,454000,0;128145,89701,2563,15,569000,0;192217,134552,3844,11,710000,0';
const SHIPYARD = '500,250,100,3,50000,95;1125,563,225,4,69000,90;2531,1266,506,5,92000,85;5695,2848,1139,6,123000,80;12814,6407,2563,7,167000,75;28833,14416,5767,9,225000,70;64873,32437,12975,11,304000,65;145965,72982,29193,14,410000,60;328420,164210,65684,18,554000,55;738946,369473,147789,22,748000,50;1662628,831314,332526,28,1010000,45;3740914,1870457,748183,35,1365000,40;8417056,4208528,1683411,44,1842000,35;18938376,9469188,3787675,55,2485000,30;42611346,21305673,8522269,68,3354000,25';
const RESEARCH = '200,400,200,3,31000,0;340,680,340,4,40000,0;578,1156,578,5,50000,0;983,1965,983,6,63000,0;1670,3341,1670,8,77000,0;2840,5679,2840,10,96000,0;4828,9655,4828,13,121000,0;8207,16414,8207,16,150000,0;13952,27903,13952,20,190000,0;23718,47435,23718,25,235000,0;37948,75896,37948,31,294000,0;60717,121434,60717,38,369000,0;97147,194294,97147,48,460000,0;155436,310871,155436,60,575000,0;248697,497394,248697,75,719000,0;397915,795830,397915,94,900000,0;636664,1273328,636664,117,1123000,0;1018662,2037324,1018662,147,1404000,0;1629859,3259719,1629859,183,1756000,0;2607775,5215550,2607775,229,2196000,0';
const SPACEPORT = '250,150,300,2,35000,0;625,375,750,2,50000,0;1563,938,1875,2,67000,0;3906,2344,4688,3,90000,0;9766,5859,11719,4,121000,0;24414,14648,29297,5,163000,0;61035,36621,73242,6,219000,0;152588,91553,183105,7,296000,0;381470,228882,457764,9,400000,0;953674,572205,1144409,11,540000,0';
const PLANETARY_GOVERNMENT = '2000,1500,650,3,31000,0;3800,2850,1235,4,42000,0;7220,5415,2347,5,58000,0;13718,10289,4458,6,77000,0;26064,19548,8471,8,104000,0;49522,37141,16095,10,142000,0;94092,70569,30580,13,192000,0;178774,134081,58102,16,258000,0;339671,254753,110393,20,350000,0;645375,484032,209747,25,471000,0';

const RAW_DATA: Record<BuildingRole, string> = {
  'metal-production-1': METAL_PRODUCTION, 'metal-production-2': METAL_PRODUCTION, 'metal-production-3': METAL_PRODUCTION,
  'mineral-production-1': MINERAL_PRODUCTION, 'mineral-production-2': MINERAL_PRODUCTION,
  'gas-production-1': GAS_PRODUCTION, 'gas-production-2': GAS_PRODUCTION,
  'basic-energy': BASIC_ENERGY, 'advanced-energy': ADVANCED_ENERGY, hangar: HANGAR,
  construction: CONSTRUCTION, 'advanced-factory': ADVANCED_FACTORY,
  'metal-storage': METAL_STORAGE, 'mineral-storage': MINERAL_STORAGE, 'gas-storage': GAS_STORAGE,
  recycling: RECYCLING, 'trade-center': TRADE_CENTER, shipyard: SHIPYARD, research: RESEARCH,
  spaceport: SPACEPORT, 'planetary-government': PLANETARY_GOVERNMENT,
};

const MAX_LEVELS: Record<BuildingRole, number> = Object.fromEntries(
  BUILDING_ROLES.map((role) => [role, RAW_DATA[role].split(';').length]),
) as Record<BuildingRole, number>;

function numberOrNull(value: string): number | null {
  return value === 'null' ? null : Number(value);
}

function sourceFor(role: BuildingRole, level: number): BalanceRow['source'] {
  if (level === MAX_LEVELS[role]) return 'max-level';
  if (role === 'basic-energy' || role === 'advanced-energy') return 'approved-md';
  if (level === 1) return 'zip';
  if (role === 'hangar') return level < 16 ? 'derived-series' : 'approved-md';
  if (role === 'construction') return level < 17 ? 'derived-series' : 'approved-md';
  if (role === 'trade-center') return level < 7 ? 'approved-md' : 'approved-md';
  return 'zip';
}

function effectFor(role: BuildingRole, level: number, values: number[]): BalanceEffect {
  const value = values[5] ?? 0;
  if (role.startsWith('metal-production')) {
    return { kind: 'resource-income', resource: 'metal', amountPerHour: value, label: 'Добыча металла' };
  }
  if (role.startsWith('mineral-production')) {
    return { kind: 'resource-income', resource: 'minerals', amountPerHour: value, label: 'Добыча минералов' };
  }
  if (role.startsWith('gas-production')) {
    return { kind: 'resource-income', resource: 'gas', amountPerHour: value, label: 'Добыча газа' };
  }
  if (role === 'basic-energy' || role === 'advanced-energy') {
    return { kind: 'energy-income', amountPerHour: value, label: 'Энергия/ч' };
  }
  if (role === 'hangar') {
    return { kind: 'hangar-capacity', bonus: value, total: values[6] ?? 50, label: 'Вместимость флота' };
  }
  if (role === 'construction') {
    return { kind: 'construction-time-factor', factorPercent: value, label: 'Время производства/строительства' };
  }
  if (role === 'advanced-factory') {
    return { kind: 'production-time-factor', factorPercent: Math.max(0, 100 + value), label: 'Время производства' };
  }
  if (role === 'shipyard') {
    return { kind: 'unit-production-time-factor', factorPercent: value, label: 'Время строительства кораблей и обороны' };
  }
  if (role === 'metal-storage' || role === 'mineral-storage' || role === 'gas-storage') {
    const resource = role === 'metal-storage' ? 'metal' : role === 'mineral-storage' ? 'minerals' : 'gas';
    return { kind: 'storage-capacity', resource, capacity: value, label: `Вместимость ${resource}` };
  }
  if (role === 'recycling') {
    return { kind: 'recycling', efficiencyPercent: value, debrisPerSecond: values[6] ?? 0, label: 'Переработка' };
  }
  if (role === 'trade-center') return { kind: 'module', label: 'Торговые сделки: до 3 слотов на уровень' };
  if (role === 'research') return { kind: 'module', label: 'Исследования через отдельный модуль лаборатории' };
  if (role === 'spaceport') return { kind: 'module', label: 'Отдельные очереди улучшений кораблей и командиров' };
  return { kind: 'module', label: 'Управленческий модуль планеты' };
}

const ROWS = new Map<BuildingRole, readonly BalanceRow[]>(BUILDING_ROLES.map((role) => {
  const rows = RAW_DATA[role].split(';').map((raw, index) => {
    const values = raw.split(',').map(Number);
    const costValues = raw.startsWith('null') ? null : values.slice(0, 4);
    const cost = costValues ? {
      metal: costValues[0], minerals: costValues[1], gas: costValues[2], energy: costValues[3],
    } : null;
    const rawTimeMs = raw.startsWith('null') ? null : values[4];
    return {
      targetLevel: index + 1,
      cost,
      rawTimeMs,
      effect: effectFor(role, index + 1, values),
      source: sourceFor(role, index + 1),
    } satisfies BalanceRow;
  });
  return [role, rows];
}));

export function isBuildingRole(value: unknown): value is BuildingRole {
  return typeof value === 'string' && (BUILDING_ROLES as readonly string[]).includes(value);
}

export function getBuildingMaxLevel(role: BuildingRole): number {
  return MAX_LEVELS[role];
}

export function getBuildingBalanceRow(role: BuildingRole, targetLevel: number): BalanceRow | null {
  const rows = ROWS.get(role);
  const level = Math.floor(targetLevel);
  return rows?.[level - 1] ?? null;
}

export function getBuildingEffect(role: BuildingRole, level: number): BalanceEffect {
  if (level <= 0) return { kind: 'module', label: 'Здание не построено' };
  return getBuildingBalanceRow(role, Math.min(getBuildingMaxLevel(role), level))?.effect
    ?? { kind: 'module', label: 'Эффект недоступен' };
}

const FACTION_NAMES: Record<BuildingFaction, Record<BuildingRole, string>> = {
  aegis: {
    'metal-production-1': 'Металлическая шахта I', 'metal-production-2': 'Металлическая шахта II', 'metal-production-3': 'Металлическая шахта III',
    'mineral-production-1': 'Минеральная шахта I', 'mineral-production-2': 'Минеральная шахта II', 'gas-production-1': 'Газовая скважина I', 'gas-production-2': 'Газовая скважина II',
    'basic-energy': 'Солнечная электростанция', 'advanced-energy': 'Ядерный реактор', hangar: 'Ангар', construction: 'Фабрика', 'advanced-factory': 'Промышленный комплекс',
    'metal-storage': 'Склад металла', 'mineral-storage': 'Склад минералов', 'gas-storage': 'Газовое хранилище', recycling: 'Перерабатывающий центр', 'trade-center': 'Торговый центр',
    shipyard: 'Верфь', research: 'Лаборатория', spaceport: 'Космодром', 'planetary-government': 'Палата управления',
  },
  synod: {
    'metal-production-1': 'Металлический экстрактор I', 'metal-production-2': 'Металлический экстрактор II', 'metal-production-3': 'Металлический экстрактор III',
    'mineral-production-1': 'Минеральный сепаратор I', 'mineral-production-2': 'Минеральный сепаратор II', 'gas-production-1': 'Газовый коллектор I', 'gas-production-2': 'Газовый коллектор II',
    'basic-energy': 'Энергосеть', 'advanced-energy': 'Энергетическое ядро', hangar: 'Хранилище корпусов', construction: 'Сборочный узел', 'advanced-factory': 'Производственный модуль',
    'metal-storage': 'Металлический резерв', 'mineral-storage': 'Минеральный резерв', 'gas-storage': 'Газовый резервуар', recycling: 'Рекламатор', 'trade-center': 'Обменный узел',
    shipyard: 'Сборочный док', research: 'Экспериментальный центр', spaceport: 'Звёздный портал', 'planetary-government': 'Регулятор',
  },
  veyra: {
    'metal-production-1': 'Поглотитель металла I', 'metal-production-2': 'Поглотитель металла II', 'metal-production-3': 'Поглотитель металла III',
    'mineral-production-1': 'Минеральный нарост I', 'mineral-production-2': 'Минеральный нарост II', 'gas-production-1': 'Газовая железа I', 'gas-production-2': 'Газовая железа II',
    'basic-energy': 'Энергетический кокон', 'advanced-energy': 'Энергетическое сердце', hangar: 'Гнездилище', construction: 'Инкубатор', 'advanced-factory': 'Маточный комплекс',
    'metal-storage': 'Металлическая капсула', 'mineral-storage': 'Минеральная капсула', 'gas-storage': 'Газовый пузырь', recycling: 'Перевариватель', 'trade-center': 'Обменная камера',
    shipyard: 'Боевой инкубатор', research: 'Генетическая камера', spaceport: 'Звёздное гнездо', 'planetary-government': 'Маточное ядро',
  },
};

const BUILDING_PURPOSE: Record<BuildingRole, string> = {
  'metal-production-1': 'Добыча металла.', 'metal-production-2': 'Улучшенная добыча металла.', 'metal-production-3': 'Высшая ступень добычи металла.',
  'mineral-production-1': 'Добыча минералов.', 'mineral-production-2': 'Улучшенная добыча минералов.', 'gas-production-1': 'Добыча газа.', 'gas-production-2': 'Улучшенная добыча газа.',
  'basic-energy': 'Генерация энергии.', 'advanced-energy': 'Продвинутая генерация энергии.', hangar: 'Вместимость флота и юнитов.', construction: 'Производство и строительство.',
  'advanced-factory': 'Продвинутое производство.', 'metal-storage': 'Хранение металла.', 'mineral-storage': 'Хранение минералов.', 'gas-storage': 'Хранение газа.',
  recycling: 'Переработка обломков.', 'trade-center': 'Торговля и обмен ресурсами.', shipyard: 'Производство кораблей.', research: 'Исследования и технологии.',
  spaceport: 'Космическая инфраструктура.', 'planetary-government': 'Управление планетой.',
};

const FACTIONS = ['aegis', 'synod', 'veyra'] as const;
const ART_FILE_BY_FACTION: Record<BuildingFaction, Record<BuildingRole, string>> = Object.fromEntries(
  FACTIONS.map((faction) => [faction, Object.fromEntries(BUILDING_ROLES.map((role) => [
    role,
    new URL(`../../../assets/source/New assets/buildings/${faction}/building.${faction}.${role}.png`, import.meta.url).href,
  ]))]),
) as Record<BuildingFaction, Record<BuildingRole, string>>;

export type BuildingPresentation = {
  faction: BuildingFaction;
  assetRole: BuildingRole;
  name: string;
  purpose: string;
  art: string;
  maxLevel: number;
};

export function getBuildingPresentation(role: BuildingRole, faction: BuildingFaction = 'aegis'): BuildingPresentation {
  return {
    faction,
    assetRole: role,
    name: FACTION_NAMES[faction][role],
    purpose: BUILDING_PURPOSE[role],
    art: ART_FILE_BY_FACTION[faction][role],
    maxLevel: getBuildingMaxLevel(role),
  };
}

export function getBuildingResourceIncomePerHour(buildings: Partial<Record<BuildingRole, number>>) {
  const income = { metal: 0, minerals: 0, gas: 0 };
  for (const role of RESOURCE_BUILDING_ROLES) {
    const effect = getBuildingEffect(role, buildings[role] ?? 0);
    if (effect.kind === 'resource-income') income[effect.resource] += effect.amountPerHour;
  }
  return income;
}

export function getBuildingEnergyIncomePerHour(buildings: Partial<Record<BuildingRole, number>>): number {
  return (['basic-energy', 'advanced-energy'] as const).reduce((total, role) => {
    const effect = getBuildingEffect(role, buildings[role] ?? 0);
    return total + (effect.kind === 'energy-income' ? effect.amountPerHour : 0);
  }, 0);
}

export const PLANET_BASE_STORAGE_CAPACITY = 100_000;

export function getBuildingStorageCapacity(role: 'metal-storage' | 'mineral-storage' | 'gas-storage', level: number): number {
  if (level <= 0) return PLANET_BASE_STORAGE_CAPACITY;
  const effect = getBuildingEffect(role, level);
  return effect.kind === 'storage-capacity' ? PLANET_BASE_STORAGE_CAPACITY + effect.capacity : PLANET_BASE_STORAGE_CAPACITY;
}

export function getStorageCapacities(buildings: Partial<Record<BuildingRole, number>>) {
  return {
    metal: getBuildingStorageCapacity('metal-storage', buildings['metal-storage'] ?? 0),
    minerals: getBuildingStorageCapacity('mineral-storage', buildings['mineral-storage'] ?? 0),
    gas: getBuildingStorageCapacity('gas-storage', buildings['gas-storage'] ?? 0),
  };
}

export function getHangarCapacity(level: number): number {
  const safeLevel = Math.max(0, Math.min(getBuildingMaxLevel('hangar'), Math.floor(Number.isFinite(level) ? level : 0)));
  if (safeLevel === 0) return 50;
  const effect = getBuildingEffect('hangar', safeLevel);
  return effect.kind === 'hangar-capacity' ? effect.total : 50;
}

export function getConstructionTimeFactor(level: number): number {
  const effect = getBuildingEffect('construction', level);
  return effect.kind === 'construction-time-factor' ? effect.factorPercent / 100 : 1;
}

export function getShipyardTimeFactor(level: number): number {
  const effect = getBuildingEffect('shipyard', level);
  return effect.kind === 'unit-production-time-factor' ? effect.factorPercent / 100 : 1;
}

export function getProductionTimeFactor(level: number): number {
  const effect = getBuildingEffect('advanced-factory', level);
  return effect.kind === 'production-time-factor' ? effect.factorPercent / 100 : 1;
}

/**
 * Official shipyard and advanced-factory coefficients apply to the same
 * production timer. Independent bonuses are applied successively to the raw
 * duration, so the second coefficient acts on the already reduced time.
 */
export function getUnitProductionTimeFactor(shipyardLevel: number, advancedFactoryLevel: number): number {
  return getShipyardTimeFactor(shipyardLevel) * getProductionTimeFactor(advancedFactoryLevel);
}

export function calculateUnitProductionDurationMs(
  rawTimeMs: number,
  shipyardLevel: number,
  advancedFactoryLevel: number,
): number {
  return Math.max(1, Math.round(Math.max(1, rawTimeMs) * getUnitProductionTimeFactor(shipyardLevel, advancedFactoryLevel)));
}

export function parseClockDurationMs(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

export function formatClockDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getRecyclingBalance(level: number) {
  const effect = getBuildingEffect('recycling', level);
  return effect.kind === 'recycling'
    ? { efficiencyPercent: effect.efficiencyPercent, debrisPerSecond: effect.debrisPerSecond }
    : { efficiencyPercent: 0, debrisPerSecond: 0 };
}

export function formatBalanceEffect(effect: BalanceEffect): string {
  switch (effect.kind) {
    case 'resource-income': return `${effect.label}: +${effect.amountPerHour.toLocaleString('ru-RU')}/ч`;
    case 'energy-income': return `${effect.label}: +${effect.amountPerHour.toLocaleString('ru-RU')}/ч`;
    case 'hangar-capacity': return `${effect.label}: +${effect.bonus.toLocaleString('ru-RU')}; итог ${effect.total.toLocaleString('ru-RU')}`;
    case 'construction-time-factor': return `${effect.label}: ${effect.factorPercent}% от базового времени`;
    case 'production-time-factor': return `${effect.label}: ${effect.factorPercent}% от базового времени`;
    case 'unit-production-time-factor': return `${effect.label}: ${effect.factorPercent}% от базового времени`;
    case 'storage-capacity': return `${effect.label}: +${effect.capacity.toLocaleString('ru-RU')} к вместимости здания`;
    case 'recycling': return `${effect.label}: возврат ${effect.efficiencyPercent}%; ${effect.debrisPerSecond} обломков/с`;
    case 'module': return effect.label;
  }
}
