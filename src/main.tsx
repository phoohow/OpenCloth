import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/ui/app';
import { uiMode } from '@/ui/mobile/mobileUi';
import { installPublicApi } from '@/api/openclothApi';
import './index.css';

// Published before the first paint so the CSS control metrics match the shell about to render.
document.documentElement.dataset.uiMode = uiMode();

// Automation facade for PLM scripts; replaces any previous API object.
installPublicApi();

// Production builds register the offline shell worker; dev keeps requests uncached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
