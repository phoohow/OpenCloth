import type { MeshSampling, Vec2 } from '../../core/model/types';
import type { TriangleMesh } from './triangulate';
import { delaunayTriangulate } from './delaunay';

/** Triangles over a mutable flat [x, y, ...] buffer, wound counter-clockwise. */
interface Remesh {
  /** Vertices as flat [x0, y0, x1, y1, ...] pairs. */
  positions: number[];
  /** Triangle vertex indices, counter-clockwise. */
  triangles: number[];
}

/** Edge length above this multiple of the target is split at its midpoint. */
const SPLIT_RATIO = 4 / 3;

/** Rounds of legalization and relaxation that follow the length-driven refinement. */
const RELAX_ROUNDS = 8;

/** Laplacian passes inside one round. */
const RELAX_PASSES = 3;

/** Share of the way an interior vertex moves toward its neighbour centroid per pass. */
const RELAX_FACTOR = 0.8;

/** Flip passes per legalization step; a mesh usually settles after two or three. */
const FLIP_ROUNDS = 6;

/** Valence below which an interior vertex has no room to relax. */
const MIN_VALENCE = 3;

/** Distance from the outline a seeded vertex keeps, as a share of the target edge length. */
const OUTLINE_MARGIN = 0.6;

/** Share of the target edge length the seed lattice offsets each point by. */
const JITTER = 0.3;

/** Minimum distance between two blue-noise samples, as a share of the target edge length. */
const POISSON_RADIUS = 0.7;

/** Candidate points tried per active blue-noise sample. */
const POISSON_ATTEMPTS = 24;

/** Attempts at recovering one outline edge the Delaunay triangulation does not contain. */
const RECOVERY_ROUNDS = 32;

/** Rounds of longest-edge splitting before the relaxation loop takes over. */
const SPLIT_ROUNDS = 24;

/**
 * Triangulates one pattern piece into the simulation mesh. The interior is seeded at about
 * `targetEdgeLength` spacing, either by a jittered hexagonal lattice or, with `blueNoise`, by
 * Poisson-disk sampling; then the outline loops and the seeds go through Delaunay triangulation,
 * the triangles outside the piece are dropped, and long edges are split until none is left above
 * four thirds of the target. Delaunay legalization alternates with Laplacian relaxation, which
 * turns the seeds into an even, isotropic mesh. Only interior vertices move, so the outline keeps
 * its shape, and both triangles of a split edge share one midpoint, so the mesh stays crack-free
 * under deformation.
 */
export function remeshPolygon(
  outline: Vec2[],
  holes: Vec2[][],
  targetEdgeLength: number,
  sampling: MeshSampling = 'lattice',
): TriangleMesh {
  if (outline.length < 3 || !(targetEdgeLength > 0)) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, triangleCount: 0 };
  }

  const points: number[] = [];
  const loops: number[][] = [];
  for (const loop of [outline, ...holes]) {
    if (loop.length < 3) continue;
    const start = points.length / 2;
    for (const p of loop) points.push(p.x, p.y);
    loops.push(loopIndices(start, loop.length));
  }

  // Outline samples sit exactly on straight edges and corners, which makes three of them collinear
  // and four of them co-circular. A micron-scale offset lifts the point set into general position,
  // where the circumcircle tests have unambiguous answers.
  const epsilon = targetEdgeLength * 1e-4;
  for (let i = 0; i < points.length; i += 2) {
    points[i] = points[i]! + (hash01(i, 1) - 0.5) * epsilon;
    points[i + 1] = points[i + 1]! + (hash01(i, 2) - 0.5) * epsilon;
  }

  if (sampling === 'blueNoise') seedPoisson(points, loops, targetEdgeLength);
  else seedInterior(points, loops, targetEdgeLength);

  const mesh: Remesh = { positions: points, triangles: delaunayTriangulate(points) };
  if (!recoverOutline(mesh, loops)) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, triangleCount: 0 };
  }
  keepInside(mesh, loops);

  const limit = targetEdgeLength * SPLIT_RATIO;
  // Split in rounds: one round halves the edges it touches, so a few rounds cover the band the
  // seeds leave between the lattice and the outline.
  for (let round = 0; round < SPLIT_ROUNDS; round++) {
    if (!splitLongEdges(mesh, limit)) break;
  }
  for (let round = 0; round < RELAX_ROUNDS; round++) {
    legalize(mesh);
    relaxInterior(mesh);
    splitLongEdges(mesh, limit);
  }
  legalize(mesh);
  for (let round = 0; round < SPLIT_ROUNDS; round++) {
    if (!splitLongEdges(mesh, limit)) break;
  }
  legalize(mesh);

  return {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(mesh.triangles),
    vertexCount: mesh.positions.length / 2,
    triangleCount: mesh.triangles.length / 3,
  };
}

/** Vertex indices of a loop in the flat point array. */
function loopIndices(start: number, count: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < count; i++) indices.push(start + i);
  return indices;
}

/**
 * Adds a jittered hexagonal lattice of interior vertices, one per `spacing` cell: hexagons pack the
 * plane at one density with the most regular triangles, and the jitter keeps the mesh from lining up
 * with straight edges of the piece. The band along the outline is left to the refinement so no seed
 * competes with a boundary edge, and points that fall into a hole or off the piece are left out.
 */
function seedInterior(points: number[], loops: number[][], spacing: number): void {
  for (const p of latticeCandidates(points, loops, spacing, Infinity)) points.push(p.x, p.y);
}

/** Deterministic pseudo-random value in [0, 1) for a lattice cell. */
function hash01(a: number, b: number): number {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Adds interior vertices by Poisson-disk sampling (Bridson's dart throwing): every new point keeps
 * at least `spacing * POISSON_RADIUS` from the existing ones, which leaves no lattice direction in
 * the mesh. Points that fall outside the piece or inside the outline margin are dropped, so the
 * band along the outline stays to the refinement. Runs from a fixed seed, so the result is
 * deterministic.
 */
function seedPoisson(points: number[], loops: number[][], spacing: number): void {
  const radius = spacing * POISSON_RADIUS;
  const margin = spacing * OUTLINE_MARGIN;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]!);
    maxX = Math.max(maxX, points[i]!);
    minY = Math.min(minY, points[i + 1]!);
    maxY = Math.max(maxY, points[i + 1]!);
  }

  const cell = radius / Math.SQRT2;
  const columns = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  // Sample index per grid cell, -1 when empty.
  const grid = new Int32Array(columns * rows).fill(-1);
  const seeds: number[] = [];
  const active: number[] = [];

  const cellOf = (x: number, y: number): number => {
    const column = Math.min(columns - 1, Math.max(0, Math.floor((x - minX) / cell)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
    return row * columns + column;
  };

  const accept = (x: number, y: number): boolean => {
    const column = Math.floor((x - minX) / cell), row = Math.floor((y - minY) / cell);
    for (let dy = -2; dy <= 2; dy++) {
      const gy = row + dy;
      if (gy < 0 || gy >= rows) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const gx = column + dx;
        if (gx < 0 || gx >= columns) continue;
        const sample = grid[gy * columns + gx]!;
        if (sample < 0) continue;
        const sx = seeds[sample * 2]!, sy = seeds[sample * 2 + 1]!;
        if ((sx - x) * (sx - x) + (sy - y) * (sy - y) < radius * radius) return false;
      }
    }
    return insideLoops(points, loops, x, y) && distanceToLoops(points, loops, x, y) >= margin;
  };

  const add = (x: number, y: number): void => {
    seeds.push(x, y);
    grid[cellOf(x, y)] = seeds.length / 2 - 1;
    active.push(seeds.length / 2 - 1);
  };

  // One lattice point inside the piece starts the process; a piece too small for one keeps no seed.
  const start = latticeCandidates(points, loops, spacing, 1);
  if (start.length === 0) return;
  add(start[0]!.x, start[0]!.y);

  // Fixed-seed linear congruential generator keeps the sampling deterministic.
  let state = 0x2f6e2b1;
  const random = (): number => {
    state = (Math.imul(state, 1597334677) + 12345) >>> 0;
    return state / 4294967296;
  };

  while (active.length > 0) {
    const pick = Math.floor(random() * active.length);
    const ox = seeds[active[pick]! * 2]!, oy = seeds[active[pick]! * 2 + 1]!;
    let added = false;
    for (let attempt = 0; attempt < POISSON_ATTEMPTS; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = radius * (1 + random());
      const x = ox + Math.cos(angle) * distance;
      const y = oy + Math.sin(angle) * distance;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (!accept(x, y)) continue;
      add(x, y);
      added = true;
      break;
    }
    // A spent point leaves the active list; a point that spawned a neighbour may spawn more.
    if (!added) active.splice(pick, 1);
  }

  for (let i = 0; i < seeds.length; i += 2) points.push(seeds[i]!, seeds[i + 1]!);
}

/** First `count` lattice candidates that fall inside the piece and outside the outline margin. */
function latticeCandidates(
  points: number[], loops: number[][], spacing: number, count: number,
): Array<{ x: number; y: number }> {
  const rowHeight = spacing * (Math.sqrt(3) / 2);
  const margin = spacing * OUTLINE_MARGIN;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]!);
    maxX = Math.max(maxX, points[i]!);
    minY = Math.min(minY, points[i + 1]!);
    maxY = Math.max(maxY, points[i + 1]!);
  }
  const found: Array<{ x: number; y: number }> = [];
  for (let row = 0; found.length < count; row++) {
    const top = minY + row * rowHeight;
    if (top > maxY) break;
    const shift = (row & 1) === 1 ? spacing / 2 : 0;
    for (let column = 0; ; column++) {
      const left = minX + shift + column * spacing;
      if (left > maxX) break;
      const jx = left + (hash01(row, column) - 0.5) * spacing * JITTER;
      const jy = top + (hash01(row + 7919, column + 104729) - 0.5) * spacing * JITTER;
      if (!insideLoops(points, loops, jx, jy)) continue;
      if (distanceToLoops(points, loops, jx, jy) < margin) continue;
      found.push({ x: jx, y: jy });
      if (found.length >= count) break;
    }
  }
  return found;
}

/** Even-odd containment over all loops, so holes count as outside on their own. */
function insideLoops(points: number[], loops: number[][], x: number, y: number): boolean {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
      const ay = points[a * 2 + 1]!, by = points[b * 2 + 1]!;
      if ((ay > y) === (by > y)) continue;
      const ax = points[a * 2]!, bx = points[b * 2]!;
      if (x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside;
    }
  }
  return inside;
}

/** Distance from (x, y) to the closest outline segment. */
function distanceToLoops(points: number[], loops: number[][], x: number, y: number): number {
  let best = Infinity;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
      best = Math.min(best, distanceToSegment(
        x, y,
        points[a * 2]!, points[a * 2 + 1]!,
        points[b * 2]!, points[b * 2 + 1]!,
      ));
    }
  }
  return best;
}

/** Distance from (x, y) to the segment from (ax, ay) to (bx, by). */
function distanceToSegment(
  x: number, y: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
    : 0;
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

/**
 * Restores the outline edges the Delaunay triangulation of the point set does not contain, by
 * flipping the diagonals that cross them. Without them the mesh would cut a chord across the piece
 * and the silhouette would no longer match the pattern.
 */
function recoverOutline(mesh: Remesh, loops: number[][]): boolean {
  const { positions: p, triangles: t } = mesh;
  const stride = p.length / 2;
  const constraints = new Set<number>();
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      constraints.add(edgeKey(loop[i]!, loop[(i + 1) % loop.length]!, stride));
    }
  }
  const present = new Set<number>();
  for (let i = 0; i < t.length; i += 3) {
    for (let e = 0; e < 3; e++) present.add(edgeKey(t[i + e]!, t[i + ((e + 1) % 3)]!, stride));
  }
  for (const key of constraints) {
    if (present.has(key)) continue;
    if (!recoverEdge(mesh, Math.floor(key / stride), key % stride, constraints)) return false;
  }
  return true;
}

/**
 * Flips crossing diagonals until edge `a, b` exists, or gives up when no flip helps. Outline edges
 * already in place are never flipped, or recovering one corner would tear open another.
 */
function recoverEdge(mesh: Remesh, a: number, b: number, constraints: Set<number>): boolean {
  const { positions: p, triangles: t } = mesh;
  const stride = p.length / 2;
  const target = edgeKey(a, b, stride);
  for (let round = 0; round < RECOVERY_ROUNDS; round++) {
    const table = new Map<number, number[]>();
    for (let i = 0; i < t.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const key = edgeKey(t[i + e]!, t[i + ((e + 1) % 3)]!, stride);
        const opposite = t[i + ((e + 2) % 3)]!;
        const uses = table.get(key);
        if (uses) uses.push(i, opposite);
        else table.set(key, [i, opposite]);
      }
    }
    if (table.has(target)) return true;

    let flipped = false;
    for (const [key, uses] of table) {
      if (uses.length !== 4) continue;
      const [first, c, second, d] = uses as [number, number, number, number];
      const u = Math.floor(key / stride), v = key % stride;
      if (c === d || u === a || u === b || v === a || v === b) continue;
      if (constraints.has(key)) continue;
      if (!segmentsCross(p, u, v, a, b)) continue;
      // Only a convex quadrilateral can be flipped onto its other diagonal.
      if ((signedArea(p, u, v, c) > 0) === (signedArea(p, u, v, d) > 0)) continue;
      if (signedArea(p, u, d, c) <= 0 || signedArea(p, v, c, d) <= 0) continue;
      t[first] = u;
      t[first + 1] = d;
      t[first + 2] = c;
      t[second] = v;
      t[second + 1] = c;
      t[second + 2] = d;
      flipped = true;
      break;
    }
    if (!flipped) return false;
  }
  return false;
}

/** True when segments `u, v` and `a, b` cross at a point interior to both. */
function segmentsCross(p: number[], u: number, v: number, a: number, b: number): boolean {
  return (signedArea(p, u, v, a) > 0) !== (signedArea(p, u, v, b) > 0)
    && (signedArea(p, a, b, u) > 0) !== (signedArea(p, a, b, v) > 0);
}

/** Drops the triangles whose centre falls outside the piece, holes included. */
function keepInside(mesh: Remesh, loops: number[][]): void {
  const { positions: p, triangles: t } = mesh;
  const kept: number[] = [];
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i]!, b = t[i + 1]!, c = t[i + 2]!;
    const x = (p[a * 2]! + p[b * 2]! + p[c * 2]!) / 3;
    const y = (p[a * 2 + 1]! + p[b * 2 + 1]! + p[c * 2 + 1]!) / 3;
    if (!insideLoops(p, loops, x, y)) continue;
    kept.push(a, b, c);
  }
  mesh.triangles = kept;
}

/** Twice the signed area of triangle `a, b, c`; positive when counter-clockwise. */
function signedArea(p: number[], a: number, b: number, c: number): number {
  return (p[b * 2]! - p[a * 2]!) * (p[c * 2 + 1]! - p[a * 2 + 1]!)
    - (p[b * 2 + 1]! - p[a * 2 + 1]!) * (p[c * 2]! - p[a * 2]!);
}

/** Unordered key of an edge of a mesh with at most `stride` vertices. */
function edgeKey(a: number, b: number, stride: number): number {
  return a < b ? a * stride + b : b * stride + a;
}

/** Squared distance between vertices `a` and `b`. */
function edgeLengthSquared(p: number[], a: number, b: number): number {
  const dx = p[b * 2]! - p[a * 2]!, dy = p[b * 2 + 1]! - p[a * 2 + 1]!;
  return dx * dx + dy * dy;
}

/**
 * Splits the longest edge of every triangle that still has one above `limit`. One split per
 * triangle per round keeps the vertex count close to the area the piece needs, where subdividing
 * every long edge at once would quadruple the whole mesh. The set is built over the mesh, so both
 * triangles of a split edge split it and no T-junction is left behind.
 */
function splitLongEdges(mesh: Remesh, limit: number): boolean {
  const { positions: p, triangles: t } = mesh;
  const stride = p.length / 2;
  const limitSquared = limit * limit;
  const marked = new Set<number>();

  for (let i = 0; i < t.length; i += 3) {
    const v0 = t[i]!, v1 = t[i + 1]!, v2 = t[i + 2]!;
    const ab = edgeLengthSquared(p, v0, v1);
    const bc = edgeLengthSquared(p, v1, v2);
    const ca = edgeLengthSquared(p, v2, v0);
    const longest = Math.max(ab, bc, ca);
    if (longest <= limitSquared) continue;
    if (longest === ab) marked.add(edgeKey(v0, v1, stride));
    else if (longest === bc) marked.add(edgeKey(v1, v2, stride));
    else marked.add(edgeKey(v2, v0, stride));
  }
  if (marked.size === 0) return false;

  // Both triangles of a split edge ask for the same midpoint, which keeps the seam watertight.
  const midpoints = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = edgeKey(a, b, stride);
    const cached = midpoints.get(key);
    if (cached !== undefined) return cached;
    p.push((p[a * 2]! + p[b * 2]!) / 2, (p[a * 2 + 1]! + p[b * 2 + 1]!) / 2);
    const index = p.length / 2 - 1;
    midpoints.set(key, index);
    return index;
  };

  const out: number[] = [];
  for (let i = 0; i < t.length; i += 3) {
    const corners = [t[i]!, t[i + 1]!, t[i + 2]!];
    const split = [
      marked.has(edgeKey(corners[0]!, corners[1]!, stride)),
      marked.has(edgeKey(corners[1]!, corners[2]!, stride)),
      marked.has(edgeKey(corners[2]!, corners[0]!, stride)),
    ];
    const count = (split[0] ? 1 : 0) + (split[1] ? 1 : 0) + (split[2] ? 1 : 0);

    if (count === 0) {
      out.push(corners[0]!, corners[1]!, corners[2]!);
      continue;
    }

    // Rotate until the split edges, when they are adjacent, start at the first corner.
    const rotate = (): void => {
      corners.push(corners.shift()!);
      split.push(split.shift()!);
    };
    if (count === 2) {
      for (let r = 0; r < 2 && !(split[0] && split[1]); r++) rotate();
    } else if (count === 1) {
      while (!split[0]) rotate();
    }

    const v0 = corners[0]!, v1 = corners[1]!, v2 = corners[2]!;
    if (count === 3) {
      const m01 = midpoint(v0, v1), m12 = midpoint(v1, v2), m20 = midpoint(v2, v0);
      out.push(v0, m01, m20, m01, v1, m12, m20, m12, v2, m01, m12, m20);
    } else if (count === 2) {
      const m01 = midpoint(v0, v1), m12 = midpoint(v1, v2);
      out.push(v0, m01, m12, v0, m12, v2, m01, v1, m12);
    } else {
      const m01 = midpoint(v0, v1);
      out.push(v0, m01, v2, m01, v1, v2);
    }
  }

  mesh.triangles = out;
  return true;
}

/** Flips non-Delaunay diagonals until every shared edge maximizes its two smallest angles. */
function legalize(mesh: Remesh): void {
  for (let round = 0; round < FLIP_ROUNDS; round++) {
    if (!flipPass(mesh)) return;
  }
}

/** One sweep of Delaunay flips; returns whether any diagonal was flipped. */
function flipPass(mesh: Remesh): boolean {
  const { positions: p, triangles: t } = mesh;
  const stride = p.length / 2;
  const table = new Map<number, number[]>();
  for (let i = 0; i < t.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(t[i + e]!, t[i + ((e + 1) % 3)]!, stride);
      const opposite = t[i + ((e + 2) % 3)]!;
      const uses = table.get(key);
      if (uses) uses.push(i, opposite);
      else table.set(key, [i, opposite]);
    }
  }

  const locked = new Uint8Array(t.length / 3);
  let flipped = false;
  for (const [key, uses] of table) {
    if (uses.length !== 4) continue;
    const [first, c, second, d] = uses as [number, number, number, number];
    if (locked[first / 3] || locked[second / 3] || c === d) continue;

    const a = Math.floor(key / stride), b = key % stride;
    // Convex quadrilateral: the opposite corners lie on either side of this diagonal.
    const sideC = signedArea(p, a, b, c), sideD = signedArea(p, a, b, d);
    if (sideC === 0 || sideD === 0 || (sideC > 0) === (sideD > 0)) continue;
    // The diagonal is Delaunay while the angles facing it add up to less than a straight angle.
    if (cornerAngle(p, c, a, b) + cornerAngle(p, d, a, b) <= Math.PI + 1e-9) continue;
    // The flipped triangles replace the pair; both must stay wide enough to be worth it.
    if (signedArea(p, a, d, c) <= 1e-12 || signedArea(p, b, c, d) <= 1e-12) continue;

    t[first] = a;
    t[first + 1] = d;
    t[first + 2] = c;
    t[second] = b;
    t[second + 1] = c;
    t[second + 2] = d;
    locked[first / 3] = 1;
    locked[second / 3] = 1;
    flipped = true;
  }
  return flipped;
}

/** Angle at `at` between the rays to `first` and `second`, in radians. */
function cornerAngle(p: number[], at: number, first: number, second: number): number {
  const ux = p[first * 2]! - p[at * 2]!, uy = p[first * 2 + 1]! - p[at * 2 + 1]!;
  const vx = p[second * 2]! - p[at * 2]!, vy = p[second * 2 + 1]! - p[at * 2 + 1]!;
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (lu < 1e-12 || lv < 1e-12) return Math.PI;
  return Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (lu * lv))));
}

/**
 * Moves every interior vertex toward the centroid of its neighbours, which evens out the band the
 * lattice leaves along the outline. Outline vertices stay put so the silhouette and the seam vertex
 * order survive.
 */
function relaxInterior(mesh: Remesh): void {
  const { positions: p, triangles: t } = mesh;
  const count = p.length / 2;
  if (count === 0) return;
  const stride = count;
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  const incident: number[][] = Array.from({ length: count }, () => []);
  const useCount = new Map<number, number>();

  for (let i = 0; i < t.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = t[i + e]!, b = t[i + ((e + 1) % 3)]!;
      const key = edgeKey(a, b, stride);
      useCount.set(key, (useCount.get(key) ?? 0) + 1);
      neighbours[a]!.push(b);
      neighbours[b]!.push(a);
      incident[a]!.push(i);
    }
  }

  const boundary = new Uint8Array(count);
  for (const [key, use] of useCount) {
    if (use !== 1) continue;
    boundary[Math.floor(key / stride)] = 1;
    boundary[key % stride] = 1;
  }

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let v = 0; v < count; v++) {
      const around = neighbours[v]!;
      if (boundary[v] || around.length < MIN_VALENCE) continue;
      let cx = 0, cy = 0;
      for (const u of around) {
        cx += p[u * 2]!;
        cy += p[u * 2 + 1]!;
      }
      cx /= around.length;
      cy /= around.length;
      const px = p[v * 2]!, py = p[v * 2 + 1]!;
      const qx = px + (cx - px) * RELAX_FACTOR;
      const qy = py + (cy - py) * RELAX_FACTOR;
      if (!keepsTriangles(p, t, incident[v]!, v, qx, qy)) continue;
      p[v * 2] = qx;
      p[v * 2 + 1] = qy;
    }
  }
}

/** True when moving vertex `v` to (qx, qy) keeps every incident triangle upright and not thinner. */
function keepsTriangles(
  p: number[], t: number[], incident: number[], v: number, qx: number, qy: number,
): boolean {
  const ox = p[v * 2]!, oy = p[v * 2 + 1]!;
  p[v * 2] = qx;
  p[v * 2 + 1] = qy;
  let keeps = true;
  for (const at of incident) {
    const after = signedArea(p, t[at]!, t[at + 1]!, t[at + 2]!);
    if (after <= 0) { keeps = false; break; }
    p[v * 2] = ox;
    p[v * 2 + 1] = oy;
    const before = signedArea(p, t[at]!, t[at + 1]!, t[at + 2]!);
    p[v * 2] = qx;
    p[v * 2 + 1] = qy;
    if (after < before * 0.25) { keeps = false; break; }
  }
  p[v * 2] = ox;
  p[v * 2 + 1] = oy;
  return keeps;
}
