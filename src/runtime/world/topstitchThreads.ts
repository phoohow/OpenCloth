import type { Pattern, Project, Topstitch } from '@/model/types';
import type { ThreadSegment } from '@/runtime/world/threadRibbon';
import type { ClothSimInput } from '@/sim/common';

import { topstitchRows } from '@/pattern/panel';
import { resamplePath, surfaceCursor, surfaceStep, type SurfaceAnchor } from '@/runtime/engine/surfaceAnchor';

function visibleTopstitches(pattern: Pattern, panelId: string): Topstitch[] {
  return Object.values(pattern.topstitches ?? {}).filter(
    stitch => stitch.panelId === panelId && stitch.visible !== false,
  );
}

export function topstitchSegments(project: Project, panels: ClothSimInput['panels']): ThreadSegment[] {
  const pattern = project.pattern;
  const segments: ThreadSegment[] = [];
  for (const panel of panels) {
    if (pattern.panels[panel.panelId]?.visible === false) continue;
    const cursor = surfaceCursor(panel);
    for (const stitch of visibleTopstitches(pattern, panel.panelId)) {
      for (const row of topstitchRows(pattern, stitch)) {
        let previous: SurfaceAnchor | null = null;
        for (const point of resamplePath(row, surfaceStep(panel))) {
          const anchor = cursor.at(point);
          if (!anchor) continue;
          if (previous) segments.push({ a: previous, b: anchor, color: stitch.color });
          previous = anchor;
        }
      }
    }
  }

  return segments;
}
