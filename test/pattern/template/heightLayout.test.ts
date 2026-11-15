import { presetPattern } from '@/pattern/template';
import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import { layoutByHeight } from '@/pattern/template/patternLayout';
import { samplePanelOutline } from '@/pattern/panel';
import { bodyLandmarks } from '@/avatar/landmarks';
import { drapeHeightOffsetCm } from '@/pattern/drape';
import { panelHeightOffsets, toHeightPattern } from '@/ui/viewport2D/panelHeight';
import type { Pattern } from '@/model/types';
import { computeBBox } from '@/base/geom';

/** Bounds of every piece as the 2D pane draws it: pattern x, body height y. */
function drawnBoxes(pattern: Pattern, body: ReturnType<typeof bodyLandmarks>) {
  const heights = toHeightPattern(pattern, panelHeightOffsets(pattern, body));
  return Object.values(heights.panels).map((panel) => {
    const outline = samplePanelOutline(heights, panel);
    const xs = outline.map(p => p.x);
    const ys = outline.map(p => p.y);
    return {
      name: panel.name,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  });
}

const find = (boxes: ReturnType<typeof drawnBoxes>, name: string) => {
  const box = boxes.find(other => other.name === name);
  if (!box) throw new Error(`piece ${name} missing`);
  return box;
};

/** True when two pieces stand in one column, one over the other. */
function stackedOver(upper: ReturnType<typeof find>, lower: ReturnType<typeof find>): boolean {
  const sharesColumn = Math.min(upper.maxX, lower.maxX) - Math.max(upper.minX, lower.minX) > 0;
  return sharesColumn && upper.maxY > lower.maxY && upper.minY >= lower.minY;
}

describe('height layout', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);

  for (const [label, build] of [
    ['shirt', () => presetPattern('shirt')],
    ['hoodie', () => presetPattern('hoodie')],
    ['T-shirt', () => presetPattern('tshirt')],
    ['dress', () => presetPattern('dress')],
  ] as const) {
    it(`draws every ${label} piece clear of the others`, () => {
      const pattern = build();
      layoutByHeight(pattern, body);
      const boxes = drawnBoxes(pattern, body);
      expect(boxes.length).toBeGreaterThan(1);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const clash = a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
          expect(clash, `${a.name} overlaps ${b.name}`).toBe(false);
        }
      }
    });
  }

  it('stacks a dress bodice over the skirt it is sewn to', () => {
    const pattern = presetPattern('dress');
    layoutByHeight(pattern, body);
    const boxes = drawnBoxes(pattern, body);
    expect(stackedOver(find(boxes, '前上身片'), find(boxes, '前裙片'))).toBe(true);
    expect(stackedOver(find(boxes, '后上身片'), find(boxes, '后裙片'))).toBe(true);
    // Front and back stand side by side, never one behind the other.
    expect(find(boxes, '前裙片').maxX).toBeLessThan(find(boxes, '后裙片').minX);
  });

  it('keeps a collar over its neckline and a cuff under its sleeve', () => {
    const pattern = presetPattern('shirt');
    layoutByHeight(pattern, body);
    const boxes = drawnBoxes(pattern, body);
    expect(stackedOver(find(boxes, '领座'), find(boxes, '左前片'))).toBe(true);
    expect(stackedOver(find(boxes, '过肩'), find(boxes, '后背片'))).toBe(true);
    for (const [cuff, sleeve] of [['左袖克夫', '左袖'], ['右袖克夫', '右袖']] as const) {
      const cuffBox = find(boxes, cuff);
      const sleeveBox = find(boxes, sleeve);
      expect(cuffBox.minY, cuff).toBeLessThan(sleeveBox.maxY);
      expect(Math.min(cuffBox.maxX, sleeveBox.maxX) - Math.max(cuffBox.minX, sleeveBox.minX)).toBeGreaterThan(0);
    }
  });

  it('puts the arms outside the body', () => {
    for (const key of ['shirt', 'hoodie']) {
      const pattern = presetPattern(key);
      layoutByHeight(pattern, body);
      const boxes = drawnBoxes(pattern, body);
      const body_ = boxes.filter(box => /前|后|领|过肩|兜帽/.test(box.name));
      const left = find(boxes, '左袖');
      const right = find(boxes, '右袖');
      expect(left.maxX).toBeLessThan(Math.min(...body_.map(box => box.minX)));
      expect(right.minX).toBeGreaterThan(Math.max(...body_.map(box => box.maxX)));
    }
  });

  it('leaves every piece at its wrap height, give or take the stacking gap', () => {
    const pattern = presetPattern('hoodie');
    const wrapped = new Map<string, number>();
    for (const panel of Object.values(pattern.panels)) {
      if (!panel.drape) continue;
      const box = computeBBox(samplePanelOutline(pattern, panel));
      wrapped.set(panel.id, box.max.y + drapeHeightOffsetCm(panel, box.max.y, body));
    }
    layoutByHeight(pattern, body);
    const heights = panelHeightOffsets(pattern, body);
    for (const panel of Object.values(pattern.panels)) {
      const height = wrapped.get(panel.id);
      if (height === undefined) continue;
      const box = computeBBox(samplePanelOutline(pattern, panel));
      // The lift only ever clears a piece from the row above, so it stays inside one gap.
      expect(Math.abs(box.max.y + (heights.get(panel.id) ?? 0) - height)).toBeLessThanOrEqual(12);
    }
  });
});
