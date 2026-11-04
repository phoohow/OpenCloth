import { describe, expect, it } from 'vitest';
import { sampleEdge } from '../../../src/pattern/panel/panelBuilder';
import { drawFrame, patternWithLines, samePath, screenPoints, type Frame } from './canvasScene';
import type { DraftState } from '../../../src/ui/viewport2D/tools';

const SEAM_HOVER_COLOR = '#4da6ff';
const HOVER_DASH = '5,3';

const hover = (edgeId: string) => ({ edgeId, t0: 0, t1: 1 });
const picked = (edgeId: string, startLow?: boolean) => ({ edgeId, t0: 0, t1: 1, startLow });
const draft = (sides: ReturnType<typeof picked>[]): DraftState => ({ tool: 'seam', sides, drag: null });

/** Whether the blue dashed pending-side stroke was recorded for an edge. */
function hasHover(frame: Frame, edgeId: string): boolean {
  const edge = screenPoints(sampleEdge(patternWithLines(), edgeId));
  return frame.strokes.some(s => s.style === SEAM_HOVER_COLOR && s.width === 3
    && s.dash.join(',') === HOVER_DASH && samePath(s.points, edge));
}

describe('seam tool hover highlight', () => {
  it('highlights the edge under the cursor before the first pick', () => {
    expect(hasHover(drawFrame({ seamHover: hover('e0') }), 'e0')).toBe(true);
  });

  it('keeps highlighting after a finished seam leaves an idle draft', () => {
    const frame = drawFrame({ seamHover: hover('e0'), draft: draft([]) });
    expect(hasHover(frame, 'e0')).toBe(true);
  });

  it('highlights the second side while the first side is armed', () => {
    const frame = drawFrame({ seamHover: hover('e2'), draft: draft([picked('e0', true)]) });
    expect(hasHover(frame, 'e2')).toBe(true);
  });

  it('does not highlight while a start vertex is awaited', () => {
    const frame = drawFrame({ seamHover: hover('e2'), draft: draft([picked('e0')]) });
    expect(hasHover(frame, 'e2')).toBe(false);
  });

  it('does not highlight a side that is already picked', () => {
    const frame = drawFrame({ seamHover: hover('e0'), draft: draft([picked('e0', true)]) });
    expect(hasHover(frame, 'e0')).toBe(false);
  });
});
