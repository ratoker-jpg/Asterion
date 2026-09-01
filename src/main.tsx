import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './universe-nav.css';
import './universe-polish-v2.css';
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

    // Desktop browser previews are usually very close to 16:9. In that case
    // use cover-fit to remove black bars. For unusual window shapes fall back
    // to contain-fit so important UI is not heavily cropped.
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
