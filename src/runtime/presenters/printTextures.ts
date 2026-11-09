/** Panel print frames and placements, in the shapes the texture port paints. */

import type { FabricAppearance, Pattern, Print, Project, Vec2 } from '@/model/types';
import { fabricForPanel, panelPrints } from '@/model';
import { computeBBox } from '@/base/geom';
import { samplePanelOutline } from '@/pattern/panel';
import type { PaintCommand, PrintPlacement } from '@/render/common';
import { FALLBACK_APPEARANCE } from '@/runtime/clothConstants';

/** Panel bounds a print mapping reads: the print origin and the box the UVs normalise over. */
export interface PanelPrintFrame {
  center: Vec2;
  min: Vec2;
  max: Vec2;
}

/** Bounding boxes a panel's print mapping needs. */
export function panelPrintFrame(
  pattern: Pattern, panelId: string, positions2D: Float32Array,
): PanelPrintFrame | null {
  const panel = pattern.panels[panelId];
  if (!panel || positions2D.length < 6) return null;
  const outline = computeBBox(samplePanelOutline(pattern, panel));
  const points: Vec2[] = [];
  for (let i = 0; i + 1 < positions2D.length; i += 2) {
    points.push({ x: positions2D[i]!, y: positions2D[i + 1]! });
  }
  const mesh = computeBBox(points);
  return {
    center: { x: (outline.min.x + outline.max.x) / 2, y: (outline.min.y + outline.max.y) / 2 },
    min: mesh.min,
    max: mesh.max,
  };
}

/** One print rectangle in the panel's normalised UV square. */
export function printPlacement(print: Print, frame: PanelPrintFrame): PrintPlacement {
  const width = Math.max(1e-6, frame.max.x - frame.min.x);
  const height = Math.max(1e-6, frame.max.y - frame.min.y);
  return {
    center: {
      x: (frame.center.x + print.center.x - frame.min.x) / width,
      y: (frame.center.y + print.center.y - frame.min.y) / height,
    },
    width: print.widthCm / width,
    height: print.heightCm / height,
    angleDeg: print.angleDeg,
    opacity: Math.min(1, Math.max(0, print.opacity)),
    repeat: { x: Math.max(1, print.repeat.x), y: Math.max(1, print.repeat.y) },
    imageUrl: print.imageUrl,
  };
}

/** Texture key and paint command of one panel's composed fabric. */
export function printPaint(
  project: Project, panelId: string, positions2D: Float32Array,
): { key: string; command: PaintCommand } | null {
  const frame = panelPrintFrame(project.pattern, panelId, positions2D);
  if (!frame) return null;
  const prints = panelPrints(project, panelId);
  if (prints.length === 0) return null;
  return {
    key: `print:${panelId}`,
    command: paintCommand(
      fabricForPanel(project, panelId)?.appearance ?? FALLBACK_APPEARANCE,
      frame,
      prints.map(print => printPlacement(print, frame)),
    ),
  };
}

/** Paint command of a fabric plus its print placements. */
export function paintCommand(
  appearance: FabricAppearance,
  frame: PanelPrintFrame,
  placements: readonly PrintPlacement[],
): PaintCommand {
  return {
    width: 1024,
    height: 1024,
    baseColor: appearance.baseColor,
    ...(appearance.maps?.albedo ? { albedo: { url: appearance.maps.albedo, tiling: appearance.uvTiling, offset: appearance.uvOffset } } : {}),
    panelSizeCm: { x: frame.max.x - frame.min.x, y: frame.max.y - frame.min.y },
    prints: placements,
  };
}
