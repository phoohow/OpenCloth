import { describe, expect, it } from 'vitest';
import { vec2, type Pattern } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { pickPointHandle } from '../../../src/ui/viewport2D/hitTest';

/** Press radius used by every case, in world centimetres. */
const RADIUS = 2;

/** Pattern with a single point at the origin, a short handle 1 cm right and a far one 1 cm above. */
function pointPattern(): Pattern {
  const pattern = createDefaultProject().pattern;
  pattern.points = {
    p: {
      id: 'p',
      pos: vec2(0, 0),
      kind: 'smooth',
      handleOut: { x: 1, y: 0 },
      handleIn: { x: 0, y: 1 },
    },
  };
  return pattern;
}

describe('curve handle press', () => {
  it('leaves a press on the vertex to the vertex even when a short handle is in range', () => {
    expect(pickPointHandle(pointPattern(), ['p'], vec2(0, 0), RADIUS)).toBeNull();
  });

  it('takes a press nearer the handle than the vertex', () => {
    expect(pickPointHandle(pointPattern(), ['p'], vec2(0.9, 0), RADIUS)).toEqual({
      pointId: 'p',
      which: 'out',
      pos: { x: 1, y: 0 },
    });
  });

  it('reads only the points it is given', () => {
    expect(pickPointHandle(pointPattern(), [], vec2(0.9, 0), RADIUS)).toBeNull();
  });

  it('ignores handles outside the radius', () => {
    expect(pickPointHandle(pointPattern(), ['p'], vec2(3.5, 0), RADIUS)).toBeNull();
  });

  it('leaves the press to a vertex another point owns', () => {
    const pattern = pointPattern();
    pattern.points.q = { id: 'q', pos: vec2(1, 0) };
    expect(pickPointHandle(pattern, ['p'], vec2(1, 0), RADIUS)).toBeNull();
  });
});
