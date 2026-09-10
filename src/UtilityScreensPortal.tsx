import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RatingView } from './RatingView';
import { ScienceView } from './ScienceView';
import { SettingsView } from './SettingsView';
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

export function UtilityScreensPortal() {
  const { route } = useNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [preferences, setPreferences] = useState<UiPreferencesV2>(() => readPreferences());
  const [runtimeState, setRuntimeState] = useState<RuntimeStateSnapshot | null>(() => getRuntimeStateSnapshot());
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    preferencesRef.current = preferences;
    applyTypographyPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const syncRuntimeState = () => setRuntimeState(getRuntimeStateSnapshot());
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

  return createPortal(
    <div className="utility-screen-host" data-utility-screen={APP_ROUTE_LABELS[active]} data-qa-utility-screen={active}>
      {active === 'settings' ? (
        <SettingsView preferences={preferences} onPreferencesChange={updatePreferences} onReset={resetUiPreferences} />
      ) : active === 'rating' ? (
        runtimeState ? <RatingView command={runtimeState.command} currentPlayerResourcePoints={runtimeState.rating.resourcePoints} /> : null
      ) : (
        <ScienceView />
      )}
    </div>,
    target,
  );
}
