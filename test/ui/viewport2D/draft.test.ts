import { describe, expect, it } from 'vitest';
import { vec2 } from '../../../src/core/model/types';
import { cleanDraftLoop } from '../../../src/ui/viewport2D/tools';

describe('cleanDraftLoop', () => {
  it('keeps a plain loop untouched', () => {
    const loop = [vec2(0, 0), vec2(10, 0), vec2(10, 10)];
    expect(cleanDraftLoop(loop)).toEqual(loop);
  });

  it('drops a repeated click on the same position', () => {
    const loop = cleanDraftLoop([vec2(0, 0), vec2(10, 0), vec2(10, 0), vec2(10, 10)]);

    expect(loop).toHaveLength(3);
    expect(loop[2]).toEqual(vec2(10, 10));
  });

  it('drops a closing point that lands back on the start', () => {
    const loop = cleanDraftLoop([vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 0)]);

    expect(loop).toHaveLength(3);
  });

  it('reduces a stroke that never left the first point to nothing usable', () => {
    const loop = cleanDraftLoop([vec2(2, 2), vec2(2, 2)]);

    expect(loop).toHaveLength(1);
  });
});
