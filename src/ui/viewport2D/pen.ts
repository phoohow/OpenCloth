import type { Vec2 } from '../../core/model/types';
import { toScreen, type ViewTransform } from './viewMath';

/** Everything one draw layer needs to put a world-space point on the pane. */
export interface Pen {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly view: ViewTransform;
  /** Screen pixels per centimetre. */
  readonly scale: number;
  /** Projects a pattern-space point into canvas pixels. */
  screen(point: Vec2): Vec2;
}

/** Binds the canvas, its size and the view transform into one drawing target. */
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
