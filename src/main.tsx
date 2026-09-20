import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FleetWorkspacePortal } from './FleetWorkspacePortal';
import { GlobalPageScrollController } from './GlobalPageScrollController';
import { GlobalTypographyController } from './GlobalTypographyController';
import { PrototypeResetController } from './PrototypeResetController';
import { RepairWorkshopPortal } from './RepairWorkshopPortal';
import { ShipInfoController } from './ShipInfoController';
import { DefenseInfoController } from './DefenseInfoController';
import { UtilityScreensPortal } from './UtilityScreensPortal';
import { NavigationProvider } from './ui/navigation.tsx';
import './styles.css';
import './universe-nav.css';
import './universe-polish-v2.css';
import './planet-visual-v2.css';
import './shell-v3.css';
import './shell-v4.css';
import './single-planet-v5.css';
import './ui/header/header.tokens.css';
import './ui/header/header.theme.css';
import './asterion-header.css';
import './ui/header/header.test-mode.css';
import './resource-zone.css';
import './web-preview.css';
import './shipyard-workspace.css';
import './shipyard-tooltip-overflow.css';
import './fleet-root-active-fix.css';
import './repair-workshop-fixed-layout.css';
import './global-page-scroll.css';
import './fleet-ui-standard.css';
import './simulator-races.css';
import './typography.css';
import './settings.css';
import './rating.css';
import './science.css';
import './utility-source-rebuild-polish.css';
import './universe-interaction.css';
import './asterion-unified-theme.css';

const isElectron = navigator.userAgent.includes('Electron');

// The whole game renders on a fixed 1920x1080 stage scaled to fit the window.
// Browser-style page zoom (Ctrl+wheel / touchpad pinch) rescales that stage and
// "endlessly" magnifies the UI — block it at the input level for both Electron
// and the web preview (Electron main additionally clamps zoomFactor).
window.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  },
  { passive: false, capture: true },
);

// Keyboard page zoom (Ctrl +/-/0) rescales the fixed stage the same way —
// block it in the web preview too (Electron blocks it in the main process).
window.addEventListener(
  'keydown',
  (event) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '_', '0'].includes(event.key)) {
      event.preventDefault();
    }
  },
  { capture: true },
);

if (!isElectron) {
  document.documentElement.classList.add('web-preview');

  const updateWebStageFit = () => {
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const targetAspect = 1920 / 1080;
    const currentAspect = width / height;
    const containScale = Math.min(width / 1920, height / 1080);
    const coverScale = Math.max(width / 1920, height / 1080);
    const aspectDelta = Math.abs(currentAspect - targetAspect) / targetAspect;

    const scale = aspectDelta <= 0.08 ? coverScale : containScale;
    document.documentElement.style.setProperty('--web-stage-scale', String(scale));
  };

  updateWebStageFit();
  window.addEventListener('resize', updateWebStageFit);
  window.visualViewport?.addEventListener('resize', updateWebStageFit);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NavigationProvider>
      <App />
      <PrototypeResetController />
      <GlobalPageScrollController />
      <GlobalTypographyController />
      <FleetWorkspacePortal />
      <UtilityScreensPortal />
      <RepairWorkshopPortal />
      <ShipInfoController />
      <DefenseInfoController />
    </NavigationProvider>
  </StrictMode>,
);
