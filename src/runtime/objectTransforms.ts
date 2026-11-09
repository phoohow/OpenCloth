/** Pure transform application to vertex buffers; no scene objects. */

import type { ObjectTransform } from '@/model/types';

/** Scales and rotates a vertex buffer around its own centre, then translates it. */
export function applyObjectTransform(positions: Float32Array, t: ObjectTransform): void {
  if (isIdentity(t) || positions.length < 3) return;
  const count = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3]!; cy += positions[i * 3 + 1]!; cz += positions[i * 3 + 2]!;
  }
  cx /= count; cy /= count; cz /= count;
  const m = rotationScaleMatrix(t);
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

/** Column-major 3×3 matrix of the transform's rotation and scale. */
function rotationScaleMatrix(t: ObjectTransform): number[] {
  const { x: e1, y: e2, z: e3 } = t.rotationEuler;
  const c1 = Math.cos(e1), s1 = Math.sin(e1);
  const c2 = Math.cos(e2), s2 = Math.sin(e2);
  const c3 = Math.cos(e3), s3 = Math.sin(e3);
  const { x: sx, y: sy, z: sz } = t.scale;
  return [
    c2 * c3 * sx, (c1 * s3 + s1 * s2 * c3) * sx, (s1 * s3 - c1 * s2 * c3) * sx,
    -c2 * s3 * sy, (c1 * c3 - s1 * s2 * s3) * sy, (s1 * c3 + c1 * s2 * s3) * sy,
    s2 * sz, -s1 * c2 * sz, c1 * c2 * sz,
  ];
}
