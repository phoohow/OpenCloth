import type { Vec2 } from '@/base/math';

export const COMPOSITE_MAX_SIDE = 1024;

export const COMPOSITE_MIN_SIDE = 64;

export interface CanvasSize {
  width: number;
  height: number;
}

export function compositeCanvasSize(size: Vec2): CanvasSize {
  const w = Math.max(1e-6, size.x);
  const h = Math.max(1e-6, size.y);
  const aspect = w / h;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return { width: COMPOSITE_MAX_SIDE, height: COMPOSITE_MAX_SIDE };
  }

  return aspect >= 1
    ? { width: COMPOSITE_MAX_SIDE, height: Math.max(COMPOSITE_MIN_SIDE, Math.round(COMPOSITE_MAX_SIDE / aspect)) }
    : { width: Math.max(COMPOSITE_MIN_SIDE, Math.round(COMPOSITE_MAX_SIDE * aspect)), height: COMPOSITE_MAX_SIDE };
}
