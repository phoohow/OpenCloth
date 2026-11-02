import type { Vec2 } from '../../core/model/types';

/** Triangles over a flat [x, y, ...] polygon-space vertex buffer. */
export interface TriangleMesh {
  /** Vertices as a flat array [x0, y0, x1, y1, ...] */
  positions: Float32Array;
  /** Triangle vertex indices */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Interior angle below which an outline vertex counts as a corner and keeps its exact position. */
const CORNER_ANGLE_RAD = (50 * Math.PI) / 180;

/**
 * Resamples a closed outline to a uniform vertex spacing. Sharp corners keep their original
 * position, and each run between two corners is divided into equal segments, so a panel enters
 * triangulation with boundary vertices of one size instead of a dense curve next to a coarse
 * straight edge or a stub left over at the end of a run.
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

/** Resamples one open chain into equal segments, keeping both of its endpoints. */
function resampleChain(chain: Vec2[], spacing: number): Vec2[] {
  const n = chain.length;
  if (n < 2) return chain.slice();
  let total = 0;
  for (let i = 1; i < n; i++) total += pointDistance(chain[i - 1]!, chain[i]!);
  const segments = Math.max(1, Math.round(total / spacing));
  const out: Vec2[] = [chain[0]!];
  if (segments > 1) {
    const step = total / segments;
    let walked = 0;
    let next = step;
    for (let i = 1; i < n; i++) {
      const a = chain[i - 1]!, b = chain[i]!;
      const len = pointDistance(a, b);
      if (!(len > 1e-9)) continue;
      while (next < walked + len - 1e-9) {
        const t = (next - walked) / len;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        next += step;
      }
      walked += len;
    }
  }
  out.push({ ...chain[n - 1]! });
  return out;
}

/** Distance between two points. */
function pointDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
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
