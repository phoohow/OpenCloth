/** Sampling policy of the path tracer: when a frame may show traced samples. */

/** Per-frame camera drift under this matrix distance ends the interaction burst. */
const VIEW_SETTLE_TOLERANCE = 1e-4;

/** Per-frame camera drift over this matrix distance hands the view back to rasterization. */
const VIEW_MOVE_TOLERANCE = 2e-3;

/** Drift from the accumulated camera over this matrix distance restarts the sample pass. */
const CAMERA_RESTART_TOLERANCE = 2e-3;

/** What the gate decided for one frame. */
export interface TraceVerdict {
  /** The view is being manipulated; the pass must restart. */
  moving: boolean;
  /** The accumulated samples no longer match the camera. */
  restart: boolean;
}

/** Compares this frame's camera with what the tracer holds. */
export class TraceGate {
  private lastCamera: number[] | null = null;
  private syncedCamera: number[] | null = null;
  private moving = false;

  /** @param camera flat transform and projection of the viewport camera */
  observe(camera: number[]): TraceVerdict {
    const drift = cameraDistance(this.lastCamera, camera);
    this.lastCamera = camera;
    // Two thresholds keep the orbit damping from alternating between the pipelines every frame.
    const wasMoving = this.moving;
    const moved = drift > (this.moving ? VIEW_SETTLE_TOLERANCE : VIEW_MOVE_TOLERANCE);
    this.moving = moved;
    const driftFromSynced = cameraDistance(this.syncedCamera, camera);
    // The burst that just ended threw its samples away, so the tracer has to pick up the camera
    // it actually stopped at even when the last step was shorter than the restart tolerance.
    const settled = wasMoving && !moved && driftFromSynced > 0;
    const restart = moved || settled || driftFromSynced > CAMERA_RESTART_TOLERANCE;
    return { moving: moved, restart };
  }

  /** Records the camera the tracer captured. */
  markSynced(camera: number[]): void {
    this.syncedCamera = camera;
  }

  /** Forgets the snapshot; the next frame recaptures the camera. */
  reset(): void {
    this.syncedCamera = null;
    this.moving = false;
  }
}

/** Largest entry-wise change between two camera snapshots; Infinity when there is nothing to match. */
export function cameraDistance(from: number[] | null, to: number[]): number {
  if (!from || from.length !== to.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < to.length; i++) distance = Math.max(distance, Math.abs(to[i]! - from[i]!));
  return distance;
}

/** Camera transform and projection values that invalidate accumulated samples. */
export function readCameraValues(camera: {
  matrixWorld: { elements: number[] }; projectionMatrix: { elements: number[] };
}): number[] {
  return [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
}
