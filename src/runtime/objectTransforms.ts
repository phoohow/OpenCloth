/** Pure transform application to vertex buffers; no scene objects. */

import type { ObjectTransform } from '@/model/types';
import { eulerScaleMatrix3 } from '@/base/math';

/** Scales and rotates a vertex buffer around its own centre, then translates it. */
export function applyObjectTransform(positions: Float32Array, t: ObjectTransform): void {
  if (isIdentity(t) || positions.length < 3) return;
  const count = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3]!; cy += positions[i * 3 + 1]!; cz += positions[i * 3 + 2]!;
  }
  cx /= count; cy /= count; cz /= count;
  const m = eulerScaleMatrix3(t.rotationEuler, t.scale);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]! - cx;
    const y = positions[i * 3 + 1]! - cy;
    const z = positions[i * 3 + 2]! - cz;
    positions[i * 3] = m[0]! * x + m[3]! * y + m[6]! * z + cx + t.position.x;
    positions[i * 3 + 1] = m[1]! * x + m[4]! * y + m[7]! * z + cy + t.position.y;
    positions[i * 3 + 2] = m[2]! * x + m[5]! * y + m[8]! * z + cz + t.position.z;
  }
}

/** True when a transform leaves geometry exactly where it is. */
function isIdentity(t: ObjectTransform): boolean {
  return !t.position.x && !t.position.y && !t.position.z
    && !t.rotationEuler.x && !t.rotationEuler.y && !t.rotationEuler.z
    && t.scale.x === 1 && t.scale.y === 1 && t.scale.z === 1;
}
