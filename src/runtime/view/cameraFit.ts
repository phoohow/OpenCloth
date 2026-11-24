import type { Bounds, CameraFit } from '@/render/common';

import { AXIS_NEG_X, AXIS_NEG_Y, AXIS_NEG_Z, AXIS_X, AXIS_Y, AXIS_Z, type Vec3 } from '@/base/math';
import { orthoFitViewHeight, perspectiveFitDistance, projectBox } from '@/render/common';

const SQRT_HALF = Math.SQRT1_2;

export const CAMERA_VIEW_FRAMES: Record<CameraPreset, ViewFrame> = {
  front: { direction: AXIS_Z, up: AXIS_Y },
  back: { direction: AXIS_NEG_Z, up: AXIS_Y },
  left: { direction: AXIS_NEG_X, up: AXIS_Y },
  right: { direction: AXIS_X, up: AXIS_Y },
  top: { direction: AXIS_Y, up: AXIS_NEG_Z },
  bottom: { direction: AXIS_NEG_Y, up: AXIS_Z },
  frontLeft: { direction: { x: -SQRT_HALF, y: 0, z: SQRT_HALF }, up: AXIS_Y },
  frontRight: { direction: { x: SQRT_HALF, y: 0, z: SQRT_HALF }, up: AXIS_Y },
  backLeft: { direction: { x: -SQRT_HALF, y: 0, z: -SQRT_HALF }, up: AXIS_Y },
  backRight: { direction: { x: SQRT_HALF, y: 0, z: -SQRT_HALF }, up: AXIS_Y },
};

const ORBIT_FRAMES: readonly ViewFrame[] = Object.values(CAMERA_VIEW_FRAMES);

export type CameraPreset =
  | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
  | 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight';

export interface ViewFrame {
  direction: Vec3;
  up: Vec3;
}

export function fitCameraToBox(box: Bounds, fovDeg: number, aspect: number): CameraFit {
  return {
    distance: orbitDistance(box, fovDeg, aspect),
    viewHeight: orbitViewHeight(box, aspect),
  };
}

function orbitDistance(box: Bounds, fovDeg: number, aspect: number): number {
  let distance = 0;
  for (const frame of ORBIT_FRAMES) {
    const extents = projectBox(box, frame.direction, frame.up);
    distance = Math.max(distance, perspectiveFitDistance(extents, fovDeg, aspect));
  }

  return distance;
}

function orbitViewHeight(box: Bounds, aspect: number): number {
  let viewHeight = 0;
  for (const frame of ORBIT_FRAMES) {
    viewHeight = Math.max(viewHeight, orthoFitViewHeight(projectBox(box, frame.direction, frame.up), aspect));
  }

  return viewHeight;
}
