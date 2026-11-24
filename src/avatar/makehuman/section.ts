import { cross3t, normalize3t, type Vec3Tuple } from '@/base/math';

const MERGE = 1e-4;

const BAND = 0.05;

export interface SectionLoop {
  readonly points: Float32Array;
  readonly perimeter: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly centerX: number;
  readonly centerZ: number;
}

interface Plane {
  origin: Vec3Tuple;
  u: Vec3Tuple;
  v: Vec3Tuple;
  n: Vec3Tuple;
}

function key(x: number, z: number): number {
  return (Math.round(x / MERGE) + 4096) * 8192 + (Math.round(z / MERGE) + 4096);
}

export function sectionLoops(
  positions: Float32Array,
  indices: Uint32Array,
  y: number,
): SectionLoop[] {
  return sliceTriangles(positions, indices, horizontal(y), null);
}

export function planeLoops(
  positions: Float32Array,
  indices: Uint32Array,
  origin: Vec3Tuple,
  u: Vec3Tuple,
  v: Vec3Tuple,
): SectionLoop[] {
  const n = normalize3t(cross3t(u, v));
  return sliceTriangles(positions, indices, { origin, u, v, n }, null);
}

function horizontal(y: number): Plane {
  return { origin: [0, y, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] };
}

export class SectionIndex {
  private readonly positions: Float32Array;
  private readonly indices: Uint32Array;
  private readonly low: number;
  private readonly buckets: number[][];

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.positions = positions;
    this.indices = indices;
    const triangles = Math.floor(indices.length / 3);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      const y = positions[i]!;
      if (y < min) min = y;
      if (y > max) max = y;
    }

    this.low = min;
    const bands = Math.max(1, Math.ceil((max - min) / BAND) + 1);
    const buckets: number[][] = Array.from({ length: bands }, () => []);
    for (let t = 0; t < triangles; t++) {
      const a = indices[t * 3]! * 3 + 1;
      const b = indices[t * 3 + 1]! * 3 + 1;
      const c = indices[t * 3 + 2]! * 3 + 1;
      const ya = positions[a]!;
      const yb = positions[b]!;
      const yc = positions[c]!;
      const lo = Math.max(0, Math.floor((Math.min(ya, yb, yc) - min) / BAND));
      const hi = Math.min(bands - 1, Math.floor((Math.max(ya, yb, yc) - min) / BAND));
      for (let band = lo; band <= hi; band++) buckets[band]!.push(t);
    }

    this.buckets = buckets;
  }

  loops(y: number): SectionLoop[] {
    const band = Math.floor((y - this.low) / BAND);
    const bucket = this.buckets[band] ?? [];
    return sliceTriangles(this.positions, this.indices, horizontal(y), bucket);
  }
}

function planeDistance(plane: Plane, x: number, y: number, z: number): number {
  const { n, origin } = plane;
  return n[0] * (x - origin[0]) + n[1] * (y - origin[1]) + n[2] * (z - origin[2]);
}

function planeAxis(axis: Vec3Tuple, origin: Vec3Tuple, x: number, y: number, z: number): number {
  return axis[0] * (x - origin[0]) + axis[1] * (y - origin[1]) + axis[2] * (z - origin[2]);
}

function sliceTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  plane: Plane,
  triangles: readonly number[] | null,
): SectionLoop[] {
  const points: number[] = [];
  const pointKeys: number[] = [];
  const neighbors = new Map<number, number[]>();

  const emit = (x: number, y: number, z: number): number => {
    const id = pointKeys.length;
    const a = planeAxis(plane.u, plane.origin, x, y, z);
    const b = planeAxis(plane.v, plane.origin, x, y, z);
    points.push(a, b);
    pointKeys.push(key(a, b));
    return id;
  };
  const link = (a: number, b: number): void => {
    if (a === b) return;
    const ka = pointKeys[a]!;
    const kb = pointKeys[b]!;
    if (ka === kb) return;
    const listA = neighbors.get(ka);
    if (listA) listA.push(kb); else neighbors.set(ka, [kb]);
    const listB = neighbors.get(kb);
    if (listB) listB.push(ka); else neighbors.set(kb, [ka]);
  };

  const total = triangles ? triangles.length : Math.floor(indices.length / 3);
  for (let k = 0; k < total; k++) {
    const tri = (triangles ? triangles[k]! : k) * 3;
    const ia = indices[tri]! * 3;
    const ib = indices[tri + 1]! * 3;
    const ic = indices[tri + 2]! * 3;
    const ax = positions[ia]!, ay = positions[ia + 1]!, az = positions[ia + 2]!;
    const bx = positions[ib]!, by = positions[ib + 1]!, bz = positions[ib + 2]!;
    const cx = positions[ic]!, cy = positions[ic + 1]!, cz = positions[ic + 2]!;

    let first = -1;
    let second = -1;
    const sa = planeDistance(plane, ax, ay, az);
    const sb = planeDistance(plane, bx, by, bz);
    const sc = planeDistance(plane, cx, cy, cz);
    if ((sa < 0) !== (sb < 0)) {
      const k = sa / (sa - sb);
      first = emit(ax + (bx - ax) * k, ay + (by - ay) * k, az + (bz - az) * k);
    }

    if ((sb < 0) !== (sc < 0)) {
      const k = sb / (sb - sc);
      const id = emit(bx + (cx - bx) * k, by + (cy - by) * k, bz + (cz - bz) * k);
      if (first < 0) first = id; else second = id;
    }

    if ((sc < 0) !== (sa < 0)) {
      const k = sc / (sc - sa);
      const id = emit(cx + (ax - cx) * k, cy + (ay - cy) * k, cz + (az - cz) * k);
      if (first < 0) first = id; else second = id;
    }

    if (second >= 0) link(first, second);
  }

  const visited = new Set<number>();
  const loops: SectionLoop[] = [];
  for (const startKey of neighbors.keys()) {
    if (visited.has(startKey)) continue;
    visited.add(startKey);
    const keys: number[] = [startKey];
    let current = startKey;
    let previous = Number.NaN;
    for (;;) {
      const around = neighbors.get(current);
      if (!around) break;
      const next = around.find(k => k !== previous && !visited.has(k));
      if (next === undefined) break;
      visited.add(next);
      keys.push(next);
      previous = current;
      current = next;
    }

    if (keys.length < 3) continue;
    loops.push(loopFrom(keys, points, pointKeys));
  }

  loops.sort((a, b) => b.perimeter - a.perimeter);
  return loops;
}

function loopFrom(
  keys: number[],
  points: number[],
  pointKeys: number[],
): SectionLoop {
  const byKey = new Map<number, number>();
  for (let i = 0; i < pointKeys.length; i++) if (!byKey.has(pointKeys[i]!)) byKey.set(pointKeys[i]!, i);

  const coords = new Float32Array(keys.length * 2);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  keys.forEach((k, i) => {
    const id = byKey.get(k);
    const x = id === undefined ? 0 : points[id * 2]!;
    const z = id === undefined ? 0 : points[id * 2 + 1]!;
    coords[i * 2] = x;
    coords[i * 2 + 1] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  });
  let perimeter = 0;
  for (let i = 0; i < keys.length; i++) {
    const j = (i + 1) % keys.length;
    perimeter += Math.hypot(coords[i * 2]! - coords[j * 2]!, coords[i * 2 + 1]! - coords[j * 2 + 1]!);
  }

  return {
    points: coords,
    perimeter,
    minX, maxX, minZ, maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

export function torsoLoop(loops: readonly SectionLoop[]): SectionLoop | undefined {
  let best: SectionLoop | undefined;
  for (const loop of loops) {
    if (loop.minX > 0 || loop.maxX < 0) continue;
    if (!best || loop.perimeter > best.perimeter) best = loop;
  }

  return best;
}

export function limbLoop(loops: readonly SectionLoop[], x: number): SectionLoop | undefined {
  let best: SectionLoop | undefined;
  let bestDistance = Infinity;
  for (const loop of loops) {
    if (loop.minX < 0 && loop.maxX > 0) continue;
    const distance = Math.abs(loop.centerX - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = loop;
    }
  }

  return best;
}
