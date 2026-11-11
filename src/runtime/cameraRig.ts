/** Camera presets, framing and saved placement over the Contract camera host. */

import type { Bounds, CameraHost, CameraPose } from '@/render/common';
import { add3, normalize3, scale3, sub3 } from '@/base/math';
import type { CameraAnimationConfig, CameraConfig, CameraProjection, Vec3 } from '@/model/types';
import { normalizeCameraAnimation } from '@/model';
import {
  CAMERA_VIEW_FRAMES, fitCameraToBox, type CameraPreset,
} from '@/runtime/cameraFit';
import { cameraAnimationPose } from '@/runtime/cameraAnimation';

/** Camera state stored with the project. */
export type CameraState = CameraConfig;

/** What the camera framing counts: the cloth, the body and every visible reference. */
export interface CameraRigDeps {
  readonly host: CameraHost;
  /** Bounds of every framed object, in world space. */
  readonly bounds: () => Bounds;
}

interface RunningAnimation {
  config: CameraAnimationConfig;
  base: CameraState;
  elapsedSec: number;
}

/** Builds camera poses from the scene bounds. */
export class CameraRig {
  private animation: RunningAnimation | null = null;
  /** True while the rig writes a pose, which must not re-base the running move. */
  private writing = false;
  private readonly detach: () => void;

  constructor(private readonly deps: CameraRigDeps) {
    this.detach = deps.host.onChange(() => this.rebaseOnUserMove());
  }

  get projection(): CameraProjection {
    return this.deps.host.projection();
  }

  setProjection(projection: CameraProjection): void {
    this.deps.host.setProjection(projection);
  }

  /** Moves the camera to a named preset and frames the scene. */
  setPreset(preset: CameraPreset): void {
    const frame = CAMERA_VIEW_FRAMES[preset];
    const bounds = this.deps.bounds();
    const center = centerOf(bounds);
    const snapshot = this.deps.host.snapshot();
    const fit = fitCameraToBox(bounds, snapshot.fovDeg, snapshot.aspect);
    this.deps.host.setPose({
      projection: this.deps.host.projection(),
      position: add3(center, scale3(frame.direction, fit.distance)),
      target: center,
      up: frame.up,
      fovDeg: snapshot.fovDeg,
      viewHeightMeters: fit.viewHeight,
    });
  }

  /** Refits the scene box along the current view direction. */
  frameScene(): void {
    const snapshot = this.deps.host.snapshot();
    const direction = normalize3(sub3(snapshot.position, snapshot.target)) ?? { x: 0, y: 0, z: 1 };
    const fit = fitCameraToBox(this.deps.bounds(), snapshot.fovDeg, snapshot.aspect);
    this.deps.host.setPose({
      projection: snapshot.projection,
      position: add3(snapshot.target, scale3(direction, fit.distance)),
      target: snapshot.target,
      up: snapshot.up,
      fovDeg: snapshot.fovDeg,
      viewHeightMeters: fit.viewHeight,
    });
  }

  /** Stored placement; while a move plays, this is the placement the move plays around. */
  getState(): CameraState {
    return this.animation?.base ?? this.liveState();
  }

  setState(state: {
    position?: Vec3; target?: Vec3; fovDeg?: number; viewHeightMeters?: number;
    projection?: CameraProjection;
  }): void {
    const snapshot = this.deps.host.snapshot();
    const pose: CameraPose = {
      projection: state.projection ?? snapshot.projection,
      position: state.position ?? snapshot.position,
      target: state.target ?? snapshot.target,
      up: snapshot.up,
      fovDeg: state.fovDeg ?? snapshot.fovDeg,
      viewHeightMeters: state.viewHeightMeters ?? snapshot.viewHeightMeters,
    };
    this.deps.host.setPose(pose);
  }

  /** Starts, updates or stops the looping move; a missing or disabled config stops it. */
  setAnimation(config: CameraAnimationConfig | null | undefined): void {
    if (!config?.enabled) {
      this.stopAnimation();
      return;
    }
    const next = normalizeCameraAnimation(config);
    const running = this.animation;
    if (running) {
      running.config = next;
      return;
    }
    this.animation = { config: next, base: this.getState(), elapsedSec: 0 };
  }

  /** Whether a looping move currently drives the camera. */
  isAnimating(): boolean {
    return this.animation !== null;
  }

  /** Advances the running move by one frame; true when it moved the camera. */
  advanceAnimation(dtMs: number): boolean {
    const running = this.animation;
    if (!running) return false;
    running.elapsedSec += Math.max(0, dtMs) / 1000;
    this.write(cameraAnimationPose(running.base, running.config, running.elapsedSec));
    return true;
  }

  /** Drops the move and puts the camera back where it was before it started. */
  stopAnimation(): void {
    const running = this.animation;
    this.animation = null;
    if (running) this.write(running.base);
  }

  dispose(): void {
    this.detach();
  }

  /** Writes a placement to the host without letting it count as user input. */
  private write(state: CameraState): void {
    const snapshot = this.deps.host.snapshot();
    this.writing = true;
    try {
      this.deps.host.setPose({
        projection: state.projection,
        position: state.position,
        target: state.target,
        up: snapshot.up,
        fovDeg: state.fovDeg,
        viewHeightMeters: state.viewHeightMeters,
      });
    } finally {
      this.writing = false;
    }
  }

  /** Placement the host holds right now, animated or not. */
  private liveState(): CameraState {
    const snapshot = this.deps.host.snapshot();
    return {
      projection: snapshot.projection,
      position: snapshot.position,
      target: snapshot.target,
      fovDeg: snapshot.fovDeg,
      viewHeightMeters: snapshot.viewHeightMeters,
    };
  }

  /** Restarts the move around a placement the user just picked. */
  private rebaseOnUserMove(): void {
    const running = this.animation;
    if (this.writing || !running) return;
    running.base = this.liveState();
    running.elapsedSec = 0;
  }
}

function centerOf(bounds: Bounds): Vec3 {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}
