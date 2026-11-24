import { AXIS_Y } from '@/base/math/vec3';

export function computeVertexNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const abx = positions[b]! - positions[a]!, aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!, acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a]! += nx; normals[a + 1]! += ny; normals[a + 2]! += nz;
    normals[b]! += nx; normals[b + 1]! += ny; normals[b + 2]! += nz;
    normals[c]! += nx; normals[c + 1]! += ny; normals[c + 2]! += nz;
  }

  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (length < 1e-9) {
      normals[i] = AXIS_Y.x;
      normals[i + 1] = AXIS_Y.y;
      normals[i + 2] = AXIS_Y.z;
      continue;
    }

    normals[i]! /= length;
    normals[i + 1]! /= length;
    normals[i + 2]! /= length;
  }

  return normals;
}

export function computeVertexAreas(positions: Float32Array, indices: Uint32Array): Float32Array {
  const areas = new Float32Array(Math.floor(positions.length / 2));
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const ax = positions[a * 2]!;
    const ay = positions[a * 2 + 1]!;
    const bx = positions[b * 2]!;
    const by = positions[b * 2 + 1]!;
    const cx = positions[c * 2]!;
    const cy = positions[c * 2 + 1]!;
    const third = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 6;
    areas[a] += third;
    areas[b] += third;
    areas[c] += third;
  }

  return areas;
}
