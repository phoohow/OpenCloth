import type { Panel, PanelDrape, Pattern } from '@/model/types';
import { vec2 } from '@/model/types';
import { PatternBuilder } from '@/pattern/template/templateKit';
import { layoutRows } from '@/pattern/template/patternLayout';
import { frontArc, backArc } from '@/pattern/template/drapeArcs';
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
  /** Sleeve opening circumference. */
  cuffCm: number;
  shoulderCm: number;
  neckWidthCm: number;
  neckDepthCm: number;
  /** Crown height above the shoulder line. */
  hoodHeightCm: number;
}

export const DEFAULT_HOODIE_PARAMS: HoodieParams = {
  chestCm: 110,
  lengthCm: 70,
  sleeveLengthCm: 60,
  cuffCm: 20,
  shoulderCm: 46,
  neckWidthCm: 20,
  neckDepthCm: 8,
  hoodHeightCm: 32,
};

/** Shoulder drop from the neck seam to the shoulder tip, in centimeters. */
const SHOULDER_SLOPE_CM = 5;

/** Back neck drop as a share of the front drop. */
const BACK_NECK_SHARE = 0.35;

/** Height of the ribbed hem bands, in centimeters. */
const RIB_HEIGHT_CM = 7;

/** Half-hood panel plus its named outline edges. */
interface HoodEdges {
  panel: Panel;
  bottomFront: string;
  bottomBack: string;
  centerBack: string;
}

/**
 * Adds one half of a two-piece hood. The bottom edge follows the neck opening, the centre-back
 * edge joins the other half and the face opening stays free.
 */
function addHoodHalf(builder: PatternBuilder, o: {
  name: string;
  frontNeckCm: number;
  backNeckCm: number;
  heightCm: number;
  drape: PanelDrape;
}): HoodEdges {
  const bottomWidth = o.frontNeckCm + o.backNeckCm;
  // The crown is wider than the neck opening so the hood clears the head.
  const crownWidth = bottomWidth + Math.max(4, o.heightCm * 0.14);
  const height = o.heightCm;

  const faceBottom = builder.point(0, 0);
  const shoulder = builder.point(o.frontNeckCm, 0);
  const backBottom = builder.point(bottomWidth, 0);
  const crown = builder.point(crownWidth, height);

  const bottomFront = builder.line(faceBottom, shoulder, 'neckline');
  const bottomBack = builder.line(shoulder, backBottom, 'neckline');
  const centerBack = builder.bezier(backBottom, crown,
    vec2(bottomWidth, height * 0.4), vec2(crownWidth * 0.95, height * 0.8), 'free');
  const faceOpening = builder.bezier(crown, faceBottom,
    vec2(crownWidth * 0.3, height * 0.97), vec2(-bottomWidth * 0.08, height * 0.45), 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [bottomFront, bottomBack, centerBack, faceOpening],
    drape: o.drape,
  });
  return { panel, bottomFront, bottomBack, centerBack };
}

/** Rib band hanging from a hem: the top edge attaches, the bottom edge is finished. */
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
 * Builds a hooded sweatshirt: bodice halves, long sleeves, a two-piece hood and a ribbed hem.
 */
export function generateHoodie(params: HoodieParams = DEFAULT_HOODIE_PARAMS, fabricId = 'fabric_default'): Pattern {
  const builder = new PatternBuilder(fabricId);
  const {
    chestCm, lengthCm, sleeveLengthCm, cuffCm, shoulderCm,
    neckWidthCm, neckDepthCm, hoodHeightCm,
  } = params;

  const halfWidth = chestCm / 4;
  const sleeveWidth = chestCm * 0.36;
  // Armhole depth follows the chest; a long sweatshirt must not turn it into a shallow cap sleeve.
  const armholeDepth = Math.min(chestCm * 0.205, lengthCm * 0.55);
  const underarmAt = (lengthCm - SHOULDER_SLOPE_CM - armholeDepth) / lengthCm;

  const bodice = {
    halfWidthCm: halfWidth,
    halfShoulderCm: shoulderCm / 2,
    lengthCm,
    neckHalfWidthCm: neckWidthCm / 2,
    underarmAt,
    shoulderSlopeCm: SHOULDER_SLOPE_CM,
    splitNeckline: true,
  };

  const front = addBodice(builder, {
    ...bodice,
    name: '前片',
    neckDepthCm,
    drape: { region: 'torso', ...frontArc(180) },
  });

  const back = addBodice(builder, {
    ...bodice,
    name: '后片',
    neckDepthCm: neckDepthCm * BACK_NECK_SHARE,
    drape: { region: 'torso', ...backArc(180) },
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
    drape: shoulderSleeveDrape('left', SHOULDER_SLOPE_CM),
  });

  const sleeveR = addSleeve(builder, {
    name: '右袖',
    widthCm: sleeveWidth,
    lengthCm: sleeveShaft,
    capHeightCm: capHeight,
    cuffCm,
    side: 'right',
    drape: shoulderSleeveDrape('right', SHOULDER_SLOPE_CM),
  });

  // The hem rib hangs from the bodice hem, one band per bodice half.
  const ribDrape = { region: 'torso' as const, anchor: 'shoulderTop' as const, anchorOffsetCm: -lengthCm };
  const frontRib = addRibBand(builder, {
    name: '前下摆罗纹',
    lengthCm: chestCm / 2,
    heightCm: RIB_HEIGHT_CM,
    drape: { ...ribDrape, ...frontArc(180) },
  });

  const backRib = addRibBand(builder, {
    name: '后下摆罗纹',
    lengthCm: chestCm / 2,
    heightCm: RIB_HEIGHT_CM,
    drape: { ...ribDrape, ...backArc(180) },
  });

  // Both hood halves follow the neck opening; each takes one half of the front and back neckline.
  const frontNeckHalfCm = polylineLength(sampleEdge(builder.pattern, front.necklineLeft!));
  const backNeckHalfCm = polylineLength(sampleEdge(builder.pattern, back.necklineLeft!));

  const hoodL = addHoodHalf(builder, {
    name: '兜帽左片',
    frontNeckCm: frontNeckHalfCm,
    backNeckCm: backNeckHalfCm,
    heightCm: hoodHeightCm,
    drape: {
      region: 'neck',
      anchor: 'shoulderTop',
      anchorOffsetCm: hoodHeightCm,
      startDeg: 90,
      sweepDeg: 180,
    },
  });

  const hoodR = addHoodHalf(builder, {
    name: '兜帽右片',
    frontNeckCm: frontNeckHalfCm,
    backNeckCm: backNeckHalfCm,
    heightCm: hoodHeightCm,
    drape: {
      region: 'neck',
      anchor: 'shoulderTop',
      anchorOffsetCm: hoodHeightCm,
      startDeg: 90,
      sweepDeg: -180,
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

  builder.seam(front.hem, frontRib.top, { flipB: true, strength: 1 });
  builder.seam(back.hem, backRib.top, { flipB: true, strength: 1 });
  builder.seam(frontRib.endRight, backRib.endRight, { strength: 1 });
  builder.seam(frontRib.endLeft, backRib.endLeft, { strength: 1 });

  // Each hood half meets the other at the centre back. The left half takes the left halves of the
  // neckline and the right half the right ones, so both centre-front ends pair with a neck centre.
  builder.seam(hoodL.centerBack, hoodR.centerBack);
  builder.seam(hoodL.bottomFront, front.necklineLeft!, { strength: 1 });
  builder.seam(hoodL.bottomBack, back.necklineLeft!, { flipB: true, strength: 1 });
  builder.seam(hoodR.bottomFront, front.necklineRight!, { flipB: true, strength: 1 });
  builder.seam(hoodR.bottomBack, back.necklineRight!, { strength: 1 });

  layoutRows(builder.pattern, [
    [sleeveL.panel, front.panel, back.panel, sleeveR.panel],
    [hoodL.panel, hoodR.panel, frontRib.panel, backRib.panel],
  ]);

  return builder.pattern;
}

export const hoodieTemplate = defineTemplate({
  key: 'hoodie',
  name: '卫衣',
  icon: 'hoodie',
  summary: '前片 · 后片 · 长袖 · 兜帽 · 罗纹下摆',
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