import type { AllianceRole } from '../../domain/command/types.ts';

const CRYSTAL_COUNT = 4;

/** One naming of the roles for every screen that shows them (Rating, Command). */
export const ROLE_NAMES: Readonly<Record<AllianceRole, { full: string; short: string }>> = {
  leader: { full: 'Глава', short: 'Глава' },
  deputy: { full: 'Заместитель', short: 'Зам.' },
  member: { full: 'Участник', short: 'Участник' },
};

export function RoleBadge({ role, compact = false }: { role: AllianceRole; compact?: boolean }) {
  return <span className={`rating-role-v2 is-${role}${compact ? ' is-compact' : ''}`} data-qa-rating-role={role}>{compact ? ROLE_NAMES[role].short : ROLE_NAMES[role].full}</span>;
}

export function CrystalDots({ count }: { count: number }) {
  return <span className="rating-crystals-v2" aria-label={`Кристаллы: ${count} из ${CRYSTAL_COUNT}`}>{Array.from({ length: CRYSTAL_COUNT }, (_, index) => <i key={index} className={index < count ? 'is-owned' : ''} />)}<b>{count}/{CRYSTAL_COUNT}</b></span>;
}
