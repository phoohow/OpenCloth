import type { Vec2 } from '../../core/model/types';

/** Pan and zoom of the 2D pattern view, in canvas pixels. */
export interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

// Zoom clamp and snap step, in canvas pixels per world centimeter.
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 50;
export const SNAP_STEP_CM = 0.5;

/** World centimeters to canvas pixels; canvas-centered, Y up. */
export function toScreen(p: Vec2, view: ViewTransform, w: number, h: number): Vec2 {
  return {
    x: w / 2 + (p.x * view.scale + view.offsetX),
    y: h / 2 - (p.y * view.scale + view.offsetY),
  };
}

/** Canvas pixels to world centimeters. */
export function toWorld(s: Vec2, view: ViewTransform, w: number, h: number): Vec2 {
  return {
    x: (s.x - w / 2 - view.offsetX) / view.scale,
    y: (h / 2 - s.y - view.offsetY) / view.scale,
  };
}

/** Wheel zoom keeping the world point under the cursor fixed on screen. */
export function zoomAround(
  view: ViewTransform, cursor: Vec2, factor: number, w: number, h: number,
): ViewTransform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
  const world = toWorld(cursor, view, w, h);
  return {
    scale,
    offsetX: cursor.x - w / 2 - world.x * scale,
    offsetY: h / 2 - cursor.y - world.y * scale,
  };
}

/** View transform that fits a bounding box into the canvas with pixel padding. */
export function fitView(
  bbox: { min: Vec2; max: Vec2 }, w: number, h: number, padding = 40,
): ViewTransform {
  const bw = Math.max(bbox.max.x - bbox.min.x, 1e-3);
  const bh = Math.max(bbox.max.y - bbox.min.y, 1e-3);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((w - 2 * padding) / bw, (h - 2 * padding) / bh)));
  const cx = (bbox.min.x + bbox.max.x) / 2;
  const cy = (bbox.min.y + bbox.max.y) / 2;
  return { scale, offsetX: -cx * scale, offsetY: -cy * scale };
}

/** Rounds a coordinate to the snap grid. */
export function snapToGrid(v: Vec2, step = SNAP_STEP_CM): Vec2 {
  return { x: Math.round(v.x / step) * step, y: Math.round(v.y / step) * step };
}
