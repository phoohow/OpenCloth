import { describe, expect, it } from 'vitest';
import { createEmptyPattern } from '../../../src/core/model/defaults';
import type { Pattern, SeamAllowanceCorner } from '../../../src/core/model/types';
import { panelOutlineWithAllowance } from '../../../src/pattern/panel/panelBuilder';
import { hasSelfIntersection } from '../../../src/pattern/geom/offset';
import { computeBBox } from '../../../src/pattern/geom/vec2';
import { addSquare } from '../../core/command/fixtures';

const box = (pattern: Pattern, panelId: string, allowanceCm: number): Pattern => {
  pattern.panels[panelId].seamAllowanceCm = allowanceCm;
  return pattern;
};

function square(withAllowance: number): { pattern: Pattern; panelId: string; edgeIds: string[] } {
  const pattern = createEmptyPattern();
  const panelId = addSquare(pattern, 'sq', 0, 0, 10);
  box(pattern, panelId, withAllowance);
  return { pattern, panelId, edgeIds: pattern.panels[panelId].outlineEdgeIds };
}

const sizeOf = (pattern: Pattern, panelId: string): { w: number; h: number; count: number } => {
  const outline = panelOutlineWithAllowance(pattern, pattern.panels[panelId]);
  const b = computeBBox(outline);
  return { w: b.max.x - b.min.x, h: b.max.y - b.min.y, count: outline.length };
};

describe('panelOutlineWithAllowance 角型', () => {
  it('无角型覆盖时保持原样：每角一个尖角点', () => {
    const { pattern, panelId } = square(1);
    const out = sizeOf(pattern, panelId);
    expect(out.count).toBe(4);
    expect(out.w).toBeCloseTo(12, 6);
    expect(out.h).toBeCloseTo(12, 6);
  });

  it('圆角把角点换成一段弧，包围盒不变', () => {
    const { pattern, panelId, edgeIds } = square(1);
    pattern.edges[edgeIds[0]]!.cornerStyle = 'round';
    const out = sizeOf(pattern, panelId);
    expect(out.count).toBeGreaterThan(5);
    expect(out.w).toBeCloseTo(12, 6);
    expect(out.h).toBeCloseTo(12, 6);
    expect(hasSelfIntersection(panelOutlineWithAllowance(pattern, pattern.panels[panelId]))).toBe(false);
  });

  it('斜角切成两点一条弦', () => {
    const { pattern, panelId, edgeIds } = square(1);
    pattern.edges[edgeIds[1]]!.cornerStyle = 'bevel';
    const out = sizeOf(pattern, panelId);
    expect(out.count).toBe(5);
  });

  it('每个角各自取闭合于该角的那条边的角型', () => {
    const { pattern, panelId, edgeIds } = square(1);
    const styles: SeamAllowanceCorner[] = ['round', 'miter', 'bevel', 'miter'];
    edgeIds.forEach((id, i) => { pattern.edges[id]!.cornerStyle = styles[i]; });
    const oneCorner = sizeOf(pattern, panelId);
    edgeIds.forEach((id, i) => { pattern.edges[id]!.cornerStyle = i === 0 ? 'round' : 'miter'; });
    const other = sizeOf(pattern, panelId);
    expect(oneCorner.count).toBeGreaterThan(other.count);
  });

  it('逐边缝份不同也在角点收尾，不自交', () => {
    const { pattern, panelId, edgeIds } = square(0);
    pattern.edges[edgeIds[0]]!.seamAllowanceCm = 4;
    pattern.panels[panelId].seamAllowanceCm = 1;
    const outline = panelOutlineWithAllowance(pattern, pattern.panels[panelId]);
    const b = computeBBox(outline);
    expect(b.min.y).toBeCloseTo(-4, 6);
    expect(b.max.y).toBeCloseTo(11, 6);
    expect(hasSelfIntersection(outline)).toBe(false);
  });

  it('缝份为 0 时轮廓就是净边', () => {
    const { pattern, panelId } = square(0);
    const out = panelOutlineWithAllowance(pattern, pattern.panels[panelId]);
    expect(out.length).toBe(4);
    expect(computeBBox(out).min.x).toBeCloseTo(0, 6);
    expect(computeBBox(out).max.x).toBeCloseTo(10, 6);
  });
});
