import type { Vec2, Vec3Tuple } from '@/base/math';

export function trianglePointToPanel2D(
  vertexOffset: number,
  positions2D: Float32Array,
  particles: Vec3Tuple,
  weights: Vec3Tuple,
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
