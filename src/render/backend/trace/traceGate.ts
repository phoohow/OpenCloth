const VIEW_SETTLE_TOLERANCE = 1e-4;

const VIEW_MOVE_TOLERANCE = 2e-3;

const CAMERA_RESTART_TOLERANCE = 2e-3;

export interface TraceVerdict {
  moving: boolean;
  restart: boolean;
}

export class TraceGate {
  private lastCamera: number[] | null = null;
  private syncedCamera: number[] | null = null;
  private moving = false;

  observe(camera: number[]): TraceVerdict {
    const drift = cameraDistance(this.lastCamera, camera);
    this.lastCamera = camera;
    const wasMoving = this.moving;
    const moved = drift > (this.moving ? VIEW_SETTLE_TOLERANCE : VIEW_MOVE_TOLERANCE);
    this.moving = moved;
    const driftFromSynced = cameraDistance(this.syncedCamera, camera);
    const settled = wasMoving && !moved && driftFromSynced > 0;
    const restart = moved || settled || driftFromSynced > CAMERA_RESTART_TOLERANCE;
    return { moving: moved, restart };
  }

  markSynced(camera: number[]): void {
    this.syncedCamera = camera;
  }

  reset(): void {
    this.syncedCamera = null;
    this.moving = false;
  }
}

export function cameraDistance(from: number[] | null, to: number[]): number {
  if (!from || from.length !== to.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < to.length; i++) distance = Math.max(distance, Math.abs(to[i]! - from[i]!));
  return distance;
}

export function readCameraValues(camera: {
  matrixWorld: { elements: number[] }; projectionMatrix: { elements: number[] };
}): number[] {
  return [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
}
