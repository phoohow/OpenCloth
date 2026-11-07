/** The GPU resources one viewport shares and the adapter probe that gates WebGPU support. */

/** Reports whether the browser has a usable WebGPU adapter. */
export async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  const adapter = await navigator.gpu.requestAdapter();
  return !!adapter;
}

/**
 * Canvas and GPU device of one viewport. The Renderer creates it privately and keeps the three.js
 * renderer itself; this object only carries the resources those subsystems may share.
 */
export class RenderContext {
  constructor(
    readonly canvas: HTMLCanvasElement,
    /** GPU device every subsystem shares. */
    readonly device: GPUDevice,
  ) { }

  /** Aspect of the drawing surface, guarded against a hidden pane. */
  aspect(): number {
    return Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
  }
}
