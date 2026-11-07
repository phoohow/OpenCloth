import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { ViewConfig } from '@/model/types';
import { createDefaultRayTracing } from '@/model';
import { SceneMgr } from '@/render/scene/manager';
import type { SceneCamera } from '@/render/scene/camera';
import type { TraceBackend } from '@/render/trace/backend';
import type { ViewMode } from '@/render/modes/viewMode';
import type { ViewModeSpec } from '@/render/modes/spec';
import { resolveViewMode } from '@/render/modes/spec';
import { FrameMgr, type FrameDeps } from '@/render/frame/manager';

/** Raster settings with an overlay-free physical fill. */
function config(patch: Partial<ViewConfig> = {}): ViewConfig {
  return {
    fill: 'physical',
    wire: 'off',
    backend: 'raster',
    wireOptions: { color: 0x66ccff, depth: 'tested' },
    toneMapping: 'aces',
    rayTracing: createDefaultRayTracing(),
    ...patch,
  };
}

/** Renderer stub that records nothing but accepts every submit. */
function renderer(): THREE.WebGPURenderer {
  return {
    autoClear: true,
    toneMappingExposure: 1,
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(640, 480),
    getSize: (size: THREE.Vector2) => size.set(640, 480),
    setRenderTarget: () => { },
    render: () => { },
    copyTextureToTexture: () => { },
  } as unknown as THREE.WebGPURenderer;
}

/** View mode stub that resolves the given config and leaves the scene alone. */
function viewMode(spec: ViewModeSpec): ViewMode {
  return {
    current: spec,
    sync: () => { },
    applyFillOverride: () => () => { },
  } as unknown as ViewMode;
}

/** Camera stub with only the object FrameMgr updates. */
function camera(): SceneCamera {
  return { camera: new THREE.PerspectiveCamera() } as unknown as SceneCamera;
}

/** Trace backend stub with the given active tracer; null leaves it unbuilt. */
function trace(active: unknown = null): TraceBackend {
  return { active } as unknown as TraceBackend;
}

/** One frame manager wired to the stubs. */
function frame(configValue: ViewConfig, active: unknown = null): FrameMgr {
  const spec = resolveViewMode(configValue);
  const deps: FrameDeps = {
    renderer: renderer(),
    sceneMgr: new SceneMgr(),
    camera: camera(),
    viewMode: viewMode(spec),
    trace: trace(active),
  };
  return new FrameMgr(deps);
}

/** One traced frame that reached the target. */
const drawnTrace = {
  renderScale: 0.5,
  render: () => ({ drawn: true, defer: null, samples: 1, weight: 1, accumulating: true }),
};

/** One traced frame the gate kept on the raster base. */
const deferredTrace = {
  renderScale: 0.5,
  render: () => ({ drawn: false, defer: 'moving' as const, samples: 0, weight: 0, accumulating: true }),
};

describe('FrameMgr', () => {
  it('runs the raster passes in order and skips the trace passes', () => {
    const stats = frame(config()).draw();

    expect(stats.passes).toEqual(['scene', 'composite', 'post', 'overlay', 'present']);
    expect(stats.defer).toBeNull();
  });

  it('runs the trace pass before the compositor', () => {
    const stats = frame(config({
      backend: 'pathtrace',
      rayTracing: { ...createDefaultRayTracing(), denoise: false },
    }), deferredTrace).draw();

    expect(stats.passes).toEqual(['scene', 'trace', 'composite', 'post', 'overlay', 'present']);
    expect(stats.defer).toBe('moving');
  });

  it('runs denoising only after traced samples were drawn', () => {
    const stats = frame(config({ backend: 'pathtrace' }), drawnTrace).draw();

    expect(stats.passes).toContain('denoise');
    expect(stats.passes.indexOf('denoise')).toBeGreaterThan(stats.passes.indexOf('trace'));
    expect(stats.passes.indexOf('denoise')).toBeLessThan(stats.passes.indexOf('composite'));
  });

  it('keeps the pass order stable across frames', () => {
    const manager = frame(config());
    const first = manager.draw();
    const second = manager.draw();

    expect(second.passes).toEqual(first.passes);
  });
});
