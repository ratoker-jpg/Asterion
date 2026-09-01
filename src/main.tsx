import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './universe-nav.css';
import './universe-polish-v2.css';
import './planet-visual-v2.css';
import './shell-v3.css';
import './shell-v4.css';
import './single-planet-v5.css';
import './web-preview.css';

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
  </StrictMode>,
);
