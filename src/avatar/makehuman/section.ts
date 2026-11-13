/**
 * Horizontal cross-sections of a closed triangle mesh, used to read the body's real girths and
 * half widths instead of approximating them from the requested measurements.
 */

/** One closed loop of a cross-section, projected onto the ground plane. */
export interface SectionLoop {
  /** Intersection points as x / z pairs, in order around the loop. */
  readonly points: Float32Array;
  readonly perimeter: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly centerX: number;
  readonly centerZ: number;
}

/** Quantization of the intersection points, in meters, so shared corners of two triangles match. */
const MERGE = 1e-4;

/** Rounds a point to the key shared by the triangles that meet along one edge. */
function key(x: number, z: number): number {
  return (Math.round(x / MERGE) + 4096) * 8192 + (Math.round(z / MERGE) + 4096);
}

/**
 * Loops of the mesh cut by the plane `y`, largest first. Each triangle crossing the plane yields
 * one segment; the segments are chained through the shared corner points into closed loops.
 */
export function sectionLoops(
  positions: Float32Array,
  indices: Uint32Array,
  y: number,
): SectionLoop[] {
  return sliceTriangles(positions, indices, y, null);
}

/** Height band of the slice buckets, in meters. */
const BAND = 0.05;

/**
 * Triangles of one mesh bucketed by height, so a cross-section only has to look at the triangles
 * it can actually cut. A body is sliced dozens of times per build, which makes this worth keeping
 * next to the deformed vertex buffer it was built for.
 */
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

  /** Loops of the mesh cut by the plane `y`, largest first. */
  loops(y: number): SectionLoop[] {
    const band = Math.floor((y - this.low) / BAND);
    const bucket = this.buckets[band] ?? [];
    return sliceTriangles(this.positions, this.indices, y, bucket);
  }
}

/** Segments the given triangles cut out of the plane `y` and chains them into loops. */
function sliceTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  y: number,
  triangles: readonly number[] | null,
): SectionLoop[] {
  const points: number[] = [];
  /** Key of each emitted point, parallel to `points` (two entries per point). */
  const pointKeys: number[] = [];
  const neighbors = new Map<number, number[]>();

  const emit = (x: number, z: number): number => {
    const id = pointKeys.length;
    points.push(x, z);
    pointKeys.push(key(x, z));
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
    // Half-open test: a corner exactly on the plane counts as above, so shared edges agree.
    if ((ay < y) !== (by < y)) {
      const k = (y - ay) / (by - ay);
      first = emit(ax + (bx - ax) * k, az + (bz - az) * k);
    }
    if ((by < y) !== (cy < y)) {
      const k = (y - by) / (cy - by);
      const id = emit(bx + (cx - bx) * k, bz + (cz - bz) * k);
      if (first < 0) first = id; else second = id;
    }
    if ((cy < y) !== (ay < y)) {
      const k = (y - cy) / (ay - cy);
      const id = emit(cx + (ax - cx) * k, cz + (az - cz) * k);
      if (first < 0) first = id; else second = id;
    }
    if (second >= 0) link(first, second);
  }

  // Walk the segment graph: every point belongs to exactly two segments of a watertight surface.
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

/** Turns a chain of point keys back into a polyline and measures its box and perimeter. */
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

/** The loop that wraps the torso at this height: the widest one spanning the body's midline. */
export function torsoLoop(loops: readonly SectionLoop[]): SectionLoop | undefined {
  let best: SectionLoop | undefined;
  for (const loop of loops) {
    if (loop.minX > 0 || loop.maxX < 0) continue;
    if (!best || loop.perimeter > best.perimeter) best = loop;
  }
  return best;
}

/** The loop centered nearest to `x`, used to read one arm or leg. */
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
