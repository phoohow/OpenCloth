import { describe, it, expect } from 'vitest';
import { generateTShirt, DEFAULT_TSHIRT_PARAMS } from '../../../src/pattern/template/tShirtTemplate';
import { samplePanelOutline } from '../../../src/pattern/panel/panelBuilder';
import { computeBBox } from '../../../src/pattern/geom/vec2';

/** Bounding boxes of every panel outline, keyed by panel name. */
function panelBoxes(pattern = generateTShirt()): Record<string, ReturnType<typeof computeBBox>> {
  const boxes: Record<string, ReturnType<typeof computeBBox>> = {};
  for (const panel of Object.values(pattern.panels)) boxes[panel.name] = computeBBox(samplePanelOutline(pattern, panel));
  return boxes;
}

describe('generateTShirt 2D 排料', () => {
  it('版型片的包围盒互不重叠', () => {
    const boxes = panelBoxes();
    const names = Object.keys(boxes);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = boxes[names[i]], b = boxes[names[j]];
        const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
        const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
        expect(overlapX > 0 && overlapY > 0, `${names[i]} / ${names[j]} 重叠`).toBe(false);
      }
    }
  });

  it('前片与后片左右分开且关于原点对称', () => {
    const { 前片: front, 后片: back } = panelBoxes();
    expect(front.max.x).toBeLessThan(back.min.x);
    expect(front.min.x + back.max.x).toBeCloseTo(0, 6);
  });

  it('排料整体以原点为中心', () => {
    const boxes = Object.values(panelBoxes());
    const min = Math.min(...boxes.map(b => b.min.x));
    const max = Math.max(...boxes.map(b => b.max.x));
    expect(min + max).toBeCloseTo(0, 6);
  });

  it('版型尺寸不随排料改变', () => {
    const boxes = panelBoxes();
    const height = DEFAULT_TSHIRT_PARAMS.lengthCm;
    expect(boxes['前片'].max.y - boxes['前片'].min.y).toBeCloseTo(height, 6);
    expect(boxes['后片'].max.y - boxes['后片'].min.y).toBeCloseTo(height, 6);
    expect(boxes['前片'].max.x - boxes['前片'].min.x).toBeCloseTo(DEFAULT_TSHIRT_PARAMS.chestCm / 2, 6);
  });
});
