import { describe, expect, it } from 'vitest';
import { makehumanBody } from '@/avatar/makehuman/body';
import { buildMeshCollider, sampleMeshCollider } from '@/avatar/collider/meshCollider';
import { liftBuriedPositions } from '@/sim/bodyRecovery';
import { createDefaultAvatar } from '@/model/defaults/avatar';

/** Flat triangle soup, nine floats per triangle. */
function soupOf(positions: Float32Array, indices: Uint32Array): Float32Array {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]!;
    out[i * 3] = positions[v * 3]!;
    out[i * 3 + 1] = positions[v * 3 + 1]!;
    out[i * 3 + 2] = positions[v * 3 + 2]!;
  }
  return out;
}

/** Area-weighted vertex normals of an indexed mesh. */
function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const abx = positions[b]! - positions[a]!, aby = positions[b + 1]! - positions[a + 1]!, abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!, acy = positions[c + 1]! - positions[a + 1]!, acz = positions[c + 2]! - positions[a + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

describe('buried particles', () => {
  it('lifts a panel start layout back out of the body', () => {
    const body = makehumanBody(createDefaultAvatar().params);
    const collider = buildMeshCollider(soupOf(body.positions, body.bodyIndices))!;
    const normals = vertexNormals(body.positions, body.bodyIndices);

    // A fitted panel one to two centimetres under the skin, the depth a bad fit starts from.
    const depth = 0.015;
    const stride = 5;
    const points: number[] = [];
    for (let v = 0; v < body.positions.length / 3; v += stride) {
      points.push(
        body.positions[v * 3]! - normals[v * 3]! * depth,
        body.positions[v * 3 + 1]! - normals[v * 3 + 1]! * depth,
        body.positions[v * 3 + 2]! - normals[v * 3 + 2]! * depth,
      );
    }
    const positions = new Float32Array(points);
    const count = positions.length / 3;

    let buried = 0;
    for (let i = 0; i < count; i++) {
      if (sampleMeshCollider(collider, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) < 0) buried++;
    }
    expect(buried).toBeGreaterThan(count / 2);

    const moved = liftBuriedPositions(collider, positions, () => 0.007);
    expect(moved).toBeGreaterThan(0);

    let stillBuried = 0;
    for (let i = 0; i < count; i++) {
      if (sampleMeshCollider(collider, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) < 0) stillBuried++;
    }

    // Thin features (fingers, the gap between the legs) can hold no point one centimetre in, so a
    // small residue is expected; the panels that covered the body have to come out.
    expect(stillBuried).toBeLessThan(Math.max(1, buried * 0.02));
  }, 600_000);
});
