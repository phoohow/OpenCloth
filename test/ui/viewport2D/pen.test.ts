import { describe, expect, it } from 'vitest';
import { createPen } from '@/ui/viewport2D/pen';
import { DRAW_LAYERS, type DisplayOptions, type SceneState } from '@/ui/viewport2D/render';

const display = (patch: Partial<DisplayOptions> = {}): DisplayOptions => ({
  internal: true, darts: true, seamAllowance: false, notches: true, grain: true,
  annotations: true, measurements: true, gradingOverlay: false, seamJoin: false,
  prints: true, topstitches: true, trims: true, wireframe: false,
  ...patch,
});

const state = (patch: Partial<SceneState> = {}): SceneState => ({
  showSeams: false,
  ...patch,
} as SceneState);

describe('createPen', () => {
  it('binds the canvas size, view and projection together', () => {
    const ctx = {} as CanvasRenderingContext2D;
    const view = { offsetX: 10, offsetY: -5, scale: 2 };
    const pen = createPen(ctx, 800, 600, view);
    expect(pen.ctx).toBe(ctx);
    expect(pen.width).toBe(800);
    expect(pen.height).toBe(600);
    expect(pen.view).toBe(view);
    expect(pen.scale).toBe(2);
    expect(pen.screen({ x: 3, y: 4 })).toEqual({ x: 416, y: 297 });
  });
});

describe('DRAW_LAYERS', () => {
  it('keeps the back-to-front paint order explicit', () => {
    expect(DRAW_LAYERS.map(layer => layer.id)).toEqual([
      'background', 'grading', 'panels', 'prints', 'internalLines', 'darts',
      'notches', 'grain', 'topstitches', 'trims', 'annotations', 'measurements',
      'seams', 'seamJoints', 'selection', 'draft', 'seamDraft', 'insertHint',
      'snapHint', 'hover', 'markHint', 'ghost', 'rubberBand', 'ruler',
    ]);
  });

  it('gates the optional layers on display switches and interaction state', () => {
    const off = display({ gradingOverlay: false, prints: false, internal: false, darts: false,
      notches: false, grain: false, topstitches: false, trims: false, annotations: false,
      measurements: false, seamJoin: false });
    const on = display({ gradingOverlay: true, seamJoin: true });
    for (const layer of DRAW_LAYERS) {
      if (!layer.when) continue;
      if (layer.id === 'seams') {
        expect(layer.when(state({ showSeams: false }), off)).toBe(false);
        expect(layer.when(state({ showSeams: true }), off)).toBe(true);
      } else {
        expect(layer.when(state(), off)).toBe(false);
        expect(layer.when(state(), on)).toBe(true);
      }
    }
  });

  it('always draws the background and the ruler', () => {
    expect(DRAW_LAYERS[0]?.when).toBeUndefined();
    expect(DRAW_LAYERS[DRAW_LAYERS.length - 1]?.when).toBeUndefined();
  });
});
