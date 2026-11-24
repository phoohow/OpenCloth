import type { Vec3Tuple } from '@/base/math';

export function pushTriangle(
  positions: number[], normals: number[],
  a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple,
  na: Vec3Tuple, nb: Vec3Tuple, nc: Vec3Tuple,
): void {
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  normals.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
}

export function pushQuad(
  positions: number[], normals: number[],
  a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple, d: Vec3Tuple,
  na: Vec3Tuple, nb: Vec3Tuple, nc: Vec3Tuple, nd: Vec3Tuple,
): void {
  pushTriangle(positions, normals, a, b, c, na, nb, nc);
  pushTriangle(positions, normals, a, c, d, na, nc, nd);
}
