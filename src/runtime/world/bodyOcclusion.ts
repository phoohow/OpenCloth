import type { Vec3 } from '@/model/types';

const OCCLUSION_END = 0.92;

const OCCLUSION_STEPS = 12;

const MIN_STEP_M = 0.002;

export function bodyOccludesSegment(
  signedDistance: (x: number, y: number, z: number) => number,
  origin: Vec3,
  direction: Vec3,
  distance: number,
  steps = OCCLUSION_STEPS,
): boolean {
  const reach = distance * OCCLUSION_END;
  let travelled = 0;
  for (let i = 0; i < steps && travelled < reach; i++) {
    const clearance = signedDistance(
      origin.x + direction.x * travelled,
      origin.y + direction.y * travelled,
      origin.z + direction.z * travelled,
    );
    if (clearance < 0) return true;
    travelled += Math.max(clearance, MIN_STEP_M);
  }

  return false;
}
