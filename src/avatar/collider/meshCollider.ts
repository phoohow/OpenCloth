/** Smallest and largest grid cell edge, in metres. */
const MIN_CELL = 0.015;
const MAX_CELL = 0.05;
/** Cell edge as a multiple of the mean triangle edge. */
const CELL_PER_EDGE = 3;
/** Triangles a single cell may hold before the grid is refined. */
const MAX_PER_CELL = 160;
/** Upper bound on grid cells: 1M cells is 4 MB per index array on the GPU and 12 MB while building. */
const MAX_CELLS = 1_000_000;
/** Clearance reported for points outside the search range, in metres. */
const FAR = 0.25;
/** Cell rings searched first; widened when the first search finds no triangle at all. */
const RINGS = 1;
const FALLBACK_RINGS = 3;

/**
 * Uniform triangle grid over the body mesh: every cell lists the triangles whose bounds
 * overlap it, so a nearest-surface query only visits a small neighbourhood.
 */
export interface MeshCollider {
  /** Minimum corner of the grid. */
  origin: [number, number, number];
  /** Cell edge in metres. */
  cell: number;
  /** Cell counts per axis. */
  dims: [number, number, number];
  /** Cell offsets into `cellTriangles`; one more entry than there are cells. */
  cellStart: Uint32Array;
  /** Triangle indices grouped by cell. */
  cellTriangles: Uint32Array;
  /** Triangle vertices, nine floats per triangle. */
  vertices: Float32Array;
  triangleCount: number;
}

/** Nearest surface point and the side the query point falls on. */
export interface MeshHit {
  point: [number, number, number];
  distance: number;
  /** +1 outside the surface, -1 inside, from the nearest triangle's winding. */
  side: number;
}

/** Scratch socket of the closest-point routine; the CPU pass calls it millions of times. */
const closestOut = new Float64Array(3);
/** Scratch cell range of one triangle; see `triangleCellRange`. */
const cellRange = new Int32Array(6);

/**
 * Closest point on a triangle to `p`, written into `out`. This is the reference for the `closestOnTriangle`
 * mirror in the collide shader; the fixture test pins its results so the two stay in step.
 */
export function closestPointOnTriangle(
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

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}

/** Cell edge that keeps a handful of triangles per cell, from the mean edge length. */
function meanEdgeCell(vertices: Float32Array, triangleCount: number): number {
  const stride = Math.max(1, Math.floor(triangleCount / 2000));
  let sum = 0;
  let edges = 0;
  for (let t = 0; t < triangleCount; t += stride) {
    const o = t * 9;
    const ax = vertices[o], ay = vertices[o + 1], az = vertices[o + 2];
    const bx = vertices[o + 3], by = vertices[o + 4], bz = vertices[o + 5];
    const cx = vertices[o + 6], cy = vertices[o + 7], cz = vertices[o + 8];
    sum += Math.hypot(bx - ax, by - ay, bz - az)
      + Math.hypot(cx - bx, cy - by, cz - bz)
      + Math.hypot(ax - cx, ay - cy, az - cz);
    edges += 3;
  }
  return edges > 0 ? (sum / edges) * CELL_PER_EDGE : MIN_CELL;
}

/** Inclusive cell range covered by a triangle's bounds, written into `cellRange`. */
function triangleCellRange(
  vertices: Float32Array,
  t: number,
  origin: [number, number, number],
  cell: number,
  dims: [number, number, number],
): void {
  const o = t * 9;
  for (let axis = 0; axis < 3; axis++) {
    const va = vertices[o + axis], vb = vertices[o + 3 + axis], vc = vertices[o + 6 + axis];
    const lo = Math.min(va, vb, vc);
    const hi = Math.max(va, vb, vc);
    const i0 = Math.floor((lo - origin[axis]) / cell);
    const i1 = Math.floor((hi - origin[axis]) / cell);
    cellRange[axis] = Math.max(0, i0);
    cellRange[3 + axis] = Math.min(dims[axis] - 1, i1);
  }
}

/** Grid with the densest cell, so the caller can refine or accept it. */
interface BuiltGrid extends MeshCollider {
  maxPerCell: number;
}

/** Buckets triangles into the grid at one cell size; null when the grid would exceed its cell budget. */
function buildGrid(
  vertices: Float32Array,
  triangleCount: number,
  min: [number, number, number],
  max: [number, number, number],
  cell: number,
): BuiltGrid | null {
  const origin: [number, number, number] = [min[0] - cell, min[1] - cell, min[2] - cell];
  const dims: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    dims[axis] = Math.max(1, Math.ceil((max[axis] - origin[axis]) / cell) + 1);
  }
  const cells = dims[0] * dims[1] * dims[2];
  if (cells > MAX_CELLS) return null;

  const counts = new Uint32Array(cells);
  for (let t = 0; t < triangleCount; t++) {
    triangleCellRange(vertices, t, origin, cell, dims);
    for (let iz = cellRange[2]; iz <= cellRange[5]; iz++) {
      for (let iy = cellRange[1]; iy <= cellRange[4]; iy++) {
        const row = (iz * dims[1] + iy) * dims[0];
        for (let ix = cellRange[0]; ix <= cellRange[3]; ix++) counts[row + ix]++;
      }
    }
  }

  let maxPerCell = 0;
  const cellStart = new Uint32Array(cells + 1);
  for (let c = 0; c < cells; c++) {
    if (counts[c] > maxPerCell) maxPerCell = counts[c];
    cellStart[c + 1] = cellStart[c] + counts[c];
  }

  const cursor = cellStart.slice(0, cells);
  const cellTriangles = new Uint32Array(cellStart[cells]);
  for (let t = 0; t < triangleCount; t++) {
    triangleCellRange(vertices, t, origin, cell, dims);
    for (let iz = cellRange[2]; iz <= cellRange[5]; iz++) {
      for (let iy = cellRange[1]; iy <= cellRange[4]; iy++) {
        const row = (iz * dims[1] + iy) * dims[0];
        for (let ix = cellRange[0]; ix <= cellRange[3]; ix++) {
          cellTriangles[cursor[row + ix]++] = t;
        }
      }
    }
  }

  return { origin, cell, dims, cellStart, cellTriangles, vertices, triangleCount, maxPerCell };
}

/** Grid layout of a collider, kept so a moved body can be re-bucketed into the same cells. */
export interface MeshGridSpec {
  origin: [number, number, number];
  cell: number;
  dims: [number, number, number];
}

/** Indexes flat triangle vertices (nine floats per triangle) into a uniform grid. */
export function buildMeshCollider(vertices: Float32Array, cell?: number, margin = 0): MeshCollider | null {
  const triangleCount = Math.floor(vertices.length / 9);
  if (triangleCount === 0) return null;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangleCount * 9; i++) {
    const axis = i % 3;
    const v = vertices[i];
    if (!Number.isFinite(v)) continue;
    if (v < min[axis]) min[axis] = v;
    if (v > max[axis]) max[axis] = v;
  }
  if (!Number.isFinite(min[0]) || min[0] > max[0]) return null;
  for (let axis = 0; axis < 3; axis++) {
    min[axis] -= margin;
    max[axis] += margin;
  }

  const trimmed = vertices.length === triangleCount * 9 ? vertices : vertices.slice(0, triangleCount * 9);
  let edge = cell ?? meanEdgeCell(trimmed, triangleCount);
  edge = Math.min(MAX_CELL, Math.max(MIN_CELL, edge));

  // Coarsen until the grid fits its cell budget, then refine until cells stay sparse.
  for (let attempt = 0; attempt < 8; attempt++) {
    const built = buildGrid(trimmed, triangleCount, min, max, edge);
    if (!built) {
      edge *= 1.3;
      continue;
    }
    if (built.maxPerCell <= MAX_PER_CELL || attempt >= 4) {
      const { maxPerCell: _densest, ...collider } = built;
      return collider;
    }
    edge *= 0.7;
  }
  return null;
}

/** Re-buckets moved triangles into an existing grid; null when the spec is empty. */
export function reindexMeshCollider(vertices: Float32Array, spec: MeshGridSpec): MeshCollider | null {
  const triangleCount = Math.floor(vertices.length / 9);
  if (triangleCount === 0) return null;
  const { origin, cell, dims } = spec;
  const cells = dims[0] * dims[1] * dims[2];
  if (cells <= 0 || cells > MAX_CELLS) return null;

  const counts = new Uint32Array(cells);
  for (let t = 0; t < triangleCount; t++) {
    triangleCellRange(vertices, t, origin, cell, dims);
    for (let iz = cellRange[2]; iz <= cellRange[5]; iz++) {
      for (let iy = cellRange[1]; iy <= cellRange[4]; iy++) {
        const row = (iz * dims[1] + iy) * dims[0];
        for (let ix = cellRange[0]; ix <= cellRange[3]; ix++) counts[row + ix]++;
      }
    }
  }

  const cellStart = new Uint32Array(cells + 1);
  for (let c = 0; c < cells; c++) cellStart[c + 1] = cellStart[c] + counts[c];
  const cursor = cellStart.slice(0, cells);
  const cellTriangles = new Uint32Array(cellStart[cells]);
  for (let t = 0; t < triangleCount; t++) {
    triangleCellRange(vertices, t, origin, cell, dims);
    for (let iz = cellRange[2]; iz <= cellRange[5]; iz++) {
      for (let iy = cellRange[1]; iy <= cellRange[4]; iy++) {
        const row = (iz * dims[1] + iy) * dims[0];
        for (let ix = cellRange[0]; ix <= cellRange[3]; ix++) {
          cellTriangles[cursor[row + ix]++] = t;
        }
      }
    }
  }

  return { origin, cell, dims, cellStart, cellTriangles, vertices, triangleCount };
}

/**
 * Nearest body surface point to `p`, searched over a (2*rings+1)³ block of cells.
 * A hit is guaranteed for every surface point within `rings * cell` of `p`.
 */
export function nearestMeshPoint(
  collider: MeshCollider,
  px: number, py: number, pz: number,
  rings = RINGS,
): MeshHit | null {
  const { origin, cell, dims, cellStart, cellTriangles, vertices } = collider;
  const baseX = Math.floor((px - origin[0]) / cell);
  const baseY = Math.floor((py - origin[1]) / cell);
  const baseZ = Math.floor((pz - origin[2]) / cell);

  let bestDist = Infinity;
  let bestX = 0, bestY = 0, bestZ = 0;
  let bestTriangle = -1;

  for (let oz = -rings; oz <= rings; oz++) {
    const iz = baseZ + oz;
    if (iz < 0 || iz >= dims[2]) continue;
    for (let oy = -rings; oy <= rings; oy++) {
      const iy = baseY + oy;
      if (iy < 0 || iy >= dims[1]) continue;
      const row = (iz * dims[1] + iy) * dims[0];
      for (let ox = -rings; ox <= rings; ox++) {
        const ix = baseX + ox;
        if (ix < 0 || ix >= dims[0]) continue;
        const c = row + ix;
        const end = cellStart[c + 1];
        for (let k = cellStart[c]; k < end; k++) {
          const t = cellTriangles[k];
          const o = t * 9;
          closestPointOnTriangle(
            px, py, pz,
            vertices[o], vertices[o + 1], vertices[o + 2],
            vertices[o + 3], vertices[o + 4], vertices[o + 5],
            vertices[o + 6], vertices[o + 7], vertices[o + 8],
            closestOut,
          );
          const dx = px - closestOut[0], dy = py - closestOut[1], dz = pz - closestOut[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestDist) {
            bestDist = d2;
            bestX = closestOut[0]; bestY = closestOut[1]; bestZ = closestOut[2];
            bestTriangle = t;
          }
        }
      }
    }
  }

  if (bestTriangle < 0) return null;
  const o = bestTriangle * 9;
  const abx = vertices[o + 3] - vertices[o], aby = vertices[o + 4] - vertices[o + 1], abz = vertices[o + 5] - vertices[o + 2];
  const acx = vertices[o + 6] - vertices[o], acy = vertices[o + 7] - vertices[o + 1], acz = vertices[o + 8] - vertices[o + 2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const side = (px - bestX) * nx + (py - bestY) * ny + (pz - bestZ) * nz >= 0 ? 1 : -1;
  return { point: [bestX, bestY, bestZ], distance: Math.sqrt(bestDist), side };
}

/**
 * Signed distance to the body surface, negative inside; points beyond the searched range read as
 * `FAR`. The rings mirror the collide pass so the fit heatmap measures the surface collision sees.
 */
export function sampleMeshCollider(collider: MeshCollider, px: number, py: number, pz: number): number {
  const hit = nearestMeshPoint(collider, px, py, pz, RINGS) ?? nearestMeshPoint(collider, px, py, pz, FALLBACK_RINGS);
  if (!hit) return FAR;
  return hit.side > 0 ? hit.distance : -hit.distance;
}
