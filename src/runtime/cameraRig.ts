/** Camera presets, framing and saved placement over the Contract camera host. */

import type { Bounds, CameraHost, CameraPose } from '@/render/common';
import type { CameraConfig, CameraProjection, Vec3 } from '@/model/types';
import {
  CAMERA_VIEW_FRAMES, fitCameraToBox, type CameraPreset,
} from '@/runtime/cameraFit';

/** Camera state stored with the project. */
export type CameraState = CameraConfig;

/** What the camera framing counts: the cloth, the body and every visible reference. */
export interface CameraRigDeps {
  readonly host: CameraHost;
  /** Bounds of every framed object, in world space. */
  readonly bounds: () => Bounds;
}

/** Builds camera poses from the scene bounds. */
export class CameraRig {
  constructor(private readonly deps: CameraRigDeps) { }

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
    const fit = fitCameraToBox(bounds, frame, snapshot.fovDeg, snapshot.aspect);
    this.deps.host.setPose({
      projection: this.deps.host.projection(),
      position: add(center, scale(frame.direction, fit.distance)),
      target: center,
      up: frame.up,
      fovDeg: snapshot.fovDeg,
      viewHeightMeters: fit.viewHeight,
    });
  }

  /** Refits the scene box along the current view direction. */
  frameScene(): void {
    const snapshot = this.deps.host.snapshot();
    const direction = normalize(sub(snapshot.position, snapshot.target)) ?? { x: 0, y: 0, z: 1 };
    const fit = fitCameraToBox(
      this.deps.bounds(), { direction, up: snapshot.up }, snapshot.fovDeg, snapshot.aspect,
    );
    this.deps.host.setPose({
      projection: snapshot.projection,
      position: add(snapshot.target, scale(direction, fit.distance)),
      target: snapshot.target,
      up: snapshot.up,
      fovDeg: snapshot.fovDeg,
      viewHeightMeters: fit.viewHeight,
    });
  }

  getState(): CameraState {
    const snapshot = this.deps.host.snapshot();
    return {
      projection: snapshot.projection,
      position: snapshot.position,
      target: snapshot.target,
      fovDeg: snapshot.fovDeg,
      viewHeightMeters: snapshot.viewHeightMeters,
    };
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
}

function centerOf(bounds: Bounds): Vec3 {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function normalize(v: Vec3): Vec3 | null {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-9 ? { x: v.x / length, y: v.y / length, z: v.z / length } : null;
}
