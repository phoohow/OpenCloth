import type { Panel, PanelDrape, Vec2 } from '@/model/types';
import { vec2 } from '@/model/types';
import { evalBezier } from '@/base/geom/bezier';
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
  /** Drafts the neckline as two halves meeting at its centre. */
  splitNeckline?: boolean;
  drape: PanelDrape;
  seamAllowanceCm?: number;
}

/** Adds a front or back bodice panel: hem, side seams, curved armholes, shoulders and one neckline edge. */
export function addBodice(builder: PatternBuilder, o: BodiceOptions): BodiceEdges {
  const top = o.lengthCm;
  const shoulderY = top - (o.shoulderSlopeCm ?? 0);
  const underarmY = shoulderY - Math.max(shoulderY - top * (o.underarmAt ?? 0.75), 0.5);
  const armholeH = shoulderY - underarmY;
  const halfNeck = o.neckHalfWidthCm;
  const halfHem = o.hemHalfWidthCm ?? o.halfWidthCm;
  const hemL = builder.point(-halfHem, 0);
  const hemR = builder.point(halfHem, 0);
  const underarmR = builder.point(o.halfWidthCm, underarmY);
  const shoulderR = builder.point(o.halfShoulderCm, shoulderY);
  const neckR = builder.point(halfNeck, top);
  const neckL = builder.point(-halfNeck, top);
  const shoulderL = builder.point(-o.halfShoulderCm, shoulderY);
  const underarmL = builder.point(-o.halfWidthCm, underarmY);
  // The armhole bulges out under the arm, then turns in under the shoulder tip.
  const armholeOut = armholeH * 0.62;
  const armholeIn = armholeH * 0.1;

  const hem = builder.line(hemL, hemR, 'hem');
  const sideRight = builder.line(hemR, underarmR, 'sideSeam');
  const armholeRight = builder.bezier(underarmR, shoulderR,
    vec2(o.halfWidthCm, underarmY + armholeOut),
    vec2(o.halfShoulderCm + 1.5, shoulderY - armholeIn), 'armhole');
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
  const armholeLeft = builder.bezier(shoulderL, underarmL,
    vec2(-o.halfShoulderCm - 1.5, shoulderY - armholeIn),
    vec2(-o.halfWidthCm, underarmY + armholeOut), 'armhole');
  const sideLeft = builder.line(underarmL, hemL, 'sideSeam');

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
 * Wrap of a set-in sleeve: the cap crown rides over the shoulder tip and the underarm seam
 * closes below it, centred on one full turn around the arm.
 */
export function shoulderSleeveDrape(side: 'left' | 'right', shoulderSlopeCm: number): PanelDrape {
  return {
    region: 'arm',
    side,
    anchor: 'shoulderTop',
    anchorOffsetCm: -shoulderSlopeCm,
    startDeg: 180,
    sweepDeg: 360,
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

  const hem = builder.line(hemL, hemR, 'hem');
  const seamRight = builder.line(hemR, baseR, 'sideSeam');
  const capRight = builder.bezier(baseR, crown,
    vec2(o.widthCm / 2, baseY + o.capHeightCm * 0.55), vec2(o.widthCm * 0.12, crownY - o.capHeightCm * 0.05), 'sleeveCap');
  const capLeft = builder.bezier(crown, baseL,
    vec2(-o.widthCm * 0.12, crownY - o.capHeightCm * 0.05), vec2(-o.widthCm / 2, baseY + o.capHeightCm * 0.55), 'sleeveCap');
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
  const half = widthCm / 2;
  const curve: Vec2[] = [
    { x: half, y: 0 },
    { x: half, y: capHeightCm * 0.55 },
    { x: widthCm * 0.12, y: capHeightCm * 0.95 },
    { x: 0, y: capHeightCm },
  ];
  return 2 * cubicLength(curve);
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

/** Waistband or collar band plus its named outline edges. */
export interface BandEdges {
  panel: Panel;
  top: string;
  endRight: string;
  bottom: string;
  endLeft: string;
}

/** Measurements for addBand, in centimeters. */
export interface BandOptions {
  name: string;
  lengthCm: number;
  heightCm: number;
  drape: PanelDrape;
  seamAllowanceCm?: number;
}

/** Adds a rectangular band panel; its bottom edge joins the opening it stands on. */
export function addBand(builder: PatternBuilder, o: BandOptions): BandEdges {
  const half = o.lengthCm / 2;
  const bl = builder.point(-half, 0);
  const br = builder.point(half, 0);
  const tr = builder.point(half, o.heightCm);
  const tl = builder.point(-half, o.heightCm);

  const bottom = builder.line(bl, br, 'waist');
  const endRight = builder.line(br, tr, 'free');
  const top = builder.line(tr, tl, 'hem');
  const endLeft = builder.line(tl, bl, 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [bottom, endRight, top, endLeft],
    drape: o.drape,
    seamAllowanceCm: o.seamAllowanceCm ?? 0.7,
  });

  return { panel, top, endRight, bottom, endLeft };
}
