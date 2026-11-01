import type { Pattern, Panel } from '../../core/model/types';
import { vec2 } from '../../core/model/types';
import { PatternBuilder } from './templateKit';
import { offsetPanel } from './patternLayout';
import { cm, defineTemplate } from './garmentTemplate';

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
  lengthCm: 68,
  sleeveLengthCm: 20,
  shoulderCm: 42,
  neckWidthCm: 18,
  neckDepthCm: 8,
};

/** Builds a T-shirt pattern: front panel, back panel and two sleeves. */
export function generateTShirt(params: TShirtParams = DEFAULT_TSHIRT_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const { chestCm, lengthCm, sleeveLengthCm, shoulderCm, neckWidthCm, neckDepthCm } = params;

  const halfChest = chestCm / 4;
  const halfShoulder = shoulderCm / 2;
  const halfNeck = neckWidthCm / 2;

  // ===== Front panel =====
  // Outline points, counter-clockwise from the left hem
  const fHemLeft = builder.point(-halfChest, 0);
  const fHemRight = builder.point(halfChest, 0);
  const fUnderarmRight = builder.point(halfChest, lengthCm * 0.75);
  const fShoulderRight = builder.point(halfShoulder, lengthCm);
  const fNeckRight = builder.point(halfNeck, lengthCm);
  const fNeckBottom = builder.point(0, lengthCm - neckDepthCm);
  const fNeckLeft = builder.point(-halfNeck, lengthCm);
  const fShoulderLeft = builder.point(-halfShoulder, lengthCm);
  const fUnderarmLeft = builder.point(-halfChest, lengthCm * 0.75);

  const fEdgeHem = builder.line(fHemLeft, fHemRight, 'hem');
  const fEdgeSideRight = builder.line(fHemRight, fUnderarmRight, 'sideSeam');
  const fEdgeArmRight = builder.bezier(fUnderarmRight, fShoulderRight,
    vec2(halfChest, lengthCm * 0.88), vec2(halfShoulder + 2, lengthCm * 0.92), 'armhole');
  const fEdgeShoulderRight = builder.line(fShoulderRight, fNeckRight, 'shoulder');
  const fEdgeNeckRight = builder.bezier(fNeckRight, fNeckBottom,
    vec2(halfNeck * 0.5, lengthCm - 1), vec2(halfNeck * 0.4, lengthCm - neckDepthCm + 1), 'neckline');
  const fEdgeNeckLeft = builder.bezier(fNeckBottom, fNeckLeft,
    vec2(-halfNeck * 0.4, lengthCm - neckDepthCm + 1), vec2(-halfNeck * 0.5, lengthCm - 1), 'neckline');
  const fEdgeShoulderLeft = builder.line(fNeckLeft, fShoulderLeft, 'shoulder');
  const fEdgeArmLeft = builder.bezier(fShoulderLeft, fUnderarmLeft,
    vec2(-halfShoulder - 2, lengthCm * 0.92), vec2(-halfChest, lengthCm * 0.88), 'armhole');
  const fEdgeSideLeft = builder.line(fUnderarmLeft, fHemLeft, 'sideSeam');

  const front = builder.panel({
    name: '前片',
    edges: [fEdgeHem, fEdgeSideRight, fEdgeArmRight, fEdgeShoulderRight,
      fEdgeNeckRight, fEdgeNeckLeft, fEdgeShoulderLeft, fEdgeArmLeft, fEdgeSideLeft],
    drape: { region: 'torso', plumb: true },
  });

  // ===== Back panel =====
  const bHemLeft = builder.point(-halfChest, 0);
  const bHemRight = builder.point(halfChest, 0);
  const bUnderarmRight = builder.point(halfChest, lengthCm * 0.75);
  const bShoulderRight = builder.point(halfShoulder, lengthCm);
  const bNeckRight = builder.point(halfNeck, lengthCm);
  const bNeckBottom = builder.point(0, lengthCm - neckDepthCm * 0.4);
  const bNeckLeft = builder.point(-halfNeck, lengthCm);
  const bShoulderLeft = builder.point(-halfShoulder, lengthCm);
  const bUnderarmLeft = builder.point(-halfChest, lengthCm * 0.75);

  const bEdgeHem = builder.line(bHemLeft, bHemRight, 'hem');
  const bEdgeSideRight = builder.line(bHemRight, bUnderarmRight, 'sideSeam');
  const bEdgeArmRight = builder.bezier(bUnderarmRight, bShoulderRight,
    vec2(halfChest, lengthCm * 0.88), vec2(halfShoulder + 2, lengthCm * 0.92), 'armhole');
  const bEdgeShoulderRight = builder.line(bShoulderRight, bNeckRight, 'shoulder');
  const bEdgeNeckRight = builder.bezier(bNeckRight, bNeckBottom,
    vec2(halfNeck * 0.5, lengthCm - 0.5), vec2(halfNeck * 0.3, lengthCm - neckDepthCm * 0.4 + 0.5), 'neckline');
  const bEdgeNeckLeft = builder.bezier(bNeckBottom, bNeckLeft,
    vec2(-halfNeck * 0.3, lengthCm - neckDepthCm * 0.4 + 0.5), vec2(-halfNeck * 0.5, lengthCm - 0.5), 'neckline');
  const bEdgeShoulderLeft = builder.line(bNeckLeft, bShoulderLeft, 'shoulder');
  const bEdgeArmLeft = builder.bezier(bShoulderLeft, bUnderarmLeft,
    vec2(-halfShoulder - 2, lengthCm * 0.92), vec2(-halfChest, lengthCm * 0.88), 'armhole');
  const bEdgeSideLeft = builder.line(bUnderarmLeft, bHemLeft, 'sideSeam');

  const back = builder.panel({
    name: '后片',
    edges: [bEdgeHem, bEdgeSideRight, bEdgeArmRight, bEdgeShoulderRight,
      bEdgeNeckRight, bEdgeNeckLeft, bEdgeShoulderLeft, bEdgeArmLeft, bEdgeSideLeft],
    drape: { region: 'torso', startDeg: 270, sweepDeg: -180, plumb: true },
  });

  // ===== Sleeves =====
  // Sleeve round sized off the chest.
  const sleeveWidth = chestCm * 0.32;
  const sleeveCapHeight = Math.min(9, sleeveLengthCm * 0.45);
  const sleeveShaft = sleeveLengthCm - sleeveCapHeight;

  interface SleeveParts { panel: Panel; capFrontHalf: string; capBackHalf: string; innerRight: string; innerLeft: string; }

  function makeSleeve(name: string): SleeveParts {
    const cuffLeft = builder.point(-sleeveWidth / 2, 0);
    const cuffRight = builder.point(sleeveWidth / 2, 0);
    const underarmRight = builder.point(sleeveWidth / 2, sleeveShaft);
    const crown = builder.point(0, sleeveShaft + sleeveCapHeight);
    const underarmLeft = builder.point(-sleeveWidth / 2, sleeveShaft);

    const edgeCuff = builder.line(cuffLeft, cuffRight, 'hem');
    const innerRight = builder.line(cuffRight, underarmRight, 'sideSeam');
    const capFrontHalf = builder.bezier(underarmRight, crown,
      vec2(sleeveWidth / 2, sleeveShaft + sleeveCapHeight * 0.6),
      vec2(sleeveWidth * 0.18, sleeveShaft + sleeveCapHeight * 0.98), 'sleeveCap');
    const capBackHalf = builder.bezier(crown, underarmLeft,
      vec2(-sleeveWidth * 0.18, sleeveShaft + sleeveCapHeight * 0.98),
      vec2(-sleeveWidth / 2, sleeveShaft + sleeveCapHeight * 0.6), 'sleeveCap');
    const innerLeft = builder.line(underarmLeft, cuffLeft, 'sideSeam');

    const panel = builder.panel({
      name,
      edges: [edgeCuff, innerRight, capFrontHalf, capBackHalf, innerLeft],
      drape: { region: 'arm', side: name.includes('左') ? 'left' : 'right', rowWrap: true, pinTop: false },
    });
    return { panel, capFrontHalf, capBackHalf, innerRight, innerLeft };
  }

  const sleeveL = makeSleeve('左袖');
  const sleeveR = makeSleeve('右袖');

  // ===== 2D layout =====
  // Sleeves outboard, front and back side by side, all centered on the origin with a gap.
  const gapCm = 4;
  const bodyX = halfChest + gapCm / 2;
  const sleeveX = bodyX + halfChest + gapCm + sleeveWidth / 2;
  offsetPanel(builder.pattern, front, -bodyX, 0);
  offsetPanel(builder.pattern, back, bodyX, 0);
  offsetPanel(builder.pattern, sleeveL.panel, -sleeveX, 0);
  offsetPanel(builder.pattern, sleeveR.panel, sleeveX, 0);

  // ===== Seams =====
  builder.seam(fEdgeShoulderRight, bEdgeShoulderRight);
  builder.seam(fEdgeShoulderLeft, bEdgeShoulderLeft);
  builder.seam(fEdgeSideRight, bEdgeSideRight);
  builder.seam(fEdgeSideLeft, bEdgeSideLeft);

  builder.seam(sleeveR.capFrontHalf, fEdgeArmRight, { type: 'gather' });
  builder.seam(sleeveR.capBackHalf, bEdgeArmRight, { type: 'gather' });
  builder.seam(sleeveL.capFrontHalf, fEdgeArmLeft, { type: 'gather' });
  builder.seam(sleeveL.capBackHalf, bEdgeArmLeft, { type: 'gather' });
  builder.seam(sleeveR.innerRight, sleeveR.innerLeft, { flipB: true });
  builder.seam(sleeveL.innerRight, sleeveL.innerLeft, { flipB: true });

  return builder.pattern;
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
