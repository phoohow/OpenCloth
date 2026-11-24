import type { AvatarParams } from '@/model/types';

import './index.css';
import { installPublicApi } from '@/api/openclothApi';
import { thumbnailMeshes, settleTemplate } from '@/app';
import { makehumanBody } from '@/avatar';
import { loadMakehumanBody } from '@/avatar/makehuman/data';
import { createBackend, type Backend } from '@/render/backend';
import { detectWebGPU } from '@/render/common';
import { createPreviewer, createRenderer, type Previewer } from '@/render/renderer';
import { createRenderWorld } from '@/render/world';
import { createViewport } from '@/runtime';
import { makehumanAvatarMeshes } from '@/runtime/engine/makehumanAvatar';
import { getTemplates, hydrateTemplates } from '@/store';
import { App } from '@/ui/app';
import { registerAssetPreviews } from '@/ui/assets/assetPreviews';
import { uiMode } from '@/ui/mobile/mobileUi';
import { RenderHostContext, type RenderHostFactory } from '@/ui/viewport3D/renderHost';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

let previews: Promise<PreviewSession | null> | null = null;

interface PreviewSession {
  readonly pipeline: Previewer;
  readonly backend: Backend;
}

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

function previewSession(): Promise<PreviewSession | null> {
  previews ??= createBackend(document.createElement('canvas'))
    .then(backend => ({ backend, pipeline: createPreviewer({ backend }) }))
    .catch(() => null);
  return previews;
}

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

document.documentElement.dataset.uiMode = uiMode();

registerAssetPreviews({
  model: async url => (await previewSession())?.pipeline.model(url) ?? null,
  body: async key => {
    const params = JSON.parse(key) as AvatarParams;
    const session = await previewSession();
    return session?.pipeline.body(makehumanAvatarMeshes(makehumanBody(params))) ?? null;
  },
  environment: async url => (await previewSession())?.pipeline.environment(url) ?? null,
  pattern: async key => {
    const template = getTemplates().find(item => item.key === key);
    const session = await previewSession();
    if (!template || !session) return null;
    const settled = await settleTemplate(template, session.backend.device.device());
    return settled ? session.pipeline.garment(thumbnailMeshes(settled)) : null;
  },
});

window.addEventListener('pagehide', () => {
  void previews?.then(session => {
    if (!session) return;
    session.pipeline.dispose();
    session.backend.dispose();
  });
});

installPublicApi();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

void start();
