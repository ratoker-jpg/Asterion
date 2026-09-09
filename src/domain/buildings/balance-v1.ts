/**
 * Asterion Balance v1 — the single source of truth for building transitions.
 *
 * Each row describes the transition into the target level. A max-level row has
 * an effect but no cost or construction time by design.
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
// use two effect values; max-level rows use null costs/time.
const METAL_PRODUCTION = '24,10,0,1,44000,10150;36,15,0,16,62000,11165;54,23,0,17,86000,12282;81,34,0,19,121000,13510;122,51,0,21,169000,14861;182,76,0,23,237000,16347;273,114,0,25,331000,17982;410,171,0,28,464000,19780;615,256,0,31,649000,21758;923,384,0,34,909000,23934;1384,577,0,37,1273000,26327;2076,865,0,41,1782000,28960;3114,1297,0,45,2495000,31856;4671,1946,0,49,3492000,35042;7006,2919,0,54,4540000,38546;10509,4379,0,60,5902000,42400;15764,6568,0,66,7673000,46640;23646,9853,0,72,8774000,51305;35469,14779,0,80,12967000,56435;53204,22168,0,87,13257000,62078;79806,33253,0,96,21914000,68286;119709,49879,0,106,26297000,75115;179564,74818,0,116,31556000,82626;269346,112227,0,128,37867000,90889;404019,168341,0,141,45441000,99978;606028,252512,0,155,54529000,109981;909042,378768,0,171,65435000,120994;1363563,568151,0,187,78522000,133082;2045345,852227,0,207,94226000,146397;null,null,null,null,null,161037';
const MINERAL_PRODUCTION = '24,12,0,1,52000,8735;36,18,0,24,73000,9609;54,27,0,26,102000,10569;81,41,0,28,143000,11626;122,61,0,31,200000,12789;182,91,0,34,280000,14068;273,137,0,38,392000,15475;410,205,0,42,548000,17022;615,308,0,46,767000,18724;923,461,0,50,1074000,20597;1384,692,0,55,1504000,22657;2076,1038,0,61,2106000,24922;3114,1557,0,67,2948000,27414;4671,2335,0,74,4127000,30156;7006,3503,0,81,5366000,33171;10509,5255,0,89,6975000,36489;15764,7882,0,98,9068000,40137;23646,11823,0,108,11788000,44151;35469,17735,0,119,15324000,48566;53204,26602,0,131,19922000,53423;79806,39903,0,144,25898000,58765;119709,59855,0,158,31080000,64642;179564,89782,0,174,37294000,71106;269346,134673,0,192,44752000,78217;404019,202009,0,211,44753000,86038;606028,303014,0,232,64443000,94642;909042,454521,0,255,77332000,104119;1363563,681782,0,282,92798000,114521;2045345,1022672,0,309,111358000,125979;null,null,null,null,null,138577';
const GAS_PRODUCTION = '112,35,0,2,180000,375;168,53,0,10,234000,468;252,79,0,13,304000,585;378,118,0,16,395000,732;567,177,0,20,514000,914;851,266,0,25,668000,1143;1276,399,0,32,869000,1429;1914,598,0,40,1129000,1786;2870,897,0,50,1468000,2233;4306,1346,0,62,1909000,2791;6458,2018,0,77,2481000,3488;9688,3027,0,97,3226000,4360;14532,4541,0,121,4194000,5451;21797,6812,0,151,5452000,6813;32696,10218,0,189,7087000,8516;49044,15326,0,236,9213000,10646;73566,22989,0,295,11977000,13307;110349,34484,0,369,15571000,16631;165524,51726,0,462,20242000,20792;248286,77589,0,577,26315000,25993;372429,116384,0,289,34209000,28601;558643,174576,0,317,44472000,31451;837965,261864,0,349,57813000,34596;1256947,392796,0,384,75157000,38056;1885421,589194,0,422,97704000,41861;2828131,883791,0,464,127015000,46047;4242196,1325686,0,511,165120000,50652;6363294,1988530,0,562,214656000,55717;9544942,2982794,0,618,279053000,61289;null,null,null,null,null,67418';
const BASIC_ENERGY = '75,30,0,0,151000,60;113,45,0,0,196000,120;169,68,0,0,255000,200;253,101,0,0,332000,300;380,152,0,0,431000,420;570,228,0,0,561000,630;854,342,0,0,729000,870;1281,513,0,0,948000,1140;1922,769,0,0,1232000,1440;2883,1153,0,0,1601000,1770;4325,1730,0,0,2082000,2210;6487,2595,0,0,2706000,2690;9731,3892,0,0,3518000,3210;14596,5839,0,0,4573000,3770;21895,8758,0,0,5945000,4370;32842,13137,0,0,7729000,5170;49263,19705,0,0,10048000,6020;73895,29558,0,0,13062000,6920;110842,44337,0,0,16981000,7870;166263,66505,0,0,22075000,8870;249394,99758,0,0,28697000,10130;374091,149637,0,0,37307000,11450;561137,224455,0,0,48499000,12830;841706,336682,0,0,63048000,14270;1262558,505023,0,0,81963000,15770;1893838,757535,0,0,106552000,17590;2840756,1136303,0,0,138517000,19480;4261135,1704454,0,0,180073000,21440;6391702,2556681,0,0,234094000,23470;null,null,null,null,null,25570';
const ADVANCED_ENERGY = '1500,500,250,0,900000,100;2250,750,375,0,1170000,200;3375,1125,563,0,1521000,350;5063,1688,844,0,1977000,550;7594,2531,1266,0,2570000,800;11391,3797,1898,0,3342000,1100;17086,5695,2848,0,4344000,1450;25629,8543,4271,0,5647000,1850;38443,12814,6407,0,7342000,2300;57665,19222,9611,0,9544000,2800;86498,28833,14416,0,12407000,3350;129746,43249,21624,0,16129000,3950;194620,64873,32437,0,20968000,4600;291929,97310,48655,0,27259000,5300;437894,145965,72982,0,35436000,6050;656841,218947,109473,0,46067000,6850;985261,328420,164210,0,59887000,7700;1477892,492631,246315,0,77854000,8600;2216838,738946,369473,0,101210000,9550;null,null,null,null,null,10550';
const HANGAR = '200,35,0,2,180000,70,120;30,5,0,26,234000,105,155;60,11,0,29,304000,158,208;120,21,0,32,395000,236,286;240,42,0,35,514000,354,404;481,84,0,39,668000,532,582;961,168,0,42,869000,797,847;1922,336,0,47,1129000,1196,1246;3844,673,0,51,1468000,1794,1844;7689,1346,0,56,1909000,2691,2741;15377,2691,0,62,2481000,3364,3414;30755,5382,0,68,3226000,4205,4255;61509,10764,0,75,4194000,5256,5306;123019,21528,0,83,5452000,6570,6620;246038,43057,0,91,7087000,8212,8262;492075,86113,0,100,9213000,10265,10315;984150,172226,0,110,11977000,12832,12882;1968300,344453,0,110,15571000,16040,16090;3936600,688905,0,110,20242000,20050,20100;null,null,null,null,null,25062,25112';
const CONSTRUCTION = '400,120,200,3,180000,98;600,180,300,3,225000,96;900,270,450,3,281000,93;1350,405,675,4,352000,90;2025,608,1013,4,439000,86;3038,911,1519,5,549000,83;4556,1367,2278,6,687000,80;6834,2050,3417,7,858000,77;10252,3075,5126,8,1073000,75;15377,4613,7689,9,1341000,72;23066,6920,11533,10,1676000,69;34599,10380,17300,12,2095000,67;51899,15570,25949,13,2619000,64;77848,23354,38924,16,3274000,62;116772,35032,58386,18,4093000,60;175158,52547,87579,21,5116000,58;262736,78821,131368,24,6395000,56;394105,118231,197052,28,7994000,53;591157,177347,295578,33,9992000,50;null,null,null,null,null,48';
const ADVANCED_FACTORY = '1000000,500000,100000,200,10980000,-5;1500000,750000,150000,200,21960000,-10;2250000,1125000,225000,250,27450000,-15;3375000,1687500,337500,250,34312000,-20;null,null,null,null,null,-23';
const METAL_STORAGE = '2000,0,0,1,600000,50000;3000,0,0,1,750000,130040;4500,0,0,2,937000,250080;6750,0,0,2,1172000,430120;10125,0,0,2,1465000,700160;15188,0,0,2,1831000,1105200;22781,0,0,3,2289000,1712740;34172,0,0,3,2861000,2624030;51258,0,0,4,3576000,3990945;76887,0,0,4,4470000,6041298;107641,0,0,5,5588000,9116806;150698,0,0,6,6985000,13422503;210977,0,0,6,8731000,19450461;295368,0,0,7,10914000,27889588;413515,0,0,9,13642000,39704348;537570,0,0,10,17053000,56244997;698841,0,0,11,21316000,77747829;908493,0,0,13,26645000,105701498;1181041,0,0,15,33307000,142041256;null,null,null,null,null,450000000';
const MINERAL_STORAGE = '1500,500,0,1,630000,50000;2250,750,0,1,787000,110040;3375,1125,0,2,984000,200080;5063,1688,0,2,1230000,335120;7594,2531,0,2,1538000,537660;11391,3797,0,2,1923000,841450;17086,5695,0,3,2403000,1297115;25629,8543,0,3,3004000,1980593;38443,12814,0,4,3755000,3005789;57665,19222,0,4,4694000,4543563;80731,28833,0,5,5867000,6850205;113023,43249,0,6,7334000,10079487;158233,64873,0,6,9168000,14600466;221526,97310,0,7,11460000,20929821;310136,145965,0,9,14325000,29790901;403177,218947,0,10,17906000,42196398;524131,328420,0,11,22382000,58323532;681370,492631,0,13,27978000,79288794;885781,738946,0,15,34972000,106543622;null,null,null,null,null,300000000';
const GAS_STORAGE = '2000,0,0,1,600000,50000;3000,0,0,2,750000,130040;4500,0,0,2,937000,250080;6750,0,0,2,1172000,430120;10125,0,0,2,1465000,700160;15188,0,0,3,1831000,1105200;22781,0,0,3,2289000,1712740;34172,0,0,4,2861000,2624030;51258,0,0,4,3576000,3990945;76887,0,0,5,4470000,6041298;107641,0,0,5,5588000,9116806;150698,0,0,6,6985000,13422503;210977,0,0,7,8731000,19450461;295368,0,0,8,10914000,27889588;413515,0,0,10,13642000,39704348;537570,0,0,11,17053000,56244997;698841,0,0,13,21316000,77747829;908493,0,0,15,26645000,105701498;1181041,0,0,17,33307000,142041256;null,null,null,null,null,189282930';
const RECYCLING = '22150,14500,5000,11,10980000,75,7;33225,21750,7500,13,21960000,80,12;49838,32625,11250,15,27450000,85,18;74756,48938,16875,17,34312000,90,25;112134,73406,25313,20,42891000,95,33;168202,110109,37969,23,53613000,100,42;252302,165164,56953,26,67017000,105,52;378454,247746,85430,30,83771000,110,63;567680,371619,128145,34,104713000,115,85;null,null,null,null,null,120,98';
const TRADE_CENTER = '5000,3500,100,2,1920000,0;7500,5250,150,3,3840000,0;11250,7875,225,3,4800000,0;16875,11813,338,4,6000000,0;25313,17719,506,4,7500000,0;37969,26578,759,7,9375000,0;56953,39867,1139,9,11719000,0;85430,59801,1709,12,14648000,0;128145,89701,2563,15,18311000,0;null,null,null,null,null,0';
const SHIPYARD = '500,250,100,3,1620000,0;1125,563,225,4,2187000,0;2531,1266,506,5,2952000,0;5695,2848,1139,6,3986000,0;12814,6407,2563,7,5381000,0;28833,14416,5767,9,7264000,0;64873,32437,12975,11,9807000,0;145965,72982,29193,14,13239000,0;328420,164210,65684,18,17872000,0;738946,369473,147789,22,24128000,0;1662628,831314,332526,28,32573000,0;3740914,1870457,748183,35,43973000,0;8417056,4208528,1683411,44,59364000,0;18938376,9469188,3787675,55,80141000,0;null,null,null,null,null,0';
const RESEARCH = '200,400,200,3,1020000,0;340,680,340,4,1275000,0;578,1156,578,5,1594000,0;983,1965,983,6,1992000,0;1670,3341,1670,8,2490000,0;2840,5679,2840,10,3113000,0;4828,9655,4828,13,3891000,0;8207,16414,8207,16,4864000,0;13952,27903,13952,20,6080000,0;23718,47435,23718,25,7600000,0;37948,75896,37948,31,9499000,0;60717,121434,60717,38,11874000,0;97147,194294,97147,48,14843000,0;155436,310871,155436,60,18554000,0;248697,497394,248697,75,23192000,0;397915,795830,397915,94,28990000,0;636664,1273328,636664,117,36238000,0;1018662,2037324,1018662,147,45297000,0;1629859,3259719,1629859,183,56621000,0;null,null,null,null,null,0';
const SPACEPORT = '250,150,300,2,1170000,0;625,375,750,2,1580000,0;1563,938,1875,2,2132000,0;3906,2344,4688,3,2879000,0;9766,5859,11719,4,3886000,0;24414,14648,29297,5,5246000,0;61035,36621,73242,6,7083000,0;152588,91553,183105,7,9561000,0;381470,228882,457764,9,12908000,0;null,null,null,null,null,0';
const PLANETARY_GOVERNMENT = '2000,1500,650,3,1020000,0;3800,2850,1235,4,1377000,0;7220,5415,2347,5,1859000,0;13718,10289,4458,6,2510000,0;26064,19548,8471,8,3388000,0;49522,37141,16095,10,4574000,0;94092,70569,30580,13,6175000,0;178774,134081,58102,16,8336000,0;339671,254753,110393,20,11253000,0;null,null,null,null,null,0';

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
  if (role === 'hangar' || role === 'construction') return level < 16 ? 'derived-series' : 'approved-md';
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
  if (role === 'metal-storage' || role === 'mineral-storage' || role === 'gas-storage') {
    const resource = role === 'metal-storage' ? 'metal' : role === 'mineral-storage' ? 'minerals' : 'gas';
    return { kind: 'storage-capacity', resource, capacity: value, label: `Вместимость ${resource}` };
  }
  if (role === 'recycling') {
    return { kind: 'recycling', efficiencyPercent: value, debrisPerSecond: values[6] ?? 0, label: 'Переработка' };
  }
  if (role === 'trade-center') return { kind: 'module', label: 'Торговые сделки: до 3 слотов на уровень' };
  if (role === 'shipyard') return { kind: 'module', label: 'Производство кораблей через отдельный модуль верфи' };
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

export function getProductionTimeFactor(level: number): number {
  const effect = getBuildingEffect('advanced-factory', level);
  return effect.kind === 'production-time-factor' ? effect.factorPercent / 100 : 1;
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
    case 'storage-capacity': return `${effect.label}: +${effect.capacity.toLocaleString('ru-RU')} к вместимости здания`;
    case 'recycling': return `${effect.label}: возврат ${effect.efficiencyPercent}%; ${effect.debrisPerSecond} обломков/с`;
    case 'module': return effect.label;
  }
}
