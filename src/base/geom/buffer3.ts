/** Read helpers for flat xyz vertex buffers. */

import type { Vec3 } from '@/base/math/vec3';

/** Distance between two xyz points stored at particle indices in a flat buffer. */
export function distance3At(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  );
}

/** Distance between a flat-buffer point and a vector; Infinity when the index is out of range. */
export function distance3AtPoint(positions: Float32Array, index: number, point: Vec3): number {
  const offset = index * 3;
  if (offset + 2 >= positions.length) return Infinity;
  return Math.hypot(
    positions[offset]! - point.x,
    positions[offset + 1]! - point.y,
    positions[offset + 2]! - point.z,
  );
}

/** Reads one xyz point from a flat buffer, defaulting missing components to zero. */
export function readPoint3At(positions: Float32Array, index: number): Vec3 {
  return {
    x: positions[index * 3] ?? 0,
    y: positions[index * 3 + 1] ?? 0,
    z: positions[index * 3 + 2] ?? 0,
  };
}
