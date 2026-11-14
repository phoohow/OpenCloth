import type { Pattern } from '@/model/types';
import { PatternBuilder } from '@/pattern/template/templateKit';
import { layoutRows } from '@/pattern/template/patternLayout';
import { cm, defineTemplate } from '@/pattern/template/garmentTemplate';
import {
  addBodice, addSleeve, addBand, capHeightForArmhole, shoulderSleeveDrape,
} from '@/pattern/template/panelShapes';
import { sampleEdge } from '@/pattern/panel/panelBuilder';
import { polylineLength } from '@/base/geom';

/** Body measurements of a button-up shirt, in centimeters. */
export interface ShirtParams {
  chestCm: number;
  lengthCm: number;
  sleeveLengthCm: number;
  /** Sleeve opening circumference. */
  cuffCm: number;
  shoulderCm: number;
  neckWidthCm: number;
  neckDepthCm: number;
  collarHeightCm: number;
}

export const DEFAULT_SHIRT_PARAMS: ShirtParams = {
  chestCm: 100,
  lengthCm: 72,
  sleeveLengthCm: 52,
  cuffCm: 24,
  shoulderCm: 44,
  neckWidthCm: 17,
  neckDepthCm: 9,
  collarHeightCm: 4,
};

/** Shoulder drop from the neck seam to the shoulder tip, in centimeters. */
const SHOULDER_SLOPE_CM = 4.5;

/** Builds a shirt pattern: bodice halves, two long sleeves and a two-piece stand collar. */
export function generateShirt(params: ShirtParams = DEFAULT_SHIRT_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const {
    chestCm, lengthCm, sleeveLengthCm, cuffCm, shoulderCm,
    neckWidthCm, neckDepthCm, collarHeightCm,
  } = params;

  const halfWidth = chestCm / 4;
  // The sleeve piece's flat width is the tube it sews into, so it has to clear the arm's girth.
  const sleeveWidth = chestCm * 0.36;
  const backNeckDepth = neckDepthCm * 0.35;
  // Armhole depth follows the chest; a long shirt must not turn it into a shallow cap sleeve.
  const armholeDepth = Math.min(chestCm * 0.205, lengthCm * 0.55);
  const underarmAt = (lengthCm - SHOULDER_SLOPE_CM - armholeDepth) / lengthCm;

  const front = addBodice(builder, {
    name: '前片',
    halfWidthCm: halfWidth,
    halfShoulderCm: shoulderCm / 2,
    lengthCm,
    neckHalfWidthCm: neckWidthCm / 2,
    neckDepthCm,
    underarmAt,
    shoulderSlopeCm: SHOULDER_SLOPE_CM,
    drape: { region: 'torso', zone: 'front' },
  });

  const back = addBodice(builder, {
    name: '后片',
    halfWidthCm: halfWidth,
    halfShoulderCm: shoulderCm / 2,
    lengthCm,
    neckHalfWidthCm: neckWidthCm / 2,
    neckDepthCm: backNeckDepth,
    underarmAt,
    shoulderSlopeCm: SHOULDER_SLOPE_CM,
    drape: { region: 'torso', zone: 'back' },
  });

  // The cap arc must match the armhole arc, so the cap height follows from the armhole length.
  const armholeArc = polylineLength(sampleEdge(builder.pattern, front.armholeRight));
  const capHeight = capHeightForArmhole(
    sleeveWidth, armholeArc, Math.max(Math.min(sleeveLengthCm - 4, sleeveWidth * 0.9), 8),
  );
  // Sleeve length is measured from the shoulder, so the shaft below the cap is what is left.
  const sleeveShaft = Math.max(sleeveLengthCm - capHeight, 4);

  const sleeveL = addSleeve(builder, {
    name: '左袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveShaft,
    capHeightCm: capHeight,
    cuffCm,
    side: 'left',
    drape: shoulderSleeveDrape('left'),
  });

  const sleeveR = addSleeve(builder, {
    name: '右袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveShaft,
    capHeightCm: capHeight,
    cuffCm,
    side: 'right',
    drape: shoulderSleeveDrape('right'),
  });

  // The collar bands stand on the neckline edges and wrap by their own cut length.
  const frontNecklineCm = polylineLength(sampleEdge(builder.pattern, front.neckline));
  const backNecklineCm = polylineLength(sampleEdge(builder.pattern, back.neckline));
  const collarFront = addBand(builder, {
    name: '前领片',
    lengthCm: frontNecklineCm,
    heightCm: collarHeightCm,
    drape: {
      region: 'torso',
      zone: 'front',
      flip: true,
      anchorOffsetCm: collarHeightCm,
    },
  });

  const collarBack = addBand(builder, {
    name: '后领片',
    lengthCm: backNecklineCm,
    heightCm: collarHeightCm,
    drape: {
      region: 'torso',
      zone: 'back',
      flip: true,
      anchorOffsetCm: collarHeightCm,
    },
  });

  // Shoulder and side seams join matching ends.
  builder.seam(front.shoulderRight, back.shoulderRight);
  builder.seam(front.shoulderLeft, back.shoulderLeft);
  builder.seam(front.sideRight, back.sideRight);
  builder.seam(front.sideLeft, back.sideLeft);

  // Each cap half pairs its underarm end with the armhole's underarm end. The right armhole is
  // authored underarm first, the left one shoulder first, so the left seams flip their bodice side.
  builder.seam(sleeveR.capRight, front.armholeRight);
  builder.seam(sleeveR.capLeft, back.armholeRight, { flipB: true });
  builder.seam(sleeveL.capRight, front.armholeLeft, { flipB: true });
  builder.seam(sleeveL.capLeft, back.armholeLeft);
  builder.seam(sleeveR.seamRight, sleeveR.seamLeft, { flipB: true });
  builder.seam(sleeveL.seamRight, sleeveL.seamLeft, { flipB: true });

  builder.seam(collarFront.bottom, front.neckline, { strength: 1 });
  builder.seam(collarBack.bottom, back.neckline, { strength: 1 });

  layoutRows(builder.pattern, [
    [sleeveL.panel, front.panel, back.panel, sleeveR.panel],
    [collarFront.panel, collarBack.panel],
  ]);

  return builder.pattern;
}

export const shirtTemplate = defineTemplate({
  key: 'shirt',
  name: '衬衫',
  icon: 'shirt',
  summary: '前片 · 后片 · 长袖 · 立领',
  fields: [
    cm('chestCm', '胸围', 76, 140),
    cm('lengthCm', '衣长', 55, 90),
    cm('sleeveLengthCm', '袖长', 20, 66),
    cm('cuffCm', '袖口', 18, 40),
    cm('shoulderCm', '肩宽', 32, 56),
    cm('neckWidthCm', '领宽', 14, 24),
    cm('neckDepthCm', '领深', 5, 14),
    cm('collarHeightCm', '领座高', 2, 9),
  ],
  defaults: DEFAULT_SHIRT_PARAMS,
}, generateShirt);
