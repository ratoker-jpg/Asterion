import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RatingView } from './RatingView';
import { ScienceView } from './ScienceView';
import { SettingsView } from './SettingsView';
import type { AllianceIdentity } from './domain/rating/types.ts';
import {
  applyTypographyPreferences,
  persistPreferences,
  readPreferences,
  resetPreferences,
} from './domain/settings/preferences.ts';
import { getDesktopBridge, getWindowPresetDimensions } from './domain/settings/desktop.ts';
import { WINDOW_PRESETS, type DesktopDisplayState, type UiPreferencesV2 } from './domain/settings/types.ts';

type UtilityScreen = 'Настройки' | 'Рейтинг' | 'Наука';

function isUtilityScreen(value: string | undefined): value is UtilityScreen {
  return value === 'Настройки' || value === 'Рейтинг' || value === 'Наука';
}

function readCurrentAlliance(): AllianceIdentity | null {
  try {
    const raw = localStorage.getItem('asterion.vertical-slice.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { command?: { alliance?: { name?: unknown; tag?: unknown } } };
    const name = parsed.command?.alliance?.name;
    const tag = parsed.command?.alliance?.tag;
    if (typeof name !== 'string' || typeof tag !== 'string' || !name.trim() || !tag.trim()) return null;
    return { name: name.trim(), tag: tag.trim() };
  } catch {
    return null;
  }
}

function presetForDisplayState(state: DesktopDisplayState, fallback: UiPreferencesV2['display']['preset']) {
  if (state.mode !== 'windowed') return fallback;
  return WINDOW_PRESETS.find((preset) => {
    const [width, height] = getWindowPresetDimensions(preset);
    return width === state.width && height === state.height;
  }) ?? fallback;
}

export function UtilityScreensPortal() {
  const [target, setTarget] = useState<Element | null>(null);
  const [active, setActive] = useState<UtilityScreen | null>(null);
  const [preferences, setPreferences] = useState<UiPreferencesV2>(() => readPreferences());
  const [currentAlliance, setCurrentAlliance] = useState<AllianceIdentity | null>(() => readCurrentAlliance());
  const allianceSignature = useRef(JSON.stringify(currentAlliance));
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
    const sync = () => {
      const label = document.querySelector('.utility-navigation button.active span')?.textContent?.trim();
      setActive(isUtilityScreen(label) ? label : null);
      setTarget(document.querySelector('.workspace'));
      const alliance = readCurrentAlliance();
      const signature = JSON.stringify(alliance);
      if (signature !== allianceSignature.current) {
        allianceSignature.current = signature;
        setCurrentAlliance(alliance);
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
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

  if (!active || !target) return null;

  return createPortal(
    <div className="utility-screen-host" data-utility-screen={active}>
      {active === 'Настройки' ? (
        <SettingsView preferences={preferences} onPreferencesChange={updatePreferences} onReset={resetUiPreferences} />
      ) : active === 'Рейтинг' ? (
        <RatingView currentAlliance={currentAlliance} />
      ) : (
        <ScienceView />
      )}
    </div>,
    target,
  );
}
