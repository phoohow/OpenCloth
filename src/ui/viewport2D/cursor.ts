import type { ToolType } from '../../store/uiStore';
import type { PressRole } from './hitTest';

/**
 * Tools that drop geometry where the pointer lands. Only these show the crosshair: while drawing
 * the cursor is an aiming reticle, while selecting it stays the plain arrow the OS gives you.
 */
export const DRAW_CURSOR_TOOLS = new Set<ToolType>([
  'point', 'deletePoint', 'line', 'curve', 'internalLine', 'rect', 'circle', 'ellipse',
  'split', 'hole', 'dart', 'notch', 'annotation', 'measure', 'trim',
]);

/** Everything the 2D canvas knows about the pointer when it picks a cursor. */
export interface CursorState {
  tool: ToolType;
  /** Middle-button or space panning in progress. */
  panning: boolean;
  /** Space held down: the next press pans instead of drawing. */
  spaceDown: boolean;
  /** What the pointer is over, already reduced to a drag affordance. */
  hover: PressRole;
  /** A drag with a live ghost (panel, point, handle, notch, print, trim) is in flight. */
  dragging: boolean;
}

/**
 * CSS cursor for the 2D canvas. Drawing tools aim, everything else keeps the default arrow except
 * over something a press would move, so the cursor only promises a drag where one can start.
 */
export function viewport2DCursor(state: CursorState): string {
  if (state.panning || state.dragging) return 'grabbing';
  if (state.spaceDown) return 'grab';
  if (DRAW_CURSOR_TOOLS.has(state.tool)) return 'crosshair';
  return state.hover ?? 'default';
}
