import { describe, expect, it } from 'vitest';
import { GARMENT_TEMPLATES } from '@/pattern/template';

describe('garment template catalogue', () => {
  it('offers the five garment blocks in pattern-tab order', () => {
    expect(GARMENT_TEMPLATES.map(template => template.key))
      .toEqual(['tshirt', 'shirt', 'hoodie', 'skirt', 'dress']);
  });
});