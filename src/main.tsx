import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/ui/app';
import { uiMode } from '@/ui/mobile/mobileUi';
import { installPublicApi } from '@/api/openclothApi';
import { detectWebGPU } from '@/render/common';
import { createBackend } from '@/render/backend';
import { createRenderWorld } from '@/render/world';
import { createRenderer } from '@/render/renderer';
import { createViewport } from '@/runtime';
import { RenderHostContext, type RenderHostFactory } from '@/ui/viewport3D/renderHost';
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

/** The only assembly point: creates Backend, World, Renderer and Viewport and injects the ports. */
const createRenderSession: RenderHostFactory = async (canvas, callbacks) => {
  if (!(await detectWebGPU())) return null;
  const backend = await createBackend(canvas, {
    onDenoiseFailure: callbacks.onDenoiseFailure,
    onDeviceLost: callbacks.onDeviceLost,
  });
  const world = createRenderWorld();
  const renderer = createRenderer({ backend, onTraceFailure: callbacks.onTraceFailure });
  const viewport = createViewport({
    renderer,
    world,
    textures: backend.textures,
    assets: backend.assets,
    export: backend.export,
    device: backend.device,
    canvas,
  });
  return {
    viewport,
    dispose() {
      viewport.dispose();
      renderer.dispose();
      backend.dispose();
    },
  };
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RenderHostContext.Provider value={createRenderSession}>
      <App />
    </RenderHostContext.Provider>
  </StrictMode>,
);