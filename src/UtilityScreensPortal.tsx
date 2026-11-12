import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RatingView } from './RatingView';
import { ScienceView } from './ScienceView';
import { SettingsView } from './SettingsView';
import type { BuildingFaction } from './domain/buildings/balance-v1.ts';
import { getRuntimeStateSnapshot, subscribeRuntimeStateSnapshot, type RuntimeStateSnapshot } from './domain/runtime/state-store.ts';
import {
  applyTypographyPreferences,
  persistPreferences,
  readPreferences,
  resetPreferences,
} from './domain/settings/preferences.ts';
import { getDesktopBridge, getWindowPresetDimensions } from './domain/settings/desktop.ts';
import { WINDOW_PRESETS, type DesktopDisplayState, type UiPreferencesV2 } from './domain/settings/types.ts';
import { APP_ROUTE_LABELS, isUtilityRoute, useNavigation } from './ui/navigation.tsx';

function presetForDisplayState(state: DesktopDisplayState, fallback: UiPreferencesV2['display']['preset']) {
  if (state.mode !== 'windowed') return fallback;
  return WINDOW_PRESETS.find((preset) => {
    const [width, height] = getWindowPresetDimensions(preset);
    return width === state.width && height === state.height;
  }) ?? fallback;
}

/**
 * Test Mode QA only: a stored rating fixture (long names, 100 players, an
 * oversized alliance...) replaces the world's standings so Electron QA can shoot
 * worst cases inside the real shell. Production never reads it.
 */
const RATING_QA_FIXTURE_KEY = 'asterion.qa.rating-fixture.v1';
type RatingQaFixture = Pick<RuntimeStateSnapshot, 'ownerScores' | 'owners' | 'currentPlayerId'> & {
  alliances: RuntimeStateSnapshot['command']['alliances'];
  allianceDetails: NonNullable<RuntimeStateSnapshot['alliances']>;
};
function readRatingQaFixture(state: RuntimeStateSnapshot): RatingQaFixture | null {
  if (state.mode !== 'test') return null;
  try {
    const raw = window.localStorage.getItem(RATING_QA_FIXTURE_KEY);
    return raw ? JSON.parse(raw) as RatingQaFixture : null;
  } catch {
    return null;
  }
}

function playerFaction(state: RuntimeStateSnapshot | null): BuildingFaction {
  const factionId = state?.owners[state.currentPlayerId]?.factionId;
  return factionId === 'synod' || factionId === 'veyra' ? factionId : 'aegis';
}

export function UtilityScreensPortal() {
  const { route } = useNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [preferences, setPreferences] = useState<UiPreferencesV2>(() => readPreferences());
  const [runtimeState, setRuntimeState] = useState<RuntimeStateSnapshot | null>(() => getRuntimeStateSnapshot());
  const preferencesRef = useRef(preferences);
  // A closed portal keeps the newest snapshot in a ref and renders nothing: a world publish every second
  // must not cost it a React commit. The snapshot is taken when a utility screen opens.
  const latestRuntimeState = useRef(runtimeState);
  const activeRef = useRef(false);
  activeRef.current = isUtilityRoute(route);

  useEffect(() => {
    preferencesRef.current = preferences;
    applyTypographyPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const syncRuntimeState = () => {
      latestRuntimeState.current = getRuntimeStateSnapshot();
      if (activeRef.current) setRuntimeState(latestRuntimeState.current);
    };
    syncRuntimeState();
    return subscribeRuntimeStateSnapshot(syncRuntimeState);
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return undefined;

    let active = true;
    const syncDisplayState = (state: DesktopDisplayState) => {
      if (!active) return;
      const current = preferencesRef.current;
      const display = {
        mode: state.mode,
        preset: presetForDisplayState(state, current.display.preset),
      } satisfies UiPreferencesV2['display'];
      if (display.mode === current.display.mode && display.preset === current.display.preset) return;

      const next = { ...current, display };
      preferencesRef.current = next;
      setPreferences(next);
      persistPreferences(next);
    };

    void bridge.getDisplayState().then(syncDisplayState).catch(() => undefined);
    const unsubscribe = bridge.onDisplayState?.(syncDisplayState);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    setTarget(document.querySelector('.workspace'));
  }, []);

  const updatePreferences = (next: UiPreferencesV2) => {
    preferencesRef.current = next;
    setPreferences(next);
    persistPreferences(next);
    applyTypographyPreferences(next);
  };

  const resetUiPreferences = () => {
    const defaults = resetPreferences();
    preferencesRef.current = defaults;
    setPreferences(defaults);
    applyTypographyPreferences(defaults);
    void getDesktopBridge()?.setDisplay(defaults.display).catch(() => undefined);
  };

  const active = isUtilityRoute(route) ? route : null;
  if (!active || !target) return null;
  const liveRuntimeState = latestRuntimeState.current ?? runtimeState;
  const ratingFixture = active === 'rating' && liveRuntimeState ? readRatingQaFixture(liveRuntimeState) : null;

  return createPortal(
    <div className="utility-screen-host" data-utility-screen={APP_ROUTE_LABELS[active]} data-qa-utility-screen={active}>
      {active === 'settings' ? (
        <SettingsView preferences={preferences} onPreferencesChange={updatePreferences} onReset={resetUiPreferences} />
      ) : active === 'rating' ? (
        liveRuntimeState ? (ratingFixture ? (
          <RatingView
            mode="production"
            command={{ ...liveRuntimeState.command, alliances: ratingFixture.alliances }}
            ownerScores={ratingFixture.ownerScores}
            currentPlayerScore={ratingFixture.ownerScores[ratingFixture.currentPlayerId]}
            currentPlayerId={ratingFixture.currentPlayerId}
            owners={ratingFixture.owners}
            allianceDetails={ratingFixture.allianceDetails}
          />
        ) : (
          <RatingView
            mode={liveRuntimeState.mode}
            command={liveRuntimeState.command}
            ownerScores={liveRuntimeState.ownerScores}
            currentPlayerScore={liveRuntimeState.ownerScores[liveRuntimeState.currentPlayerId]}
            currentPlayerId={liveRuntimeState.currentPlayerId}
            owners={liveRuntimeState.owners}
            allianceDetails={liveRuntimeState.alliances}
          />
        )) : null
      ) : (
        <ScienceView factionId={playerFaction(liveRuntimeState)} />
      )}
    </div>,
    target,
  );
}
