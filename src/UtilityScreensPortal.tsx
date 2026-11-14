import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RatingView } from './RatingView';
import { ScienceView } from './ScienceView';
import { SettingsView } from './SettingsView';
import type { BuildingFaction } from './domain/buildings/balance-v1.ts';
import { getRuntimeStateSnapshot, type RuntimeStateSnapshot } from './domain/runtime/state-store.ts';
import {
  applyTypographyPreferences,
  persistPreferences,
  readPreferences,
  resetPreferences,
} from './domain/settings/preferences.ts';
import { getDesktopBridge, getWindowPresetDimensions } from './domain/settings/desktop.ts';
import { WINDOW_PRESETS, type DesktopDisplayState, type UiPreferencesV2 } from './domain/settings/types.ts';
import { useClockNow } from './application/shared-clock';
import { propValuesEqual } from './ui/prop-equal.ts';
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

function snapshotsEqual(a: RuntimeStateSnapshot, b: RuntimeStateSnapshot): boolean {
  return a.mode === b.mode
    && a.currentPlayerId === b.currentPlayerId
    && a.command === b.command
    && propValuesEqual(a.ownerScores, b.ownerScores)
    && propValuesEqual(a.owners, b.owners)
    && propValuesEqual(a.alliances, b.alliances);
}

function playerFaction(state: RuntimeStateSnapshot | null): BuildingFaction {
  const factionId = state?.owners[state.currentPlayerId]?.factionId;
  return factionId === 'synod' || factionId === 'veyra' ? factionId : 'aegis';
}

/**
 * The standings screen reads the world's snapshot while it renders and is woken by the shared clock: that wake-up
 * joins the commit of the world tick, so the screen costs no commit of its own (a setState from a snapshot listener
 * used to add a second one every second). The snapshot App publishes after a commit is one tick behind, which is
 * invisible for standings. An unchanged snapshot keeps the same object, so the screen's memos hold.
 */
function RatingHost() {
  useClockNow();
  const kept = useRef<RuntimeStateSnapshot | null>(null);
  const next = getRuntimeStateSnapshot();
  if (next && (!kept.current || (kept.current !== next && !snapshotsEqual(kept.current, next)))) kept.current = next;
  const live = kept.current;
  if (!live) return null;
  const fixture = readRatingQaFixture(live);
  return fixture ? (
    <RatingView
      mode="production"
      command={{ ...live.command, alliances: fixture.alliances }}
      ownerScores={fixture.ownerScores}
      currentPlayerScore={fixture.ownerScores[fixture.currentPlayerId]}
      currentPlayerId={fixture.currentPlayerId}
      owners={fixture.owners}
      allianceDetails={fixture.allianceDetails}
    />
  ) : (
    <RatingView
      mode={live.mode}
      command={live.command}
      ownerScores={live.ownerScores}
      currentPlayerScore={live.ownerScores[live.currentPlayerId]}
      currentPlayerId={live.currentPlayerId}
      owners={live.owners}
      allianceDetails={live.alliances}
    />
  );
}

export function UtilityScreensPortal() {
  const { route } = useNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [preferences, setPreferences] = useState<UiPreferencesV2>(() => readPreferences());
  const preferencesRef = useRef(preferences);
  useEffect(() => {
    preferencesRef.current = preferences;
    applyTypographyPreferences(preferences);
  }, [preferences]);

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

  return createPortal(
    <div className="utility-screen-host" data-utility-screen={APP_ROUTE_LABELS[active]} data-qa-utility-screen={active}>
      {active === 'settings' ? (
        <SettingsView preferences={preferences} onPreferencesChange={updatePreferences} onReset={resetUiPreferences} />
      ) : active === 'rating' ? (
        <RatingHost />
      ) : (
        <ScienceView factionId={playerFaction(getRuntimeStateSnapshot())} />
      )}
    </div>,
    target,
  );
}
