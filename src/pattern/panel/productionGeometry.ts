import type { Pattern, Print, Topstitch, Trim, Vec2 } from '@/model/types';

import { computeBBox } from '@/base/geom';
import { degToRad, normalize2, rotate2, sub2 } from '@/base/math';
import { sampleEdgeInterval, samplePanelOutline } from '@/pattern/panel/panelBuilder';

const MIN_TRIM_DIAMETER_CM = 0.4;

export function panelFrame(pattern: Pattern, panelId: string): { center: Vec2; min: Vec2; max: Vec2 } | null {
  const panel = pattern.panels[panelId];
  if (!panel) return null;
  const outline = samplePanelOutline(pattern, panel);
  if (outline.length === 0) return null;
  const bbox = computeBBox(outline);
  return {
    center: { x: (bbox.min.x + bbox.max.x) / 2, y: (bbox.min.y + bbox.max.y) / 2 },
    min: bbox.min,
    max: bbox.max,
  };
}

export function rotatedFrame(center: Vec2, widthCm: number, heightCm: number, angleDeg: number): Vec2[] {
  const angle = degToRad(angleDeg);
  const hw = widthCm / 2, hh = heightCm / 2;
  const corner = (sx: number, sy: number): Vec2 => {
    const offset = rotate2({ x: sx * hw, y: sy * hh }, angle);
    return { x: center.x + offset.x, y: center.y + offset.y };
  };
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

export function printFrame(pattern: Pattern, print: Print): Vec2[] | null {
  const frame = panelFrame(pattern, print.panelId);
  if (!frame) return null;
  const center = { x: frame.center.x + print.center.x, y: frame.center.y + print.center.y };
  return rotatedFrame(center, print.widthCm, print.heightCm, print.angleDeg);
}

export function printCenter(pattern: Pattern, print: Print): Vec2 | null {
  const frame = panelFrame(pattern, print.panelId);
  if (!frame) return null;
  return { x: frame.center.x + print.center.x, y: frame.center.y + print.center.y };
}

export function topstitchRows(pattern: Pattern, stitch: Topstitch): Vec2[][] {
  const pts = sampleEdgeInterval(pattern, stitch.edgeId, stitch.t0, stitch.t1);
  if (pts.length < 2) return [];
  const frame = panelFrame(pattern, stitch.panelId);
  const center = frame?.center ?? null;
  const rows: Vec2[][] = [];
  for (let row = 0; row < Math.max(1, stitch.rows); row++) {
    const distance = (stitch.offsetMm + row * stitch.spacingMm) / 10;
    const line: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const tangent = normalize2(sub2(next, prev));
      let nx = -tangent.y, ny = tangent.x;
      if (center && nx * (center.x - pts[i].x) + ny * (center.y - pts[i].y) < 0) { nx = -nx; ny = -ny; }
      line.push({ x: pts[i].x + nx * distance, y: pts[i].y + ny * distance });
    }

    rows.push(line);
  }

  return rows;
}

export function trimRadiusCm(trim: Trim): number {
  return Math.max(MIN_TRIM_DIAMETER_CM, trim.sizeMm / 10) / 2;
}
