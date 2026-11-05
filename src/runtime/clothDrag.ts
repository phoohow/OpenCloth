import type { Vec3 } from '@/model/types';

/**
 * Weight of every particle in a pointer grab, one per merged particle: `strength` at `center`,
 * falling off linearly to 0 at `radius`, and 0 outside it. The weights travel with the particles,
 * so the grabbed patch keeps following the pointer while the fabric moves.
 */
export function grabWeightsAround(
  positions: Float32Array,
  center: Vec3,
  radius: number,
  strength: number,
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const weights = new Float32Array(count);
  if (!(radius > 0) || !(strength > 0)) return weights;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3]! - center.x;
    const dy = positions[i * 3 + 1]! - center.y;
    const dz = positions[i * 3 + 2]! - center.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < radius) weights[i] = (1 - distance / radius) * strength;
  }
  return weights;
}
