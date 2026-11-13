import { describe, expect, it } from 'vitest';
import { DEFAULT_TSHIRT_PARAMS, generateTShirt } from '@/pattern/template/tShirtTemplate';
import { generateShirt } from '@/pattern/template/shirtTemplate';
import { generateHoodie } from '@/pattern/template/hoodieTemplate';
import { generateSkirt } from '@/pattern/template/skirtTemplate';
import { generateDress } from '@/pattern/template/dressTemplate';
import { edgeLength } from '@/pattern/geom/edgeSample';
import type { Pattern } from '@/model/types';

/** Seam sides have to be the same length, or the stitches gather or stretch one of them. */
describe('template seam lengths', () => {
  const cases: Array<[string, () => Pattern]> = [
    ['T-shirt', () => generateTShirt(DEFAULT_TSHIRT_PARAMS)],
    ['shirt', () => generateShirt()],
    ['hoodie', () => generateHoodie()],
    ['skirt', () => generateSkirt()],
    ['dress', () => generateDress()],
  ];

  for (const [name, build] of cases) {
    it(`pairs every ${name} seam with an equal arc length`, () => {
      const pattern = build();
      for (const seam of Object.values(pattern.seams)) {
        const a = edgeLength(pattern, seam.a.edgeId);
        const b = edgeLength(pattern, seam.b.edgeId);
        // One percent covers the sampling difference between two drafted curves.
        expect(Math.abs(a - b) / Math.max(a, b), `${seam.id}: ${a} vs ${b}`).toBeLessThan(0.01);
      }
    });
  }
});