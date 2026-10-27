import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const harness = vi.hoisted(() => {
  const calls: string[] = [];
  /** Readbacks handed out in call order; resolved by the tests. */
  const pending: Array<{ resolve: (counts: { min: number; max: number; avg: number }) => void }> = [];
  /** Sizes the accumulation buffer was asked to hold. */
  const sizes: Array<[number, number]> = [];
  /** Draws the app itself made, with the target they landed on. */
  const draws: Array<'blend' | 'canvas'> = [];
  const tracers: Array<{
    frameBudget: number;
    renderDelay: number;
    minSamples: number;
    fadeDuration: number;
    synchronizeRenderSize: boolean;
  }> = [];

  class FakeWebGPUPathTracer {
    camera: unknown = null;
    maxBounces = 0;
    frameBudget = 0;
    maxSamples = 256;
    renderScale = 1;
    filterGlossyFactor = 1;
    clampDirect = 0;
    clampIndirect = 0;
    synchronizeRenderSize = true;
    dynamicLowRes = true;
    renderDelay = 500;
    minSamples = 1;
    fadeDuration = 500;

    constructor() {
      tracers.push(this);
    }

    setScene(): void { calls.push('setScene'); }
    updateCamera(): void { calls.push('updateCamera'); }
    updateMaterials(): void { calls.push('updateMaterials'); }
    updateTransforms(): void { calls.push('updateTransforms'); }
    updateLights(): void { calls.push('updateLights'); }
    updateEnvironment(): void { calls.push('updateEnvironment'); }
    setDenoiser(): void { calls.push('setDenoiser'); }
    reset(): void { calls.push('reset'); }
    renderSample(): void { calls.push('renderSample'); }
    dispose(): void { calls.push('dispose'); }

    setSize(width: number, height: number): void {
      calls.push('setSize');
      sizes.push([width, height]);
    }

    getSampleCountsAsync() {
      calls.push('getSampleCountsAsync');
      return new Promise<{ min: number; max: number; avg: number }>(resolve => {
        pending.push({ resolve });
      });
    }
  }

  return { calls, pending, sizes, draws, tracers, FakeWebGPUPathTracer };
});

vi.mock('three-gpu-pathtracer/webgpu', () => ({
  WebGPUPathTracer: harness.FakeWebGPUPathTracer,
  OIDNDenoiser: class {},
}));

const THREE = await import('three/webgpu');
const { RayTracingRenderer } = await import('../../src/render/renderer/rayTracingRenderer');
const { createDefaultRayTracing } = await import('../../src/core/model/defaults');

/** CSS drawing area the fake renderer reports, before any device pixel ratio. */
const VIEWPORT = { width: 800, height: 600 };

/** One animation frame. */
const FRAME_MS = 16;

function fakeRenderer(): WebGPURenderer {
  let target: 'blend' | 'canvas' = 'canvas';
  return {
    autoClear: true,
    getSize: (size: { set: (x: number, y: number) => unknown }) => size.set(VIEWPORT.width, VIEWPORT.height),
    getDrawingBufferSize: (size: { set: (x: number, y: number) => unknown }) => size.set(VIEWPORT.width * 2, VIEWPORT.height * 2),
    setRenderTarget: (next: unknown) => { target = next ? 'blend' : 'canvas'; },
    render: () => { harness.draws.push(target); },
  } as unknown as WebGPURenderer;
}

/** Settles the nth outstanding readback with `avg` samples per pixel. */
async function completeReadback(index: number, avg: number): Promise<void> {
  harness.pending[index].resolve({ min: avg, max: avg, avg });
  await Promise.resolve();
  await Promise.resolve();
}

function countCalls(name: string): number {
  return harness.calls.filter(call => call === name).length;
}

function buildScene() {
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setIndex([0, 1, 2]);
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const camera = new THREE.PerspectiveCamera(45, VIEWPORT.width / VIEWPORT.height, 0.1, 100);
  camera.position.set(0, 1.4, 3.2);
  return { scene, camera };
}

describe('ray tracing progressive view', () => {
  let now = 0;

  beforeEach(() => {
    harness.calls.length = 0;
    harness.pending.length = 0;
    harness.sizes.length = 0;
    harness.draws.length = 0;
    harness.tracers.length = 0;
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  it('defers to the raster frame while the view is in motion', () => {
    const { scene, camera } = buildScene();
    const tracer = new RayTracingRenderer(fakeRenderer(), createDefaultRayTracing());

    expect(tracer.render(scene, camera)).toBe(false);
    camera.position.set(0.2, 1.4, 3.2);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(false);
    camera.position.set(0.4, 1.4, 3.2);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(false);

    // Nothing is traced or uploaded until the view stops changing.
    expect(countCalls('renderSample')).toBe(0);
    expect(countCalls('setScene')).toBe(0);
    expect(tracer.sampleCount).toBe(0);
    tracer.dispose();
  });

  it('accumulates at the drawing area with a path slot for every pixel', () => {
    const { scene, camera } = buildScene();
    const config = { ...createDefaultRayTracing(), frameBudget: 50000 };
    const tracer = new RayTracingRenderer(fakeRenderer(), config);
    const options = harness.tracers[0];
    expect(options.synchronizeRenderSize).toBe(false);
    expect(options.renderDelay).toBe(0);
    expect(options.minSamples).toBe(0);
    expect(options.fadeDuration).toBe(0);

    tracer.render(scene, camera);
    now += FRAME_MS;
    tracer.render(scene, camera);
    expect(harness.sizes[0]).toEqual([VIEWPORT.width, VIEWPORT.height]);
    expect(options.frameBudget).toBe(VIEWPORT.width * VIEWPORT.height);
    tracer.dispose();
  });

  it('reports measured samples instead of drawn frames', async () => {
    const { scene, camera } = buildScene();
    const tracer = new RayTracingRenderer(fakeRenderer(), createDefaultRayTracing());

    tracer.render(scene, camera);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(true);
    expect(countCalls('renderSample')).toBe(1);
    expect(tracer.sampleCount).toBe(0);

    await completeReadback(0, 7);
    expect(tracer.sampleCount).toBe(7);

    // Unchanged views keep accumulating; the reading follows the measurement, not the frame count.
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(true);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(true);
    expect(countCalls('renderSample')).toBe(3);
    expect(tracer.sampleCount).toBe(7);
    tracer.dispose();
  });

  it('keeps path tracing through the sub-pixel drift of the orbit damping', async () => {
    const { scene, camera } = buildScene();
    const tracer = new RayTracingRenderer(fakeRenderer(), createDefaultRayTracing());

    tracer.render(scene, camera);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(true);
    await completeReadback(0, 55);

    // Drift under a pixel per frame neither hands the view back to raster nor restarts the pass.
    for (let i = 0; i < 3; i++) {
      camera.position.x += 5e-4;
      now += FRAME_MS;
      expect(tracer.render(scene, camera)).toBe(true);
    }
    expect(countCalls('updateCamera')).toBe(0);
    expect(tracer.sampleCount).toBe(55);
    tracer.dispose();
  });

  it('restarts the count on a camera change and discards the previous pass', async () => {
    const { scene, camera } = buildScene();
    const tracer = new RayTracingRenderer(fakeRenderer(), createDefaultRayTracing());

    tracer.render(scene, camera);
    now += FRAME_MS;
    tracer.render(scene, camera);
    await completeReadback(0, 55);
    expect(tracer.sampleCount).toBe(55);

    camera.position.set(2.4, 1.4, 1.2);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(false);
    expect(tracer.sampleCount).toBe(0);

    now += FRAME_MS;
    tracer.render(scene, camera);
    expect(harness.calls).toContain('updateCamera');
    const abandoned = harness.pending.length - 1;

    // The view moves again before the restarted pass can answer.
    camera.position.set(2.8, 1.4, 1.0);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(false);

    // A readback of an abandoned pass must not answer for the image now on screen.
    await completeReadback(abandoned, 90);
    expect(tracer.sampleCount).toBe(0);

    now += FRAME_MS;
    tracer.render(scene, camera);
    await completeReadback(harness.pending.length - 1, 1);
    expect(tracer.sampleCount).toBe(1);
    tracer.dispose();
  });

  it('lays the raster view under a young pass and drops it once blended', async () => {
    const { scene, camera } = buildScene();
    const tracer = new RayTracingRenderer(fakeRenderer(), createDefaultRayTracing());

    tracer.render(scene, camera);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(true);
    // The pass has no measured samples yet, so the raster frame is what the user sees.
    expect(harness.draws).toEqual(['blend', 'canvas']);

    harness.draws.length = 0;
    await completeReadback(0, 32);
    now += FRAME_MS;
    expect(tracer.render(scene, camera)).toBe(true);
    expect(harness.draws).toEqual([]);
    tracer.dispose();
  });

  it('caps the reported count at the convergence limit', async () => {
    const { scene, camera } = buildScene();
    const config = { ...createDefaultRayTracing(), maxSamples: 64 };
    const tracer = new RayTracingRenderer(fakeRenderer(), config);

    tracer.render(scene, camera);
    now += FRAME_MS;
    tracer.render(scene, camera);
    await completeReadback(0, 120);
    expect(tracer.sampleCount).toBe(64);
    tracer.dispose();
  });
});
