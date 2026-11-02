import earcut from 'earcut';
import type { Vec2 } from '../../core/model/types';
import { distance } from '../geom/vec2';

/** Triangles over a flat [x, y, ...] polygon-space vertex buffer. */
export interface TriangleMesh {
  /** Vertices as a flat array [x0, y0, x1, y1, ...] */
  positions: Float32Array;
  /** Triangle vertex indices */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Triangulates a closed polygon with optional holes via ear clipping. */
export function triangulatePolygon(outline: Vec2[], holes: Vec2[][] = []): TriangleMesh {
  const flat: number[] = [];
  const holeIndices: number[] = [];

  for (const p of outline) flat.push(p.x, p.y);
  for (const hole of holes) {
    holeIndices.push(flat.length / 2);
    for (const p of hole) flat.push(p.x, p.y);
  }

  const indices = earcut(flat, holeIndices.length ? holeIndices : undefined, 2);
  const positions = new Float32Array(flat);

  return {
    positions,
    indices: new Uint32Array(indices),
    vertexCount: flat.length / 2,
    triangleCount: indices.length / 3,
  };
}

/** Edge length above this multiple of the target that triggers a midpoint split. */
const SPLIT_RATIO = 1.4;

/** Smoothing passes that even out triangle shapes after refinement. */
const RELAX_PASSES = 8;

/** Delaunay legalization passes interleaved with smoothing. */
const FLIP_PASSES = 2;

/** Share of the way an interior vertex moves toward its neighbour centroid per pass. */
const RELAX_FACTOR = 0.55;

/**
 * Conforming isotropic refinement: every edge longer than `targetEdgeLength * 1.4` is split at
 * its midpoint. Splits are decided per edge and shared by both triangles, so the mesh stays
 * crack-free under 3D deformation. A Delaunay flip pass runs first each round, which removes the
 * thin ears ear clipping leaves along straight edges; the long diagonals a flip introduces are
 * split in the same or the next round. Interior vertices are then relaxed toward the neighbour
 * centroid and flipped once more, which makes the triangles regular instead of merely small.
 */
export function refineMesh(
  mesh: TriangleMesh,
  targetEdgeLength: number,
  maxIterations = 24,
): TriangleMesh {
  const positions = Array.from(mesh.positions);
  let indices = Array.from(mesh.indices);
  const splitThreshold = targetEdgeLength * SPLIT_RATIO;

  // One cache for all passes: a split edge keeps the same midpoint vertex forever.
  const midpointCache = new Map<string, number>();

  const getPos = (idx: number): Vec2 => ({ x: positions[idx * 2], y: positions[idx * 2 + 1] });

  const getMidpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const pa = getPos(a), pb = getPos(b);
    positions.push((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    const mid = positions.length / 2 - 1;
    midpointCache.set(key, mid);
    return mid;
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    delaunayPass(positions, indices, splitThreshold);
    const splitEdges = collectSplitEdges(indices, getPos, splitThreshold);
    if (splitEdges.size === 0) break;

    const newIndices: number[] = [];

    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const splitAB = splitEdges.has(edgeKey(a, b));
      const splitBC = splitEdges.has(edgeKey(b, c));
      const splitCA = splitEdges.has(edgeKey(c, a));

      if (!splitAB && !splitBC && !splitCA) {
        newIndices.push(a, b, c);
        continue;
      }

      const mAB = splitAB ? getMidpoint(a, b) : -1;
      const mBC = splitBC ? getMidpoint(b, c) : -1;
      const mCA = splitCA ? getMidpoint(c, a) : -1;
      const count = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0);

      if (count === 1) {
        // One split edge: bisect into two triangles.
        if (splitAB) newIndices.push(a, mAB, c, mAB, b, c);
        else if (splitBC) newIndices.push(b, mBC, a, mBC, c, a);
        else newIndices.push(c, mCA, b, mCA, a, b);
      } else if (count === 2) {
        // Two split edges: corner triangle at the shared vertex plus two others.
        if (splitAB && splitBC) {
          newIndices.push(a, mAB, c, mAB, b, mBC, mAB, mBC, c);
        } else if (splitBC && splitCA) {
          newIndices.push(b, mBC, a, mBC, c, mCA, mBC, mCA, a);
        } else {
          newIndices.push(c, mCA, b, mCA, a, mAB, mCA, mAB, b);
        }
      } else {
        // All three split: red refinement into four congruent triangles.
        newIndices.push(a, mAB, mCA, mAB, b, mBC, mCA, mBC, c, mAB, mBC, mCA);
      }
    }

    indices = newIndices;
  }

  // Alternate smoothing with legalization so the thin strips ear clipping leaves dissolve.
  for (let round = 0; round < FLIP_PASSES + 1; round++) {
    relaxInterior(positions, indices);
    for (let pass = 0; pass < FLIP_PASSES; pass++) delaunayPass(positions, indices, splitThreshold);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 2,
    triangleCount: indices.length / 3,
  };
}

/** Interior angle below which an outline vertex counts as a corner and keeps its exact position. */
const CORNER_ANGLE_RAD = (50 * Math.PI) / 180;

/**
 * Resamples a closed outline to a near-uniform vertex spacing. Sharp corners keep their original
 * position, so a panel's silhouette survives the resampling and ear clipping sees boundary
 * vertices of one size instead of a dense curve next to a coarse straight edge.
 */
export function resampleClosedOutline(points: Vec2[], spacing: number): Vec2[] {
  const n = points.length;
  if (!(spacing > 0) || n < 4) return points.slice();

  const corners: number[] = [];
  for (let i = 0; i < n; i++) if (outlineTurn(points, i) > CORNER_ANGLE_RAD) corners.push(i);

  if (corners.length <= 1) {
    const start = corners[0] ?? 0;
    const chain: Vec2[] = [];
    for (let k = 0; k <= n; k++) chain.push(points[(start + k) % n]!);
    const out = resampleChain(chain, spacing);
    out.pop();
    return out.length >= 3 ? out : points.slice();
  }

  const out: Vec2[] = [];
  for (let c = 0; c < corners.length; c++) {
    const start = corners[c]!;
    const end = corners[(c + 1) % corners.length]!;
    const chain: Vec2[] = [];
    let i = start;
    chain.push(points[i]!);
    while (i !== end) {
      i = (i + 1) % n;
      chain.push(points[i]!);
    }
    const run = resampleChain(chain, spacing);
    // The run ends on the next chain's corner, which that chain starts from.
    if (out.length > 0) run.shift();
    out.push(...run);
  }
  // The last chain closes back onto the first corner.
  const first = out[0], last = out[out.length - 1];
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) out.pop();
  return out.length >= 3 ? out : points.slice();
}

/** Turn between the incoming and outgoing segment at an outline vertex, in radians. */
function outlineTurn(points: Vec2[], i: number): number {
  const n = points.length;
  const prev = points[(i - 1 + n) % n]!;
  const cur = points[i]!;
  const next = points[(i + 1) % n]!;
  const ax = cur.x - prev.x, ay = cur.y - prev.y;
  const bx = next.x - cur.x, by = next.y - cur.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return Math.PI;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
  return Math.acos(cos);
}

/** Resamples one open chain at `spacing`, keeping both of its endpoints. */
function resampleChain(chain: Vec2[], spacing: number): Vec2[] {
  if (chain.length <= 2) return chain.slice();
  const out: Vec2[] = [chain[0]!];
  let arc = 0;
  let next = spacing;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1]!, b = chain[i]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-9)) continue;
    const end = arc + len;
    while (next < end) {
      const t = (next - arc) / len;
      out.push({ x: a.x + dx * t, y: a.y + dy * t });
      next += spacing;
    }
    arc = end;
  }
  const last = chain[chain.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-9) out.push({ ...last });
  return out;
}

/** Unordered key of an edge, so both triangles sharing it produce the same key. */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Edges the next refinement round splits: the longest edge of every triangle that still has one
 * above the split threshold. Splitting one edge per triangle per round keeps the mesh count
 * close to the area the panel needs, instead of quadrupling every triangle as a whole-mesh
 * red refinement does. The set is built over the whole mesh, so the two triangles sharing an
 * edge both split it and no T-junction is left behind.
 */
function collectSplitEdges(
  indices: number[],
  getPos: (index: number) => Vec2,
  splitThreshold: number,
): Set<string> {
  const splitEdges = new Set<string>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const pa = getPos(a), pb = getPos(b), pc = getPos(c);
    const ab = distance(pa, pb), bc = distance(pb, pc), ca = distance(pc, pa);
    const longest = Math.max(ab, bc, ca);
    if (longest <= splitThreshold) continue;
    if (ab === longest) splitEdges.add(edgeKey(a, b));
    else if (bc === longest) splitEdges.add(edgeKey(b, c));
    else splitEdges.add(edgeKey(c, a));
  }
  return splitEdges;
}

/**
 * Moves every interior mesh vertex toward the centroid of its neighbours, which turns the
 * uneven triangles refinement leaves behind into regular ones. A move is kept only while all
 * triangles around the vertex stay valid, so the relaxation never folds the mesh.
 */
function relaxInterior(positions: number[], indices: number[]): void {
  if (indices.length === 0) return;
  const count = positions.length / 2;
  const neighbors: number[][] = Array.from({ length: count }, () => []);
  const incident: number[][] = Array.from({ length: count }, () => []);
  const useCount = new Map<string, number>();

  for (let t = 0; t < indices.length; t += 3) {
    const tri = t / 3;
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)];
      const key = edgeKey(a, b);
      useCount.set(key, (useCount.get(key) ?? 0) + 1);
      incident[a]!.push(tri);
      incident[b]!.push(tri);
      neighbors[a]!.push(b);
      neighbors[b]!.push(a);
    }
  }

  const boundary = new Set<number>();
  const seen = new Set<string>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)];
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      if (useCount.get(key) === 1) {
        boundary.add(a);
        boundary.add(b);
      }
    }
  }

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let v = 0; v < count; v++) {
      const around = neighbors[v]!;
      if (boundary.has(v) || around.length < 3) continue;
      let cx = 0;
      let cy = 0;
      for (const u of around) {
        cx += positions[u * 2]!;
        cy += positions[u * 2 + 1]!;
      }
      cx /= around.length;
      cy /= around.length;
      const px = positions[v * 2]!, py = positions[v * 2 + 1]!;
      const qx = px + (cx - px) * RELAX_FACTOR;
      const qy = py + (cy - py) * RELAX_FACTOR;
      if (keepsTriangles(positions, indices, incident[v]!, v, qx, qy)) {
        positions[v * 2] = qx;
        positions[v * 2 + 1] = qy;
      }
    }
  }
}

/** True when moving vertex `v` to (qx, qy) leaves every incident triangle properly shaped. */
function keepsTriangles(
  positions: number[], indices: number[], incident: number[], v: number, qx: number, qy: number,
): boolean {
  for (const tri of incident) {
    const base = tri * 3;
    const a = indices[base]!, b = indices[base + 1]!, c = indices[base + 2]!;
    const before = triArea(positions, a, b, c, -1, 0, 0);
    const after = triArea(positions, a, b, c, v, qx, qy);
    if (Math.abs(after) < Math.abs(before) * 0.4) return false;
    if (before !== 0 && Math.sign(after) !== Math.sign(before)) return false;
  }
  return true;
}

/** Signed area of triangle `a, b, c`, with vertex `swap` read from (sx, sy) instead. */
function triArea(
  positions: number[], a: number, b: number, c: number, swap: number, sx: number, sy: number,
): number {
  const px = (i: number): number => (i === swap ? sx : positions[i * 2]!);
  const py = (i: number): number => (i === swap ? sy : positions[i * 2 + 1]!);
  return (px(b) - px(a)) * (py(c) - py(a)) - (py(b) - py(a)) * (px(c) - px(a));
}

/** Angle at `at` between the rays to `first` and `second`, in radians. */
function cornerAngle(at: Vec2, first: Vec2, second: Vec2): number {
  const ux = first.x - at.x, uy = first.y - at.y;
  const vx = second.x - at.x, vy = second.y - at.y;
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (lu < 1e-12 || lv < 1e-12) return Math.PI;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (lu * lv)));
  return Math.acos(cos);
}

/** Signed area of the triangle `o`, `a`, `b`; positive when counter-clockwise. */
function turn(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Flips the shared diagonal of two triangles while the quadrilateral is non-Delaunay, which
 * maximizes the smallest angle. Each triangle takes at most one flip per pass. A flip whose new
 * diagonal is longer than `maxDiagonal` is skipped: refinement would split it straight away and
 * the split would only add triangles without making them rounder.
 */
function delaunayPass(positions: number[], indices: number[], maxDiagonal = Infinity): void {
  const vertex = (i: number): Vec2 => ({ x: positions[i * 2], y: positions[i * 2 + 1] });
  const edges = new Map<string, Array<{ tri: number; opposite: number }>>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)], opposite = indices[t + ((e + 2) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const list = edges.get(key);
      if (list) list.push({ tri: t / 3, opposite });
      else edges.set(key, [{ tri: t / 3, opposite }]);
    }
  }

  const locked = new Set<number>();
  for (const [key, list] of edges) {
    if (list.length !== 2) continue;
    const first = list[0]!, second = list[1]!;
    if (locked.has(first.tri) || locked.has(second.tri)) continue;
    const [a, b] = key.split('_').map(Number) as [number, number];
    const c = first.opposite, d = second.opposite;
    if (c === d) continue;

    const pa = vertex(a), pb = vertex(b), pc = vertex(c), pd = vertex(d);
    if (distance(pc, pd) > maxDiagonal) continue;
    // Convex quadrilateral: the two corners sit on opposite sides of the other diagonal.
    if ((turn(pc, pd, pa) > 0) === (turn(pc, pd, pb) > 0)) continue;
    // The diagonal is Delaunay once the opposite angles add up to less than a straight angle.
    if (cornerAngle(pc, pa, pb) + cornerAngle(pd, pa, pb) <= Math.PI + 1e-9) continue;

    const firstArea = turn(pa, pc, pd);
    const secondArea = turn(pb, pc, pd);
    if (Math.abs(firstArea) < 1e-12 || Math.abs(secondArea) < 1e-12) continue;

    const t1 = first.tri * 3, t2 = second.tri * 3;
    indices[t1] = a;
    indices[t1 + 1] = firstArea > 0 ? c : d;
    indices[t1 + 2] = firstArea > 0 ? d : c;
    indices[t2] = b;
    indices[t2 + 1] = secondArea > 0 ? c : d;
    indices[t2 + 2] = secondArea > 0 ? d : c;
    locked.add(first.tri);
    locked.add(second.tri);
  }
}

/** Extracts edges that belong to only one triangle. */
export function extractBoundaryEdges(mesh: TriangleMesh): Array<[number, number]> {
  const edgeCount = new Map<string, number>();
  const edges: Array<[number, number]> = [];

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of edgeCount) {
    if (count === 1) {
      const [a, b] = key.split('_').map(Number);
      edges.push([a, b]);
    }
  }
  return edges;
}

/** Pairs of triangles that share an edge. */
export function buildAdjacency(mesh: TriangleMesh): Array<[number, number]> {
  const edgeToTri = new Map<string, number>();
  const pairs: Array<[number, number]> = [];

  for (let t = 0; t < mesh.triangleCount; t++) {
    const tri = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const existing = edgeToTri.get(key);
      if (existing !== undefined) {
        pairs.push([existing, t]);
      } else {
        edgeToTri.set(key, t);
      }
    }
  }
  return pairs;
}
