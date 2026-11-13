/**
 * Front-view outline of the body mesh.
 *
 * The 2D pane draws the same surface the 3D view shows, projected orthographically: a triangle
 * faces the viewer when its projection keeps the mesh's counter-clockwise winding, and the outline
 * is the boundary of the front-facing set — the edges used by exactly one front-facing triangle.
 * That boundary is a closed 1-manifold, so every walk along it returns to its start. Nothing is
 * approximated, so a change of measurements, age or pose shows up in the reference exactly as it
 * does in the viewport.
 */

import type { Vec2 } from '@/model/types';
import { computeBBox, polygonArea } from '@/base/geom';

/** Centimetres in one metre. */
const CM = 100;

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
 * `positions` are meters, `indices` the body triangles. The result holds the boundary rings of the
 * visible surface, holes included; where the outline touches itself the rings join at that vertex.
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
    // An edge-on triangle belongs to the far side, so the outline runs along its front neighbour.
    front[t] = area > 0 ? 1 : 0;
  }

  // The visible surface covers each interior edge twice, once from each front-facing triangle;
  // an edge covered once is where the visible surface ends.
  const covered = new Map<number, number>();
  for (let t = 0; t < triangles; t++) {
    if (!front[t]) continue;
    for (let i = 0; i < 3; i++) {
      const a = indices[t * 3 + i]!;
      const b = indices[t * 3 + (i + 1) % 3]!;
      const key = edgeKey(a, b, stride);
      covered.set(key, (covered.get(key) ?? 0) + 1);
    }
  }

  const edges: Array<[number, number]> = [];
  for (const [key, count] of covered) {
    if (count !== 1) continue;
    edges.push([Math.floor(key / stride), key % stride]);
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
    // Creases close into small rings of their own, the figure into large ones, so size is what
    // separates a crease from an outline.
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
