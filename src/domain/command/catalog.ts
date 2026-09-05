import type {
  AllianceEvent,
  AllianceMember,
  AllianceProfile,
  DiplomaticRelation,
  JointOperation,
  ResourceRequest,
} from './types.ts';

export const DEFAULT_ALLIANCE_PROFILE: AllianceProfile = {
  name: 'Содружество Гелион',
  tag: 'HLN',
  leaderMemberId: 'member-kai-norden',
  motto: 'Единый курс. Общая орбита.',
  description: 'Тактический союз колоний внутреннего сектора. Совместные операции координируются через Командование.',
  status: 'active',
  foundedLabel: 'Цикл 04.26',
  emblem: { glyph: 'starforge', accent: 'cyan' },
};

export const DEFAULT_ALLIANCE_MEMBERS: readonly AllianceMember[] = [
  {
    id: 'member-kai-norden', callsign: 'Кай Норден', role: 'leader', homeSector: 'Helion · 1:1',
    specialization: 'Стратегическое командование', activity: 'online', contribution: 1840,
    currentOperationId: 'joint-sun-raid', note: 'Координирует окно сбора сил и приоритеты совместных операций.',
  },
  {
    id: 'member-ira-vel', callsign: 'Ира Вель', role: 'officer', homeSector: 'Aster · 1:4',
    specialization: 'Логистика', activity: 'online', contribution: 1510,
    currentOperationId: 'joint-sun-raid', note: 'Ведёт ресурсные запросы и подготовку транспортных контуров.',
  },
  {
    id: 'member-daren-sol', callsign: 'Дарен Сол', role: 'officer', homeSector: 'Tau · 2:3',
    specialization: 'Ударные флоты', activity: 'active', contribution: 1460,
    currentOperationId: 'joint-gate-intercept', note: 'Специализация — перехват и быстрые совместные вылеты.',
  },
  {
    id: 'member-lis-ara', callsign: 'Лис Ара', role: 'veteran', homeSector: 'Mira · 2:8',
    specialization: 'Оборона систем', activity: 'active', contribution: 1215,
    currentOperationId: 'joint-mirage-evac', note: 'Поддерживает оборонительные задачи и прикрытие эвакуаций.',
  },
  {
    id: 'member-ven-tor', callsign: 'Вен Тор', role: 'veteran', homeSector: 'Draco · 3:2',
    specialization: 'Разведка', activity: 'online', contribution: 1120,
    currentOperationId: 'joint-gate-intercept', note: 'Разведданные по внешнему контуру и оценка рисков.',
  },
  {
    id: 'member-nora-kei', callsign: 'Нора Кей', role: 'member', homeSector: 'Oris · 3:7',
    specialization: 'Промышленность', activity: 'active', contribution: 870,
    currentOperationId: null, note: 'Стабильный промышленный вклад, периодически запрашивает газ для производства.',
  },
  {
    id: 'member-rin-os', callsign: 'Рин Ос', role: 'member', homeSector: 'Vega · 4:1',
    specialization: 'Энергетика', activity: 'away', contribution: 740,
    currentOperationId: null, note: 'Поддержка энергетических проектов и резервных мощностей.',
  },
  {
    id: 'member-tess-var', callsign: 'Тесс Вар', role: 'member', homeSector: 'Kron · 4:5',
    specialization: 'Снабжение', activity: 'active', contribution: 690,
    currentOperationId: 'joint-mirage-evac', note: 'Снабжение экспедиционных групп и гражданских конвоев.',
  },
];

export const DEFAULT_RESOURCE_REQUESTS: readonly ResourceRequest[] = [
  {
    id: 'request-nora-gas', memberId: 'member-nora-kei', resource: 'gas', amount: 4200, fulfilledAmount: 1600,
    purpose: 'Цикл промышленного производства', priority: 'high', state: 'open',
  },
  {
    id: 'request-tess-metal', memberId: 'member-tess-var', resource: 'metal', amount: 6800, fulfilledAmount: 2400,
    purpose: 'Подготовка эвакуационного конвоя', priority: 'critical', state: 'open',
  },
  {
    id: 'request-rin-minerals', memberId: 'member-rin-os', resource: 'minerals', amount: 3100, fulfilledAmount: 900,
    purpose: 'Модернизация энергетического узла', priority: 'standard', state: 'open',
  },
  {
    id: 'request-ven-energy', memberId: 'member-ven-tor', resource: 'energy', amount: 1200, fulfilledAmount: 0,
    purpose: 'Полевой сенсорный контур', priority: 'high', state: 'reviewing',
  },
];

export const DEFAULT_DIPLOMACY: readonly DiplomaticRelation[] = [
  {
    id: 'relation-aurora', allianceName: 'Коалиция Аврора', tag: 'AUR', status: 'ally',
    note: 'Проверенный партнёр по операциям внутреннего сектора.',
    meaning: 'Допускается совместное планирование. Реальные бонусы в v1 не начисляются.',
    history: ['Подтверждён совместный протокол связи', 'Согласовано окно наблюдения за корональным узлом'],
  },
  {
    id: 'relation-meridian', allianceName: 'Меридиан', tag: 'MRD', status: 'trade_pact',
    note: 'Открытый торговый коридор без военных обязательств.',
    meaning: 'Торговый статус носит информационный характер до появления экономической механики.',
    history: ['Продлён навигационный коридор', 'Стороны сохранили нейтральный военный режим'],
  },
  {
    id: 'relation-free-orbits', allianceName: 'Свободные Орбиты', tag: 'ORB', status: 'neutral',
    note: 'Стабильный нейтралитет и обмен открытыми навигационными данными.',
    meaning: 'Обязательств нет; операции оцениваются отдельно.',
    history: ['Подтверждён нейтральный статус'],
  },
  {
    id: 'relation-iron-veil', allianceName: 'Железная Вуаль', tag: 'IVL', status: 'tense',
    note: 'Рост активности на границе систем 3-го кольца.',
    meaning: 'Повышенный риск столкновений. Автоматических штрафов нет.',
    history: ['Зафиксировано сближение патрулей', 'Дипломатический канал остаётся открытым'],
  },
  {
    id: 'relation-void-hand', allianceName: 'Рука Пустоты', tag: 'VHD', status: 'hostile',
    note: 'Операции союза регулярно пересекаются с интересами Содружества.',
    meaning: 'Враждебный статус — только foundation-метаданные, без отдельной войны в этом PR.',
    history: ['Отозван протокол безопасного прохода', 'Контакты переведены в режим повышенного контроля'],
  },
];

export const DEFAULT_JOINT_OPERATIONS: readonly JointOperation[] = [
  {
    id: 'joint-sun-raid', title: 'Рейд на Солнце', kind: 'sun_raid',
    objective: 'Сформировать ударную группу для выхода к корональному узлу Корон-7.', state: 'mustering',
    participants: 9, recommendedParticipants: 12, windowLabel: 'Сбор сил · окно 00:54:00',
    description: 'Флагманская союзная операция. Сейчас работает только участие и подготовительный статус; исполнение рейда отложено.',
    joinedByPlayer: false,
  },
  {
    id: 'joint-gate-intercept', title: 'Перехват у Врат Тау', kind: 'assault',
    objective: 'Синхронно перекрыть три маршрута выхода из системы Тау.', state: 'active',
    participants: 11, recommendedParticipants: 12, windowLabel: 'Активная фаза · 01:18:30',
    description: 'Кооперативная ударная задача средней длительности. Реальный dispatch выполняться в этом PR не будет.',
    joinedByPlayer: true,
  },
  {
    id: 'joint-mirage-evac', title: 'Эвакуация станции Мираж', kind: 'logistics',
    objective: 'Собрать прикрытие и транспортный резерв для эвакуационного окна.', state: 'awaiting',
    participants: 7, recommendedParticipants: 10, windowLabel: 'Ожидает участников · 02:35:00',
    description: 'Вспомогательная операция с упором на координацию. Транспортировка останется в контуре Флотов.',
    joinedByPlayer: false,
  },
];

export const DEFAULT_ALLIANCE_EVENTS: readonly AllianceEvent[] = [
  { id: 'event-01', kind: 'operation', timestampLabel: '16:42', text: 'Дарен Сол присоединился к операции «Рейд на Солнце».' },
  { id: 'event-02', kind: 'request', timestampLabel: '15:18', text: 'Тесс Вар создал срочный запрос на металл для эвакуационного конвоя.' },
  { id: 'event-03', kind: 'diplomacy', timestampLabel: '13:05', text: 'Отношения с «Железной Вуалью» отмечены как напряжённые.' },
  { id: 'event-04', kind: 'member', timestampLabel: '11:27', text: 'Вен Тор обновил статус разведывательной группы.' },
  { id: 'event-05', kind: 'settings', timestampLabel: '09:40', text: 'Командование подтвердило текущее окно совместных операций.' },
];
