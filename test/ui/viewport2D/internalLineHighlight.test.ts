import { describe, expect, it } from 'vitest';
import { elementNodeId } from '../../../src/core/model/elementRef';
import { drawFrame, patternWithLines, samePath, screenPoints } from './canvasScene';

describe('internal line selection highlight', () => {
  it('draws both lines in their usage colours when nothing is selected', () => {
    const { strokes } = drawFrame();
    const fold = patternWithLines().internalLines.fold!;
    const split = patternWithLines().internalLines.split!;

    expect(strokes.some(s => s.style === '#8ec7ff' && s.width === 1.5 && samePath(s.points, screenPoints(fold.points)))).toBe(true);
    expect(strokes.some(s => s.style === '#c7a5ff' && s.width === 1.5 && samePath(s.points, screenPoints(split.points)))).toBe(true);
    expect(strokes.some(s => s.style === '#ffd75e')).toBe(false);
  });

  it('highlights the picked line in solid yellow with a halo and vertex markers', () => {
    const { strokes, fills } = drawFrame({ selection: [elementNodeId('internal', 'fold')] });
    const points = screenPoints(patternWithLines().internalLines.fold!.points);

    expect(strokes.some(s => s.style === '#ffd75e' && s.width === 3 && s.dash.length === 0
      && samePath(s.points, points))).toBe(true);
    expect(strokes.some(s => s.style === 'rgba(255,215,94,0.25)' && s.width === 8
      && samePath(s.points, points))).toBe(true);
    for (const p of points) {
      expect(fills.some(f => f.style === '#ffd75e' && f.at
        && Math.abs(f.at.x - p.x) < 1e-6 && Math.abs(f.at.y - p.y) < 1e-6)).toBe(true);
    }
  });

  it('leaves the other line in its usage colour', () => {
    const { strokes } = drawFrame({ selection: [elementNodeId('internal', 'fold')] });
    const split = screenPoints(patternWithLines().internalLines.split!.points);

    expect(strokes.some(s => s.style === '#c7a5ff' && samePath(s.points, split))).toBe(true);
    expect(strokes.some(s => s.style === '#ffd75e' && samePath(s.points, split))).toBe(false);
  });

  it('highlights a solid split line too', () => {
    const { strokes } = drawFrame({ selection: [elementNodeId('internal', 'split')] });
    const split = screenPoints(patternWithLines().internalLines.split!.points);

    expect(strokes.some(s => s.style === '#ffd75e' && s.width === 3 && samePath(s.points, split))).toBe(true);
  });
});
