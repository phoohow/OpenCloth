/** Camera presets and pure box framing, independent of three. */

import type { Vec3 } from '@/base/math';
import type { Bounds, CameraFit } from '@/render/common';
import { orthoFitViewHeight, perspectiveFitDistance, projectBox } from '@/render/common';

/** Named view the camera can jump to; the camera sits on the direction ray, looking at the scene. */
export type CameraPreset =
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
  | 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';

/** View direction and up vector of one preset. */
export interface ViewFrame {
  direction: Vec3;
  up: Vec3;
}

const SQRT_HALF = Math.SQRT1_2;
const UP = { x: 0, y: 1, z: 0 };

/** Axis-aligned view frames: four sides, top and bottom, then four 45-degree corners. */
export const CAMERA_VIEW_FRAMES: Record<CameraPreset, ViewFrame> = {
  front: { direction: { x: 0, y: 0, z: 1 }, up: UP },
  back: { direction: { x: 0, y: 0, z: -1 }, up: UP },
  left: { direction: { x: -1, y: 0, z: 0 }, up: UP },
  right: { direction: { x: 1, y: 0, z: 0 }, up: UP },
  top: { direction: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  bottom: { direction: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  frontLeft: { direction: { x: -SQRT_HALF, y: 0, z: SQRT_HALF }, up: UP },
  frontRight: { direction: { x: SQRT_HALF, y: 0, z: SQRT_HALF }, up: UP },
  backLeft: { direction: { x: -SQRT_HALF, y: 0, z: -SQRT_HALF }, up: UP },
  backRight: { direction: { x: SQRT_HALF, y: 0, z: -SQRT_HALF }, up: UP },
};

/** Every preset direction, measured so one framing fits all of them. */
const ORBIT_FRAMES: readonly ViewFrame[] = Object.values(CAMERA_VIEW_FRAMES);

/**
 * Distance and orthographic height that frame the box for the viewport's current aspect.
 * Only presets are named here; the framing math itself lives in `render/common/viewMath`.
 */
export function fitCameraToBox(box: Bounds, fovDeg: number, aspect: number): CameraFit {
  return {
    distance: orbitDistance(box, fovDeg, aspect),
    viewHeight: orbitViewHeight(box, aspect),
  };
}

/** Orbit distance that frames the box from every preset, keeping the camera on one radius. */
function orbitDistance(box: Bounds, fovDeg: number, aspect: number): number {
  let distance = 0;
  for (const frame of ORBIT_FRAMES) {
    const extents = projectBox(box, frame.direction, frame.up);
    distance = Math.max(distance, perspectiveFitDistance(extents, fovDeg, aspect));
  }
  return distance;
}

/** Orthographic height that fits the box from every preset, keeping one apparent scale. */
function orbitViewHeight(box: Bounds, aspect: number): number {
  let viewHeight = 0;
  for (const frame of ORBIT_FRAMES) {
    viewHeight = Math.max(viewHeight, orthoFitViewHeight(projectBox(box, frame.direction, frame.up), aspect));
  }
  return viewHeight;
}
