import type { NavigationIconKind } from '../navigation.tsx';
import type { HeaderIconKind } from './types.ts';

export function GameIcon({ kind }: { kind: HeaderIconKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (kind === 'metal') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 7 12 3l8 4-8 4-8-4Z"/><path {...common} d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>;
  if (kind === 'mineral') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 7 7-7 13L5 9l7-7Z"/><path {...common} d="M5 9h14M12 2v20"/></svg>;
  if (kind === 'gas') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3c4 4.7 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2-6.3 6-11Z"/><circle {...common} cx="10" cy="13" r="1.8"/><circle {...common} cx="14.5" cy="15.5" r="1.2"/></svg>;
  if (kind === 'energy') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z"/></svg>;
  if (kind === 'population') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="9" cy="8" r="3"/><circle {...common} cx="16.5" cy="9.5" r="2.3"/><path {...common} d="M3.5 20c.5-4.2 2.5-6.3 5.5-6.3s5 2.1 5.5 6.3M14 14.6c3.5-.5 5.6 1.3 6.5 5.4"/></svg>;
  if (kind === 'resource') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 4 6-4 6-4-6 4-6Zm-6 9 3 4-3 5-3-5 3-4Zm12 0 3 4-3 5-3-5 3-4Z"/></svg>;
  if (kind === 'industry') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M3 21V10l6 3v-3l6 3V6h4v15H3Z"/><path {...common} d="M6 17h2m3 0h2m3 0h2M16 6V3h3v3"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 19h16M7 19v-4l4-2V8l2-2 2 2v5l3 2v4M11 10h4M9 19v-3m6 3v-4"/><path {...common} d="m12 6 1-4 1 4"/></svg>;
}

export function NavigationIcon({ kind }: { kind: NavigationIconKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.55, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (kind === 'planet') return <svg viewBox="0 0 32 32" aria-hidden="true"><ellipse {...common} cx="16" cy="16" rx="11" ry="6.5" /><circle {...common} cx="16" cy="16" r="4.7" /><path {...common} d="M4 13c5-5 19-7 25-2M5 20c5 4 17 5 23 1" /></svg>;
  if (kind === 'universe') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="2.4" /><ellipse {...common} cx="16" cy="16" rx="12.5" ry="5.2" transform="rotate(25 16 16)" /><ellipse {...common} cx="16" cy="16" rx="12.5" ry="5.2" transform="rotate(-35 16 16)" /></svg>;
  if (kind === 'fleets') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 3 8 23-8-5-8 5 8-23Z" /><path {...common} d="M11 19H4l5-6M21 19h7l-5-6M16 8v13" /></svg>;
  if (kind === 'operations') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="10" /><circle {...common} cx="16" cy="16" r="4" /><path {...common} d="M16 2v6M16 24v6M2 16h6M24 16h6" /></svg>;
  if (kind === 'command') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 8 4 5-4 5-4-5 4-5Z" /><path {...common} d="M12 13 3 9l6 9 7 7M20 13l9-4-6 9-7 7" /></svg>;
  if (kind === 'reports') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M9 3h11l4 4v22H9V3Z" /><path {...common} d="M20 3v5h5M13 13h8M13 18h8M13 23h6" /></svg>;
  if (kind === 'settings') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="4.2" /><path {...common} d="m16 3 1.5 3.4a10.3 10.3 0 0 1 3 1.2l3.4-1.4 2.1 2.1-1.4 3.4a10.3 10.3 0 0 1 1.2 3L29 16l-1.2 1.5a10.3 10.3 0 0 1-1.2 3l1.4 3.4-2.1 2.1-3.4-1.4a10.3 10.3 0 0 1-3 1.2L16 29l-1.5-1.2a10.3 10.3 0 0 1-3-1.2l-3.4 1.4L6 25.9l1.4-3.4a10.3 10.3 0 0 1-1.2-3L3 16l3.2-1.3a10.3 10.3 0 0 1 1.2-3L6 8.3l2.1-2.1 3.4 1.4a10.3 10.3 0 0 1 3-1.2L16 3Z" /></svg>;
  if (kind === 'rating') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 4 3.5 7.1 7.8 1.1-5.7 5.5 1.3 7.8-6.9-3.7-6.9 3.7 1.3-7.8-5.7-5.5 7.8-1.1L16 4Z" /></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M13 4h6M14 4v8L7 25c-1.1 2.2.2 4 3 4h12c2.8 0 4.1-1.8 3-4l-7-13V4" /><path {...common} d="M10 21h12" /></svg>;
}

