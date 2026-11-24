import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/app';
import { edgeMidpoint, insertTargetOnEdge } from '@/ui/viewport2D/snap';

describe('point tool midpoint snapping', () => {
  const pattern = createStarterProject().pattern;
  const straight = Object.values(pattern.edges).find(edge => edge.type === 'line')!;
  const start = pattern.points[straight.startPointId]!.pos;
  const end = pattern.points[straight.endPointId]!.pos;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  it('takes the midpoint of a straight edge as the average of its ends', () => {
    const found = edgeMidpoint(pattern, straight.id);
    expect(found).not.toBeNull();
    expect(found!.x).toBeCloseTo(mid.x, 9);
    expect(found!.y).toBeCloseTo(mid.y, 9);
  });

  it('locks the landing point onto the midpoint when the cursor is on it', () => {
    const target = insertTargetOnEdge(pattern, { edgeId: straight.id, point: mid }, mid, 0.2);
    expect(target.snapped).toBe(true);
    expect(target.pos).toEqual(mid);
  });

  it('still locks when the cursor is within the tolerance of the midpoint', () => {
    const cursor = { x: mid.x + 0.1, y: mid.y };
    const target = insertTargetOnEdge(pattern, { edgeId: straight.id, point: mid }, cursor, 0.2);
    expect(target.snapped).toBe(true);
    expect(target.pos).toEqual(mid);
  });

  it('keeps the projected point when the cursor is clear of the midpoint', () => {
    const point = { x: start.x + (end.x - start.x) / 4, y: start.y + (end.y - start.y) / 4 };
    const target = insertTargetOnEdge(pattern, { edgeId: straight.id, point }, point, 0.2);
    expect(target.snapped).toBe(false);
    expect(target.pos).toBe(point);
    expect(target.mid).toEqual(mid);
  });
});
