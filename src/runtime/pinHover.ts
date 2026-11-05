import type { Vec3 } from '@/model/types';

/** Pixel distance between a viewport point in NDC and a projected point (`z` is NDC depth). */
export function ndcDistancePx(
  ndcX: number, ndcY: number, point: Vec3, width: number, height: number,
): number {
  return Math.hypot((point.x - ndcX) * width / 2, (point.y - ndcY) * height / 2);
}

/**
 * Pin markers under the pointer, nearest first. `project` returns null for a particle that cannot
 * be projected; points behind the camera are rejected because their projection mirrors to the
 * wrong side. `limit` caps the list so the caller can run a costly test on the nearest few.
 */
export function pinsByScreenDistance(
  candidates: readonly number[],
  project: (index: number) => Vec3 | null,
  ndcX: number,
  ndcY: number,
  width: number,
  height: number,
  radiusPx: number,
  limit = Infinity,
): number[] {
  const hits: { index: number; distance: number }[] = [];
  for (const index of candidates) {
    const point = project(index);
    if (!point || point.z > 1) continue;
    const distance = ndcDistancePx(ndcX, ndcY, point, width, height);
    if (distance < radiusPx) hits.push({ index, distance });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits.slice(0, limit).map(hit => hit.index);
}
