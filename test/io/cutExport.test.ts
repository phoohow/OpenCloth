import { describe, expect, it } from 'vitest';
import { markerGerber, markerHpgl } from '../../src/io/cutExport';
import { generateTote } from '../../src/pattern/template/bagTemplate';
import { buildMarkerLayout } from '../../src/pattern/marker/markerLayout';

describe('cut exports', () => {
  it('writes a Gerber file with one closed contour per placed piece', () => {
    const pattern = generateTote();
    const layout = buildMarkerLayout(pattern, { fabricWidthCm: 150, gapCm: 0.5 });
    const gerber = markerGerber(pattern, { fabricWidthCm: 150, gapCm: 0.5 });
    expect(gerber.startsWith('%FSLAX46Y46*%\n%MOMM*%')).toBe(true);
    expect(gerber.trimEnd().endsWith('M02*')).toBe(true);
    expect(gerber.match(/D02\*/g)).toHaveLength(layout.placements.length);
  });

  it('writes an HPGL file that returns the pen before ending', () => {
    const pattern = generateTote();
    const layout = buildMarkerLayout(pattern, { fabricWidthCm: 150, gapCm: 0.5 });
    const hpgl = markerHpgl(pattern, { fabricWidthCm: 150, gapCm: 0.5 });
    expect(hpgl.startsWith('IN;SP1;')).toBe(true);
    expect(hpgl.endsWith('SP0;')).toBe(true);
    expect(hpgl.match(/PD/g)).toHaveLength(layout.placements.length);
  });
});
