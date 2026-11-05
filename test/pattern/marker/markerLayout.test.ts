import { describe, expect, it } from 'vitest';
import { createEmptyPattern } from '@/model/defaults';
import { buildMarkerLayout } from '@/pattern/marker/markerLayout';
import { addSquare } from '../../core/command/fixtures';

/** One square panel graded 2 cm wider at size L. */
function gradedSquare() {
  const pattern = createEmptyPattern();
  addSquare(pattern, 'sq', 0, 0, 10);
  pattern.points.sq_p1 = { ...pattern.points.sq_p1, grading: { size_L: { x: 2, y: 0 } } };
  pattern.points.sq_p2 = { ...pattern.points.sq_p2, grading: { size_L: { x: 2, y: 0 } } };
  return pattern;
}

describe('buildMarkerLayout sizes', () => {
  it('packs the current pattern once when no size scope is given', () => {
    const layout = buildMarkerLayout(gradedSquare(), { fabricWidthCm: 100 });
    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0].piece.name).toBe('sq');
    expect(layout.placements[0].piece.width).toBeCloseTo(12, 6);
  });

  it('packs every requested size and labels each piece with its size', () => {
    const layout = buildMarkerLayout(gradedSquare(), {
      fabricWidthCm: 100,
      sizes: [{ id: 'size_M', label: 'M' }, { id: 'size_L', label: 'L' }],
    });
    expect(layout.placements).toHaveLength(2);
    const byName = new Map(layout.placements.map(entry => [entry.piece.name, entry.piece.width]));
    expect(byName.get('sq M')).toBeCloseTo(12, 6);
    expect(byName.get('sq L')).toBeCloseTo(14, 6);
    expect(new Set(layout.placements.map(entry => entry.piece.panelId)).size).toBe(2);
  });
});
