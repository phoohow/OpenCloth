import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/ui/app';
import { uiMode } from '@/ui/mobile/mobileUi';
import { installPublicApi } from '@/api/openclothApi';
import { detectWebGPU } from '@/render/common';
import { createBackend, type Backend } from '@/render/backend';
import { createPreviewer, createRenderer, type Previewer } from '@/render/renderer';
import { createRenderWorld } from '@/render/world';
import { createViewport } from '@/runtime';
import { RenderHostContext, type RenderHostFactory } from '@/ui/viewport3D/renderHost';
import { registerAssetPreviews } from '@/ui/assets/assetPreviews';
import { getTemplates, hydrateTemplates } from '@/store';
import { thumbnailMeshes, settleTemplate } from '@/runtime/templateThumbnail';
import { loadMakehumanBody } from '@/avatar/makehuman/data';
import { makehumanBody } from '@/avatar';
import { makehumanAvatarMeshes } from '@/runtime/makehumanAvatar';
import type { AvatarParams } from '@/model/types';
import './index.css';

// Published before the first paint so the CSS control metrics match the shell about to render.
document.documentElement.dataset.uiMode = uiMode();

// Catalogue previews run on their own backend and their own pipeline, built on first request.
interface PreviewSession {
  readonly pipeline: Previewer;
  readonly backend: Backend;
}

let previews: Promise<PreviewSession | null> | null = null;
function previewSession(): Promise<PreviewSession | null> {
  previews ??= createBackend(document.createElement('canvas'))
    .then(backend => ({ backend, pipeline: createPreviewer({ backend }) }))
    .catch(() => null);
  return previews;
}

registerAssetPreviews({
  model: async url => (await previewSession())?.pipeline.model(url) ?? null,
  // The model tab hands over a body's measurements as JSON; the body is built from them here.
  body: async key => {
    const params = JSON.parse(key) as AvatarParams;
    const session = await previewSession();
    return session?.pipeline.body(makehumanAvatarMeshes(makehumanBody(params))) ?? null;
  },
  environment: async url => (await previewSession())?.pipeline.environment(url) ?? null,
  // A template's icon is the garment itself: simulated to rest, then drawn without the body.
  pattern: async key => {
    const template = getTemplates().find(item => item.key === key);
    const session = await previewSession();
    if (!template || !session) return null;
    const settled = await settleTemplate(template, session.backend.device.device());
    return settled ? session.pipeline.garment(thumbnailMeshes(settled)) : null;
  },
});

// The preview device lasts as long as the document; the entry holds it and releases it last.
window.addEventListener('pagehide', () => {
  void previews?.then(session => {
    if (!session) return;
    session.pipeline.dispose();
    session.backend.dispose();
  });
});

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

/**
 * Loads the MakeHuman body mesh before the first render: every body measurement reads it
 * synchronously, from the 2D body guide to the cloth drape.
 */
async function start(): Promise<void> {
  const root = createRoot(document.getElementById('root')!);
  void hydrateTemplates();
  try {
    await loadMakehumanBody();
  } catch (err) {
    console.error('MakeHuman body data failed to load:', err);
    root.render(<p style={{ padding: 24, font: '14px system-ui' }}>模特数据加载失败，请刷新页面重试。</p>);
    return;
  }
  root.render(
    <StrictMode>
      <RenderHostContext.Provider value={createRenderSession}>
        <App />
      </RenderHostContext.Provider>
    </StrictMode>,
  );
}

void start();
