import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../src/core/model/types';
import { packPanels } from '../../../src/pattern/marker/packing';
import { placePoint, type MarkerPiece } from '../../../src/pattern/marker/markerLayout';

/** Marker piece with a 10 x 6 cm rectangle outline. */
const piece: MarkerPiece = {
  panelId: 'p',
  name: 'p',
  width: 10,
  height: 6,
  outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
  grain: null,
};

const point: Vec2 = { x: 2, y: 1 };

describe('packPanels angles and flip', () => {
  it('places with an arbitrary angle and reports its rotated bounds', () => {
    const result = packPanels([{ id: 'p', width: 10, height: 6, qty: 1 }], 20, { angles: [30] });
    const placement = result.placements[0]!;
    expect(placement.angleDeg).toBe(30);
    expect(placement.width).toBeCloseTo(10 * Math.cos(Math.PI / 6) + 6 * 0.5, 6);
    expect(placement.height).toBeCloseTo(10 * 0.5 + 6 * Math.cos(Math.PI / 6), 6);
  });

  it('marks every placement flipped when the option is on', () => {
    const result = packPanels([{ id: 'p', width: 10, height: 6, qty: 2 }], 30, { flip: true });
    expect(result.placements).toHaveLength(2);
    expect(result.placements.every(placement => placement.flipped)).toBe(true);
  });

  it('mirrors the outline inside the piece before rotation', () => {
    const plain = { itemId: 'p', x: 0, y: 0, width: 10, height: 6, angleDeg: 0, flipped: false };
    const flipped = { ...plain, flipped: true };
    expect(placePoint(piece, plain, point)).toEqual({ x: 2, y: 1 });
    expect(placePoint(piece, flipped, point)).toEqual({ x: 8, y: 1 });
  });

  it('keeps the mirrored outline inside the placement bounds after rotation', () => {
    const placement = { itemId: 'p', x: 4, y: 2, width: 8.66, height: 8.66, angleDeg: 45, flipped: true };
    const mapped = placePoint(piece, placement, point);
    expect(mapped.x).toBeGreaterThanOrEqual(placement.x - 1e-6);
    expect(mapped.y).toBeGreaterThanOrEqual(placement.y - 1e-6);
  });
});
