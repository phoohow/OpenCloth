import type { Vec3 } from '@/model/types';

/** How far along the ray toward the cloth the occlusion walk goes. */
const OCCLUSION_END = 0.92;

/** Samples taken between the camera and the cloth. */
const OCCLUSION_STEPS = 12;

/** Shortest advance of one step, so a point resting on the skin still moves forward. */
const MIN_STEP_M = 0.002;

/**
 * True when the body sits between the camera and a cloth point, so the cloth is hidden and must not
 * answer hover gestures. The walk stops just short of the cloth because cloth rests a few
 * millimetres off the skin; `signedDistance` is negative inside the body. `direction` must be unit
 * length.
 *
 * Each step advances by the clearance it reads, as a sphere trace does: a clear stretch is crossed
 * in one step, and a limb thinner than the step spacing cannot be skipped over.
 */
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
