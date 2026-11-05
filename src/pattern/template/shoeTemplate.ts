import type { EdgeSemantic, Panel, Pattern, Vec2 } from '../../core/model/types';
import { PatternBuilder } from './templateKit';
import { layoutRows } from './patternLayout';
import { cm, defineTemplate } from './garmentTemplate';

/** Foot length, ball width and collar height of a casual shoe. */
export interface ShoeParams {
  footLengthCm: number;
  footWidthCm: number;
  upperHeightCm: number;
}

export const DEFAULT_SHOE_PARAMS: ShoeParams = {
  footLengthCm: 26,
  footWidthCm: 9.5,
  upperHeightCm: 7,
};

/** One closed outline authored in local coordinates, with a semantic per edge. */
interface OutlinePoint {
  x: number;
  y: number;
  semantic: EdgeSemantic;
}

/** Builds a closed panel from a point list; mirroring reverses the order to keep the winding. */
function addOutline(
  builder: PatternBuilder,
  name: string,
  points: OutlinePoint[],
  mirrorLength: number | null,
  seamAllowanceCm: number,
): Panel {
  const ordered = mirrorLength === null
    ? points
    : [points[0]!, ...points.slice(1).reverse()];
  const refs = ordered.map(point => builder.point(
    mirrorLength === null ? point.x : mirrorLength - point.x,
    point.y,
  ));
  const count = ordered.length;
  const edges: string[] = [];
  for (let i = 0; i < count; i++) {
    const semantic = mirrorLength === null
      ? ordered[i]!.semantic
      : points[(count - i - 1) % count]!.semantic;
    edges.push(builder.line(refs[i]!, refs[(i + 1) % count]!, semantic));
  }
  return builder.panel({ name, edges, seamAllowanceCm });
}

/** Side profile of an upper: sole edge, toe, vamp, collar and heel. */
function upperPoints(length: number, height: number): OutlinePoint[] {
  return [
    { x: 0, y: 0, semantic: 'free' },
    { x: length, y: 0, semantic: 'free' },
    { x: length, y: height * 0.22, semantic: 'free' },
    { x: length * 0.62, y: height, semantic: 'free' },
    { x: length * 0.18, y: height * 0.92, semantic: 'neckline' },
    { x: 0, y: height * 0.55, semantic: 'sideSeam' },
  ];
}

/** Foot-shaped sole outline: rounded heel and toe, straight ball. */
function solePoints(length: number, width: number): Vec2[] {
  return [
    { x: 0, y: width * 0.25 },
    { x: length * 0.08, y: 0 },
    { x: length * 0.85, y: 0 },
    { x: length, y: width * 0.25 },
    { x: length, y: width * 0.65 },
    { x: length * 0.9, y: width },
    { x: length * 0.1, y: width },
    { x: 0, y: width * 0.65 },
  ];
}

/**
 * Builds a pair of shoe layers: mirrored side-profile uppers and mirrored foot-shaped soles.
 * The two layers are not sewn together in v1; the template only provides the pieces.
 */
export function generateShoes(params: ShoeParams = DEFAULT_SHOE_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const length = Math.max(10, params.footLengthCm);
  const width = Math.max(4, params.footWidthCm);
  const height = Math.max(2, params.upperHeightCm);

  const upperLeft = addOutline(builder, '左鞋帮', upperPoints(length, height), null, 0.6);
  const upperRight = addOutline(builder, '右鞋帮', upperPoints(length, height), length, 0.6);

  const soleOutline: OutlinePoint[] = solePoints(length, width).map((point, index) => ({
    ...point,
    semantic: index === 0 || index === 4 ? 'sideSeam' : 'free',
  }));
  const soleLeft = addOutline(builder, '左鞋垫', soleOutline, null, 0.6);
  const soleRight = addOutline(builder, '右鞋垫', soleOutline, length, 0.6);

  layoutRows(builder.pattern, [
    [upperLeft, upperRight],
    [soleLeft, soleRight],
  ]);
  return builder.pattern;
}

export const shoeTemplate = defineTemplate({
  key: 'shoe',
  name: '鞋履',
  icon: 'shoe',
  summary: '左右鞋帮 + 左右鞋垫（v1 不含缝合）',
  fields: [
    cm('footLengthCm', '鞋长', 20, 33),
    cm('footWidthCm', '掌宽', 6, 14),
    cm('upperHeightCm', '鞋帮高', 3, 15),
  ],
  defaults: DEFAULT_SHOE_PARAMS,
}, generateShoes);
