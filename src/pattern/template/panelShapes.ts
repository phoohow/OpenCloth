import type { Panel, PanelDrape, Vec2 } from '@/model/types';
import { vec2 } from '@/model/types';
import { evalBezier, type CubicBezier2 } from '@/base/geom/bezier';
import { distance2, lerp } from '@/base/math';
import type { PatternBuilder } from '@/pattern/template/templateKit';

/** Bodice panel plus its named outline edges, in outline order. */
export interface BodiceEdges {
  panel: Panel;
  hem: string;
  sideRight: string;
  armholeRight: string;
  shoulderRight: string;
  neckline: string;
  /** Right and left halves of the neckline, present when it was split at its centre. */
  necklineRight?: string;
  necklineLeft?: string;
  shoulderLeft: string;
  armholeLeft: string;
  sideLeft: string;
}

/** Measurements for addBodice, in centimeters. */
export interface BodiceOptions {
  name: string;
  /** Half width of the panel at the side seams and hem. */
  halfWidthCm: number;
  /** Half width of the hem when the bodice narrows toward the waist; defaults to `halfWidthCm`. */
  hemHalfWidthCm?: number;
  /** Half distance between the shoulder tips. */
  halfShoulderCm: number;
  lengthCm: number;
  /** Half width of the neck opening. */
  neckHalfWidthCm: number;
  /** Drop of the neck opening below the shoulder line. */
  neckDepthCm: number;
  /** Underarm height as a fraction of the panel length. */
  underarmAt?: number;
  /** Drop of the shoulder tip below the neck seam, which a flat shoulder line omits. */
  shoulderSlopeCm?: number;
  /** Bows the side seam inward by this much at the waist. */
  waistInsetCm?: number;
  /** Drops the middle of the hem below its ends, giving a shirt-tail curve. */
  hemCurveCm?: number;
  /** Drafts the neckline as two halves meeting at its centre. */
  splitNeckline?: boolean;
  drape: PanelDrape;
  seamAllowanceCm?: number;
}

/** Underarm and shoulder heights of one bodice draft, in pattern centimetres. */
export interface ArmholeFrame {
  halfWidthCm: number;
  halfShoulderCm: number;
  underarmY: number;
  shoulderY: number;
}

/**
 * Armhole cubic from the underarm point up to the shoulder tip. The curve leaves the underarm
 * almost vertically and scoops in under the tip, so the sleeve hangs from a hollow armhole.
 */
export function armholeCubic(o: ArmholeFrame, sideSign: 1 | -1): CubicBezier2 {
  const h = Math.max(o.shoulderY - o.underarmY, 1e-3);
  return {
    p0: vec2(sideSign * o.halfWidthCm, o.underarmY),
    c0: vec2(sideSign * (o.halfWidthCm - h * 0.05), o.underarmY + h * 0.45),
    c1: vec2(sideSign * (o.halfShoulderCm - h * 0.025), o.shoulderY - h * 0.45),
    p1: vec2(sideSign * o.halfShoulderCm, o.shoulderY),
  };
}

/** Side seam cubic from the hem up to the underarm, bowed inward at the waist. */
export function sideSeamCubic(o: {
  hemHalfWidthCm: number;
  halfWidthCm: number;
  hemY: number;
  underarmY: number;
  waistInsetCm?: number;
}): CubicBezier2 {
  const inset = o.waistInsetCm ?? 0;
  const rise = o.underarmY - o.hemY;
  return {
    p0: vec2(o.hemHalfWidthCm, o.hemY),
    c0: vec2(o.hemHalfWidthCm - inset, o.hemY + rise * 0.35),
    c1: vec2(o.halfWidthCm - inset, o.underarmY - rise * 0.35),
    p1: vec2(o.halfWidthCm, o.underarmY),
  };
}

/** Adds a front or back bodice panel: hem, side seams, curved armholes, shoulders and one neckline edge. */
export function addBodice(builder: PatternBuilder, o: BodiceOptions): BodiceEdges {
  const top = o.lengthCm;
  const shoulderY = top - (o.shoulderSlopeCm ?? 0);
  const underarmY = shoulderY - Math.max(shoulderY - top * (o.underarmAt ?? 0.75), 0.5);
  const halfNeck = o.neckHalfWidthCm;
  const halfHem = o.hemHalfWidthCm ?? o.halfWidthCm;
  const hemCurve = o.hemCurveCm ?? 0;
  const hemL = builder.point(-halfHem, 0);
  const hemR = builder.point(halfHem, 0);
  const underarmR = builder.point(o.halfWidthCm, underarmY);
  const shoulderR = builder.point(o.halfShoulderCm, shoulderY);
  const neckR = builder.point(halfNeck, top);
  const neckL = builder.point(-halfNeck, top);
  const shoulderL = builder.point(-o.halfShoulderCm, shoulderY);
  const underarmL = builder.point(-o.halfWidthCm, underarmY);

  const rightArmhole = armholeCubic({ ...o, underarmY, shoulderY }, 1);
  const leftArmhole = armholeCubic({ ...o, underarmY, shoulderY }, -1);
  const rightSide = sideSeamCubic({ halfWidthCm: o.halfWidthCm, hemHalfWidthCm: halfHem, hemY: 0, underarmY, waistInsetCm: o.waistInsetCm });
  const leftSide = sideSeamCubic({ halfWidthCm: o.halfWidthCm, hemHalfWidthCm: halfHem, hemY: 0, underarmY, waistInsetCm: o.waistInsetCm });

  const hem = hemCurve > 0
    ? builder.bezier(hemL, hemR,
      vec2(-halfHem * 0.35, -hemCurve), vec2(halfHem * 0.35, -hemCurve), 'hem')
    : builder.line(hemL, hemR, 'hem');
  const sideRight = o.waistInsetCm
    ? builder.bezier(hemR, underarmR, rightSide.c0, rightSide.c1, 'sideSeam')
    : builder.line(hemR, underarmR, 'sideSeam');
  const armholeRight = builder.bezier(underarmR, shoulderR, rightArmhole.c0, rightArmhole.c1, 'armhole');
  const shoulderRight = builder.line(shoulderR, neckR, 'shoulder');
  // The whole neck opening is one cubic, dropping about neckDepthCm at its center.
  const neckControls: [Vec2, Vec2] = [
    vec2(halfNeck * 0.55, top - o.neckDepthCm * (4 / 3)),
    vec2(-halfNeck * 0.55, top - o.neckDepthCm * (4 / 3)),
  ];
  let neckline: string;
  let necklineRight: string | undefined;
  let necklineLeft: string | undefined;
  let outlineNeck: string[];
  if (o.splitNeckline) {
    // de Casteljau split at t = 0.5 keeps the drafted neck curve unchanged.
    const ab = midpoint(neckR.pos, neckControls[0]);
    const bc = midpoint(neckControls[0], neckControls[1]);
    const cd = midpoint(neckControls[1], neckL.pos);
    const abc = midpoint(ab, bc);
    const bcd = midpoint(bc, cd);
    const neckCenter = builder.point(0, top - o.neckDepthCm);
    necklineRight = builder.bezier(neckR, neckCenter, ab, abc, 'neckline');
    necklineLeft = builder.bezier(neckCenter, neckL, bcd, cd, 'neckline');
    neckline = necklineRight;
    outlineNeck = [necklineRight, necklineLeft];
  } else {
    neckline = builder.bezier(neckR, neckL, neckControls[0], neckControls[1], 'neckline');
    outlineNeck = [neckline];
  }
  const shoulderLeft = builder.line(neckL, shoulderL, 'shoulder');
  const armholeLeft = builder.bezier(shoulderL, underarmL, leftArmhole.c1, leftArmhole.c0, 'armhole');
  const sideLeft = o.waistInsetCm
    ? builder.bezier(underarmL, hemL, leftSide.c1, leftSide.c0, 'sideSeam')
    : builder.line(underarmL, hemL, 'sideSeam');

  const panel = builder.panel({
    name: o.name,
    edges: [hem, sideRight, armholeRight, shoulderRight, ...outlineNeck, shoulderLeft, armholeLeft, sideLeft],
    drape: o.drape,
    seamAllowanceCm: o.seamAllowanceCm ?? 1,
  });

  return {
    panel, hem, sideRight, armholeRight, shoulderRight, neckline, necklineRight, necklineLeft,
    shoulderLeft, armholeLeft, sideLeft,
  };
}

/** Point halfway between two positions. */
function midpoint(a: Vec2, b: Vec2): Vec2 {
  return vec2(lerp(a.x, b.x, 0.5), lerp(a.y, b.y, 0.5));
}

/** Sleeve panel plus its named outline edges. */
export interface SleeveEdges {
  panel: Panel;
  hem: string;
  seamRight: string;
  capRight: string;
  capLeft: string;
  seamLeft: string;
}

/** Measurements for addSleeve, in centimeters. */
export interface SleeveOptions {
  name: string;
  /** Flat width across the bicep; also the sleeve cap's base width. */
  widthCm: number;
  /** Distance from the cap base line to the hem. */
  lengthCm: number;
  capHeightCm: number;
  side: 'left' | 'right';
  /** Hem width; full width when absent. */
  cuffCm?: number;
  /** Wrap override; defaults to a row-wrapped arm draped from the shoulder hinge. */
  drape?: PanelDrape;
  seamAllowanceCm?: number;
}

/**
 * Wrap of a set-in sleeve: the cap crown rides over the shoulder cap and the underarm seam
 * closes below it, centred on one full turn around the arm.
 */
export function shoulderSleeveDrape(side: 'left' | 'right'): PanelDrape {
  return { region: 'arm', side, zone: 'full' };
}

/** Half of a sleeve cap, from the underarm point of the cap base up to the crown. */
export function sleeveCapCubic(o: {
  halfWidthCm: number;
  baseY: number;
  crownY: number;
  sideSign: 1 | -1;
}): CubicBezier2 {
  const h = Math.max(o.crownY - o.baseY, 1e-3);
  return {
    p0: vec2(o.sideSign * o.halfWidthCm, o.baseY),
    // Vertical at the underarm and horizontal at the crown: the cap rolls over the shoulder
    // without the ballooned dome a flat crown gives.
    c0: vec2(o.sideSign * o.halfWidthCm, o.baseY + h * 0.42),
    c1: vec2(o.sideSign * o.halfWidthCm * 0.4, o.crownY),
    p1: vec2(0, o.crownY),
  };
}

/** Adds a one-piece sleeve panel: hem, underarm seams and a two-segment cap. */
export function addSleeve(builder: PatternBuilder, o: SleeveOptions): SleeveEdges {
  const halfCuff = (o.cuffCm ?? o.widthCm) / 2;
  const baseY = o.lengthCm;
  const crownY = baseY + o.capHeightCm;

  const hemL = builder.point(-halfCuff, 0);
  const hemR = builder.point(halfCuff, 0);
  const baseR = builder.point(o.widthCm / 2, baseY);
  const crown = builder.point(0, crownY);
  const baseL = builder.point(-o.widthCm / 2, baseY);

  const right = sleeveCapCubic({ halfWidthCm: o.widthCm / 2, baseY, crownY, sideSign: 1 });
  const left = sleeveCapCubic({ halfWidthCm: o.widthCm / 2, baseY, crownY, sideSign: -1 });

  const hem = builder.line(hemL, hemR, 'hem');
  const seamRight = builder.line(hemR, baseR, 'sideSeam');
  const capRight = builder.bezier(baseR, crown, right.c0, right.c1, 'sleeveCap');
  const capLeft = builder.bezier(crown, baseL, left.c1, left.c0, 'sleeveCap');
  const seamLeft = builder.line(baseL, hemL, 'sideSeam');

  const panel = builder.panel({
    name: o.name,
    edges: [hem, seamRight, capRight, capLeft, seamLeft],
    drape: o.drape ?? { region: 'arm', side: o.side },
    seamAllowanceCm: o.seamAllowanceCm ?? 1,
  });

  return { panel, hem, seamRight, capRight, capLeft, seamLeft };
}

/** Arc length of the sleeve cap `addSleeve` draws for the given flat width and cap height. */
export function sleeveCapArcCm(widthCm: number, capHeightCm: number): number {
  const half = sleeveCapCubic({ halfWidthCm: widthCm / 2, baseY: 0, crownY: capHeightCm, sideSign: 1 });
  return 2 * cubicLength([half.p0, half.c0, half.c1, half.p1]);
}

/**
 * Cap height whose half cap arc matches the armhole arc it is sewn to. Each cap half is one
 * armhole's seam, so a set-in sleeve needs equal arc lengths there or the stitches have to gather
 * or stretch.
 */
export function capHeightForArmhole(widthCm: number, armholeArcCm: number, maxCapCm: number): number {
  let lo = 0.5;
  let hi = Math.max(maxCapCm, lo + 1);
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    // `sleeveCapArcCm` measures the whole cap, which two armholes are sewn to.
    if (sleeveCapArcCm(widthCm, mid) / 2 < armholeArcCm) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Length of a cubic Bezier polyline, sampled densely enough for drafting armpits and caps. */
function cubicLength([p0, c0, c1, p1]: Vec2[], steps = 24): number {
  const curve = { p0, c0, c1, p1 };
  let total = 0;
  let previous = p0;
  for (let i = 1; i <= steps; i++) {
    const point = evalBezier(curve, i / steps);
    total += distance2(previous, point);
    previous = point;
  }
  return total;
}

/** Skirt or dress panel plus its named outline edges. */
export interface FlaredEdges {
  panel: Panel;
  hem: string;
  sideRight: string;
  waist: string;
  sideLeft: string;
}

/** Measurements for addFlaredPanel, in centimeters. */
export interface FlaredOptions {
  name: string;
  waistWidthCm: number;
  hemWidthCm: number;
  lengthCm: number;
  /** Panel width at the hip line; the side seams bow out until they reach it. */
  hipWidthCm?: number;
  drape: PanelDrape;
  seamAllowanceCm?: number;
  meshResolutionCm?: number;
}

/**
 * Bow that widens the side seam to the requested hip width 18 cm below the waist. The cubic's
 * height is monotonic, so the hip parameter is found by bisection and the bow follows from the
 * width.
 */
function hipBow(
  halfHemCm: number, halfWaistCm: number, lengthCm: number, hipWidthCm: number | undefined,
): number {
  if (hipWidthCm === undefined) return 0;
  const depth = Math.min(18, lengthCm * 0.9);
  const targetY = lengthCm - depth;
  const c0y = lengthCm * 0.35;
  const c1y = lengthCm * 0.7;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (cubicAt(0, c0y, c1y, lengthCm, t) < targetY) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  const baseX = cubicAt(halfHemCm, lerp(halfHemCm, halfWaistCm, 0.35), lerp(halfHemCm, halfWaistCm, 0.7), halfWaistCm, t);
  const weight = 3 * (1 - t) ** 2 * t + 3 * (1 - t) * t ** 2;
  return weight > 1e-6 ? Math.max(0, (hipWidthCm / 2 - baseX) / weight) : 0;
}

/** Value of one cubic Bezier coordinate at `t`. */
function cubicAt(p0: number, c0: number, c1: number, p1: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c0 + 3 * u * t * t * c1 + t * t * t * p1;
}

/** Adds a skirt or dress-body panel that widens from the waist edge to the hem. */
export function addFlaredPanel(builder: PatternBuilder, o: FlaredOptions): FlaredEdges {
  const halfWaist = o.waistWidthCm / 2;
  const halfHem = o.hemWidthCm / 2;
  const c0 = { x: lerp(halfHem, halfWaist, 0.35), y: o.lengthCm * 0.35 };
  const c1 = { x: lerp(halfHem, halfWaist, 0.7), y: o.lengthCm * 0.7 };
  const bow = hipBow(halfHem, halfWaist, o.lengthCm, o.hipWidthCm);

  const hemL = builder.point(-halfHem, 0);
  const hemR = builder.point(halfHem, 0);
  const waistR = builder.point(halfWaist, o.lengthCm);
  const waistL = builder.point(-halfWaist, o.lengthCm);

  const hem = builder.line(hemL, hemR, 'hem');
  const sideRight = builder.bezier(hemR, waistR,
    vec2(c0.x + bow, c0.y), vec2(c1.x + bow, c1.y), 'sideSeam');
  const waist = builder.line(waistR, waistL, 'waist');
  const sideLeft = builder.bezier(waistL, hemL,
    vec2(-c1.x - bow, c1.y), vec2(-c0.x - bow, c0.y), 'sideSeam');

  const panel = builder.panel({
    name: o.name,
    edges: [hem, sideRight, waist, sideLeft],
    drape: o.drape,
    seamAllowanceCm: o.seamAllowanceCm ?? 1,
    meshResolutionCm: o.meshResolutionCm,
  });

  return { panel, hem, sideRight, waist, sideLeft };
}

/** Band whose bottom edge is split into equal segments; each segment is sewn to one piece. */
export interface SplitBandEdges {
  panel: Panel;
  top: string;
  endRight: string;
  /** Bottom edges, left to right. */
  bottoms: string[];
  endLeft: string;
}

/** Measurements for addSplitBand, in centimeters. */
export interface SplitBandOptions {
  name: string;
  /** Total length of the band, split evenly across the segments. */
  lengthCm: number;
  heightCm: number;
  /** Pieces the bottom edge is sewn to. */
  segments: number;
  drape: PanelDrape;
  seamAllowanceCm?: number;
}

/** Adds a rectangular band whose bottom edge is split, so several pieces can be sewn to it. */
export function addSplitBand(builder: PatternBuilder, o: SplitBandOptions): SplitBandEdges {
  const half = o.lengthCm / 2;
  const segments = Math.max(1, Math.round(o.segments));
  const bottom = Array.from({ length: segments + 1 }, (_, i) =>
    builder.point(-half + (o.lengthCm * i) / segments, 0));
  const tr = builder.point(half, o.heightCm);
  const tl = builder.point(-half, o.heightCm);

  const bottoms = bottom.slice(0, -1).map((point, i) => builder.line(point, bottom[i + 1]!, 'waist'));
  const endRight = builder.line(bottom[segments]!, tr, 'free');
  const top = builder.line(tr, tl, 'hem');
  const endLeft = builder.line(tl, bottom[0]!, 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [...bottoms, endRight, top, endLeft],
    drape: o.drape,
    seamAllowanceCm: o.seamAllowanceCm ?? 0.7,
  });

  return { panel, top, endRight, bottoms, endLeft };
}
