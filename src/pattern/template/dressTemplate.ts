import type { Pattern } from '@/model/types';
import { addBodice, addFlaredPanel } from '@/pattern/template/panelShapes';
import { PatternBuilder } from '@/pattern/template/templateKit';
import { layoutRows } from '@/pattern/template/patternLayout';
import { cm, defineTemplate } from '@/pattern/template/garmentTemplate';

/** Body measurements of a dress, in centimeters. */
export interface DressParams {
  chestCm: number;
  waistCm: number;
  /** Hip girth the skirt has to clear at the hip line. */
  hipCm: number;
  hemCm: number;
  /** Shoulder-to-waist length. */
  waistLineCm: number;
  /** Shoulder-to-hem length. */
  lengthCm: number;
  shoulderCm: number;
  /** Neck opening width. */
  neckWidthCm: number;
  /** Front neck drop below the shoulder line. */
  neckDepthCm: number;
}

export const DEFAULT_DRESS_PARAMS: DressParams = {
  chestCm: 92,
  waistCm: 76,
  hipCm: 98,
  hemCm: 160,
  waistLineCm: 36,
  lengthCm: 112,
  shoulderCm: 40,
  neckWidthCm: 18,
  neckDepthCm: 10,
};

/** Shoulder drop from the neck seam to the shoulder tip, in centimeters. */
const SHOULDER_SLOPE_CM = 4.5;

/** Builds a sleeveless dress: fitted bodice halves joined to a flared two-panel skirt. */
export function generateDress(params: DressParams = DEFAULT_DRESS_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const { chestCm, waistCm, hipCm, hemCm, waistLineCm, lengthCm, shoulderCm, neckWidthCm, neckDepthCm } = params;

  const skirtLengthCm = Math.max(lengthCm - waistLineCm, 20);
  const backNeckDepth = neckDepthCm * 0.35;
  // The armscye follows the chest, so a fitted waistline does not flatten it into a shoulder box.
  const armholeDepth = Math.min(chestCm * 0.205, waistLineCm * 0.55);
  const underarmAt = (waistLineCm - SHOULDER_SLOPE_CM - armholeDepth) / waistLineCm;

  // The bodice narrows from the bust to the waist, matching the skirt it is sewn to.
  const bodiceBase = {
    halfWidthCm: chestCm / 4,
    hemHalfWidthCm: waistCm / 4,
    halfShoulderCm: shoulderCm / 2,
    lengthCm: waistLineCm,
    neckHalfWidthCm: neckWidthCm / 2,
    underarmAt,
    shoulderSlopeCm: SHOULDER_SLOPE_CM,
  };

  const front = addBodice(builder, {
    ...bodiceBase,
    name: '前上身片',
    neckDepthCm,
    drape: { region: 'torso', zone: 'front' },
  });

  const back = addBodice(builder, {
    ...bodiceBase,
    name: '后上身片',
    neckDepthCm: backNeckDepth,
    drape: { region: 'torso', zone: 'back' },
  });

  // The skirt hangs from the bodice hem, so its top row lands on the same body height.
  const skirtBase = {
    waistWidthCm: waistCm / 2,
    hemWidthCm: Math.max(hemCm / 2, waistCm / 2),
    lengthCm: skirtLengthCm,
    // Two panels cover the waist; each has to clear its half of the hip.
    hipWidthCm: (hipCm + 4) / 2,
    seamAllowanceCm: 1,
  };

  const skirtFront = addFlaredPanel(builder, {
    ...skirtBase,
    name: '前裙片',
    drape: { region: 'torso', anchor: 'waist', zone: 'front' },
  });

  const skirtBack = addFlaredPanel(builder, {
    ...skirtBase,
    name: '后裙片',
    drape: { region: 'torso', anchor: 'waist', zone: 'back' },
  });

  builder.seam(front.shoulderRight, back.shoulderRight);
  builder.seam(front.shoulderLeft, back.shoulderLeft);
  builder.seam(front.sideRight, back.sideRight);
  builder.seam(front.sideLeft, back.sideLeft);

  builder.seam(front.hem, skirtFront.waist, { flipB: true, strength: 1 });
  builder.seam(back.hem, skirtBack.waist, { flipB: true, strength: 1 });
  builder.seam(skirtFront.sideRight, skirtBack.sideRight);
  builder.seam(skirtFront.sideLeft, skirtBack.sideLeft);

  // Bodice pieces above the skirt body, each row read left to right like the body.
  layoutRows(builder.pattern, [[
    front.panel, back.panel, skirtFront.panel, skirtBack.panel,
  ]]);

  return builder.pattern;
}

export const dressTemplate = defineTemplate({
  key: 'dress',
  name: '连衣裙',
  icon: 'dress',
  summary: '收腰上身片 · 两片裙身',
  fields: [
    cm('chestCm', '胸围', 76, 130),
    cm('waistCm', '腰围', 56, 120),
    cm('hipCm', '臀围', 60, 150),
    cm('hemCm', '摆围', 80, 320),
    cm('waistLineCm', '腰节', 28, 46),
    cm('lengthCm', '衣长', 70, 145),
    cm('shoulderCm', '肩宽', 30, 54),
    cm('neckWidthCm', '领宽', 14, 24),
    cm('neckDepthCm', '领深', 6, 16),
  ],
  defaults: DEFAULT_DRESS_PARAMS,
}, generateDress);
