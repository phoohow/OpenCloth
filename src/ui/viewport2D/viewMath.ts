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

/**
 * Centimetres between grid lines at this zoom. The step coarsens as the view zooms out and doubles
 * until the lines stay at least `minPx` apart, so they never smear into a solid fill.
 */
export function gridStepCm(scale: number, minPx = 4): number {
  let cm = scale > 8 ? 5 : scale > 3 ? 10 : 20;
  while (cm * scale < minPx) cm *= 2;
  return cm;
}

/** Tick ladder the ruler labels step through, in centimetres. */
const RULER_STEPS_CM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

/** Centimetres between major ruler ticks, spaced for at least `minPx` pixels. */
export function rulerStepCm(scale: number, minPx = 64): number {
  return RULER_STEPS_CM.find(cm => cm * scale >= minPx) ?? RULER_STEPS_CM[RULER_STEPS_CM.length - 1];
}

/** Major ruler tick positions in centimetres spanning the visible world range. */
export function rulerTicks(fromCm: number, toCm: number, stepCm: number): number[] {
  return tickRange(fromCm, toCm, stepCm);
}

/** Minor ruler tick positions: the subdivisions between the majors, majors excluded. */
export function rulerMinorTicks(fromCm: number, toCm: number, stepCm: number): number[] {
  return tickRange(fromCm, toCm, stepCm / 5).filter(v => !isMultipleOf(v, stepCm));
}

/** Every `unit` step inside the range, rounded so labels print clean numbers. */
function tickRange(fromCm: number, toCm: number, unit: number): number[] {
  const first = Math.ceil(fromCm / unit - 1e-9) * unit;
  const out: number[] = [];
  for (let v = first; v <= toCm + 1e-9; v += unit) {
    const tick = Math.round(v * 1e6) / 1e6;
    out.push(tick === 0 ? 0 : tick);
  }
  return out;
}

/** Whether a tick sits exactly on a multiple of the major step. */
function isMultipleOf(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

/** Ruler label text: whole centimetres print bare, sub-centimetre steps keep one decimal. */
export function rulerLabel(tickCm: number, stepCm: number): string {
  return stepCm >= 1 ? String(Math.round(tickCm)) : tickCm.toFixed(1);
}

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
