import { presetPattern } from '@/pattern/template';
import { describe, expect, it } from 'vitest';
import { edgeLength } from '@/pattern/geom/edgeSample';
import type { Pattern } from '@/model/types';

/** Seam sides have to be the same length, or the stitches gather or stretch one of them. */
describe('template seam lengths', () => {
  const cases: Array<[string, () => Pattern]> = [
    ['T-shirt', () => presetPattern('tshirt')],
    ['shirt', () => presetPattern('shirt')],
    ['hoodie', () => presetPattern('hoodie')],
    ['skirt', () => presetPattern('skirt')],
    ['dress', () => presetPattern('dress')],
  ];

  for (const [name, build] of cases) {
    it(`pairs every ${name} seam with an equal arc length`, () => {
      const pattern = build();
      for (const seam of Object.values(pattern.seams)) {
        // A seam can cover part of an edge, so the interval it names is what has to match.
        const a = edgeLength(pattern, seam.a.edgeId) * Math.abs(seam.a.t1 - seam.a.t0);
        const b = edgeLength(pattern, seam.b.edgeId) * Math.abs(seam.b.t1 - seam.b.t0);
        // One percent covers the sampling difference between two drafted curves.
        expect(Math.abs(a - b) / Math.max(a, b), `${seam.id}: ${a} vs ${b}`).toBeLessThan(0.01);
      }
    });
  }
});