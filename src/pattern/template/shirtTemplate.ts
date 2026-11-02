import type { Pattern } from '../../core/model/types';
import { PatternBuilder } from './templateKit';
import {
  frontArc, backArc, frontArcFlipped, backArcFlipped, neckArcSpan, necklineLengthCm,
} from './drapeArcs';
import { layoutRows } from './patternLayout';
import { cm, defineTemplate } from './garmentTemplate';
import { addBodice, addSleeve, addBand } from './panelShapes';

/** Body measurements of a button-up shirt, in centimeters. */
export interface ShirtParams {
  chestCm: number;
  lengthCm: number;
  sleeveLengthCm: number;
  capHeightCm: number;
  shoulderCm: number;
  neckWidthCm: number;
  neckDepthCm: number;
  collarHeightCm: number;
}

export const DEFAULT_SHIRT_PARAMS: ShirtParams = {
  chestCm: 100,
  lengthCm: 72,
  sleeveLengthCm: 55,
  capHeightCm: 16,
  shoulderCm: 44,
  neckWidthCm: 17,
  neckDepthCm: 9,
  collarHeightCm: 4,
};

/** Builds a shirt pattern: bodice halves, two long sleeves and a two-piece stand collar. */
export function generateShirt(params: ShirtParams = DEFAULT_SHIRT_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const {
    chestCm, lengthCm, sleeveLengthCm, capHeightCm, shoulderCm,
    neckWidthCm, neckDepthCm, collarHeightCm,
  } = params;

  const halfWidth = chestCm / 4;
  const sleeveWidth = chestCm / 4 * 0.9;
  const backNeckDepth = neckDepthCm * 0.35;

  const front = addBodice(builder, {
    name: '前片',
    halfWidthCm: halfWidth,
    halfShoulderCm: shoulderCm / 2,
    lengthCm,
    neckHalfWidthCm: neckWidthCm / 2,
    neckDepthCm,
    drape: { region: 'torso', ...frontArc(180) },
  });

  const back = addBodice(builder, {
    name: '后片',
    halfWidthCm: halfWidth,
    halfShoulderCm: shoulderCm / 2,
    lengthCm,
    neckHalfWidthCm: neckWidthCm / 2,
    neckDepthCm: backNeckDepth,
    drape: { region: 'torso', ...backArc(180) },
  });

  const sleeveL = addSleeve(builder, {
    name: '左袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveLengthCm,
    capHeightCm,
    cuffCm: sleeveWidth * 0.5,
    side: 'left',
  });

  const sleeveR = addSleeve(builder, {
    name: '右袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveLengthCm,
    capHeightCm,
    cuffCm: sleeveWidth * 0.5,
    side: 'right',
  });

  // The collar bands stand on the neckline edges, so their spans match the opening they close.
  const neckSpan = neckArcSpan(neckWidthCm, halfWidth * 2);
  const collarFront = addBand(builder, {
    name: '前领片',
    lengthCm: necklineLengthCm(neckWidthCm / 2, neckDepthCm),
    heightCm: collarHeightCm,
    drape: {
      region: 'torso',
      ...frontArcFlipped(neckSpan),
      anchorOffsetCm: collarHeightCm,
    },
  });

  const collarBack = addBand(builder, {
    name: '后领片',
    lengthCm: necklineLengthCm(neckWidthCm / 2, backNeckDepth),
    heightCm: collarHeightCm,
    drape: {
      region: 'torso',
      ...backArcFlipped(neckSpan),
      anchorOffsetCm: collarHeightCm,
    },
  });

  // Shoulder and side seams join matching ends.
  builder.seam(front.shoulderRight, back.shoulderRight);
  builder.seam(front.shoulderLeft, back.shoulderLeft);
  builder.seam(front.sideRight, back.sideRight);
  builder.seam(front.sideLeft, back.sideLeft);

  builder.seam(sleeveR.capRight, front.armholeRight, { type: 'gather' });
  builder.seam(sleeveR.capLeft, back.armholeRight, { type: 'gather', flipB: true });
  builder.seam(sleeveL.capRight, front.armholeLeft, { type: 'gather' });
  builder.seam(sleeveL.capLeft, back.armholeLeft, { type: 'gather', flipB: true });
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
    cm('sleeveLengthCm', '袖长', 20, 62),
    cm('capHeightCm', '袖山', 8, 20),
    cm('shoulderCm', '肩宽', 32, 56),
    cm('neckWidthCm', '领宽', 14, 24),
    cm('neckDepthCm', '领深', 5, 14),
    cm('collarHeightCm', '领座高', 2, 9),
  ],
  defaults: DEFAULT_SHIRT_PARAMS,
}, generateShirt);
