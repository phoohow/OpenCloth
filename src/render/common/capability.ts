/** Neutral device-capability contract: the WebGPU probe and the path-tracing verdict. */

/** Whether this browser can run the WebGPU renderer at all. */
export async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  const adapter = await navigator.gpu.requestAdapter();
  return !!adapter;
}

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