/**
 * Front-view outline of the body mesh.
 *
 * The 2D pane draws the same surface the 3D view shows, projected orthographically: a triangle
 * faces the viewer when its projection keeps the mesh's counter-clockwise winding, and the outline
 * is the set of edges where a front-facing triangle meets a back-facing one. Nothing is
 * approximated, so a change of measurements, age or pose shows up in the reference exactly as it
 * does in the viewport.
 */

import type { Vec2 } from '@/model/types';
import { computeBBox, polygonArea } from '@/base/geom';

/** Centimetres in one metre. */
const CM = 100;

/** Projected area under which a triangle counts as seen edge-on, in square meters. */
const EDGE_ON_AREA = 1e-9;

/** Facing bits of a projected triangle: front, back, or edge-on. */
const FRONT = 1;
const BACK = 2;
const EDGE_ON = 4;

/**
 * Smallest ring kept. Creases — eyelids, lips, the folds around a nostril and the slivers the
 * edge-on triangles leave behind — close into rings of their own; a face crease is both small in
 * area and short in span, while the fragments of an arm or a leg run the length of the limb.
 */
const MIN_RING_CM2 = 10;
const MIN_RING_SPAN_CM = 12;

/** Edge key of a vertex pair, order-independent. */
function edgeKey(a: number, b: number, stride: number): number {
  return a < b ? a * stride + b : b * stride + a;
}

/**
 * Edge to follow out of a vertex: the first one met when turning clockwise from the edge just
 * walked, which keeps a crossing outline on one continuous ring.
 */
function nextOnOutline(
  candidates: readonly number[],
  taken: ReadonlySet<number>,
  current: number,
  previous: number,
  positions: Float32Array,
  stride: number,
): number | undefined {
  const incoming = Math.atan2(
    positions[current * 3 + 1]! - positions[previous * 3 + 1]!,
    positions[current * 3]! - positions[previous * 3]!,
  );
  let best: number | undefined;
  let bestTurn = Infinity;
  for (const candidate of candidates) {
    if (taken.has(edgeKey(current, candidate, stride))) continue;
    const outgoing = Math.atan2(
      positions[candidate * 3 + 1]! - positions[current * 3 + 1]!,
      positions[candidate * 3]! - positions[current * 3]!,
    );
    let turn = incoming - outgoing;
    while (turn <= -Math.PI) turn += Math.PI * 2;
    while (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < bestTurn) {
      bestTurn = turn;
      best = candidate;
    }
  }
  return best;
}

/**
 * Closed outlines of the body seen from the front, in centimetres, feet on the ground.
 *
 * `positions` are meters, `indices` the body triangles. The result holds one ring per silhouette
 * loop, holes included, and the rings never cross so an even-odd fill paints the surface once.
 * Rings too small to be more than a crease are dropped, which leaves the figure's outline alone.
 */
export function bodySilhouette(positions: Float32Array, indices: Uint32Array): Vec2[][] {
  const triangles = Math.floor(indices.length / 3);
  const stride = positions.length / 3;
  const front = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const area = (positions[b]! - positions[a]!) * (positions[c + 1]! - positions[a + 1]!)
      - (positions[c]! - positions[a]!) * (positions[b + 1]! - positions[a + 1]!);
    // Nearly edge-on triangles sit on the outline itself; classifying them as either side would
    // cut the ring where the surface turns away from the viewer.
    front[t] = area > EDGE_ON_AREA ? FRONT : area < -EDGE_ON_AREA ? BACK : EDGE_ON;
  }

  // Facing of the two triangles that share each edge: one on each side means the edge is on the
  // outline, and so does an edge-on triangle, which the outline runs through.
  const facing = new Map<number, number>();
  const addFacing = (a: number, b: number, side: number): void => {
    const key = edgeKey(a, b, stride);
    facing.set(key, (facing.get(key) ?? 0) | side);
  };
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]!;
    const b = indices[t * 3 + 1]!;
    const c = indices[t * 3 + 2]!;
    const side = front[t]!;
    addFacing(a, b, side);
    addFacing(b, c, side);
    addFacing(c, a, side);
  }

  const edges: Array<[number, number]> = [];
  for (let t = 0; t < triangles; t++) {
    const corners = [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!];
    for (let i = 0; i < 3; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 3]!;
      // A silhouette edge has a front-facing triangle on one side and a back-facing one on the
      // other; the `a < b` guard keeps the single copy the two triangles share.
      const mask = facing.get(edgeKey(a, b, stride)) ?? 0;
      const outlined = (mask & (FRONT | BACK)) === (FRONT | BACK) || (mask & EDGE_ON) !== 0;
      if (!outlined || a > b) continue;
      edges.push([a, b]);
    }
  }

  const adjacency = new Map<number, number[]>();
  const join = (a: number, b: number): void => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  };
  for (const [a, b] of edges) join(a, b);

  // Walk every edge into a ring. Where the outline crosses itself two rings meet at one vertex,
  // so the walk always turns the same way instead of following whichever edge comes first.
  const taken = new Set<number>();
  const outlines: Vec2[][] = [];
  for (const [from, to] of edges) {
    if (taken.has(edgeKey(from, to, stride))) continue;
    const ring: Vec2[] = [];
    let previous = from;
    let current = to;
    taken.add(edgeKey(from, to, stride));
    ring.push({ x: positions[from * 3]! * CM, y: positions[from * 3 + 1]! * CM });
    while (current !== from && ring.length <= edges.length + 1) {
      ring.push({ x: positions[current * 3]! * CM, y: positions[current * 3 + 1]! * CM });
      const next = nextOnOutline(adjacency.get(current) ?? [], taken, current, previous, positions, stride);
      if (next === undefined) break;
      taken.add(edgeKey(current, next, stride));
      previous = current;
      current = next;
    }
    // Creases close into small rings of their own; the outline fragments that make up the figure
    // may also close on themselves, so size, not closure, is what separates a crease from a limb.
    if (ring.length >= 3 && polygonArea(ring) >= MIN_RING_CM2 && ringSpan(ring) >= MIN_RING_SPAN_CM) {
      outlines.push(ring);
    }
  }
  return outlines;
}

/** Longest side of a ring's bounding box, in centimetres. */
function ringSpan(ring: readonly Vec2[]): number {
  const { min, max } = computeBBox(ring);
  return Math.max(max.x - min.x, max.y - min.y);
}
