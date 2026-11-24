import type { Vec3 } from '@/model/types';

export function grabWeightsAround(
  positions: Float32Array,
  center: Vec3,
  radius: number,
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const weights = new Float32Array(count);
  if (!(radius > 0)) return weights;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3]! - center.x;
    const dy = positions[i * 3 + 1]! - center.y;
    const dz = positions[i * 3 + 2]! - center.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < radius) weights[i] = 1 - distance / radius;
  }

  return weights;
}
