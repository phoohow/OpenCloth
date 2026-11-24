import * as THREE from 'three/webgpu';

export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

export class Surface {
  private readonly scratch = new THREE.Vector2();

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly renderer: THREE.WebGPURenderer,
  ) {}

  get size(): SurfaceSize {
    const target = this.renderer.getSize(this.scratch);
    return { width: target.x, height: target.y };
  }

  get drawingBuffer(): SurfaceSize {
    const target = this.renderer.getDrawingBufferSize(this.scratch);
    return { width: target.x, height: target.y };
  }

  get aspect(): number {
    return Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const current = this.renderer.getSize(this.scratch);
    if (current.x === width && current.y === height) return;
    this.renderer.setSize(width, height, false);
  }
}
