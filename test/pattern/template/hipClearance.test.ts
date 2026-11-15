import { presetPattern, PRESET_PARAMS } from '@/pattern/template';
import { describe, expect, it } from 'vitest';
import { samplePanelOutline } from '@/pattern/panel/panelBuilder';
import type { Panel, Pattern } from '@/model/types';

/** Width of one panel's outline at a height, interpolated between the nearest samples. */
function widthAt(pattern: Pattern, panel: Panel, y: number): number {
  const points = samplePanelOutline(pattern, panel);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if ((a.y - y) * (b.y - y) > 0) continue;
    const t = a.y === b.y ? 0 : (y - a.y) / (b.y - a.y);
    const x = a.x + (b.x - a.x) * t;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return max > min ? max - min : 0;
}

/** Total horizontal width of the garment at the hip line, below the waist (top edge). */
function hipGirth(pattern: Pattern, panels: Panel[], hipDepthCm: number): number {
  return panels.reduce((sum, panel) => {
    const points = samplePanelOutline(pattern, panel);
    const top = Math.max(...points.map(point => point.y));
    return sum + widthAt(pattern, panel, top - hipDepthCm);
  }, 0);
}

describe('skirt hip clearance', () => {
  it('keeps each gore wide enough at the hip that the skirt cannot slide over it', () => {
    const pattern = presetPattern('skirt');
    const front = Object.values(pattern.panels).filter(panel => panel.name.startsWith('前裙片'));
    const girth = hipGirth(pattern, front, 18) * 2;
    expect(girth).toBeGreaterThanOrEqual(PRESET_PARAMS.skirt.hipCm);
  });
});

describe('dress hip clearance', () => {
  it('keeps the skirt wide enough at the hip line', () => {
    const pattern = presetPattern('dress');
    const front = Object.values(pattern.panels).find(panel => panel.name === '前裙片');
    expect(front).toBeTruthy();
    const girth = hipGirth(pattern, [front!], 18) * 2;
    expect(girth).toBeGreaterThanOrEqual(PRESET_PARAMS.dress.hipCm);
  });
});