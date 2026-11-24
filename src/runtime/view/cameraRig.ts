import type { CameraAnimationConfig, CameraConfig, CameraProjection, Vec3 } from '@/model/types';
import type { Bounds, CameraHost, CameraPose } from '@/render/common';

import { AXIS_Z, add3, normalize3, scale3, sub3 } from '@/base/math';
import { normalizeCameraAnimation } from '@/model';
import { cameraAnimationPose } from '@/runtime/view/cameraAnimation';
import {
  CAMERA_VIEW_FRAMES, fitCameraToBox, type CameraPreset,
} from '@/runtime/view/cameraFit';

export type CameraState = CameraConfig;

export interface CameraRigDeps {
  readonly host: CameraHost;
  readonly bounds: () => Bounds;
}

interface RunningAnimation {
  config: CameraAnimationConfig;
  base: CameraState;
  elapsedSec: number;
}

export class CameraRig {
  private animation: RunningAnimation | null = null;
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

  frameScene(): void {
    const snapshot = this.deps.host.snapshot();
    const direction = normalize3(sub3(snapshot.position, snapshot.target), AXIS_Z);
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

  isAnimating(): boolean {
    return this.animation !== null;
  }

  advanceAnimation(dtMs: number): boolean {
    const running = this.animation;
    if (!running) return false;
    running.elapsedSec += Math.max(0, dtMs) / 1000;
    this.write(cameraAnimationPose(running.base, running.config, running.elapsedSec));
    return true;
  }

  stopAnimation(): void {
    const running = this.animation;
    this.animation = null;
    if (running) this.write(running.base);
  }

  dispose(): void {
    this.detach();
  }

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
