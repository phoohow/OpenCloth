import type { Object3D } from 'three/webgpu';
import type { AvatarCollider, Capsule } from '@/avatar/collider/types';

/** Minimal structural view of a mesh; keeps capsule fitting free of runtime THREE use. */
interface MeshLike {
  isMesh?: boolean;
  geometry?: {
    attributes?: Record<string, { array: ArrayLike<number>; count: number } | undefined>;
    index?: { count: number; getX(i: number): number } | null;
  };
}

/** Inclusive voxel-index bounds of a greedily merged cell region. */
interface CellBox {
  ix0: number; ix1: number;
  iy0: number; iy1: number;
  iz0: number; iz1: number;
}

// Voxel indices are clamped to +/-4095 so index-packed keys stay exact doubles.
const CELL_LIMIT = 4095;
const CELL_SPAN = (CELL_LIMIT + 1) * 2;

function encodeCol(ix: number, iz: number): number {
  return (ix + CELL_LIMIT + 1) * CELL_SPAN + (iz + CELL_LIMIT + 1);
}

function decodeCol(key: number): [number, number] {
  const ix = Math.floor(key / CELL_SPAN) - CELL_LIMIT - 1;
  const iz = (key % CELL_SPAN) - CELL_LIMIT - 1;
  return [ix, iz];
}

function encodeCell(ix: number, iy: number, iz: number): number {
  return encodeCol(ix, iz) * CELL_SPAN + (iy + CELL_LIMIT + 1);
}

function decodeCell(key: number): [number, number, number] {
  const iy = (key % CELL_SPAN) - CELL_LIMIT - 1;
  const [ix, iz] = decodeCol(Math.floor(key / CELL_SPAN));
  return [ix, iy, iz];
}

function boxCellCount(b: CellBox): number {
  return (b.ix1 - b.ix0 + 1) * (b.iy1 - b.iy0 + 1) * (b.iz1 - b.iz0 + 1);
}

/** Fits one capsule to a merged box: principal axis from covariance power iteration, radius from the enclosing sweep. */
function boxToCapsule(b: CellBox, voxel: number): Capsule {
  const x0 = b.ix0 * voxel, x1 = (b.ix1 + 1) * voxel;
  const y0 = b.iy0 * voxel, y1 = (b.iy1 + 1) * voxel;
  const z0 = b.iz0 * voxel, z1 = (b.iz1 + 1) * voxel;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;

  const corners: number[][] = [];
  for (const sx of [x0, x1]) for (const sy of [y0, y1]) for (const sz of [z0, z1]) {
    corners.push([sx - cx, sy - cy, sz - cz]);
  }

  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (const p of corners) {
    cxx += p[0] * p[0]; cyy += p[1] * p[1]; czz += p[2] * p[2];
    cxy += p[0] * p[1]; cxz += p[0] * p[2]; cyz += p[1] * p[2];
  }

  // Power iteration on the 3x3 covariance for the dominant direction.
  let v: [number, number, number] = [0, 1, 0];
  for (let it = 0; it < 12; it++) {
    const nv: [number, number, number] = [
      cxx * v[0] + cxy * v[1] + cxz * v[2],
      cxy * v[0] + cyy * v[1] + cyz * v[2],
      cxz * v[0] + cyz * v[1] + czz * v[2],
    ];
    const len = Math.hypot(nv[0], nv[1], nv[2]);
    if (len < 1e-12) break;
    v = [nv[0] / len, nv[1] / len, nv[2] / len];
  }

  const alongs: number[] = [];
  const perps: number[] = [];
  let maxAlong = 0;
  for (const p of corners) {
    const a = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
    const ox = p[0] - a * v[0], oy = p[1] - a * v[1], oz = p[2] - a * v[2];
    alongs.push(Math.abs(a));
    perps.push(Math.hypot(ox, oy, oz));
    if (alongs[alongs.length - 1] > maxAlong) maxAlong = alongs[alongs.length - 1];
  }

  // Sweep the segment half-length; a light length penalty prefers slender capsules.
  const steps = 10;
  let bestL = 0, bestScore = Infinity;
  for (let s = 0; s <= steps; s++) {
    const L = (maxAlong * s) / steps;
    let r = 0;
    for (let i = 0; i < corners.length; i++) {
      const d = Math.hypot(perps[i], Math.max(0, alongs[i] - L));
      if (d > r) r = d;
    }
    const score = r + 0.1 * L;
    if (score < bestScore) { bestScore = score; bestL = L; }
  }
  let rEnd = 0;
  for (let i = 0; i < corners.length; i++) {
    const d = Math.hypot(perps[i], Math.max(0, alongs[i] - bestL));
    if (d > rEnd) rEnd = d;
  }

  // Shrink the radius so simulated fabric is not inflated by the voxel slack.
  return {
    ax: cx - v[0] * bestL, ay: cy - v[1] * bestL, az: cz - v[2] * bestL,
    bx: cx + v[0] * bestL, by: cy + v[1] * bestL, bz: cz + v[2] * bestL,
    radius: Math.max(rEnd * 0.92, 0.004),
  };
}

/**
 * Fits a collision capsule set to a static-pose imported model: world-space mesh
 * vertices are voxelized, merged into boxes (vertical runs per column, then
 * adjacent columns with equal spans) and each box becomes one capsule.
 */
export function fitCapsulesFromGroup(
  root: Object3D,
  opts?: { maxCapsules?: number; voxel?: number },
): AvatarCollider {
  const maxCapsules = opts?.maxCapsules ?? 300;
  const voxel = opts?.voxel ?? 0.03;
  const pad = 0.1;
  root.updateMatrixWorld(true);

  const cells = new Set<number>();
  const toWorld = (e: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] => [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];
  const pushCell = (wx: number, wy: number, wz: number) => {
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) return;
    const ix = Math.floor(wx / voxel), iy = Math.floor(wy / voxel), iz = Math.floor(wz / voxel);
    if (Math.abs(ix) > CELL_LIMIT || Math.abs(iy) > CELL_LIMIT || Math.abs(iz) > CELL_LIMIT) return;
    cells.add(encodeCell(ix, iy, iz));
  };
  root.traverse((obj) => {
    const mesh = obj as unknown as MeshLike;
    if (!mesh.isMesh) return;
    const attr = mesh.geometry?.attributes?.position;
    if (!attr) return;
    const e = obj.matrixWorld.elements;
    const arr = attr.array;
    for (let i = 0; i < attr.count; i++) {
      pushCell(...toWorld(e, arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]));
    }
    // Walk triangle edges at half-voxel spacing so sparse vertex rings still fill the surface.
    const index = mesh.geometry?.index;
    const vertCount = index ? index.count : attr.count - (attr.count % 3);
    const vtx = (t: number): [number, number, number] => {
      const vi = index ? index.getX(t) : t;
      return toWorld(e, arr[vi * 3], arr[vi * 3 + 1], arr[vi * 3 + 2]);
    };
    for (let t = 0; t + 2 < vertCount; t += 3) {
      const p0 = vtx(t), p1 = vtx(t + 1), p2 = vtx(t + 2);
      const edges: [[number, number, number], [number, number, number]][] = [[p0, p1], [p1, p2], [p2, p0]];
      for (const [s, d] of edges) {
        const dx = d[0] - s[0], dy = d[1] - s[1], dz = d[2] - s[2];
        const steps = Math.min(16, Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / (voxel * 0.5))));
        for (let k = 0; k <= steps; k++) {
          const f = k / steps;
          pushCell(s[0] + dx * f, s[1] + dy * f, s[2] + dz * f);
        }
      }
    }
  });

  // Vertical runs per column, bucketed by exact (iy0, iy1) span.
  const colIys = new Map<number, Set<number>>();
  for (const k of cells) {
    const [ix, iy, iz] = decodeCell(k);
    const ck = encodeCol(ix, iz);
    let s = colIys.get(ck);
    if (!s) { s = new Set<number>(); colIys.set(ck, s); }
    s.add(iy);
  }
  const spanCols = new Map<number, Set<number>>();
  for (const [ck, iys] of colIys) {
    const sorted = [...iys].sort((a, b) => a - b);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      const spanKey = (sorted[i] + CELL_LIMIT + 1) * CELL_SPAN + (sorted[j] + CELL_LIMIT + 1);
      let set = spanCols.get(spanKey);
      if (!set) { set = new Set<number>(); spanCols.set(spanKey, set); }
      set.add(ck);
      i = j + 1;
    }
  }

  // Greedy rectangle merging of equal-span columns into boxes.
  const boxes: CellBox[] = [];
  for (const [spanKey, cols] of spanCols) {
    const iy0 = Math.floor(spanKey / CELL_SPAN) - CELL_LIMIT - 1;
    const iy1 = (spanKey % CELL_SPAN) - CELL_LIMIT - 1;
    const visited = new Set<number>();
    for (const ck0 of [...cols].sort((a, b) => a - b)) {
      if (visited.has(ck0)) continue;
      const [ix, iz] = decodeCol(ck0);
      let iz1 = iz;
      while (!visited.has(encodeCol(ix, iz1 + 1)) && cols.has(encodeCol(ix, iz1 + 1))) iz1++;
      let ix1 = ix;
      for (; ;) {
        let ok = true;
        for (let z = iz; z <= iz1; z++) {
          const nk = encodeCol(ix1 + 1, z);
          if (!cols.has(nk) || visited.has(nk)) { ok = false; break; }
        }
        if (!ok) break;
        ix1++;
      }
      for (let x = ix; x <= ix1; x++) for (let z = iz; z <= iz1; z++) visited.add(encodeCol(x, z));
      boxes.push({ ix0: ix, ix1, iy0, iy1, iz0: iz, iz1 });
    }
  }

  // Enforce the capsule budget by merging the smallest box into its nearest neighbor.
  while (boxes.length > maxCapsules) {
    let minIdx = 0;
    for (let i = 1; i < boxes.length; i++) {
      if (boxCellCount(boxes[i]) < boxCellCount(boxes[minIdx])) minIdx = i;
    }
    const b = boxes[minIdx];
    const bcx = (b.ix0 + b.ix1) / 2, bcy = (b.iy0 + b.iy1) / 2, bcz = (b.iz0 + b.iz1) / 2;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      if (i === minIdx) continue;
      const o = boxes[i];
      const d = ((o.ix0 + o.ix1) / 2 - bcx) ** 2 + ((o.iy0 + o.iy1) / 2 - bcy) ** 2 + ((o.iz0 + o.iz1) / 2 - bcz) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const o = boxes[best];
    o.ix0 = Math.min(o.ix0, b.ix0); o.ix1 = Math.max(o.ix1, b.ix1);
    o.iy0 = Math.min(o.iy0, b.iy0); o.iy1 = Math.max(o.iy1, b.iy1);
    o.iz0 = Math.min(o.iz0, b.iz0); o.iz1 = Math.max(o.iz1, b.iz1);
    boxes.splice(minIdx, 1);
  }

  const bounds = {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };
  if (boxes.length === 0) {
    bounds.min = [-pad, -pad, -pad];
    bounds.max = [pad, pad, pad];
    return { capsules: [], bounds };
  }
  for (const b of boxes) {
    bounds.min[0] = Math.min(bounds.min[0], b.ix0 * voxel);
    bounds.min[1] = Math.min(bounds.min[1], b.iy0 * voxel);
    bounds.min[2] = Math.min(bounds.min[2], b.iz0 * voxel);
    bounds.max[0] = Math.max(bounds.max[0], (b.ix1 + 1) * voxel);
    bounds.max[1] = Math.max(bounds.max[1], (b.iy1 + 1) * voxel);
    bounds.max[2] = Math.max(bounds.max[2], (b.iz1 + 1) * voxel);
  }
  bounds.min = [bounds.min[0] - pad, bounds.min[1] - pad, bounds.min[2] - pad];
  bounds.max = [bounds.max[0] + pad, bounds.max[1] + pad, bounds.max[2] + pad];

  return { capsules: boxes.map(b => boxToCapsule(b, voxel)), bounds };
}
