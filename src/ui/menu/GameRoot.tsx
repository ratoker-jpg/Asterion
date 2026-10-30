import { useEffect, useRef, useState } from 'react';
import { App } from '../../App';
import { FleetWorkspacePortal } from '../../FleetWorkspacePortal';
import { GlobalPageScrollController } from '../../GlobalPageScrollController';
import { GlobalTypographyController } from '../../GlobalTypographyController';
import { PrototypeResetController } from '../../PrototypeResetController';
import { RepairWorkshopPortal } from '../../RepairWorkshopPortal';
import { ShipInfoController } from '../../ShipInfoController';
import { DefenseInfoController } from '../../DefenseInfoController';
import { UtilityScreensPortal } from '../../UtilityScreensPortal';
import { NavigationProvider } from '../navigation.tsx';
import { useMusic } from '../../audio/hooks.ts';
import { LaunchOverlay } from './LaunchOverlay.tsx';
import { ACTIVE_RUNTIME_MODE } from '../../domain/runtime/mode.ts';
import { LEGACY_PRODUCTION_SAVE_KEY, selectContinueSlot, type SaveSlotMeta } from '../../domain/session/slots.ts';
import { createInitialSaveState } from '../../application/persistence.ts';
import { checkSlotEntry, readSlotIndex } from '../../application/slots.ts';
import { MenuApp, type SlotEntryProblem } from './MenuApp.tsx';
import { TestSaveGuard } from './SaveProblemScreen.tsx';
import { applySlotRuntime, consumeNextScreen, wantsAutostart, type ActiveSession } from './session.ts';
import { prepareCloudEntry, resolveCloudConflict, type CloudConflict, type CloudEntryOutcome } from './cloud.ts';

/** The running campaign: the game screen and its global controllers. */
function GameShell({ session, launched = false }: { session: ActiveSession | null; launched?: boolean }) {
  useMusic('game');
  return (
    <NavigationProvider>
      {launched ? <LaunchOverlay /> : null}
      <App session={session} />
      <PrototypeResetController />
      <GlobalPageScrollController />
      <GlobalTypographyController />
      <FleetWorkspacePortal />
      <UtilityScreensPortal />
      <RepairWorkshopPortal />
      <ShipInfoController />
      <DefenseInfoController />
    </NavigationProvider>
  );
}

function enter(slot: SaveSlotMeta, entryNotice?: ActiveSession['entryNotice']): ActiveSession {
  applySlotRuntime(slot);
  return { slotId: slot.id, slotName: slot.name, factionId: slot.factionId, ...(entryNotice ? { entryNotice } : {}) };
}

/**
 * Production starts in the main menu; a chosen slot mounts the game on a
 * fresh module state. Test Mode (`?mode=test`) keeps its direct entry and its
 * own isolated save, so the existing QA scripts work unchanged.
 */
export function GameRoot() {
  if (ACTIVE_RUNTIME_MODE === 'test') return <TestSaveGuard><GameShell session={null} /></TestSaveGuard>;
  return <ProductionRoot />;
}

/** `?autostart=continue`: the slot to open, or the problem that keeps it closed. */
function autostartSlot(): { slot: SaveSlotMeta | null; problem: SlotEntryProblem | null } {
  let slot = selectContinueSlot(readSlotIndex());
  if (!slot) {
    // Desktop shortcuts and QA scripts expect a playable world at once:
    // seed the legacy campaign (the same key and start as before the menu),
    // but never over an existing legacy payload, even an unreadable one.
    try {
      if (window.localStorage.getItem(LEGACY_PRODUCTION_SAVE_KEY) === null) {
        window.localStorage.setItem(LEGACY_PRODUCTION_SAVE_KEY, JSON.stringify(createInitialSaveState('production')));
      }
    } catch { /* the menu stays available */ }
    slot = selectContinueSlot(readSlotIndex());
  }
  return { slot, problem: null };
}

function ProductionRoot() {
  const [initialScreen] = useState(() => consumeNextScreen() ?? 'main');
  const [autostart] = useState(() => (wantsAutostart() ? autostartSlot() : null));
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [entryProblem, setEntryProblem] = useState<SlotEntryProblem | null>(null);
  // The cloud relay runs before a slot opens (src/ui/menu/cloud.ts): its banner and a conflict to resolve.
  const [cloudStage, setCloudStage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ slot: SaveSlotMeta; conflict: CloudConflict; launched: boolean } | null>(null);
  const [autostartPending, setAutostartPending] = useState(Boolean(autostart?.slot));
  // Entered from the menu (not autostart): the game opens with the jump-in overlay.
  const [launched, setLaunched] = useState(false);
  const entering = useRef(false);

  /** Continue, Load, autostart and a freshly created slot all pass the same health gate. */
  const open = (slot: SaveSlotMeta, outcome: CloudEntryOutcome, viaAutostart: boolean) => {
    const current = readSlotIndex().slots.find((item) => item.id === slot.id) ?? slot;
    const check = checkSlotEntry(current);
    // Autostart keeps its old meaning for a slot whose payload is gone: there are
    // no bytes left to protect, so the game starts that slot fresh as before.
    // Unreadable bytes (corrupt / newer / malformed) are still refused.
    if (!check.ok && !(viaAutostart && check.health.status === 'missing')) {
      setEntryProblem({ slotName: current.name, message: check.message });
      return;
    }
    const notice = outcome.kind === 'applied' ? { text: `${outcome.message} (${(outcome.ms / 1000).toFixed(1)} с)`, tone: 'success' as const }
      : outcome.kind === 'local' && outcome.message ? { text: outcome.message, tone: outcome.tone } : undefined;
    setLaunched(!viaAutostart);
    setSession(enter(current, notice));
  };
  const tryEnter = (slot: SaveSlotMeta, viaAutostart = false) => {
    if (entering.current) return;
    entering.current = true;
    void prepareCloudEntry(slot, { onStage: setCloudStage }).then((outcome) => {
      entering.current = false;
      setCloudStage(null);
      setAutostartPending(false);
      if (outcome.kind === 'ask') setConflict({ slot, conflict: outcome.conflict, launched: !viaAutostart });
      else open(slot, outcome, viaAutostart);
    });
  };
  const resolve = (choice: 'server' | 'local') => {
    if (!conflict) return;
    const { slot, launched: fromMenu } = conflict;
    setConflict(null);
    void resolveCloudConflict(slot, choice, setCloudStage).then((outcome) => {
      setCloudStage(null);
      if (outcome.kind === 'ask') setConflict({ slot, conflict: outcome.conflict, launched: fromMenu });
      else open(slot, outcome, !fromMenu);
    });
  };
  useEffect(() => {
    if (autostart?.slot) tryEnter(autostart.slot, true);
    // Once, on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (session) return <GameShell session={session} launched={launched} />;
  // Autostart opens the game directly: no menu flash while the cloud is asked.
  if (autostartPending) return <div className="menu-viewport" data-qa-cloud-entry={cloudStage ? 'busy' : 'starting'} />;
  return (
    <MenuApp
      initialScreen={initialScreen}
      onEnterSlot={(slot) => tryEnter(slot)}
      entryProblem={entryProblem}
      onDismissEntryProblem={() => setEntryProblem(null)}
      cloudStage={cloudStage}
      cloudConflict={conflict ? { slotName: conflict.slot.name, conflict: conflict.conflict } : null}
      onResolveCloudConflict={resolve}
      onCancelCloudConflict={() => setConflict(null)}
    />
  );
}
