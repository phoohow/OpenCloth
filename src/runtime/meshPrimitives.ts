/** Triangle-soup emitters shared by the small runtime gizmo meshes. */

/** Appends one triangle with its per-vertex normals. */
export function pushTriangle(
  positions: number[], normals: number[],
  a: readonly [number, number, number], b: readonly [number, number, number],
  c: readonly [number, number, number],
  na: readonly [number, number, number], nb: readonly [number, number, number],
  nc: readonly [number, number, number],
): void {
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  normals.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
}

/** Appends a quad as two triangles with matching per-vertex normals. */
export function pushQuad(
  positions: number[], normals: number[],
  a: readonly [number, number, number], b: readonly [number, number, number],
  c: readonly [number, number, number], d: readonly [number, number, number],
  na: readonly [number, number, number], nb: readonly [number, number, number],
  nc: readonly [number, number, number], nd: readonly [number, number, number],
): void {
  pushTriangle(positions, normals, a, b, c, na, nb, nc);
  pushTriangle(positions, normals, a, c, d, na, nc, nd);
}

/** Unit vector of an xyz triple. */
export function normalizeTuple(x: number, y: number, z: number): readonly [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}
