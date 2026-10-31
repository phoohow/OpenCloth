import type { Pattern, Project, SizeDef, Vec2 } from '../../core/model/types';
import { resolveSize } from '../../core/command/gradingCommands';
import { sampleOutline, samplePanelOutline } from '../panel/panelBuilder';

/** Size chart entries in grading order. */
export function orderedSizes(project: Project): SizeDef[] {
  return [...(project.sizes ?? [])].sort((a, b) => a.seq - b.seq);
}

/** True once the project carries a chart with a resolved active size. */
export function gradingActive(project: Project): boolean {
  return (project.sizes?.length ?? 0) > 0 && !!project.activeSizeId;
}

/** Size the stored pattern geometry is currently resolved to. */
export function activeSize(project: Project): SizeDef | null {
  return project.sizes?.find(s => s.id === project.activeSizeId) ?? null;
}

/**
 * Panel outlines (outline plus holes) resolved to one size, for the nested-size display.
 * `fromSizeId` is the size the stored geometry already represents; omit it for base geometry.
 */
export function sizeOutlines(pattern: Pattern, panelId: string, sizeId: string, fromSizeId?: string): Vec2[][] {
  const resolved = resolveSize(pattern, fromSizeId, sizeId);
  const panel = resolved.panels[panelId];
  if (!panel) return [];
  return [
    samplePanelOutline(resolved, panel),
    ...(panel.holes ?? []).map(loop => sampleOutline(resolved, loop)),
  ].filter(poly => poly.length >= 3);
}

/**
 * Points a copied grading delta applies to: every selected vertex, or the row it was copied
 * from when the selection holds no points.
 */
export function gradingPasteTargets(pattern: Pattern, selectedPointIds: string[], anchorPointId: string): string[] {
  const existing = selectedPointIds.filter(id => !!pattern.points[id]);
  return existing.length > 0 ? existing : [anchorPointId];
}

/** Grading map for a paste: one size column written onto each target point. */
export function gradingPasteMap(
  pattern: Pattern, sizeId: string, delta: Vec2, selectedPointIds: string[], anchorPointId: string,
): Record<string, Record<string, Vec2>> {
  const map: Record<string, Record<string, Vec2>> = {};
  for (const pointId of gradingPasteTargets(pattern, selectedPointIds, anchorPointId)) {
    map[pointId] = { [sizeId]: { ...delta } };
  }
  return map;
}
