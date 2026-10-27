import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const harness = vi.hoisted(() => {
  const created: Array<{ isDisposed: boolean }> = [];
  /** Set while a test holds tracer creation inside `setConfig`. */
  const gate: { block: boolean; release: (() => void) | null } = { block: false, release: null };

  class FakeRayTracingRenderer {
    private released = false;

    get isDisposed(): boolean {
      return this.released;
    }

    constructor() {
      created.push(this);
    }

    async setConfig(): Promise<void> {
      if (!gate.block) return;
      await new Promise<void>(resolve => { gate.release = resolve; });
    }

    dispose(): void {
      this.released = true;
    }
  }

  return { created, gate, FakeRayTracingRenderer };
});

vi.mock('../../src/render/renderer/rayTracingRenderer', () => ({
  RayTracingRenderer: harness.FakeRayTracingRenderer,
}));

const { createDefaultRayTracing } = await import('../../src/core/model/defaults');
const { setRendererMode, disposeRendererContext } = await import('../../src/render/renderer/rendererContext');
type RendererContext = import('../../src/render/renderer/rendererContext').RendererContext;

/** The fields lazy tracer creation reads; nothing here needs a GPU backend. */
function stubCtx(): RendererContext {
  return {
    renderer: { dispose: () => { } } as unknown as WebGPURenderer,
    scene: null,
    controls: { dispose: () => { } },
    renderMode: 'shaded',
    rayConfig: createDefaultRayTracing(),
    rayTracer: null,
    rayTracerLoading: null,
    disposed: false,
  } as unknown as RendererContext;
}

/** Yields to the queue until the creation attempt is waiting inside `setConfig`. */
async function waitUntilCreationBlocked(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) {
    if (harness.gate.release !== null) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('tracer creation never reached setConfig');
}

/** Releases the tracer waiting inside `setConfig`. */
function finishCreation(): void {
  harness.gate.release?.();
  harness.gate.release = null;
}

describe('setRendererMode', () => {
  beforeEach(() => {
    harness.created.length = 0;
    harness.gate.block = false;
    harness.gate.release = null;
  });

  it('installs the lazily created tracer and drops the consumed promise', async () => {
    const ctx = stubCtx();
    await setRendererMode(ctx, 'raytraced');

    expect(harness.created).toHaveLength(1);
    expect(ctx.rayTracer).toBe(harness.created[0]);
    expect(ctx.rayTracerLoading).toBeNull();
    expect(ctx.rayTracer?.isDisposed).toBe(false);
  });

  it('reuses the installed tracer instead of building a second one', async () => {
    const ctx = stubCtx();
    await setRendererMode(ctx, 'raytraced');
    await setRendererMode(ctx, 'raytraced');

    expect(harness.created).toHaveLength(1);
    expect(ctx.rayTracer).toBe(harness.created[0]);
  });

  it('discards a tracer whose creation was dropped mid-flight', async () => {
    harness.gate.block = true;
    const ctx = stubCtx();
    const first = setRendererMode(ctx, 'raytraced');
    await waitUntilCreationBlocked();
    const orphan = harness.created[0];

    // Recovery clears both refs before the creation answers, the way a failed pass does.
    recoverAfterFailure(ctx);
    finishCreation();
    await first;

    expect(ctx.rayTracer).toBeNull();
    expect(orphan.isDisposed).toBe(true);

    // Switching back builds a fresh tracer rather than reinstalling the disposed one.
    harness.gate.block = false;
    await setRendererMode(ctx, 'raytraced');
    expect(harness.created).toHaveLength(2);
    expect(ctx.rayTracer).toBe(harness.created[1]);
    expect(ctx.rayTracer?.isDisposed).toBe(false);
  });

  it('leaves the installed tracer alone when two callers share one creation', async () => {
    const ctx = stubCtx();
    await Promise.all([
      setRendererMode(ctx, 'raytraced'),
      setRendererMode(ctx, 'raytraced'),
    ]);

    expect(harness.created).toHaveLength(1);
    expect(ctx.rayTracer).toBe(harness.created[0]);
    expect(ctx.rayTracer?.isDisposed).toBe(false);
  });

  it('disposes a tracer finished after the context was released', async () => {
    harness.gate.block = true;
    const ctx = stubCtx();
    const pending = setRendererMode(ctx, 'raytraced');
    await waitUntilCreationBlocked();
    disposeRendererContext(ctx);
    finishCreation();
    await pending;

    expect(harness.created).toHaveLength(1);
    expect(harness.created[0].isDisposed).toBe(true);
    expect(ctx.rayTracer).toBeNull();
  });
});

/** Mirrors `Viewport3D`'s fall back to rasterization after a failed ray-traced pass. */
function recoverAfterFailure(ctx: RendererContext): void {
  ctx.rayTracer?.dispose();
  ctx.rayTracer = null;
  ctx.rayTracerLoading = null;
  ctx.renderMode = 'shaded';
}
