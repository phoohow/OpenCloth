import type { CameraAnimationConfig, CameraConfig } from '@/model/types';

import {
  AXIS_NEG_Z, AXIS_X, AXIS_Y, add3, cross3, degToRad, normalize3, rotateAxis3, scale3, sub3,
} from '@/base/math';

const MIN_DOLLY_DISTANCE = 0.2;

export function cameraAnimationPose(
  base: CameraConfig, config: CameraAnimationConfig, elapsedSec: number,
): CameraConfig {
  const offset = sub3(base.position, base.target);
  const distance = Math.hypot(offset.x, offset.y, offset.z);
  if (distance < 1e-6) return base;

  const wave = Math.sin((2 * Math.PI * elapsedSec) / Math.max(1, config.periodSec));
  const travel = config.amplitude * wave;

  switch (config.kind) {
    case 'orbit': {
      const turned = rotateAxis3(offset, AXIS_Y, degToRad(travel));
      return { ...base, position: add3(base.target, turned) };
    }
    case 'dolly': {
      const direction = normalize3(offset, AXIS_Y);
      const reached = Math.max(MIN_DOLLY_DISTANCE, distance + travel);
      return { ...base, position: add3(base.target, scale3(direction, reached)) };
    }
    case 'pan': {
      const forward = normalize3(scale3(offset, -1), AXIS_NEG_Z);
      const right = normalize3(cross3(forward, AXIS_Y), AXIS_X);
      const shift = scale3(right, travel);
      return { ...base, position: add3(base.position, shift), target: add3(base.target, shift) };
    }
    case 'crane': {
      const shift = { x: 0, y: travel, z: 0 };
      return { ...base, position: add3(base.position, shift), target: add3(base.target, shift) };
    }
    default: return base;
  }
}
