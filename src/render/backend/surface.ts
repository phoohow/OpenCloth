/** The drawing surface: canvas and sizes. */

import * as THREE from 'three/webgpu';

/** Public size of the drawing surface. */
export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

/** Owns the canvas and the renderer that presents into it. */
export class Surface {
  private readonly scratch = new THREE.Vector2();

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly renderer: THREE.WebGPURenderer,
  ) { }

  /** Drawing surface size in CSS pixels. */
  get size(): SurfaceSize {
    const target = this.renderer.getSize(this.scratch);
    return { width: target.x, height: target.y };
  }

  /** Drawing-buffer size in device pixels. */
  get drawingBuffer(): SurfaceSize {
    const target = this.renderer.getDrawingBufferSize(this.scratch);
    return { width: target.x, height: target.y };
  }

  /** Aspect of the drawing surface, guarded against a hidden pane. */
  get aspect(): number {
    return Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
  }

  /**
   * Matches the drawing buffer to a new viewport size. A repeated size is ignored: setSize
   * rewrites the canvas dimensions, which reconfigures the presentation surface and must not
   * happen on every frame.
   */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const current = this.renderer.getSize(this.scratch);
    if (current.x === width && current.y === height) return;
    this.renderer.setSize(width, height, false);
  }
}
