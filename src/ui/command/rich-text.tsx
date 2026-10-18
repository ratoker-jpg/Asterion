import type { ReactNode } from 'react';

/**
 * Minimal, safe formatting for alliance texts: **жирный**, __подчёркнутый__,
 * *курсив*. The markers are stored in the plain description string (they count
 * toward its length limit); nothing is rendered as HTML.
 */
const TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g;

export function renderRichText(text: string): ReactNode[] {
  return text.split(TOKEN).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) return <u key={index}>{part.slice(2, -2)}</u>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

/** Removes the markers, e.g. for a one-line catalog excerpt. */
export function stripRichText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\*([^*]+)\*/g, '$1');
}

export type RichMark = 'bold' | 'underline' | 'italic';
const MARKERS: Record<RichMark, string> = { bold: '**', underline: '__', italic: '*' };

/** Wraps the selected range (or inserts an empty pair) and returns the new text and caret range. */
export function applyRichMark(text: string, start: number, end: number, mark: RichMark) {
  const marker = MARKERS[mark];
  const selected = text.slice(start, end);
  const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
  return { text: next, start: start + marker.length, end: end + marker.length };
}
