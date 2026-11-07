/** One-time probe telling whether this device can path trace at all. */

import * as THREE from 'three/webgpu';
import type { SceneMgr } from '@/render/scene/manager';
import type { PathTracer } from '@/render/trace/pathTracer';

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

/**
 * Runs the freshly built tracer over the live scene and reports whether the GPU answered.
 * Kernel and bind-group failures surface asynchronously, so drawing the first frames is the only
 * honest capability test — and they are the frames the view draws anyway.
 * Returns null when the view is too small to judge: a hidden pane is clamped to 1×1 CSS pixel and
 * one-pixel ray buffers make three emit struct bindings that are not arrays, which every wavefront
 * kernel then fails to parse — a healthy GPU must not be condemned for that.
 */
export async function probeRayTracing(
  renderer: THREE.WebGPURenderer,
  device: GPUDevice,
  tracer: PathTracer,
  sceneMgr: SceneMgr,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  target: THREE.RenderTarget,
): Promise<RayTracingCapability | null> {
  const viewSize = new THREE.Vector2();
  renderer.getSize(viewSize);
  if (viewSize.x < VERIFY_MIN_SIZE || viewSize.y < VERIFY_MIN_SIZE) return null;

  const errors: string[] = [];
  let lost = '';
  const onError = (event: Event) => {
    errors.push((event as { error?: { message?: string } }).error?.message ?? 'uncaptured GPU error');
  };
  device.addEventListener('uncapturederror', onError);
  void device.lost.then(info => { lost = String(info.reason); });
  try {
    // The first call only records the scene change; the kernels go out on the ones after it.
    for (let frame = 0; frame < VERIFY_FRAMES; frame++) tracer.render(sceneMgr, camera, target);

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

    if (errors.length > 0) return { ok: false, failure: 'gpu-error', detail: probeDetail(errors[0]!) };
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
    return { ok: false, failure: 'setup-failed', detail: probeDetail(errorText(error)) };
  } finally {
    device.removeEventListener('uncapturederror', onError);
  }
}

/** Technical text of a thrown value. */
function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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
