/** The GPU context one viewport owns: canvas, renderer and drawing-buffer size. */

import * as THREE from 'three/webgpu';

/** Canvas plus the WebGPU renderer that draws into it. Holds no scene knowledge. */
export class ViewportDevice {
  /** Watcher that keeps the drawing buffer in sync with the viewport's layout size. */
  resizeObserver?: ResizeObserver;
  disposed = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly renderer: THREE.WebGPURenderer,
  ) { }

  /** Initializes the WebGPU renderer on the given canvas. */
  static async create(canvas: HTMLCanvasElement): Promise<ViewportDevice> {
    // Keep a nonzero drawing buffer while the viewport is hidden by the layout.
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
    await renderer.init();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    // Tone mapping belongs to the post chain, which decides the curve per project; leaving a curve
    // here would apply a second one to anything three draws straight to the canvas.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = false;
    return new ViewportDevice(canvas, renderer);
  }

  /** Aspect of the drawing surface, guarded against a hidden pane. */
  aspect(): number {
    return Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
  }

  /** Matches the drawing buffer to a new viewport size; hidden panes keep the last valid one. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}

/** The GPUDevice the renderer was initialized with; simulation resources share it. */
export function rendererDevice(device: ViewportDevice): GPUDevice {
  const gpu = (device.renderer.backend as unknown as { device?: GPUDevice }).device;
  if (!gpu) throw new Error('WebGPU renderer device unavailable before init');
  return gpu;
}
