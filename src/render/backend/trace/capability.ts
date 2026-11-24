import type { Commands } from '@/render/backend/commands';
import type { SceneStore } from '@/render/backend/scene/sceneStore';
import type { PathTracer } from '@/render/backend/trace/pathTracer';
import type { RayTracingCapability, VersionStamp } from '@/render/common';

import { asTargetHandle } from '@/render/backend/types';
import * as THREE from 'three/webgpu';

export {
  RayTracingUnsupportedError, type RayTraceFailure, type RayTracingCapability,
} from '@/render/common';

const VERIFY_FRAMES = 2;

const VERIFY_MIN_SIZE = 16;

const VERIFY_TIMEOUT_MS = 30000;

const PROBE_DETAIL_LIMIT = 180;

export async function probeRayTracing(
  device: GPUDevice,
  commands: Commands,
  tracer: PathTracer,
  scene: SceneStore,
  versions: Readonly<VersionStamp>,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  target: THREE.RenderTarget,
  viewSize: { x: number; y: number },
): Promise<RayTracingCapability | null> {
  if (viewSize.x < VERIFY_MIN_SIZE || viewSize.y < VERIFY_MIN_SIZE) return null;

  const errors: string[] = [];
  let lost = '';
  const onError = (event: Event) => {
    errors.push((event as { error?: { message?: string } }).error?.message ?? 'uncaptured GPU error');
  };
  device.addEventListener('uncapturederror', onError);
  void device.lost.then(info => { lost = String(info.reason); });
  try {
    for (let frame = 0; frame < VERIFY_FRAMES; frame++) {
      tracer.render(scene, versions, camera, asTargetHandle(target), commands);
    }

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

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function probeDetail(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > PROBE_DETAIL_LIMIT ? `${single.slice(0, PROBE_DETAIL_LIMIT)}…` : single;
}

function verifyTimeout(ms: number): Promise<'timeout'> {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}
