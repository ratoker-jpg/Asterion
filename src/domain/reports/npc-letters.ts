import type { CommandState } from '../command/types.ts';
import type { SpyTargetState } from '../espionage/types.ts';
import { NPC_LETTER_BALANCE, type NpcLetterRecord } from '../npc/letters.ts';
import type { NpcJointStrikeProposal } from '../npc/pacts.ts';
import type { NpcStrategyState } from '../npc/strategy.ts';
import type { LetterAnswer, PersonalLetter, ReportPlace } from './types.ts';

// «Личные»: letters the bots write to the player. They are not stored as
// letters: the invitation is the pact in the save (domain/npc/pacts.ts) and the
// rest are records (domain/npc/letters.ts). This turns both into the one
// PersonalLetter shape the messages screen draws, at the world's time.

/** What the projection needs of the world: the bots' letters, the time, and who holds which planet. */
export type NpcLetterContext = {
  strategy?: Pick<NpcStrategyState, 'proposals' | 'letters'>;
  /** World time: a letter whose moment has passed shows «Истекло» and loses its buttons. */
  now: number;
  targets?: Readonly<Record<string, SpyTargetState>>;
};

const MINUTE = 60_000;
const coordText = (c: { galaxy: number; system: number; position: number }) => `${c.galaxy}:${c.system}:${c.position}`;
const clockFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });

/** «14:20», or «12.11 14:20» when it is not the day of `reference`. */
function clock(at: number, reference: number): string {
  const date = new Date(at);
  return dayFormat.format(date) === dayFormat.format(new Date(reference)) ? clockFormat.format(date) : `${dayFormat.format(date)} ${clockFormat.format(date)}`;
}

const ACCEPT: LetterAnswer = { kind: 'accept', label: 'Принять', primary: true };
const DECLINE: LetterAnswer = { kind: 'decline', label: 'Отказаться' };
const OPEN_FLEETS: LetterAnswer = { kind: 'open_fleets', label: 'Открыть флот', primary: true };
const OPEN_COMMAND: LetterAnswer = { kind: 'open_command', label: 'Открыть Командование', primary: true };

function planetPlace(target: SpyTargetState | undefined): ReportPlace | undefined {
  return target ? { name: target.name, coordinate: target.coordinate, planetId: target.id, ownerId: target.ownerId } : undefined;
}

function botSender(command: Pick<CommandState, 'alliances'>, ownerId: string, targets: readonly SpyTargetState[]): PersonalLetter['sender'] {
  const planet = targets.find((target) => target.ownerId === ownerId);
  const alliance = command.alliances.find((item) => item.members.some((member) => member.ownerId === ownerId));
  const member = alliance?.members.find((item) => item.ownerId === ownerId);
  return {
    kind: 'player', ownerId, name: planet?.ownerName ?? member?.displayName ?? 'Командующий', factionId: planet?.raceId,
    ...(alliance ? { alliance: { name: alliance.name, tag: alliance.tag, allianceId: alliance.id } } : {}),
  };
}

function strikeLetter(proposal: NpcJointStrikeProposal, sender: PersonalLetter['sender'], ctx: NpcLetterContext): PersonalLetter {
  const { terms } = proposal;
  const target = ctx.targets?.[terms.targetPlanetId];
  const place = planetPlace(target);
  const name = sender.name;
  const ownerName = target?.ownerName ?? 'владелец';
  const reference = proposal.createdAt;
  const window = `от ${clock(terms.strikeAt + 2 * MINUTE, reference)} до ${clock(terms.strikeAt + terms.toleranceMs, reference)}`;
  const fleet = terms.fromShips ? `Его флот: около ${terms.fromShips.toLocaleString('ru-RU')} кораблей` : 'Его флот выйдет сам';
  const where = target ? `${target.name} [${coordText(target.coordinate)}], владелец ${ownerName}` : `планета игрока ${ownerName}`;
  const base = `Цель: ${where}.
${fleet}, подойдёт около ${clock(terms.strikeAt, reference)} (разброс до ${NPC_LETTER_BALANCE.scatterMinutes} мин).
Ваш флот ждут ${window}.`;
  const windowEnd = terms.strikeAt + 3 * terms.toleranceMs + 40 * MINUTE;
  let answers: LetterAnswer[] = [];
  let result: PersonalLetter['result'];
  let text = base;
  let deadlineAt: number | undefined;
  if (proposal.status === 'proposed' && ctx.now < proposal.expiresAt) {
    deadlineAt = proposal.expiresAt;
    result = { label: 'Новое', tone: 'info' };
    text = `${base}
Ответьте до ${clock(proposal.expiresAt, reference)}.`;
    answers = [{ ...ACCEPT }, { ...DECLINE }];
  } else if (proposal.status === 'proposed' || proposal.status === 'expired') {
    result = { label: 'Истекло', tone: 'neutral' };
  } else if (proposal.status === 'declined') {
    result = { label: proposal.reason === 'player-declined' ? 'Вы отказались' : 'Отклонено', tone: 'neutral' };
  } else if (proposal.status === 'accepted') {
    if (ctx.now > windowEnd) result = { label: 'Окно закрыто', tone: 'neutral' };
    else {
      result = { label: 'Принято', tone: 'success' };
      deadlineAt = terms.strikeAt + terms.toleranceMs;
      text = `${base}
Вы согласились: флот ${name} выйдет сам, ваш нужно отправить в это окно.`;
      answers = [{ ...OPEN_FLEETS }];
    }
  } else if (proposal.status === 'fulfilled') {
    result = { label: 'Выполнено', tone: 'success' };
    text = `${base}
Оба флота дошли до цели.`;
  } else if (proposal.status === 'broken') {
    result = proposal.by === proposal.from ? { label: 'Бот не пришёл', tone: 'warning' } : { label: 'Сорвано вами', tone: 'danger' };
  } else if (proposal.status === 'withdrawn' || proposal.status === 'cancelled') {
    result = { label: 'Отменено', tone: 'warning' };
    text = `${base}
${name} отозвал приглашение${proposal.reason === 'no-force' ? ': не хватило сил' : ''}.`;
  } else {
    result = { label: 'Закрыто', tone: 'neutral' };
  }
  return {
    id: `letter:npc-pact:${proposal.proposalId}`, kind: 'bot-joint-strike', sender,
    subject: target ? `${name} зовёт на совместную атаку: ${target.name}` : `${name} зовёт на совместную атаку`,
    text, at: Math.max(proposal.createdAt, proposal.decidedAt ?? 0, proposal.closedAt ?? 0), result, answers,
    subjectRef: proposal.proposalId, ref: { kind: 'joint-strike', id: proposal.proposalId }, ...(place ? { place } : {}),
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
  };
}

const REPLY_LINES: Record<string, string> = {
  'declined/warm': 'Жаль, но я понимаю. В следующий раз буду рад вашей помощи.',
  'declined/cold': 'Ясно. Запомню, что рассчитывать на вас не стоит.',
  'declined/angry': 'Вы отказались. Я это запомню.',
  'no-show/warm': 'Вы не пришли. Надеюсь, на то была причина.',
  'no-show/cold': 'Вы обещали и не пришли. Я это записал.',
  'no-show/angry': 'Вы меня подвели. Такое не забывается.',
  'betrayed/warm': 'Вы ударили по тому, с кем был уговор. Мне жаль, что так вышло.',
  'betrayed/cold': 'Вы ударили по тому, с кем был уговор. Договор разорван.',
  'betrayed/angry': 'Вы ударили по тому, с кем был уговор. Больше не пишите мне.',
};

function replyLetter(record: NpcLetterRecord, sender: PersonalLetter['sender']): PersonalLetter {
  const tone = record.tone ?? 'cold';
  return {
    id: `letter:npc:${record.letterId}`, kind: 'bot-reply', sender, subject: `${sender.name} ответил вам`,
    text: REPLY_LINES[`${record.cause ?? 'declined'}/${tone}`] ?? REPLY_LINES['declined/cold']!,
    at: record.createdAt,
    result: { label: tone === 'warm' ? 'Ответ' : tone === 'angry' ? 'Гнев' : 'Холодно', tone: tone === 'warm' ? 'info' : tone === 'angry' ? 'danger' : 'warning' },
    answers: [],
  };
}

function helpLetter(record: NpcLetterRecord, sender: PersonalLetter['sender'], ctx: NpcLetterContext): PersonalLetter {
  const target = record.planetId ? ctx.targets?.[record.planetId] : undefined;
  const attackerPlanet = record.attackerId ? Object.values(ctx.targets ?? {}).find((item) => item.ownerId === record.attackerId) : undefined;
  const attacker = attackerPlanet?.ownerName;
  const where = target ? `${target.name} [${coordText(target.coordinate)}]` : 'его планету';
  const lands = record.arrivalAt !== undefined ? clock(record.arrivalAt, record.createdAt) : '';
  const who = record.attackerId ? `Флот игрока ${attacker ?? 'неизвестного'}` : 'Пираты';
  const base = `${who} идёт на ${where}, будет там около ${lands}.
Нужна дислокация вашего флота на эту планету до этого времени.`;
  let answers: LetterAnswer[] = [];
  let result: PersonalLetter['result'];
  let text = base;
  let deadlineAt: number | undefined;
  if (record.status === 'new' && ctx.now < record.expiresAt) { result = { label: 'Новое', tone: 'info' }; answers = [{ ...ACCEPT }, { ...DECLINE }]; deadlineAt = record.expiresAt; }
  else if (record.status === 'accepted' && ctx.now < record.expiresAt) { result = { label: 'Обещано', tone: 'success' }; deadlineAt = record.arrivalAt ?? record.expiresAt; text = `${base}
Вы обещали помочь: отправьте дислокацию до ${lands}.`; answers = [{ ...OPEN_FLEETS }]; }
  else if (record.status === 'kept') { result = { label: 'Помощь пришла', tone: 'success' }; text = `${base}
Ваш флот успел.`; }
  else if (record.status === 'failed' || record.status === 'accepted') { result = { label: 'Не помогли', tone: 'danger' }; text = `${base}
Помощь не пришла вовремя.`; }
  else if (record.status === 'declined') result = { label: 'Вы отказались', tone: 'neutral' };
  else result = { label: 'Истекло', tone: 'neutral' };
  const place = planetPlace(target);
  return {
    id: `letter:npc:${record.letterId}`, kind: 'bot-help-request', sender, subject: `${sender.name} просит помощи`, text,
    at: Math.max(record.createdAt, record.decidedAt ?? 0, record.closedAt ?? 0), result, answers,
    subjectRef: record.letterId, ref: { kind: 'help-request', id: record.letterId }, ...(place ? { place } : {}),
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    ...(record.arrivalAt !== undefined ? { arriveBy: record.arrivalAt } : {}),
    attacker: record.attackerId
      ? { name: attacker ?? 'Неизвестный', ownerId: record.attackerId, ...(attackerPlanet?.raceId ? { factionId: attackerPlanet.raceId } : {}) }
      : { name: 'Пираты' },
  };
}

function allyLetter(record: NpcLetterRecord, sender: PersonalLetter['sender'], command: Pick<CommandState, 'alliances'>, ctx: NpcLetterContext): PersonalLetter {
  const alliance = record.allianceId ? command.alliances.find((item) => item.id === record.allianceId) : undefined;
  const label = alliance ? `[${alliance.tag}] ${alliance.name}` : 'союз';
  const members = alliance ? `, ${alliance.members.length} участников` : '';
  const base = `${sender.name} предлагает вам вступить в ${label}${members}. Состав и права смотрите в Командовании.`;
  let answers: LetterAnswer[] = [];
  let result: PersonalLetter['result'];
  let text = base;
  let deadlineAt: number | undefined;
  if (record.status === 'new' && ctx.now < record.expiresAt) {
    result = { label: 'Новое', tone: 'info' };
    deadlineAt = record.expiresAt;
    text = `${base}
Ответьте до ${clock(record.expiresAt, record.createdAt)}.`;
    answers = [{ ...ACCEPT }, { ...DECLINE }];
  } else if (record.status === 'accepted') {
    result = { label: 'Вы в союзе', tone: 'success' };
    text = `Вы вступили в ${label}.`;
    answers = [{ ...OPEN_COMMAND }];
  } else if (record.status === 'declined') result = { label: 'Вы отказались', tone: 'neutral' };
  else result = { label: 'Истекло', tone: 'neutral' };
  return {
    id: `letter:npc:${record.letterId}`, kind: 'bot-ally-offer', sender, subject: `${sender.name} зовёт вас в союз`, text,
    at: Math.max(record.createdAt, record.decidedAt ?? 0, record.closedAt ?? 0), result, answers,
    subjectRef: record.letterId, ref: { kind: 'ally-offer', id: record.letterId },
    ...(deadlineAt !== undefined ? { deadlineAt } : {}),
  };
}

/** The letters the bots wrote to the player, each in its current state. */
export function npcLetterList(command: Pick<CommandState, 'alliances'>, playerOwnerId: string, ctx: NpcLetterContext): PersonalLetter[] {
  const strategy = ctx.strategy;
  if (!strategy) return [];
  const targets = ctx.targets ? Object.values(ctx.targets) : [];
  const letters: PersonalLetter[] = [];
  for (const proposal of strategy.proposals ?? []) {
    if (proposal.kind !== 'joint-strike' || proposal.to !== playerOwnerId) continue;
    letters.push(strikeLetter(proposal, botSender(command, proposal.from, targets), ctx));
  }
  for (const record of strategy.letters ?? []) {
    const sender = botSender(command, record.from, targets);
    letters.push(record.kind === 'reply' ? replyLetter(record, sender) : record.kind === 'help-request' ? helpLetter(record, sender, ctx) : allyLetter(record, sender, command, ctx));
  }
  return letters;
}
