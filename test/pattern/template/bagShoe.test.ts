import { describe, expect, it } from 'vitest';
import { generateTote, DEFAULT_TOTE_PARAMS } from '@/pattern/template/bagTemplate';
import { generateShoes, DEFAULT_SHOE_PARAMS } from '@/pattern/template/shoeTemplate';
import { samplePanelOutline } from '@/pattern/panel/panelBuilder';
import { computeBBox, polygonArea } from '@/common/geom';
import type { Pattern } from '@/model/types';

/** Panel whose name matches, or undefined. */
function panelByName(pattern: Pattern, name: string) {
  return Object.values(pattern.panels).find(panel => panel.name === name);
}

describe('tote bag template', () => {
  it('creates front, back, bottom and two handles with four seams', () => {
    const pattern = generateTote();
    expect(Object.keys(pattern.panels)).toHaveLength(5);
    expect(Object.keys(pattern.seams)).toHaveLength(4);
    expect(panelByName(pattern, '前片')).toBeTruthy();
    expect(panelByName(pattern, '底片')).toBeTruthy();
    expect(panelByName(pattern, '提手 1')).toBeTruthy();
  });

  it('follows the requested body size', () => {
    const pattern = generateTote({ ...DEFAULT_TOTE_PARAMS, widthCm: 45, heightCm: 50 });
    const front = panelByName(pattern, '前片')!;
    const box = computeBBox(samplePanelOutline(pattern, front));
    expect(box.max.x - box.min.x).toBeCloseTo(45, 3);
    expect(box.max.y - box.min.y).toBeCloseTo(50, 3);
  });

  it('lays the pieces out in separated rows', () => {
    const pattern = generateTote();
    const boxes = Object.values(pattern.panels).map(panel => computeBBox(samplePanelOutline(pattern, panel)));
    const rowTops = [...new Set(boxes.map(box => Math.round(box.max.y * 1000) / 1000))].sort((a, b) => b - a);
    for (let i = 1; i < rowTops.length; i++) {
      const previousBottom = Math.min(...boxes.filter(box => Math.round(box.max.y * 1000) / 1000 === rowTops[i - 1]!).map(box => box.min.y));
      expect(rowTops[i]!).toBeLessThan(previousBottom);
    }
  });
});

describe('shoe template', () => {
  it('creates mirrored uppers and soles', () => {
    const pattern = generateShoes();
    expect(Object.keys(pattern.panels)).toHaveLength(4);
    const left = panelByName(pattern, '左鞋帮')!;
    const right = panelByName(pattern, '右鞋帮')!;
    const leftBox = computeBBox(samplePanelOutline(pattern, left));
    const rightBox = computeBBox(samplePanelOutline(pattern, right));
    expect(leftBox.max.x - leftBox.min.x).toBeCloseTo(rightBox.max.x - rightBox.min.x, 3);
    expect(leftBox.max.y - leftBox.min.y).toBeCloseTo(rightBox.max.y - rightBox.min.y, 3);
  });

  it('keeps both mirrored outlines counter-clockwise', () => {
    const pattern = generateShoes();
    for (const panel of Object.values(pattern.panels)) {
      expect(polygonArea(samplePanelOutline(pattern, panel))).toBeGreaterThan(0);
    }
  });

  it('scales the sole with the requested foot size', () => {
    const pattern = generateShoes({ ...DEFAULT_SHOE_PARAMS, footLengthCm: 30, footWidthCm: 11 });
    const sole = panelByName(pattern, '左鞋垫')!;
    const box = computeBBox(samplePanelOutline(pattern, sole));
    expect(box.max.x - box.min.x).toBeCloseTo(30, 3);
    expect(box.max.y - box.min.y).toBeCloseTo(11, 3);
  });
});
