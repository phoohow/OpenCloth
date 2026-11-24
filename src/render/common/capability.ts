export type RayTraceFailure = 'gpu-error' | 'setup-failed';

export interface RayTracingCapability {
  ok: boolean;
  failure: RayTraceFailure | null;
  detail: string;
}

export async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  const adapter = await navigator.gpu.requestAdapter();
  return !!adapter;
}

export class RayTracingUnsupportedError extends Error {
  readonly failure: RayTraceFailure;
  readonly detail: string;

  constructor(capability: RayTracingCapability) {
    super(`WebGPU path tracing unsupported: ${capability.failure}`);
    this.failure = capability.failure ?? 'setup-failed';
    this.detail = capability.detail;
  }
}
