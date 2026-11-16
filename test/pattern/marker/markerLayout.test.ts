import { describe, expect, it } from 'vitest';
import { createEmptyPattern } from '@/model/defaults';
import type { Pattern, Vec2 } from '@/model/types';
import { buildMarkerLayout } from '@/pattern/marker/markerLayout';

/** Counter-clockwise 10 cm square panel with prefixed ids. */
function addSquare(pattern: Pattern, prefix: string, x: number, y: number, size: number): void {
  const corners: Vec2[] = [
    { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
  ];
  const pointIds = corners.map((pos, i) => {
    const id = `${prefix}_p${i}`;
    pattern.points[id] = { id, pos };
    return id;
  });
  const edgeIds = pointIds.map((_, i) => {
    const id = `${prefix}_e${i}`;
    pattern.edges[id] = {
      id, type: 'line', startPointId: pointIds[i]!, endPointId: pointIds[(i + 1) % 4]!,
    };
    return id;
  });
  pattern.panels[`${prefix}_panel`] = {
    id: `${prefix}_panel`, name: prefix, outlineEdgeIds: edgeIds, dartIds: [], internalLineIds: [],
    seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 3, visible: true, locked: false,
  };
}

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
