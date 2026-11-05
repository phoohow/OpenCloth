import type { CameraProjection, Vec3 } from '@/model/types';
import {
  isOrthographic, setCameraProjection, syncOrthoFrustum, viewportAspect,
  type RendererContext,
} from '@/render/renderer';
import type { CameraPreset } from '@/runtime/cameraFit';

/** Live camera placement of the viewport; not part of the project data. */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees; meaningful while the projection is perspective. */
  fovDeg: number;
  projection: CameraProjection;
  /** World height the orthographic frustum spans in meters; meaningful while orthographic. */
  viewHeightMeters: number;
}

/** Hooks the viewport needs from the picker to refit the camera. */
export interface CameraRigHooks {
  applyPreset: (preset: CameraPreset) => void;
  frameScene: () => void;
}

/** Viewport camera: named presets, projection switching and the saved placement round-trip. */
export class CameraRig {
  constructor(
    private readonly ctx: RendererContext,
    private readonly hooks: CameraRigHooks,
  ) { }

  /** Moves the camera to a named preset and focuses the orbit target on the garment. */
  setPreset(preset: CameraPreset): void {
    this.hooks.applyPreset(preset);
  }

  /** Refits the scene box along the current view direction, leaving the camera angle alone. */
  frameScene(): void {
    this.hooks.frameScene();
  }

  /** Projection the viewport camera renders with. */
  get projection(): CameraProjection {
    return this.ctx.view.projection;
  }

  /** Swaps the viewport camera and refits the scene box along the current view direction. */
  setProjection(projection: CameraProjection): void {
    setCameraProjection(this.ctx, projection);
    this.hooks.frameScene();
  }

  getState(): CameraState {
    const { camera, controls, orthoViewHeight } = this.ctx.view;
    const ortho = isOrthographic(camera);
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      fovDeg: ortho ? this.ctx.view.perspectiveCamera.fov : camera.fov,
      projection: this.ctx.view.projection,
      viewHeightMeters: ortho ? orthoViewHeight / camera.zoom : orthoViewHeight,
    };
  }

  /** Moves the viewport camera, its orbit target and the active projection's frame size. */
  setState(state: {
    position?: Vec3; target?: Vec3; fovDeg?: number; viewHeightMeters?: number;
  }): void {
    const view = this.ctx.view;
    const { camera, controls } = view;
    if (state.position) camera.position.set(state.position.x, state.position.y, state.position.z);
    if (state.target) controls.target.set(state.target.x, state.target.y, state.target.z);
    if (state.fovDeg !== undefined) {
      view.perspectiveCamera.fov = state.fovDeg;
      view.perspectiveCamera.updateProjectionMatrix();
    }
    if (state.viewHeightMeters !== undefined) {
      // The wheel zoom folds into the base height so the slider always reads the live frame.
      view.orthoViewHeight = state.viewHeightMeters;
      view.orthographicCamera.zoom = 1;
      syncOrthoFrustum(this.ctx, viewportAspect(this.ctx));
    }
    controls.update();
  }
}
