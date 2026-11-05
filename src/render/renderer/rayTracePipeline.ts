import * as THREE from 'three/webgpu';
import type { RayTracingConfig, RenderMode } from '@/model/types';
import { createDefaultRayTracing } from '@/model';
import type { RayTracingRenderer } from '@/render/renderer/rayTracingRenderer';
import { rendererDevice, type ViewportSurface } from '@/render/renderer/viewportSurface';
import type { ViewCamera } from '@/render/renderer/viewCamera';

/** Stage of the ray tracing pipeline the 3D view is in. */
export type RayTraceState =
  | 'inactive'
  | 'building'
  | 'deforming'
  | 'moving'
  | 'blending'
  | 'traced'
  | 'unsupported';

/** Why the first ray-traced frames showed this device cannot path trace. */
export type RayTraceFailure = 'gpu-error' | 'setup-failed';

/** Outcome of the one-time path tracing probe. */
export interface RayTracingCapability {
  ok: boolean;
  failure: RayTraceFailure | null;
  /** Raw technical text shown beside the label. */
  detail: string;
}

/** Thrown instead of building a tracer on a device the probe rejected. */
export class RayTracingUnsupportedError extends Error {
  readonly failure: RayTraceFailure;
  readonly detail: string;

  constructor(capability: RayTracingCapability) {
    super(`WebGPU path tracing unsupported: ${capability.failure}`);
    this.failure = capability.failure ?? 'setup-failed';
    this.detail = capability.detail;
  }
}

/** Frames the first ray-traced switch draws to prove the kernels answer. */
const VERIFY_FRAMES = 2;

/** Below this CSS size the view is a hidden or one-pixel pane; its buffers are too small to judge. */
const VERIFY_MIN_SIZE = 16;

/**
 * Milliseconds the GPU queue may take to drain. Sized for a slow mobile GPU finishing the first
 * full-pane sample rounds: exceeding it means the switch gives up, so it must not be a normal wait.
 */
const VERIFY_TIMEOUT_MS = 30000;

/** Characters of technical detail kept for the readout. */
const PROBE_DETAIL_LIMIT = 180;

/** The lazy tracer, its one-time capability probe and the frame it draws. */
export class RayTracePipeline {
  mode: RenderMode = 'shaded';
  config: RayTracingConfig = createDefaultRayTracing();
  /** Result of the path tracing probe; null until the first ray-traced switch runs it. */
  capability: RayTracingCapability | null = null;
  tracer: RayTracingRenderer | null = null;
  loading: Promise<RayTracingRenderer | null> | null = null;

  constructor(
    private readonly surface: ViewportSurface,
    private readonly view: ViewCamera,
    private readonly onDenoiserFailure?: (message: string) => void,
  ) { }

  /** Selects rasterized shading or lazily initialized WebGPU ray tracing. */
  async setMode(mode: RenderMode): Promise<void> {
    this.mode = mode;
    if (mode !== 'raytraced' || this.tracer || this.surface.disposed) return;
    if (this.capability && !this.capability.ok) throw new RayTracingUnsupportedError(this.capability);
    if (!this.loading) {
      this.loading = import('@/render/renderer/rayTracingRenderer')
        .then(async ({ RayTracingRenderer }) => {
          if (this.surface.disposed) return null;
          const tracer = new RayTracingRenderer(this.surface.renderer, this.config, this.onDenoiserFailure);
          await tracer.setConfig(this.config);
          // The switch is only proven once the kernels have drawn; see verifyRayTracing.
          const capability = this.capability ?? await this.verify(tracer);
          if (capability) {
            this.capability = capability;
            if (!capability.ok) {
              tracer.dispose();
              throw new RayTracingUnsupportedError(capability);
            }
          }
          if (this.surface.disposed) {
            tracer.dispose();
            return null;
          }
          return tracer;
        })
        .catch(error => {
          this.loading = null;
          throw error;
        });
    }
    const loading = this.loading;
    const rayTracer = await loading;
    // Recovery or a retry can drop this creation attempt; its tracer is then ours to free.
    if (this.loading !== loading) {
      if (rayTracer && rayTracer !== this.tracer) rayTracer.dispose();
      return;
    }
    this.loading = null;
    if (this.surface.disposed) {
      rayTracer?.dispose();
      return;
    }
    if (rayTracer && !this.tracer) this.tracer = rayTracer;
  }

  /** Stores project settings and applies them to a ready tracer. */
  setConfig(config: RayTracingConfig): Promise<void> {
    this.config = config;
    if (this.mode !== 'raytraced' || !this.tracer) return Promise.resolve();
    return this.tracer.setConfig(config);
  }

  /** Draws one path-traced frame; false leaves the caller to draw a raster frame instead. */
  render(): boolean {
    if (this.mode !== 'raytraced' || !this.tracer) return false;
    return this.tracer.render(this.surface.scene, this.view.camera);
  }

  /** Which gate the viewport's next drawn frame is behind. */
  state(): RayTraceState {
    if (this.mode !== 'raytraced') return 'inactive';
    if (this.capability && !this.capability.ok) return 'unsupported';
    if (!this.tracer) return 'building';
    if (this.tracer.deferReason) return this.tracer.deferReason;
    return this.tracer.isBlending ? 'blending' : 'traced';
  }

  /** Drops the failed tracer and falls back to rasterization. */
  recoverToRaster(): void {
    this.tracer?.dispose();
    this.tracer = null;
    // A kept creation promise would reinstall this disposed tracer on the next switch.
    this.loading = null;
    this.mode = 'shaded';
  }

  /** Tells the tracer that lights or the environment image changed. */
  invalidate(): void {
    this.tracer?.invalidateLights();
    this.tracer?.invalidateEnvironment();
  }

  dispose(): void {
    this.tracer?.dispose();
    this.tracer = null;
    void this.loading?.then(rayTracer => rayTracer?.dispose()).catch(() => { });
    this.loading = null;
  }

  /**
   * Runs the freshly built tracer over the live scene and reports whether the GPU answered.
   * Kernel and bind-group failures surface asynchronously, so drawing the first frames is the only
   * honest capability test — and they are the frames the view draws anyway, so nothing is compiled twice.
   * Returns null when the view is too small to judge: a hidden pane is clamped to 1×1 CSS pixel and
   * one-pixel ray buffers make three emit struct bindings that are not arrays, which every wavefront
   * kernel then fails to parse — a healthy GPU must not be condemned for that.
   */
  private async verify(tracer: RayTracingRenderer): Promise<RayTracingCapability | null> {
    const viewSize = new THREE.Vector2();
    this.surface.renderer.getSize(viewSize);
    if (viewSize.x < VERIFY_MIN_SIZE || viewSize.y < VERIFY_MIN_SIZE) return null;

    let device: GPUDevice;
    try {
      device = rendererDevice(this.surface);
    } catch (error) {
      return { ok: false, failure: 'setup-failed', detail: probeDetail(error instanceof Error ? error.message : String(error)) };
    }

    const errors: string[] = [];
    let lost = '';
    const onError = (event: Event) => {
      errors.push((event as { error?: { message?: string } }).error?.message ?? 'uncaptured GPU error');
    };
    device.addEventListener('uncapturederror', onError);
    void device.lost.then(info => { lost = String(info.reason); });
    try {
      // The first call only records the scene change; the kernels go out on the ones after it.
      for (let frame = 0; frame < VERIFY_FRAMES; frame++) tracer.render(this.surface.scene, this.view.camera);

      // Browsers without the drain call skip that check rather than failing the device.
      const queue = device.queue as { onSubmittedWorkDone?: () => Promise<undefined> };
      if (queue.onSubmittedWorkDone) {
        const settled = await Promise.race([
          queue.onSubmittedWorkDone().then(() => 'done' as const),
          verifyTimeout(VERIFY_TIMEOUT_MS),
        ]);
        if (settled === 'timeout') {
          return { ok: false, failure: 'gpu-error', detail: probeDetail(`${VERIFY_TIMEOUT_MS}ms 内 GPU 队列没有排空`) };
        }
      }

      if (errors.length > 0) return { ok: false, failure: 'gpu-error', detail: probeDetail(errors[0]) };
      if (lost) return { ok: false, failure: 'gpu-error', detail: probeDetail(`GPU 上下文丢失：${lost}`) };

      // The wavefront backend advances one bounce per frame, so a couple of frames legitimately
      // report no finished sample yet. The count is shown, never judged.
      let average = Number.NaN;
      try {
        average = await tracer.measureSampleAverage();
      } catch {
        average = Number.NaN;
      }
      const counted = Number.isNaN(average) ? '样本计数不可读' : `平均 ${average.toFixed(1)} 样本`;
      return { ok: true, failure: null, detail: probeDetail(`试跑 ${VERIFY_FRAMES} 帧 · ${counted}`) };
    } catch (error) {
      return { ok: false, failure: 'setup-failed', detail: probeDetail(error instanceof Error ? `${error.name}: ${error.message}` : String(error)) };
    } finally {
      device.removeEventListener('uncapturederror', onError);
    }
  }
}

/** Clips diagnostic text to the width the viewport toast can show. */
function probeDetail(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > PROBE_DETAIL_LIMIT ? `${single.slice(0, PROBE_DETAIL_LIMIT)}…` : single;
}

/** Resolves as `'timeout'` after `ms`; bounds the GPU queue drain. */
function verifyTimeout(ms: number): Promise<'timeout'> {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}
