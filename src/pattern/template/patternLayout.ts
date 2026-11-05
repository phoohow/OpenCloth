import type { Panel, Pattern, Vec2 } from '@/model/types';
import { vec2 } from '@/model/types';
import { samplePanelOutline } from '@/pattern/panel/panelBuilder';
import { computeBBox } from '@/common/geom';

/** Shifts a panel's outline points, their curve handles and arc centers. */
export function offsetPanel(pattern: Pattern, panel: Panel, dx: number, dy: number): void {
  const moved = new Set<string>();
  const shiftIds = [...panel.outlineEdgeIds, ...(panel.holes ?? []).flat()];
  for (const edgeId of shiftIds) {
    const edge = pattern.edges[edgeId];
    if (!edge) continue;
    if (edge.arc) edge.arc = { ...edge.arc, center: vec2(edge.arc.center.x + dx, edge.arc.center.y + dy) };
    for (const pointId of [edge.startPointId, edge.endPointId]) {
      if (moved.has(pointId)) continue;
      moved.add(pointId);
      const point = pattern.points[pointId];
      if (!point) continue;
      point.pos = vec2(point.pos.x + dx, point.pos.y + dy);
      if (point.handleIn) point.handleIn = { ...point.handleIn, x: point.handleIn.x + dx, y: point.handleIn.y + dy };
      if (point.handleOut) point.handleOut = { ...point.handleOut, x: point.handleOut.x + dx, y: point.handleOut.y + dy };
    }
  }
}

/** Bounding box of a panel's sampled outline, before seam allowance. */
function panelBBox(pattern: Pattern, panel: Panel): { min: Vec2; max: Vec2 } {
  return computeBBox(samplePanelOutline(pattern, panel));
}

/**
 * Rows panels side by side and stacks the rows downward with a gap, centering every row on
 * the pattern origin so panels never overlap in the 2D view.
 */
export function layoutRows(pattern: Pattern, rows: Panel[][], gapCm = 4): void {
  let top = 0;
  for (const row of rows) {
    if (row.length === 0) continue;
    const boxes = row.map(panel => panelBBox(pattern, panel));
    const widths = boxes.map(box => box.max.x - box.min.x);
    const heights = boxes.map(box => box.max.y - box.min.y);
    let x = -widths.reduce((a, b) => a + b, 0) / 2 - gapCm * (row.length - 1) / 2;
    row.forEach((panel, i) => {
      offsetPanel(pattern, panel, x - boxes[i].min.x, top - boxes[i].max.y);
      x += widths[i] + gapCm;
    });
    top -= Math.max(...heights) + gapCm;
  }
}

/** Copies a generated pattern's entities into another pattern, laid out to its right. */
export function appendPattern(target: Pattern, source: Pattern, gapCm = 8): void {
  const panels = Object.values(source.panels);
  const existingBoxes = Object.values(target.panels).map(panel => panelBBox(target, panel));

  for (const [id, point] of Object.entries(source.points)) target.points[id] = point;
  for (const [id, edge] of Object.entries(source.edges)) target.edges[id] = edge;
  for (const [id, dart] of Object.entries(source.darts)) target.darts[id] = dart;
  for (const [id, line] of Object.entries(source.internalLines)) target.internalLines[id] = line;
  for (const [id, seam] of Object.entries(source.seams)) target.seams[id] = seam;
  for (const [id, panel] of Object.entries(source.panels)) target.panels[id] = panel;
  const extras = ['notches', 'annotations', 'measurements'] as const;
  for (const key of extras) {
    const src = (source as unknown as Record<string, Record<string, never>>)[key] ?? {};
    const dst = ((target as unknown as Record<string, Record<string, never>>)[key] ??= {});
    for (const [id, value] of Object.entries(src)) dst[id] = value;
  }

  if (existingBoxes.length === 0) return;
  const targetMaxX = Math.max(...existingBoxes.map(box => box.max.x));
  const sourceMinX = Math.min(...panels.map(panel => panelBBox(target, panel).min.x));
  const dx = targetMaxX + gapCm - sourceMinX;
  for (const panel of panels) offsetPanel(target, panel, dx, 0);
}
