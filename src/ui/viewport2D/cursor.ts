import type { ToolType } from '@/store';
import type { PressRole } from '@/ui/viewport2D/hitTest';

export const DRAW_CURSOR_TOOLS = new Set<ToolType>([
  'point', 'deletePoint', 'line', 'curve', 'internalLine', 'rect', 'circle', 'ellipse',
  'split', 'hole', 'dart', 'notch', 'annotation', 'measure', 'trim',
]);

export interface CursorState {
  tool: ToolType;
  panning: boolean;
  spaceDown: boolean;
  hover: PressRole;
  dragging: boolean;
}

export function viewport2DCursor(state: CursorState): string {
  if (state.panning || state.dragging) return 'grabbing';
  if (state.spaceDown) return 'grab';
  if (DRAW_CURSOR_TOOLS.has(state.tool)) return 'crosshair';
  return state.hover ?? 'default';
}
