import type { Vec2 } from '@/model/types';

import { computeBBox, polygonArea } from '@/base/geom';
import { mToCm } from '@/base/units';

const MIN_RING_CM2 = 10;

const MIN_RING_SPAN_CM = 12;

function edgeKey(a: number, b: number, stride: number): number {
  return a < b ? a * stride + b : b * stride + a;
}

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
    front[t] = area > 0 ? 1 : 0;
  }

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

  const taken = new Set<number>();
  const outlines: Vec2[][] = [];
  for (const [from, to] of edges) {
    if (taken.has(edgeKey(from, to, stride))) continue;
    const ring: Vec2[] = [];
    let previous = from;
    let current = to;
    taken.add(edgeKey(from, to, stride));
    ring.push({ x: mToCm(positions[from * 3]!), y: mToCm(positions[from * 3 + 1]!) });
    while (current !== from && ring.length <= edges.length + 1) {
      ring.push({ x: mToCm(positions[current * 3]!), y: mToCm(positions[current * 3 + 1]!) });
      const next = nextOnOutline(adjacency.get(current) ?? [], taken, current, previous, positions, stride);
      if (next === undefined) break;
      taken.add(edgeKey(current, next, stride));
      previous = current;
      current = next;
    }

    if (ring.length >= 3 && polygonArea(ring) >= MIN_RING_CM2 && ringSpan(ring) >= MIN_RING_SPAN_CM) {
      outlines.push(ring);
    }
  }

  return outlines;
}

function ringSpan(ring: readonly Vec2[]): number {
  const { min, max } = computeBBox(ring);
  return Math.max(max.x - min.x, max.y - min.y);
}
