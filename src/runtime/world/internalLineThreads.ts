import type { InternalLine, Pattern, Project, Vec2 } from '@/model/types';
import type { ThreadSegment } from '@/runtime/world/threadRibbon';
import type { ClothSimInput } from '@/sim/common';

import {
  resamplePath, surfaceCursor, surfaceStep, type SurfaceAnchor,
} from '@/runtime/engine/surfaceAnchor';

const FOLD_COLOR = '#8ec7ff';

const SPLIT_COLOR = '#c7a5ff';

const DECOR_COLOR = '#9aa0b0';

function lineColor(line: InternalLine): string {
  if (line.kind === 'fold') return FOLD_COLOR;
  if (line.kind === 'split') return SPLIT_COLOR;
  return DECOR_COLOR;
}

function visibleLines(pattern: Pattern, panelId: string): InternalLine[] {
  const panel = pattern.panels[panelId];
  if (!panel) return [];
  return panel.internalLineIds
    .map(lineId => pattern.internalLines[lineId])
    .filter((line): line is InternalLine => (line?.points.length ?? 0) >= 2);
}

export function internalLineSegments(project: Project, panels: ClothSimInput['panels']): ThreadSegment[] {
  const pattern = project.pattern;
  const segments: ThreadSegment[] = [];
  for (const panel of panels) {
    if (pattern.panels[panel.panelId]?.visible === false) continue;
    const step = surfaceStep(panel);
    const cursor = surfaceCursor(panel);
    for (const line of visibleLines(pattern, panel.panelId)) {
      const color = lineColor(line);
      const loop = closedLoop(line.points) ? [...line.points, line.points[0]] : line.points;
      const points = resamplePath(loop, step);
      let previous: SurfaceAnchor | null = null;
      for (const point of points) {
        const anchor = cursor.at(point);
        if (!anchor) continue;
        if (previous) segments.push({ a: previous, b: anchor, color });
        previous = anchor;
      }
    }
  }

  return segments;
}

function closedLoop(points: readonly Vec2[]): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  return points.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-3;
}
