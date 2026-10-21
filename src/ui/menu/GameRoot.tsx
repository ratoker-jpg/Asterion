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
import { readSlotIndex } from '../../application/slots.ts';
import { MenuApp } from './MenuApp.tsx';
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
  if (ACTIVE_RUNTIME_MODE === 'test') return <GameShell session={null} />;
  return <ProductionRoot />;
}

function ProductionRoot() {
  const [initialScreen] = useState(() => consumeNextScreen() ?? 'main');
  const [session, setSession] = useState<ActiveSession | null>(() => {
    if (!wantsAutostart()) return null;
    let slot = selectContinueSlot(readSlotIndex());
    if (!slot) {
      // Desktop shortcuts and QA scripts expect a playable world at once:
      // seed the legacy campaign (the same key and start as before the menu).
      try {
        window.localStorage.setItem(LEGACY_PRODUCTION_SAVE_KEY, JSON.stringify(createInitialSaveState('production')));
      } catch { /* the menu stays available */ }
      slot = selectContinueSlot(readSlotIndex());
    }
    return slot ? enter(slot) : null;
  });
  if (session) return <GameShell session={session} />;
  return <MenuApp initialScreen={initialScreen} onEnterSlot={(slot) => setSession(enter(slot))} />;
}
