import type { Pattern } from '@/model/types';

/** Bounding box of a panel's outline in pattern centimeters. */
export function panelSizeCm(pattern: Pattern, panelId: string): { width: number; height: number } | null {
  const panel = pattern.panels[panelId];
  if (!panel) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const edgeId of panel.outlineEdgeIds) {
    const edge = pattern.edges[edgeId];
    for (const pos of [pattern.points[edge?.startPointId ?? '']?.pos, pattern.points[edge?.endPointId ?? '']?.pos]) {
      if (!pos) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x);
      maxY = Math.max(maxY, pos.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { width: maxX - minX, height: maxY - minY };
}
