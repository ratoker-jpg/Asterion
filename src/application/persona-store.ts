import { createPersonaRegistry, parsePersonaRegistry, type PersonaRegistry } from '../domain/npc/persona-registry.ts';

/**
 * The series registry on this computer (electron/persona-file.cjs). The browser
 * version has no such file, and says so instead of pretending to remember.
 */

export type PersonaBridge = {
  read: () => { text: string | null; backup: string | null };
  write: (text: string) => void;
};

export type PersonaRegistryRead =
  | { status: 'ok'; registry: PersonaRegistry; recovered: boolean }
  | { status: 'unavailable' }
  | { status: 'unreadable'; message: string };

function desktopBridge(): PersonaBridge | null {
  return (globalThis as { asterionDesktop?: { personas?: PersonaBridge } }).asterionDesktop?.personas ?? null;
}

export function readPersonaRegistry(bridge: PersonaBridge | null = desktopBridge()): PersonaRegistryRead {
  if (!bridge) return { status: 'unavailable' };
  let files: { text: string | null; backup: string | null };
  try {
    files = bridge.read();
  } catch (error) {
    return { status: 'unreadable', message: error instanceof Error ? error.message : String(error) };
  }
  if (files.text === null && files.backup === null) return { status: 'ok', registry: createPersonaRegistry(), recovered: false };
  const main = files.text === null ? null : parsePersonaRegistry(files.text);
  if (main?.ok) return { status: 'ok', registry: main.registry, recovered: false };
  if (main && !main.ok && main.reason === 'newer') return { status: 'unreadable', message: 'Опыт серии записан более новой версией игры.' };
  const backup = files.backup === null ? null : parsePersonaRegistry(files.backup);
  if (backup?.ok) return { status: 'ok', registry: backup.registry, recovered: true };
  return { status: 'unreadable', message: 'Файл опыта серии повреждён.' };
}

export function writePersonaRegistry(registry: PersonaRegistry, bridge: PersonaBridge | null = desktopBridge()): { ok: true } | { ok: false; error: string } {
  if (!bridge) return { ok: false, error: 'Опыт серии хранится только в настольной версии игры.' };
  try {
    bridge.write(JSON.stringify(registry));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
