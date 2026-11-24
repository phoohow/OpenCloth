import type { Pattern, Project, SizeDef, Vec2 } from '@/model/types';

import { resolveSize } from '@/pattern/grading/resolveSize';
import { sampleOutline, samplePanelOutline } from '@/pattern/panel';

export function orderedSizes(project: Project): SizeDef[] {
  return [...(project.sizes ?? [])].sort((a, b) => a.seq - b.seq);
}

export function activeSize(project: Project): SizeDef | null {
  return project.sizes?.find(s => s.id === project.activeSizeId) ?? null;
}

export function sizeOutlines(pattern: Pattern, panelId: string, sizeId: string, fromSizeId?: string): Vec2[][] {
  const resolved = resolveSize(pattern, fromSizeId, sizeId);
  const panel = resolved.panels[panelId];
  if (!panel) return [];
  return [
    samplePanelOutline(resolved, panel),
    ...(panel.holes ?? []).map(loop => sampleOutline(resolved, loop)),
  ].filter(poly => poly.length >= 3);
}

export function gradingPasteTargets(pattern: Pattern, selectedPointIds: string[], anchorPointId: string): string[] {
  const existing = selectedPointIds.filter(id => !!pattern.points[id]);
  return existing.length > 0 ? existing : [anchorPointId];
}

export function gradingPasteMap(
  pattern: Pattern, sizeId: string, delta: Vec2, selectedPointIds: string[], anchorPointId: string,
): Record<string, Record<string, Vec2>> {
  const map: Record<string, Record<string, Vec2>> = {};
  for (const pointId of gradingPasteTargets(pattern, selectedPointIds, anchorPointId)) {
    map[pointId] = { [sizeId]: { ...delta } };
  }

  return map;
}
