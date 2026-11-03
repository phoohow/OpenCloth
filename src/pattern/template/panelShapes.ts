import type { Panel, PanelDrape, Vec2 } from '../../core/model/types';
import { vec2 } from '../../core/model/types';
import type { PatternBuilder } from './templateKit';

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Bodice panel plus its named outline edges, in outline order. */
export interface BodiceEdges {
  panel: Panel;
  hem: string;
  sideRight: string;
  armholeRight: string;
  shoulderRight: string;
  neckline: string;
  shoulderLeft: string;
  armholeLeft: string;
  sideLeft: string;
}

/** Measurements for addBodice, in centimeters. */
export interface BodiceOptions {
  name: string;
  /** Half width of the panel at the side seams and hem. */
  halfWidthCm: number;
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
  const hemL = builder.point(-o.halfWidthCm, 0);
  const hemR = builder.point(o.halfWidthCm, 0);
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
  // One cubic carries the whole neck opening, dropping about neckDepthCm at the center.
  const neckline = builder.bezier(neckR, neckL,
    vec2(halfNeck * 0.55, top - o.neckDepthCm * (4 / 3)),
    vec2(-halfNeck * 0.55, top - o.neckDepthCm * (4 / 3)), 'neckline');
  const shoulderLeft = builder.line(neckL, shoulderL, 'shoulder');
  const armholeLeft = builder.bezier(shoulderL, underarmL,
    vec2(-o.halfShoulderCm - 1.5, shoulderY - armholeIn),
    vec2(-o.halfWidthCm, underarmY + armholeOut), 'armhole');
  const sideLeft = builder.line(underarmL, hemL, 'sideSeam');

  const panel = builder.panel({
    name: o.name,
    edges: [hem, sideRight, armholeRight, shoulderRight, neckline, shoulderLeft, armholeLeft, sideLeft],
    drape: o.drape,
    seamAllowanceCm: o.seamAllowanceCm ?? 1,
  });

  return { panel, hem, sideRight, armholeRight, shoulderRight, neckline, shoulderLeft, armholeLeft, sideLeft };
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
function cubicLength([p0, c0, c1, p3]: Vec2[], steps = 24): number {
  let sum = 0;
  let px = p0.x;
  let py = p0.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * c0.x + 3 * mt * t * t * c1.x + t * t * t * p3.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * c0.y + 3 * mt * t * t * c1.y + t * t * t * p3.y;
    sum += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return sum;
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
  /** Bow of the side seams outward at the hip line. */
  sideBowCm?: number;
  drape: PanelDrape;
  seamAllowanceCm?: number;
  meshResolutionCm?: number;
}

/** Adds a skirt or dress-body panel that widens from the waist edge to the hem. */
export function addFlaredPanel(builder: PatternBuilder, o: FlaredOptions): FlaredEdges {
  const halfWaist = o.waistWidthCm / 2;
  const halfHem = o.hemWidthCm / 2;
  const bow = o.sideBowCm ?? 0;

  const hemL = builder.point(-halfHem, 0);
  const hemR = builder.point(halfHem, 0);
  const waistR = builder.point(halfWaist, o.lengthCm);
  const waistL = builder.point(-halfWaist, o.lengthCm);

  const hem = builder.line(hemL, hemR, 'hem');
  const sideRight = builder.bezier(hemR, waistR,
    vec2(mix(halfHem, halfWaist, 0.35) + bow, o.lengthCm * 0.35),
    vec2(mix(halfHem, halfWaist, 0.7) + bow, o.lengthCm * 0.7), 'sideSeam');
  const waist = builder.line(waistR, waistL, 'waist');
  const sideLeft = builder.bezier(waistL, hemL,
    vec2(-mix(halfHem, halfWaist, 0.7) - bow, o.lengthCm * 0.7),
    vec2(-mix(halfHem, halfWaist, 0.35) - bow, o.lengthCm * 0.35), 'sideSeam');

  const panel = builder.panel({
    name: o.name,
    edges: [hem, sideRight, waist, sideLeft],
    drape: o.drape,
    seamAllowanceCm: o.seamAllowanceCm ?? 1,
    meshResolutionCm: o.meshResolutionCm,
  });

  return { panel, hem, sideRight, waist, sideLeft };
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
