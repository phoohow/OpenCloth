import { describe, expect, it } from 'vitest';
import { DRAW_CURSOR_TOOLS, viewport2DCursor, type CursorState } from '../../../src/ui/viewport2D/cursor';

const idle: CursorState = {
  tool: 'select', panning: false, spaceDown: false, hover: null, dragging: false,
};

const withState = (patch: Partial<CursorState>): CursorState => ({ ...idle, ...patch });

describe('2D viewport cursor', () => {
  it('keeps the plain arrow for the select tool', () => {
    expect(viewport2DCursor(idle)).toBe('default');
  });

  it('shows the crosshair only for drawing tools', () => {
    for (const tool of ['line', 'curve', 'internalLine', 'rect', 'circle', 'ellipse', 'split', 'hole', 'dart', 'notch', 'annotation', 'measure', 'trim', 'point'] as const) {
      expect(DRAW_CURSOR_TOOLS.has(tool)).toBe(true);
      expect(viewport2DCursor(withState({ tool }))).toBe('crosshair');
    }
    for (const tool of ['select', 'seam', 'topstitch', 'pin', 'unpin'] as const) {
      expect(DRAW_CURSOR_TOOLS.has(tool)).toBe(false);
      expect(viewport2DCursor(withState({ tool }))).toBe('default');
    }
  });

  it('promises a drag only where one can start', () => {
    expect(viewport2DCursor(withState({ hover: 'grab' }))).toBe('grab');
    expect(viewport2DCursor(withState({ hover: 'move' }))).toBe('move');
    expect(viewport2DCursor(withState({ hover: null }))).toBe('default');
    // A drawing tool keeps aiming even over something the select tool would grab.
    expect(viewport2DCursor(withState({ tool: 'line', hover: 'grab' }))).toBe('crosshair');
  });

  it('reports panning, space and ghost drags ahead of the tool and the hover', () => {
    expect(viewport2DCursor(withState({ panning: true }))).toBe('grabbing');
    expect(viewport2DCursor(withState({ tool: 'line', panning: true, hover: 'grab' }))).toBe('grabbing');
    expect(viewport2DCursor(withState({ spaceDown: true }))).toBe('grab');
    expect(viewport2DCursor(withState({ spaceDown: true, hover: 'move' }))).toBe('grab');
    expect(viewport2DCursor(withState({ tool: 'line', dragging: true }))).toBe('grabbing');
    expect(viewport2DCursor(withState({ panning: true, spaceDown: true, dragging: true }))).toBe('grabbing');
  });
});
