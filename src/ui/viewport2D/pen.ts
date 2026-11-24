import type { Vec2 } from '@/model/types';

import { toScreen, type ViewTransform } from '@/ui/viewport2D/viewMath';

export interface Pen {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly view: ViewTransform;
  readonly scale: number;
  screen(point: Vec2): Vec2;
}

export function createPen(
  ctx: CanvasRenderingContext2D, width: number, height: number, view: ViewTransform,
): Pen {
  return {
    ctx,
    width,
    height,
    view,
    scale: view.scale,
    screen: (point: Vec2) => toScreen(point, view, width, height),
  };
}
