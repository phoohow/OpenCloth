import type { FabricAppearance, Pattern, Print, Project, Vec2 } from '@/model/types';

import { computeBBox } from '@/base/geom';
import { fabricForPanel, panelPrints } from '@/model';
import { samplePanelOutline, UV_TILE_CM } from '@/pattern/panel';
import { compositeCanvasSize, type PaintCommand, type PrintPlacement } from '@/render/common';
import { FALLBACK_APPEARANCE } from '@/runtime/engine/clothConstants';

export interface PanelPrintFrame {
  center: Vec2;
  min: Vec2;
  max: Vec2;
}

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

function frameSize(frame: PanelPrintFrame): { x: number; y: number } {
  return {
    x: Math.max(1e-6, frame.max.x - frame.min.x),
    y: Math.max(1e-6, frame.max.y - frame.min.y),
  };
}

export function printPlacement(print: Print, frame: PanelPrintFrame): PrintPlacement {
  const size = frameSize(frame);
  return {
    center: {
      x: (frame.center.x + print.center.x - frame.min.x) / size.x,
      y: (frame.center.y + print.center.y - frame.min.y) / size.y,
    },
    width: print.widthCm / size.x,
    height: print.heightCm / size.y,
    angleDeg: print.angleDeg,
    opacity: Math.min(1, Math.max(0, print.opacity)),
    repeat: { x: Math.max(1, print.repeat.x), y: Math.max(1, print.repeat.y) },
    imageUrl: print.imageUrl,
  };
}

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

export function paintCommand(
  appearance: FabricAppearance,
  frame: PanelPrintFrame,
  placements: readonly PrintPlacement[],
): PaintCommand {
  const size = frameSize(frame);
  const uv = {
    repeat: { x: UV_TILE_CM / size.x, y: UV_TILE_CM / size.y },
    offset: { x: -frame.min.x / size.x, y: -frame.min.y / size.y },
  };
  const albedoTiling = {
    x: (appearance.uvTiling.x * size.x) / UV_TILE_CM,
    y: (appearance.uvTiling.y * size.y) / UV_TILE_CM,
  };
  return {
    ...compositeCanvasSize(size),
    baseColor: appearance.baseColor,
    ...(appearance.maps?.albedo
      ? { albedo: { url: appearance.maps.albedo, tiling: albedoTiling, offset: appearance.uvOffset } }
      : {}),
    panelSizeCm: size,
    prints: placements,
    uv,
  };
}
