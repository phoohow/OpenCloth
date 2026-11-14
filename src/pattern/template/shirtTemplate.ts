import type { Panel, Pattern } from '@/model/types';
import { vec2 } from '@/model/types';
import { PatternBuilder } from '@/pattern/template/templateKit';
import { layoutRows } from '@/pattern/template/patternLayout';
import { cm, defineTemplate } from '@/pattern/template/garmentTemplate';
import {
  addSleeve, capHeightForArmhole, shoulderSleeveDrape,
} from '@/pattern/template/panelShapes';
import {
  addBackBody, addBackYoke, addCollarFall, addCollarStand, addCuff, addFrontHalf,
} from '@/pattern/template/shirtShapes';
import { sampleEdge } from '@/pattern/panel/panelBuilder';
import { polylineLength } from '@/base/geom';

/** Body measurements of a button-up shirt, in centimeters. */
export interface ShirtParams {
  chestCm: number;
  lengthCm: number;
  sleeveLengthCm: number;
  /** Sleeve opening circumference, which is also the cuff length. */
  cuffCm: number;
  shoulderCm: number;
  neckWidthCm: number;
  neckDepthCm: number;
  /** Collar stand height at the centre back. */
  collarHeightCm: number;
  /** Finished cuff height. */
  cuffHeightCm: number;
  /** Depth of the back yoke below the shoulder line. */
  yokeDepthCm: number;
}

export const DEFAULT_SHIRT_PARAMS: ShirtParams = {
  chestCm: 100,
  lengthCm: 72,
  sleeveLengthCm: 54,
  cuffCm: 24,
  shoulderCm: 44,
  neckWidthCm: 17,
  neckDepthCm: 9,
  collarHeightCm: 3.2,
  cuffHeightCm: 6,
  yokeDepthCm: 11,
};

/** Shoulder drop per centimetre of neck-to-tip run; a shirt front slopes at 15:6. */
const SHOULDER_SLOPE_SHARE = 0.38;

/** Front neck drop as a share of the front drop. */
const BACK_NECK_SHARE = 0.35;

/** Half of the button stand; two halves overlap by twice this once buttoned. */
const PLACKET_CM = 1.75;

/** Side seam bow at the waist, which a straight seam turns into a tube. */
const WAIST_INSET_CM = 0.8;

/** Hem drop at the centre front and centre back, the shirttail curve. */
const HEM_DROP_CM = 2.2;

/** Collar fall width at the centre back. */
const COLLAR_FALL_CM = 5;

/** Length of the sleeve placket, measured up from the cuff. */
const SLEEVE_PLACKET_CM = 10;

/** Air the sleeve keeps around the arm, in centimeters. */
const SLEEVE_GAP_CM = 0.6;

/** Air the cuff keeps around the wrist, in centimeters. */
const CUFF_GAP_CM = 0.8;

/** Air the collar stand keeps around the neck, so the stand does not overlap itself. */
const COLLAR_GAP_CM = 2.2;

/** Air the collar keeps outside the stand once it folds over it. */
const COLLAR_FOLD_GAP_CM = 3;

/** Builds a shirt pattern: two placketed front halves, a back yoke over the back body, two sleeves
 * with cuffs, and a two-piece collar over a stand. */
export function generateShirt(params: ShirtParams = DEFAULT_SHIRT_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const {
    chestCm, lengthCm, sleeveLengthCm, cuffCm, shoulderCm,
    neckWidthCm, neckDepthCm, collarHeightCm, cuffHeightCm, yokeDepthCm,
  } = params;

  const halfWidth = chestCm / 4;
  const halfShoulder = shoulderCm / 2;
  const halfNeck = neckWidthCm / 2;
  const shoulderSlope = (halfShoulder - halfNeck) * SHOULDER_SLOPE_SHARE;
  const shoulderY = lengthCm - shoulderSlope;
  // Armhole depth follows the chest at about a fifth of it, so a longer body does not deepen it.
  const armholeDepth = Math.min(chestCm * 0.2 + 2.5, lengthCm * 0.42);
  const underarmY = shoulderY - armholeDepth;

  const frame = {
    halfWidthCm: halfWidth,
    halfShoulderCm: halfShoulder,
    underarmY,
    shoulderY,
    topY: lengthCm,
    halfNeckCm: halfNeck,
  };

  const frontLeft = addFrontHalf(builder, {
    ...frame,
    name: '左前片',
    neckDepthCm,
    placketCm: PLACKET_CM,
    waistInsetCm: WAIST_INSET_CM,
    hemDropCm: HEM_DROP_CM,
    drape: { region: 'torso', zone: 'front' },
  }, -1);

  const frontRight = addFrontHalf(builder, {
    ...frame,
    name: '右前片',
    neckDepthCm,
    placketCm: PLACKET_CM,
    waistInsetCm: WAIST_INSET_CM,
    hemDropCm: HEM_DROP_CM,
    drape: { region: 'torso', zone: 'front' },
  }, 1);

  const backOptions = {
    ...frame,
    neckDepthCm: neckDepthCm * BACK_NECK_SHARE,
    yokeDepthCm,
    waistInsetCm: WAIST_INSET_CM,
    hemDropCm: HEM_DROP_CM,
  };

  const yoke = addBackYoke(builder, {
    ...backOptions,
    name: '过肩',
    drape: { region: 'torso', zone: 'back' },
  });

  // The body below the yoke hangs from the yoke line, so it starts that much lower on the torso.
  const backBody = addBackBody(builder, {
    ...backOptions,
    name: '后背片',
    drape: { region: 'torso', zone: 'back', anchorOffsetCm: -yokeDepthCm },
  });

  // The sleeve piece wraps the arm, so its flat width is the girth it has to clear.
  const sleeveWidth = chestCm * 0.36;
  const armholeArc = polylineLength(sampleEdge(builder.pattern, frontRight.armhole));
  const capHeight = capHeightForArmhole(
    sleeveWidth, armholeArc, Math.max(Math.min(sleeveLengthCm * 0.45, sleeveWidth * 0.9), 8),
  );
  // Sleeve length runs from the shoulder to the cuff edge, so the shaft carries neither the cap nor
  // the cuff: the sleeve hem meets the cuff at the wrist, not past the hand.
  const sleeveShaft = Math.max(sleeveLengthCm - capHeight - cuffHeightCm, 4);
  const cuffAnchorCm = -(sleeveLengthCm - cuffHeightCm);

  const sleeveL = addSleeve(builder, {
    name: '左袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveShaft,
    capHeightCm: capHeight,
    cuffCm,
    side: 'left',
    drape: { ...shoulderSleeveDrape('left'), radiusOffsetCm: SLEEVE_GAP_CM },
  });

  const sleeveR = addSleeve(builder, {
    name: '右袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveShaft,
    capHeightCm: capHeight,
    cuffCm,
    side: 'right',
    drape: { ...shoulderSleeveDrape('right'), radiusOffsetCm: SLEEVE_GAP_CM },
  });

  const cuffL = addCuff(builder, {
    name: '左袖克夫',
    lengthCm: cuffCm,
    heightCm: cuffHeightCm,
    drape: { region: 'arm', side: 'left', zone: 'full', anchorOffsetCm: cuffAnchorCm, radiusOffsetCm: CUFF_GAP_CM },
  });

  const cuffR = addCuff(builder, {
    name: '右袖克夫',
    lengthCm: cuffCm,
    heightCm: cuffHeightCm,
    drape: { region: 'arm', side: 'right', zone: 'full', anchorOffsetCm: cuffAnchorCm, radiusOffsetCm: CUFF_GAP_CM },
  });

  // Shoulder seams join the front halves to the yoke; the yoke line joins the yoke to the back body.
  builder.seam(frontLeft.shoulder, yoke.shoulderLeft);
  builder.seam(frontRight.shoulder, yoke.shoulderRight);
  builder.seam(frontLeft.side, backBody.sideLeft);
  builder.seam(frontRight.side, backBody.sideRight);
  builder.seam(yoke.yokeLine, backBody.yokeLine, { flipB: true });

  // Each cap half pairs its underarm end with the armhole's underarm end. The back armhole is cut
  // in two by the yoke, so its cap half is sewn piece by piece.
  const backArmholeArc = polylineLength(sampleEdge(builder.pattern, yoke.armholeRight))
    + polylineLength(sampleEdge(builder.pattern, backBody.armholeRight));
  const yokeShare = polylineLength(sampleEdge(builder.pattern, yoke.armholeRight)) / backArmholeArc;

  builder.seam(sleeveR.capRight, frontRight.armhole);
  builder.seamRange(sleeveR.capLeft, { t0: 0, t1: yokeShare }, yoke.armholeRight, { t0: 0, t1: 1 }, { flipB: true });
  builder.seamRange(sleeveR.capLeft, { t0: yokeShare, t1: 1 }, backBody.armholeRight, { t0: 0, t1: 1 }, { flipB: true });
  builder.seam(sleeveL.capRight, frontLeft.armhole, { flipB: true });
  builder.seamRange(sleeveL.capLeft, { t0: 0, t1: yokeShare }, yoke.armholeLeft, { t0: 0, t1: 1 });
  builder.seamRange(sleeveL.capLeft, { t0: yokeShare, t1: 1 }, backBody.armholeLeft, { t0: 0, t1: 1 });
  builder.seam(sleeveR.seamRight, sleeveR.seamLeft, { flipB: true });
  builder.seam(sleeveL.seamRight, sleeveL.seamLeft, { flipB: true });
  builder.seam(sleeveR.hem, cuffR.top, { flipB: true, strength: 1 });
  builder.seam(sleeveL.hem, cuffL.top, { flipB: true, strength: 1 });

  // The stand edge is one straight line, split at the neckline lengths it is sewn to.
  const frontNeckCm = polylineLength(sampleEdge(builder.pattern, frontRight.neckline));
  const backNeckCm = polylineLength(sampleEdge(builder.pattern, yoke.neckline));

  const stand = addCollarStand(builder, {
    name: '领座',
    necklineCm: frontNeckCm * 2 + backNeckCm,
    heightCm: collarHeightCm,
    endHeightCm: collarHeightCm * 0.8,
    drape: { region: 'neck', zone: 'full', anchorOffsetCm: collarHeightCm, radiusOffsetCm: COLLAR_GAP_CM },
  });

  const frontShare = frontNeckCm / (frontNeckCm * 2 + backNeckCm);

  builder.seamRange(stand.bottom, { t0: 0, t1: frontShare }, frontLeft.neckline, { t0: 0, t1: 1 }, { strength: 1 });
  builder.seamRange(stand.bottom, { t0: frontShare, t1: 1 - frontShare }, yoke.neckline, { t0: 0, t1: 1 }, { flipB: true, strength: 1 });
  builder.seamRange(stand.bottom, { t0: 1 - frontShare, t1: 1 }, frontRight.neckline, { t0: 0, t1: 1 }, { strength: 1 });

  const rollLineCm = polylineLength(sampleEdge(builder.pattern, stand.top));
  const fall = addCollarFall(builder, {
    name: '翻领',
    rollLineCm,
    widthCm: COLLAR_FALL_CM,
    pointOutCm: 3.2,
    pointRiseCm: 2.4,
    drape: {
      region: 'neck', zone: 'full', anchorOffsetCm: collarHeightCm + COLLAR_FALL_CM,
      radiusOffsetCm: COLLAR_FOLD_GAP_CM,
    },
  });
  builder.seam(stand.top, fall.bottom, { flipB: true, strength: 1 });

  addFrontMarks(builder, frontLeft.panel, lengthCm, neckDepthCm, -1, true);
  addFrontMarks(builder, frontRight.panel, lengthCm, neckDepthCm, 1, false);
  addSleeveMarks(builder, sleeveL.panel.id, cuffCm);
  addSleeveMarks(builder, sleeveR.panel.id, cuffCm);
  addCuffButton(builder, cuffL.panel.id, cuffCm);
  addCuffButton(builder, cuffR.panel.id, cuffCm);

  // One row read like the body: collar at the head, then left arm, the fronts, the back, right arm.
  layoutRows(builder.pattern, [[
    stand.panel, fall.panel, sleeveL.panel, cuffL.panel, frontLeft.panel, frontRight.panel,
    yoke.panel, backBody.panel, sleeveR.panel, cuffR.panel,
  ]]);

  return builder.pattern;
}

/** Draws the centre front of a front half and, on the button side, its row of buttons. */
function addFrontMarks(
  builder: PatternBuilder,
  panel: Panel,
  topY: number,
  neckDepthCm: number,
  sign: 1 | -1,
  withButtons: boolean,
): void {
  const neckY = topY - neckDepthCm;
  // The centre front is the fold the button stand turns under.
  builder.internalLine(panel, [vec2(0, -HEM_DROP_CM), vec2(0, neckY)], 'decor', '前中线');
  if (!withButtons) return;
  const x = -sign * PLACKET_CM * 0.5;
  const first = neckY - 8;
  const last = 9;
  for (let i = 0; i < 5; i++) {
    builder.trim(panel, 'button', vec2(x, first + (last - first) * (i / 4)), 11);
  }
}

/** Marks the sleeve placket running up from the cuff opening. */
function addSleeveMarks(builder: PatternBuilder, panelId: string, cuffCm: number): void {
  const panel = builder.pattern.panels[panelId]!;
  const x = cuffCm / 2 - 5.5;
  builder.internalLine(panel, [vec2(x, 0), vec2(x, SLEEVE_PLACKET_CM)], 'decor', '袖衩');
}

/** Places the cuff button on the overlapping end. */
function addCuffButton(builder: PatternBuilder, panelId: string, cuffCm: number): void {
  const panel = builder.pattern.panels[panelId]!;
  builder.trim(panel, 'button', vec2(cuffCm * 0.28, 3), 10);
}

export const shirtTemplate = defineTemplate({
  key: 'shirt',
  name: '衬衫',
  summary: '左右前片 · 过肩 · 后背片 · 长袖 · 克夫 · 领座 · 翻领',
  icon: 'shirt',
  fields: [
    cm('chestCm', '胸围', 76, 140),
    cm('lengthCm', '衣长', 55, 90),
    cm('sleeveLengthCm', '袖长', 20, 70),
    cm('cuffCm', '袖口', 18, 40),
    cm('shoulderCm', '肩宽', 32, 56),
    cm('neckWidthCm', '领宽', 14, 24),
    cm('neckDepthCm', '领深', 5, 14),
    cm('collarHeightCm', '领座高', 2, 5),
    cm('cuffHeightCm', '克夫高', 3, 9),
    cm('yokeDepthCm', '过肩深', 5, 16),
  ],
  defaults: DEFAULT_SHIRT_PARAMS,
}, generateShirt);
