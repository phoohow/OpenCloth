import { describe, expect, it } from 'vitest';
import { DEFAULT_TSHIRT_PARAMS, generateTShirt } from '../../../src/pattern/template/tShirtTemplate';
import { edgeLength } from '../../../src/pattern/geom/edgeSample';

/** Seam sides have to be the same length, or the stitches gather or stretch one of them. */
describe('T-shirt seam lengths', () => {
  it('pairs every seam with an equal arc length', () => {
    const pattern = generateTShirt(DEFAULT_TSHIRT_PARAMS);
    for (const seam of Object.values(pattern.seams)) {
      const a = edgeLength(pattern, seam.a.edgeId);
      const b = edgeLength(pattern, seam.b.edgeId);
      // One percent covers the sampling difference between two drafted curves.
      expect(Math.abs(a - b) / Math.max(a, b), `${seam.id}: ${a} vs ${b}`).toBeLessThan(0.01);
    }
  });
});
