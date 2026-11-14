import type { Panel, PanelDrape, Pattern } from '@/model/types';
import { vec2 } from '@/model/types';
import { PatternBuilder } from '@/pattern/template/templateKit';
import { layoutRows } from '@/pattern/template/patternLayout';
import { cm, defineTemplate } from '@/pattern/template/garmentTemplate';
import {
  addBodice, addSleeve, capHeightForArmhole, shoulderSleeveDrape,
} from '@/pattern/template/panelShapes';
import { sampleEdge } from '@/pattern/panel/panelBuilder';
import { polylineLength } from '@/base/geom';

/** Body measurements of a hooded sweatshirt, in centimeters. */
export interface HoodieParams {
  chestCm: number;
  lengthCm: number;
  sleeveLengthCm: number;
  /** Sleeve opening circumference, which is also the cuff rib length. */
  cuffCm: number;
  shoulderCm: number;
  neckWidthCm: number;
  neckDepthCm: number;
  /** Cut height of the hood patch, from the crown to the neck opening. */
  hoodHeightCm: number;
}

export const DEFAULT_HOODIE_PARAMS: HoodieParams = {
  chestCm: 110,
  lengthCm: 70,
  sleeveLengthCm: 54,
  cuffCm: 21,
  shoulderCm: 46,
  neckWidthCm: 20,
  neckDepthCm: 8,
  // Matches the head proxy patch from the crown to the neck-width section.
  hoodHeightCm: 23.8,
};

/** Shoulder drop per centimetre of neck-to-tip run. */
const SHOULDER_SLOPE_SHARE = 0.22;

/** Shoulder seam extended past the body on each side; a hoodie sits off the shoulder. */
const SHOULDER_DROP_CM = 3;

/** Back neck drop as a share of the front drop. */
const BACK_NECK_SHARE = 0.35;

/** Height of the ribbed hem band, in centimeters. */
const HEM_RIB_CM = 6.5;

/** Height of the ribbed cuff, in centimeters. */
const CUFF_RIB_CM = 6;

/** Half-hood panel plus its named outline edges. */
interface HoodEdges {
  panel: Panel;
  bottomFront: string;
  bottomBack: string;
  centerBack: string;
  /** The centre-back seam carried on over the crown to the forehead. */
  crownSeam: string;
}

/**
 * Adds one half of a two-piece hood. The bottom edge follows the neck opening, the centre back runs
 * from the nape over the crown to the forehead, and the face opening falls from the forehead to the
 * chin. Two halves join along the whole centre back, so the seam has two edges on each half.
 */
function addHoodHalf(builder: PatternBuilder, o: {
  name: string;
  frontNeckCm: number;
  backNeckCm: number;
  heightCm: number;
  drape: PanelDrape;
}): HoodEdges {
  const bottomWidth = o.frontNeckCm + o.backNeckCm;
  const height = o.heightCm;
  // The hood bulges out behind the skull and meets itself over the crown.
  const backOut = bottomWidth + Math.max(3, height * 0.12);
  const foreheadX = Math.max(3.5, o.frontNeckCm * 0.4);

  const faceBottom = builder.point(0, 0);
  const shoulder = builder.point(o.frontNeckCm, 0);
  const backBottom = builder.point(bottomWidth, 0);
  const crownBack = builder.point(backOut, height * 0.995);
  const forehead = builder.point(foreheadX, height);

  const bottomFront = builder.line(faceBottom, shoulder, 'neckline');
  const bottomBack = builder.line(shoulder, backBottom, 'neckline');
  const centerBack = builder.bezier(backBottom, crownBack,
    vec2(bottomWidth + 1.6, height * 0.34), vec2(backOut, height * 0.8), 'free');
  const crownSeam = builder.bezier(crownBack, forehead,
    vec2(backOut - (backOut - foreheadX) * 0.3, height * 0.995),
    vec2(foreheadX + (backOut - foreheadX) * 0.3, height * 0.995), 'free');
  // The face opening drops from the forehead to the chin, bowing forward over the jaw.
  const faceOpening = builder.bezier(forehead, faceBottom,
    vec2(foreheadX * 0.92, height * 0.6), vec2(0.6, height * 0.18), 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [bottomFront, bottomBack, centerBack, crownSeam, faceOpening],
    drape: o.drape,
  });
  return { panel, bottomFront, bottomBack, centerBack, crownSeam };
}

/** Rib band hanging from an opening: the top edge attaches, the bottom edge is finished. */
interface RibEdges {
  panel: Panel;
  top: string;
  endRight: string;
  endLeft: string;
}

/** Adds a rectangular rib band whose top edge stitches to the opening it hangs from. */
function addRibBand(builder: PatternBuilder, o: {
  name: string;
  lengthCm: number;
  heightCm: number;
  drape: PanelDrape;
}): RibEdges {
  const half = o.lengthCm / 2;
  const bottomL = builder.point(-half, 0);
  const bottomR = builder.point(half, 0);
  const topR = builder.point(half, o.heightCm);
  const topL = builder.point(-half, o.heightCm);

  const bottom = builder.line(bottomL, bottomR, 'hem');
  const endRight = builder.line(bottomR, topR, 'free');
  const top = builder.line(topR, topL, 'waist');
  const endLeft = builder.line(topL, bottomL, 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [bottom, endRight, top, endLeft],
    drape: o.drape,
    seamAllowanceCm: 0.7,
  });
  return { panel, top, endRight, endLeft };
}

/**
 * Builds a hooded sweatshirt: a boxy body with a dropped shoulder, low-capped sleeves with ribbed
 * cuffs, a ribbed hem, a two-piece hood and a kangaroo pocket marked on the front.
 */
export function generateHoodie(params: HoodieParams = DEFAULT_HOODIE_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const {
    chestCm, lengthCm, sleeveLengthCm, cuffCm, shoulderCm,
    neckWidthCm, neckDepthCm, hoodHeightCm,
  } = params;

  const halfWidth = chestCm / 4;
  const halfShoulder = shoulderCm / 2 + SHOULDER_DROP_CM;
  const halfNeck = neckWidthCm / 2;
  const shoulderSlope = Math.max(halfShoulder - halfNeck, 0) * SHOULDER_SLOPE_SHARE;
  // A hoodie armhole is deep and close to the side seam, which is what lets the sleeve cap stay low.
  const armholeDepth = Math.min(chestCm * 0.2, lengthCm * 0.4);
  const underarmAt = (lengthCm - shoulderSlope - armholeDepth) / lengthCm;

  const bodice = {
    halfWidthCm: halfWidth,
    halfShoulderCm: halfShoulder,
    lengthCm,
    neckHalfWidthCm: halfNeck,
    underarmAt,
    shoulderSlopeCm: shoulderSlope,
    splitNeckline: true,
  };

  const front = addBodice(builder, {
    ...bodice,
    name: '前片',
    neckDepthCm,
    drape: { region: 'torso', zone: 'front' },
  });

  const back = addBodice(builder, {
    ...bodice,
    name: '后片',
    neckDepthCm: neckDepthCm * BACK_NECK_SHARE,
    drape: { region: 'torso', zone: 'back' },
  });

  // A dropped shoulder runs the seam down the arm, so the sleeve is cut wide and its cap barely
  // rises above the bicep line.
  const sleeveWidth = chestCm * 0.36;
  const armholeArc = polylineLength(sampleEdge(builder.pattern, front.armholeRight));
  const capHeight = capHeightForArmhole(
    sleeveWidth, armholeArc, Math.max(Math.min(sleeveLengthCm * 0.35, sleeveWidth * 0.9), 8),
  );
  // Sleeve length runs from the shoulder to the cuff edge, so the shaft carries neither the cap nor
  // the cuff rib.
  const sleeveShaft = Math.max(sleeveLengthCm - capHeight - CUFF_RIB_CM, 4);

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

  // The hem ribs hang from the bodice hem, one band per bodice half.
  const ribDrape = { region: 'torso' as const, anchor: 'shoulderTop' as const, anchorOffsetCm: -lengthCm };
  const frontRib = addRibBand(builder, {
    name: '前下摆罗纹',
    lengthCm: chestCm / 2,
    heightCm: HEM_RIB_CM,
    drape: { ...ribDrape, zone: 'front' },
  });

  const backRib = addRibBand(builder, {
    name: '后下摆罗纹',
    lengthCm: chestCm / 2,
    heightCm: HEM_RIB_CM,
    drape: { ...ribDrape, zone: 'back' },
  });

  // Cuff ribs close the sleeve; they sit at the wrist, not at the shoulder.
  const cuffAnchorCm = -(sleeveLengthCm - CUFF_RIB_CM);
  const cuffL = addRibBand(builder, {
    name: '左袖口罗纹',
    lengthCm: cuffCm,
    heightCm: CUFF_RIB_CM,
    drape: { region: 'arm', side: 'left', zone: 'full', anchorOffsetCm: cuffAnchorCm },
  });

  const cuffR = addRibBand(builder, {
    name: '右袖口罗纹',
    lengthCm: cuffCm,
    heightCm: CUFF_RIB_CM,
    drape: { region: 'arm', side: 'right', zone: 'full', anchorOffsetCm: cuffAnchorCm },
  });

  // Both hood halves follow the neck opening; each takes one half of the front and back neckline.
  const frontNeckHalfCm = polylineLength(sampleEdge(builder.pattern, front.necklineLeft!));
  const backNeckHalfCm = polylineLength(sampleEdge(builder.pattern, back.necklineLeft!));

  const hoodL = addHoodHalf(builder, {
    name: '兜帽左片',
    frontNeckCm: frontNeckHalfCm,
    backNeckCm: backNeckHalfCm,
    heightCm: hoodHeightCm,
    drape: { region: 'head', zone: 'left' },
  });

  const hoodR = addHoodHalf(builder, {
    name: '兜帽右片',
    frontNeckCm: frontNeckHalfCm,
    backNeckCm: backNeckHalfCm,
    heightCm: hoodHeightCm,
    drape: { region: 'head', zone: 'right' },
  });

  addPocketMark(builder, front.panel, halfWidth);

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
  builder.seam(sleeveR.hem, cuffR.top, { flipB: true, strength: 1 });
  builder.seam(sleeveL.hem, cuffL.top, { flipB: true, strength: 1 });

  builder.seam(front.hem, frontRib.top, { flipB: true, strength: 1 });
  builder.seam(back.hem, backRib.top, { flipB: true, strength: 1 });
  builder.seam(frontRib.endRight, backRib.endRight, { strength: 1 });
  builder.seam(frontRib.endLeft, backRib.endLeft, { strength: 1 });

  // Each hood half meets the other at the centre back. The left half takes the left halves of the
  // neckline and the right half the right ones, so both centre-front ends pair with a neck centre.
  builder.seam(hoodL.centerBack, hoodR.centerBack);
  builder.seam(hoodL.crownSeam, hoodR.crownSeam, { flipB: true });
  builder.seam(hoodL.bottomFront, front.necklineLeft!, { strength: 1 });
  builder.seam(hoodL.bottomBack, back.necklineLeft!, { flipB: true, strength: 1 });
  builder.seam(hoodR.bottomFront, front.necklineRight!, { flipB: true, strength: 1 });
  builder.seam(hoodR.bottomBack, back.necklineRight!, { strength: 1 });

  // One row read like the body: hood at the head, left arm, the body, right arm, then the ribs.
  layoutRows(builder.pattern, [[
    hoodL.panel, hoodR.panel, sleeveL.panel, cuffL.panel, front.panel, back.panel,
    sleeveR.panel, cuffR.panel, frontRib.panel, backRib.panel,
  ]]);

  return builder.pattern;
}

/** Marks the kangaroo pocket across the front panel, its side edges slanted for the hand openings. */
function addPocketMark(builder: PatternBuilder, panel: Panel, halfWidthCm: number): void {
  const bottom = 6;
  const top = bottom + 18;
  const halfBottom = Math.min(halfWidthCm * 0.72, 19);
  const halfTop = halfBottom * 1.1;
  builder.internalLine(panel, [
    vec2(-halfBottom, bottom),
    vec2(halfBottom, bottom),
    vec2(halfTop, top),
    vec2(-halfTop, top),
    vec2(-halfBottom, bottom),
  ], 'decor', '袋鼠袋');
}

export const hoodieTemplate = defineTemplate({
  key: 'hoodie',
  name: '卫衣',
  icon: 'hoodie',
  summary: '前片 · 后片 · 落肩长袖 · 罗纹 · 兜帽',
  fields: [
    cm('chestCm', '胸围', 80, 150),
    cm('lengthCm', '衣长', 55, 90),
    cm('sleeveLengthCm', '袖长', 20, 70),
    cm('cuffCm', '袖口', 16, 34),
    cm('shoulderCm', '肩宽', 32, 58),
    cm('neckWidthCm', '领宽', 14, 26),
    cm('neckDepthCm', '领深', 5, 15),
    cm('hoodHeightCm', '帽高', 24, 44),
  ],
  defaults: DEFAULT_HOODIE_PARAMS,
}, generateHoodie);
