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
import { getDesktopBridge } from './domain/settings/desktop.ts';
import type { UiPreferencesV2 } from './domain/settings/types.ts';

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

export function UtilityScreensPortal() {
  const [target, setTarget] = useState<Element | null>(null);
  const [active, setActive] = useState<UtilityScreen | null>(null);
  const [preferences, setPreferences] = useState<UiPreferencesV2>(() => readPreferences());
  const [currentAlliance, setCurrentAlliance] = useState<AllianceIdentity | null>(() => readCurrentAlliance());
  const allianceSignature = useRef(JSON.stringify(currentAlliance));

  useEffect(() => {
    applyTypographyPreferences(preferences);
  }, [preferences]);

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
    setPreferences(next);
    persistPreferences(next);
    applyTypographyPreferences(next);
  };

  const resetUiPreferences = () => {
    const defaults = resetPreferences();
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
