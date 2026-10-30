import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/app';
import { uiMode } from './ui/mobile/mobileUi';
import './index.css';

// Published before the first paint so the CSS control metrics match the shell about to render.
document.documentElement.dataset.uiMode = uiMode();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
