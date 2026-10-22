import { useState } from 'react';
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
import { ACTIVE_RUNTIME_MODE } from '../../domain/runtime/mode.ts';
import { LEGACY_PRODUCTION_SAVE_KEY, selectContinueSlot, type SaveSlotMeta } from '../../domain/session/slots.ts';
import { createInitialSaveState } from '../../application/persistence.ts';
import { checkSlotEntry, readSlotIndex } from '../../application/slots.ts';
import { MenuApp, type SlotEntryProblem } from './MenuApp.tsx';
import { TestSaveGuard } from './SaveProblemScreen.tsx';
import { applySlotRuntime, consumeNextScreen, wantsAutostart, type ActiveSession } from './session.ts';

/** The running campaign: the game screen and its global controllers. */
function GameShell({ session }: { session: ActiveSession | null }) {
  return (
    <NavigationProvider>
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

function enter(slot: SaveSlotMeta): ActiveSession {
  applySlotRuntime(slot);
  return { slotId: slot.id, slotName: slot.name, factionId: slot.factionId };
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

function ProductionRoot() {
  const [initialScreen] = useState(() => consumeNextScreen() ?? 'main');
  const [start] = useState<{ session: ActiveSession | null; problem: SlotEntryProblem | null }>(() => {
    if (!wantsAutostart()) return { session: null, problem: null };
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
    if (!slot) return { session: null, problem: null };
    const check = checkSlotEntry(slot);
    return check.ok
      ? { session: enter(slot), problem: null }
      : { session: null, problem: { slotName: slot.name, message: check.message } };
  });
  const [session, setSession] = useState<ActiveSession | null>(start.session);
  const [entryProblem, setEntryProblem] = useState<SlotEntryProblem | null>(start.problem);
  // Continue, Load and a freshly created slot all pass the same health gate.
  const tryEnter = (slot: SaveSlotMeta) => {
    const check = checkSlotEntry(slot);
    if (!check.ok) {
      setEntryProblem({ slotName: slot.name, message: check.message });
      return;
    }
    setSession(enter(slot));
  };
  if (session) return <GameShell session={session} />;
  return (
    <MenuApp
      initialScreen={initialScreen}
      onEnterSlot={tryEnter}
      entryProblem={entryProblem}
      onDismissEntryProblem={() => setEntryProblem(null)}
    />
  );
}
