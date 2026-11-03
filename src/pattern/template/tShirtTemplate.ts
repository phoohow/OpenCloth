import type { PanelDrape, Pattern, Vec2 } from '../../core/model/types';
import { PatternBuilder } from './templateKit';
import { layoutRows } from './patternLayout';
import { frontArc, backArc } from './drapeArcs';
import { cm, defineTemplate } from './garmentTemplate';
import { addBodice, addSleeve, capHeightForArmhole } from './panelShapes';
import { sampleEdge } from '../panel/panelBuilder';

/** Body measurements of a T-shirt, in centimeters. */
export interface TShirtParams {
  chestCm: number;
  lengthCm: number;
  sleeveLengthCm: number;
  shoulderCm: number;
  neckWidthCm: number;
  neckDepthCm: number;
}

export const DEFAULT_TSHIRT_PARAMS: TShirtParams = {
  chestCm: 96,
  lengthCm: 64,
  sleeveLengthCm: 20,
  shoulderCm: 42,
  neckWidthCm: 18,
  neckDepthCm: 8,
};

/** Shoulder drop from the neck seam to the shoulder tip, a flat line reads as a plank. */
const SHOULDER_SLOPE_CM = 4.5;

/** Back neck drop as a share of the front drop. */
const BACK_NECK_SHARE = 0.3;

/** Builds a T-shirt pattern: front panel, back panel and two short sleeves. */
export function generateTShirt(params: TShirtParams = DEFAULT_TSHIRT_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const { chestCm, lengthCm, sleeveLengthCm, shoulderCm, neckWidthCm, neckDepthCm } = params;

  const halfWidth = chestCm / 4;
  const halfShoulder = shoulderCm / 2;
  // Armhole depth is a share of the chest, measured down from the shoulder tip.
  const armholeDepth = Math.min(chestCm * 0.205, lengthCm * 0.38);
  const underarmAt = (lengthCm - SHOULDER_SLOPE_CM - armholeDepth) / lengthCm;
  // A sleeve is cut as a tube, so its flat width is the arm girth plus ease.
  const sleeveWidth = chestCm * 0.32;

  const front = addBodice(builder, {
    name: '前片',
    halfWidthCm: halfWidth,
    halfShoulderCm: halfShoulder,
    lengthCm,
    neckHalfWidthCm: neckWidthCm / 2,
    neckDepthCm,
    underarmAt,
    shoulderSlopeCm: SHOULDER_SLOPE_CM,
    drape: { region: 'torso', ...frontArc(180) },
  });

  const back = addBodice(builder, {
    name: '后片',
    halfWidthCm: halfWidth,
    halfShoulderCm: halfShoulder,
    lengthCm,
    neckHalfWidthCm: neckWidthCm / 2,
    neckDepthCm: neckDepthCm * BACK_NECK_SHARE,
    underarmAt,
    shoulderSlopeCm: SHOULDER_SLOPE_CM,
    drape: { region: 'torso', ...backArc(180) },
  });

  // The cap arc must match the armhole arc, so the cap height follows from the armhole length.
  const armholeArc = arcLength(sampleEdge(builder.pattern, front.armholeRight));
  const capHeight = capHeightForArmhole(sleeveWidth, armholeArc, Math.max(sleeveLengthCm - 4, 8));
  const sleeveShaft = Math.max(sleeveLengthCm - capHeight, 2);

  const sleeveDrape = (side: 'left' | 'right'): PanelDrape => ({
    region: 'arm',
    side,
    // The cap crown joins the shoulder tip, which sits one slope below the neck seam.
    anchor: 'shoulderTop',
    anchorOffsetCm: -SHOULDER_SLOPE_CM,
    // Centre the full turn on the outer side of the arm, away from the body.
    startDeg: side === 'left' ? 0 : -180,
    sweepDeg: 360,
  });

  const sleeveL = addSleeve(builder, {
    name: '左袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveShaft,
    capHeightCm: capHeight,
    side: 'left',
    drape: sleeveDrape('left'),
  });

  const sleeveR = addSleeve(builder, {
    name: '右袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveShaft,
    capHeightCm: capHeight,
    side: 'right',
    drape: sleeveDrape('right'),
  });

  layoutRows(builder.pattern, [[sleeveL.panel, front.panel, back.panel, sleeveR.panel]]);

  // Shoulder and side seams join matching ends.
  builder.seam(front.shoulderRight, back.shoulderRight);
  builder.seam(front.shoulderLeft, back.shoulderLeft);
  builder.seam(front.sideRight, back.sideRight);
  builder.seam(front.sideLeft, back.sideLeft);

  // The armhole runs underarm to shoulder, the cap left half runs crown to underarm.
  builder.seam(sleeveR.capRight, front.armholeRight);
  builder.seam(sleeveR.capLeft, back.armholeRight, { flipB: true });
  builder.seam(sleeveL.capRight, front.armholeLeft);
  builder.seam(sleeveL.capLeft, back.armholeLeft, { flipB: true });
  builder.seam(sleeveR.seamRight, sleeveR.seamLeft, { flipB: true });
  builder.seam(sleeveL.seamRight, sleeveL.seamLeft, { flipB: true });

  return builder.pattern;
}

/** Length along a sampled outline edge, in centimeters. */
function arcLength(points: Vec2[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return sum;
}

export const tShirtTemplate = defineTemplate({
  key: 'tshirt',
  name: 'T 恤',
  icon: 't-shirt',
  summary: '前片 · 后片 · 短袖',
  fields: [
    cm('chestCm', '胸围', 76, 140),
    cm('lengthCm', '衣长', 50, 85),
    cm('sleeveLengthCm', '袖长', 8, 62),
    cm('shoulderCm', '肩宽', 32, 56),
    cm('neckWidthCm', '领宽', 14, 26),
    cm('neckDepthCm', '领深', 4, 14),
  ],
  defaults: DEFAULT_TSHIRT_PARAMS,
}, generateTShirt);
