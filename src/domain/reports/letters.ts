import { canManageAlliance, selectRole } from '../command/selectors.ts';
import type { AllianceApplication, AllianceRecord, ApplicationReason, CommandState } from '../command/types.ts';
import type { LetterAnswer, PersonalLetter, ReportItem } from './types.ts';

// «Личные»: letters addressed to the player. Today they are projected from what
// the Command domain already records about the player personally (answers to
// the player's applications, applications to the alliance the player runs).
// Bot letters with «Принять» / «Отказаться» use the same PersonalLetter shape.

const OPEN_COMMAND: LetterAnswer = { kind: 'open_command', label: 'Открыть Командование', primary: true };

const REJECT_TEXT: Record<ApplicationReason, string> = {
  declined: 'Руководство союза рассмотрело заявку и отказало.',
  full: 'В союзе не осталось свободных мест.',
  already_member: 'Заявка закрыта: вы уже состоите в союзе.',
  disbanded: 'Союз распущен, заявка закрыта.',
};

function allianceSender(application: AllianceApplication, alliance: AllianceRecord | undefined): PersonalLetter['sender'] {
  return alliance
    ? { kind: 'alliance', name: alliance.name, tag: alliance.tag, allianceId: alliance.id }
    : { kind: 'alliance', name: application.allianceName || 'Союз' };
}

function answerLetter(application: AllianceApplication, alliance: AllianceRecord | undefined): PersonalLetter | null {
  if (application.status === 'pending' || application.status === 'withdrawn' || application.resolvedAt === null) return null;
  const name = application.allianceName || alliance?.name || 'союз';
  const accepted = application.status === 'accepted';
  return {
    id: `letter:application-answer:${application.id}`,
    kind: 'application-answer',
    sender: allianceSender(application, alliance),
    subject: accepted ? `Заявка в союз «${name}» принята` : `Заявка в союз «${name}» отклонена`,
    text: accepted
      ? 'Добро пожаловать в союз. Состав, просьбы о помощи и совместные операции ждут в Командовании.'
      : application.status === 'auto_rejected'
        ? REJECT_TEXT[application.reason ?? 'full']
        : REJECT_TEXT[application.reason ?? 'declined'],
    at: application.resolvedAt,
    result: accepted ? { label: 'Принята', tone: 'success' } : { label: 'Отклонена', tone: 'danger' },
    answers: [{ ...OPEN_COMMAND }],
    subjectRef: application.id,
  };
}

function incomingLetter(application: AllianceApplication, alliance: AllianceRecord): PersonalLetter {
  return {
    id: `letter:application-incoming:${application.id}`,
    kind: 'application-incoming',
    sender: { kind: 'player', ownerId: application.ownerId, name: application.displayName },
    subject: `Заявка в союз «${alliance.name}»`,
    text: `${application.displayName} просит принять в союз. Ответить можно в Командовании, во вкладке заявок.`,
    at: application.createdAt,
    result: { label: 'Новая', tone: 'info' },
    answers: [{ kind: 'open_command', label: 'Рассмотреть заявку', primary: true }],
    subjectRef: application.id,
  };
}

export function personalLetters(command: Pick<CommandState, 'alliances' | 'applications'> | undefined, playerOwnerId: string | undefined): PersonalLetter[] {
  if (!command || !playerOwnerId) return [];
  const byId = new Map(command.alliances.map((alliance) => [alliance.id, alliance]));
  const letters: PersonalLetter[] = [];
  for (const application of command.applications) {
    const alliance = byId.get(application.allianceId);
    if (application.ownerId === playerOwnerId) {
      const letter = answerLetter(application, alliance);
      if (letter) letters.push(letter);
      continue;
    }
    if (application.status === 'pending' && alliance && canManageAlliance(selectRole(alliance, playerOwnerId))) {
      letters.push(incomingLetter(application, alliance));
    }
  }
  return letters;
}

export function personalLetterToReportItem(letter: PersonalLetter): ReportItem {
  const senderName = letter.sender.kind === 'alliance' && letter.sender.tag ? `[${letter.sender.tag}] ${letter.sender.name}` : letter.sender.name;
  return {
    id: letter.id,
    source: 'letter',
    category: 'personal',
    typeLabel: letter.sender.kind === 'alliance' ? 'Письмо союза' : 'Письмо игрока',
    title: letter.subject,
    preview: `${senderName} · ${letter.text}`,
    body: letter.text,
    timestamp: new Date(letter.at).toISOString(),
    statusLabel: letter.result.label.toLocaleUpperCase('ru-RU'),
    statusTone: letter.result.tone,
    participantNames: [senderName],
    planetNames: [],
    coordinates: [],
    details: [],
    letter,
  };
}

/** Every «Личные» item of the player, newest first is up to the feed. */
export function personalLetterItems(command: Pick<CommandState, 'alliances' | 'applications'> | undefined, playerOwnerId: string | undefined): ReportItem[] {
  return personalLetters(command, playerOwnerId).map(personalLetterToReportItem);
}
