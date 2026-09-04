import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FleetWorkspacePortal } from './FleetWorkspacePortal';
import { FleetRootNavigationController } from './FleetRootNavigationController';
import { GlobalPageScrollController } from './GlobalPageScrollController';
import { RepairWorkshopPortal } from './RepairWorkshopPortal';
import { ShipInfoController } from './ShipInfoController';
import { DefenseInfoController } from './DefenseInfoController';
import './styles.css';
import './universe-nav.css';
import './universe-polish-v2.css';
import './planet-visual-v2.css';
import './shell-v3.css';
import './shell-v4.css';
import './single-planet-v5.css';
import './asterion-header.css';
import './web-preview.css';
import './shipyard-workspace.css';
import './shipyard-tooltip-overflow.css';
import './fleet-root-active-fix.css';
import './repair-workshop-fixed-layout.css';
import './global-page-scroll.css';

const isElectron = navigator.userAgent.includes('Electron');

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
    <App />
    <FleetRootNavigationController />
    <GlobalPageScrollController />
    <FleetWorkspacePortal />
    <RepairWorkshopPortal />
    <ShipInfoController />
    <DefenseInfoController />
  </StrictMode>,
);
