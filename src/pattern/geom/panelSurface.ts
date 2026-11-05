import type { Vec2 } from '../../core/model/types';

/** Three-component vector used by the surface helpers. */
export type Triple = readonly [number, number, number];

const sub = (a: Triple, b: Triple): Triple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Triple, b: Triple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Barycentric weights of a point against a triangle, measured after projecting the point
 * onto the triangle's plane. Returns null when the triangle has no area.
 */
export function barycentricWeights3D(p: Triple, a: Triple, b: Triple, c: Triple): Triple | null {
  const v0 = sub(b, a);
  const v1 = sub(c, a);
  const v2 = sub(p, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-20) return null;
  const weightB = (d11 * d20 - d01 * d21) / denom;
  const weightC = (d00 * d21 - d01 * d20) / denom;
  return [1 - weightB - weightC, weightB, weightC];
}

/**
 * Flat pattern point of a barycentric position on one panel's merged triangle. The panel's
 * flat mesh positions are in centimetres and start at its own vertex offset.
 */
export function trianglePointToPanel2D(
  vertexOffset: number,
  positions2D: Float32Array,
  particles: readonly [number, number, number],
  weights: Triple,
): Vec2 | null {
  let x = 0;
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const local = particles[i] - vertexOffset;
    if (local < 0 || (local + 1) * 2 > positions2D.length) return null;
    x += positions2D[local * 2] * weights[i];
    y += positions2D[local * 2 + 1] * weights[i];
  }
  return { x, y };
}
