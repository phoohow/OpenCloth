import { useMemo } from 'react';
import type { Project } from '@/model/types';
import { bodyLandmarks } from '@/avatar';
import { panelHeightOffsets } from '@/ui/viewport2D/panelHeight';

/**
 * Height the 2D pane adds to each panel, so the numeric readouts show the same y as the canvas:
 * centimetres above the ground rather than the raw pattern y.
 */
export function useHeightOffsets(project: Project): ReadonlyMap<string, number> {
  const body = useMemo(() => bodyLandmarks(project.avatar.params), [project.avatar.params]);
  return useMemo(() => panelHeightOffsets(project.pattern, body), [project.pattern, body]);
}

/** Pattern object behind an `@kind:id` element row. */
export function useElement(_project: Project, nodeId: string) {
  const m = /^@(point|edge|internal|dart|notch|annotation|measurement|print|topstitch|trim):(.+)$/.exec(nodeId);
  if (!m) return null;
  return { kind: m[1], id: m[2] };
}
