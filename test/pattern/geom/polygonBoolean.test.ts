import { describe, it, expect } from 'vitest';
import { vec2, type Vec2 } from '../../../src/core/model/types';
import { polygonArea } from '../../../src/pattern/geom/vec2';
import {
  differencePolygons, intersectPolygons, unionPolygons, type PolygonList,
} from '../../../src/pattern/geom/polygonBoolean';

/** Exterior area of every polygon in a result list. */
function exteriorArea(polygons: PolygonList): number {
  return polygons.reduce((sum, rings) => sum + Math.abs(polygonArea(rings[0]!)), 0);
}

/** Counter-clockwise 10x10 square. */
const left: Vec2[] = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];
/** Counter-clockwise 10x10 square overlapping the right half of `left`. */
const right: Vec2[] = [vec2(5, 0), vec2(15, 0), vec2(15, 10), vec2(5, 10)];

describe('unionPolygons', () => {
  it('两个相交矩形合并为一片，面积为两者之和去重', () => {
    const result = unionPolygons([left, right]);
    expect(result).toHaveLength(1);
    expect(exteriorArea(result)).toBeCloseTo(150, 6);
  });

  it('不相交的矩形保留为两个多边形', () => {
    const apart = [vec2(20, 0), vec2(30, 0), vec2(30, 10), vec2(20, 10)];
    const result = unionPolygons([left, apart]);
    expect(result).toHaveLength(2);
    expect(exteriorArea(result)).toBeCloseTo(200, 6);
  });

  it('空输入返回空列表', () => {
    expect(unionPolygons([])).toEqual([]);
  });
});

describe('intersectPolygons', () => {
  it('相交区域只保留重叠部分', () => {
    const result = intersectPolygons(left, right);
    expect(result).toHaveLength(1);
    expect(exteriorArea(result)).toBeCloseTo(50, 6);
  });

  it('不相交时结果为空', () => {
    const apart = [vec2(20, 0), vec2(30, 0), vec2(30, 10), vec2(20, 10)];
    expect(intersectPolygons(left, apart)).toEqual([]);
  });
});

describe('differencePolygons', () => {
  it('从主体减去相交部分', () => {
    const result = differencePolygons(left, right);
    expect(result).toHaveLength(1);
    expect(exteriorArea(result)).toBeCloseTo(50, 6);
  });

  it('减去不相交的形状时元素顺序保持', () => {
    const apart = [vec2(20, 0), vec2(30, 0), vec2(30, 10), vec2(20, 10)];
    const result = differencePolygons(left, apart);
    expect(result).toHaveLength(1);
    expect(exteriorArea(result)).toBeCloseTo(100, 6);
  });

  it('空被减形状返回朝向规范化的主体', () => {
    const result = differencePolygons(left, []);
    expect(result).toHaveLength(1);
    expect(exteriorArea(result)).toBeCloseTo(100, 6);
  });
});
