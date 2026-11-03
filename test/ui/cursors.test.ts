import { describe, expect, it } from 'vitest';
import { CLAMP_CURSOR, OPEN_CLAMP_CURSOR, PIN_CURSOR, UNPIN_CURSOR } from '../../src/ui/viewport3D/cursors';

/** Pixel hotspot a CSS cursor string falls back to, from its `url(...) <x> <y>, auto` suffix. */
function hotspotOf(cursor: string): string {
  return cursor.slice(cursor.lastIndexOf('")') + 2).trim();
}

/** Decodes the inline SVG of a cursor so its markup can be inspected. */
function svgOf(cursor: string): string {
  const start = cursor.indexOf('data:image/svg+xml,') + 'data:image/svg+xml,'.length;
  return decodeURIComponent(cursor.slice(start, cursor.lastIndexOf('")')));
}

/** Arm segments of a clamp glyph: `[gripX, gripY, tipX, tipY]` per side, left first. */
function leversOf(cursor: string): number[][] {
  const svg = svgOf(cursor);
  const paths = [...svg.matchAll(/<path d="(M [^"]+)"/g)].map(match => match[1]!);
  return paths
    .filter(d => d.includes(' L ') && !d.includes(' A '))
    .map(d => d.replace('M ', '').replace(' L ', ' ').split(' ').map(Number))
    .slice(0, 2);
}

describe('3D cursors', () => {
  it('keeps both clamp states on the same hotspot so the glyph does not jump on press', () => {
    expect(hotspotOf(OPEN_CLAMP_CURSOR)).toBe('19 26, auto');
    expect(hotspotOf(CLAMP_CURSOR)).toBe('19 26, auto');
  });

  it('draws each lever as one straight run, never a bent path', () => {
    for (const cursor of [OPEN_CLAMP_CURSOR, CLAMP_CURSOR]) {
      const levers = leversOf(cursor);
      expect(levers).toHaveLength(2);
      // A straight lever is a single move plus a single line: no second " L " in the path.
      for (const lever of levers) expect(lever).toHaveLength(4);
    }
  });

  it('swings the jaws open while the grips come in, as a lever pivoting on the spring', () => {
    const closed = leversOf(CLAMP_CURSOR);
    const open = leversOf(OPEN_CLAMP_CURSOR);

    const jawWidth = (levers: number[][]) => Math.abs(levers[0]![2]! - levers[1]![2]!);
    const gripWidth = (levers: number[][]) => Math.abs(levers[0]![0]! - levers[1]![0]!);

    expect(jawWidth(closed)).toBeCloseTo(1.2, 1);
    expect(jawWidth(open)).toBeGreaterThan(jawWidth(closed) + 5);
    expect(gripWidth(open)).toBeLessThan(gripWidth(closed) - 5);
    // The lever keeps its length: only its angle changes.
    for (const levers of [closed, open]) {
      const [gx, gy, tx, ty] = levers[1]!;
      expect(Math.hypot(tx! - gx!, ty! - gy!)).toBeCloseTo(19.9, 0);
    }
  });

  it('draws the PIN glyph as a white ring around a small red core', () => {
    const svg = svgOf(PIN_CURSOR);
    expect(svg).toContain('A 6.5 6.5');
    expect(svg).toContain('r="2" fill="#ff3b3b"');
    expect(svg).toContain('r="3.1" fill="#000"');
  });

  it('marks every glyph as an SVG cursor with a pixel hotspot', () => {
    for (const cursor of [OPEN_CLAMP_CURSOR, CLAMP_CURSOR, PIN_CURSOR, UNPIN_CURSOR]) {
      expect(cursor.startsWith('url("data:image/svg+xml,')).toBe(true);
      expect(cursor).toMatch(/"\) \d+ \d+, auto$/);
    }
  });
});
