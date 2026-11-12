import { describe, expect, it } from 'vitest';
import { bodyLandmarks } from '@/avatar';
import { createEmptyPattern } from '@/model/defaults';
import type { AvatarParams, Vec2 } from '@/model/types';
import type { PatternElementKind } from '@/model';
import { pickElements } from '@/ui/viewport2D/hitTest';
import { createPen } from '@/ui/viewport2D/pen';
import {
  bodyGuideGeometry, drawBodyGuide, type BodyGuideSource,
} from '@/ui/viewport2D/drawBodyGuide';

const PARAMS: AvatarParams = {
  heightCm: 170, chestCm: 88, waistCm: 70, hipCm: 98, poseArmAngleRad: 0.12,
};
const BODY = bodyLandmarks(PARAMS);
const SOURCE: BodyGuideSource = { body: BODY };

const ALL_KINDS: readonly PatternElementKind[] = [
  'panel', 'point', 'edge', 'internal', 'dart', 'seam',
  'notch', 'annotation', 'print', 'topstitch', 'trim', 'measurement',
];

function bounds(points: readonly Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y)),
  };
}

describe('bodyGuideGeometry', () => {
  it('stands the full body on the ground in centimetres', () => {
    const { outlines } = bodyGuideGeometry(SOURCE);
    const all = outlines.flat();
    const box = bounds(all);
    expect(outlines.length).toBeGreaterThan(0);
    expect(outlines.every(outline => outline.length >= 3)).toBe(true);
    expect(all.length).toBeGreaterThan(100);
    expect(all.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(box.minY).toBeCloseTo(0, 6);
    expect(box.maxY).toBeCloseTo(PARAMS.heightCm, 6);
    expect(box.minX).toBeCloseTo(-box.maxX, 6);
  });

  it('places the construction rules at the shared body landmarks', () => {
    const { rules } = bodyGuideGeometry(SOURCE);
    expect(rules.map(rule => rule.label)).toEqual(['肩线', '胸围', '腰围', '臀围', '裆线', '膝线']);
    expect(rules.map(rule => rule.y)).toEqual([
      BODY.shoulderTopY, BODY.bustY, BODY.waistY, BODY.hipY, BODY.crotchY, BODY.kneeY,
    ].map(y => y * 100));
    expect(rules.every(rule => rule.halfWidth > 0)).toBe(true);
  });

  it('follows the posed mannequin', () => {
    const straight = bounds(bodyGuideGeometry(SOURCE).outlines.flat());
    const tPose = bounds(bodyGuideGeometry({
      body: bodyLandmarks({ ...PARAMS, poseArmAngleRad: Math.PI / 2 }),
    }).outlines.flat());
    expect(tPose.maxX).toBeGreaterThan(straight.maxX * 1.5);
    expect(tPose.maxY).toBeCloseTo(straight.maxY, 6);
  });

  it('stays outside pattern picking', () => {
    const empty = createEmptyPattern();
    const chest = { x: 0, y: BODY.bustY * 100 };
    expect(pickElements(empty, chest, 40, ALL_KINDS)).toBeNull();
    expect(bodyGuideGeometry(SOURCE).outlines.flat().length).toBeGreaterThan(100);
    expect(Object.keys(empty.panels)).toEqual([]);
  });
});

describe('drawBodyGuide', () => {
  it('paints one filled silhouette, its outline and the landmark labels', () => {
    const calls = { fill: 0, stroke: 0, points: [] as Vec2[], labels: [] as string[] };
    const ctx = {
      beginPath() {},
      moveTo(x: number, y: number) { calls.points.push({ x, y }); },
      lineTo(x: number, y: number) { calls.points.push({ x, y }); },
      closePath() {},
      fill() { calls.fill++; },
      stroke() { calls.stroke++; },
      setLineDash() {},
      save() {},
      restore() {},
      fillText(text: string) { calls.labels.push(text); },
    } as unknown as CanvasRenderingContext2D;
    const pen = createPen(ctx, 800, 600, { offsetX: 0, offsetY: 0, scale: 2 });

    drawBodyGuide(pen, bodyGuideGeometry(SOURCE));

    expect(calls.fill).toBe(1);
    expect(calls.stroke).toBe(2);
    expect(calls.points.length).toBeGreaterThan(200);
    expect(calls.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(calls.labels).toEqual(['肩线', '胸围', '腰围', '臀围', '裆线', '膝线']);
  });
});
