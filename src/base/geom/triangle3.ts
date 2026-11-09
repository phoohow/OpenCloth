/** Triangle algebra in world space: normal, barycentric weights and closest point. */

import type { Vec3Tuple } from '@/base/math/tuple3';
import { cross3, normalize3, sub3, type Vec3 } from '@/base/math/vec3';

/** Three-component vector stored as a tuple, for buffer-oriented triangle queries. */
export type Triple = Vec3Tuple;

/** Unit normal of a triangle; the zero vector when the triangle is degenerate. */
export function triangleNormal3(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize3(cross3(sub3(b, a), sub3(c, a))) ?? { x: 0, y: 0, z: 0 };
}

/**
 * Barycentric weights of a point against a triangle, measured after projecting the point
 * onto the triangle's plane. Returns null when the triangle has no area.
 */
export function barycentricWeights3D(
  p: Triple, a: Triple, b: Triple, c: Triple,
): Triple | null {
  const v0: Triple = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1: Triple = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2: Triple = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u: Triple, v: Triple): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denominator = d00 * d11 - d01 * d01;
  if (Math.abs(denominator) < 1e-20) return null;
  const weightB = (d11 * d20 - d01 * d21) / denominator;
  const weightC = (d00 * d21 - d01 * d20) / denominator;
  return [1 - weightB - weightC, weightB, weightC];
}

/**
 * Closest point on a triangle to `p`, written into `out`. Shared with the collide shader's
 * `closestOnTriangle`, which mirrors this routine.
 */
export function closestPointOnTriangle3(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: Float64Array,
): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out[0] = ax; out[1] = ay; out[2] = az;
    return;
  }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out[0] = bx; out[1] = by; out[2] = bz;
    return;
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v;
    return;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out[0] = cx; out[1] = cy; out[2] = cz;
    return;
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w;
    return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w;
    return;
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}
