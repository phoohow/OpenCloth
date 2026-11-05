import * as THREE from 'three/webgpu';
import { addStageFloor } from '@/render/renderer/stageFloor';
import { FALLBACK_BACKGROUND } from '@/render/renderer/sceneEnvironment';

/** The drawing buffer, scene and canvas one viewport owns. */
export class ViewportSurface {
  /** Watcher that keeps the drawing buffer in sync with the viewport's layout size. */
  resizeObserver?: ResizeObserver;
  disposed = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly renderer: THREE.WebGPURenderer,
    readonly scene: THREE.Scene,
  ) { }

  /** Initializes the WebGPU renderer and builds the empty stage scene. */
  static async create(canvas: HTMLCanvasElement): Promise<ViewportSurface> {
    // Keep a nonzero drawing buffer while the viewport is hidden by the layout.
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
    await renderer.init();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = false;

    const scene = new THREE.Scene();
    scene.background = FALLBACK_BACKGROUND;
    addStageFloor(scene);
    return new ViewportSurface(canvas, renderer, scene);
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
export function rendererDevice(surface: ViewportSurface): GPUDevice {
  const device = (surface.renderer.backend as unknown as { device?: GPUDevice }).device;
  if (!device) throw new Error('WebGPU renderer device unavailable before init');
  return device;
}
