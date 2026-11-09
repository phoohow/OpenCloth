/** Smooth vertex normals for indexed triangle meshes. */

/** Fallback normal for vertices whose incident triangles have no area. */
const UP = { x: 0, y: 1, z: 0 };

/** Accumulates area-weighted vertex normals from the triangle winding. */
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
      normals[i] = UP.x;
      normals[i + 1] = UP.y;
      normals[i + 2] = UP.z;
      continue;
    }
    normals[i]! /= length;
    normals[i + 1]! /= length;
    normals[i + 2]! /= length;
  }
  return normals;
}
