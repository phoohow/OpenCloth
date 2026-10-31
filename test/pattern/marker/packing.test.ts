import { describe, expect, it } from 'vitest';
import { packPanels, type Placement } from '../../../src/pattern/marker/packing';
import { placePoint } from '../../../src/pattern/marker/markerLayout';
import type { MarkerPiece } from '../../../src/pattern/marker/markerLayout';

describe('packPanels arbitrary angles', () => {
  it('rotates a wide piece 90 degrees when its flat width exceeds the fabric', () => {
    const result = packPanels([{ id: 'a', width: 120, height: 50, qty: 1 }], 100, { angles: [0, 90] });
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].angleDeg).toBe(90);
    expect(result.placements[0].width).toBeCloseTo(50, 6);
    expect(result.placements[0].height).toBeCloseTo(120, 6);
  });

  it('only uses the angles given', () => {
    const result = packPanels([{ id: 'a', width: 30, height: 40, qty: 3 }], 100, { angles: [0, 45] });
    for (const placement of result.placements) {
      expect([0, 45]).toContain(placement.angleDeg);
    }
  });

  it('throws when no allowed angle fits the fabric width', () => {
    expect(() => packPanels([{ id: 'a', width: 120, height: 50, qty: 1 }], 100, { angles: [0] }))
      .toThrow('无法排料');
  });
});

describe('placePoint rotation', () => {
  const piece: MarkerPiece = {
    panelId: 'p', name: 'p', width: 10, height: 20,
    outline: [], grain: null,
  };

  it('maps a 90-degree placement onto its rotated bounding box', () => {
    const place: Placement = { itemId: 'p', x: 0, y: 0, width: 20, height: 10, angleDeg: 90 };
    const bottomLeft = placePoint(piece, place, { x: 0, y: 0 });
    expect(bottomLeft.x).toBeCloseTo(20, 6);
    expect(bottomLeft.y).toBeCloseTo(0, 6);
    const topRight = placePoint(piece, place, { x: 10, y: 20 });
    expect(topRight.x).toBeCloseTo(0, 6);
    expect(topRight.y).toBeCloseTo(10, 6);
  });

  it('keeps a 0-degree placement unchanged', () => {
    const place: Placement = { itemId: 'p', x: 3, y: 4, width: 10, height: 20, angleDeg: 0 };
    expect(placePoint(piece, place, { x: 2, y: 5 })).toEqual({ x: 5, y: 9 });
  });
});