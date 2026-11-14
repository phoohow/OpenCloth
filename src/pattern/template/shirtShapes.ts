/**
 * Shirt blocks: the placketed front half, the back yoke with the body below it, and the two-piece
 * collar. A shirt reads as a shirt because of these pieces, not because of the bodice outline.
 */

import type { Panel, PanelDrape, Vec2, EdgeSemantic } from '@/model/types';
import { vec2 } from '@/model/types';
import type { CubicBezier2 } from '@/base/geom/bezier';
import { evalBezier, splitBezier } from '@/base/geom/bezier';
import type { PatternBuilder, PtRef } from '@/pattern/template/templateKit';
import {
  armholeCubic, sideSeamCubic, type ArmholeFrame,
} from '@/pattern/template/panelShapes';

/** Front half plus its named outline edges. */
export interface FrontHalfEdges {
  panel: Panel;
  hem: string;
  side: string;
  armhole: string;
  shoulder: string;
  neckline: string;
  /** Button stand edge running down the centre front. */
  frontEdge: string;
}

/** Measurements for addFrontHalf, in centimeters. */
export interface FrontHalfOptions extends ArmholeFrame {
  name: string;
  /** Shoulder line height, which is the panel top at the neck. */
  topY: number;
  /** Half width of the neck opening. */
  halfNeckCm: number;
  /** Front neck drop below the shoulder line. */
  neckDepthCm: number;
  /** Width of the button stand folded back behind the centre front. */
  placketCm: number;
  /** Side seam bow at the waist. */
  waistInsetCm?: number;
  /** Drop of the hem below the side seam at the centre front. */
  hemDropCm?: number;
  drape: PanelDrape;
}

/**
 * Adds one front half of a button-up shirt: the button stand, a shirttail hem, the side seam, the
 * armhole, the shoulder and the front neckline. The centre front sits at x = 0 and the stand
 * extends past it, so two halves overlap by twice the stand width once buttoned.
 *
 * `sign` mirrors the half: -1 drafts the other side, with the outline reversed so the panel keeps
 * the counter-clockwise winding the mesh builder expects.
 */
export function addFrontHalf(builder: PatternBuilder, o: FrontHalfOptions, sign: 1 | -1 = 1): FrontHalfEdges {
  const s = sign;
  const stand = o.placketCm;
  const drop = o.hemDropCm ?? 2;
  const halfW = o.halfWidthCm;
  const side = sideSeamCubic({
    hemHalfWidthCm: halfW, halfWidthCm: halfW, hemY: 0, underarmY: o.underarmY,
    waistInsetCm: o.waistInsetCm,
  });
  const armhole = armholeCubic(o, s);

  const hemCf = builder.point(-s * stand, -drop);
  const hemSide = builder.point(s * halfW, 0);
  const underarm = builder.point(s * halfW, o.underarmY);
  const shoulderTip = builder.point(s * o.halfShoulderCm, o.shoulderY);
  const neckSide = builder.point(s * o.halfNeckCm, o.topY);
  const neckCf = builder.point(-s * stand, o.topY - o.neckDepthCm);

  const specs: EdgeSpec[] = [
    { type: 'bezier', a: hemCf, b: hemSide, semantic: 'hem',
      c0: vec2(-s * stand + s * (halfW + stand) * 0.34, -drop), c1: vec2(s * halfW * 0.72, -drop * 0.16) },
    { type: 'bezier', a: hemSide, b: underarm, semantic: 'sideSeam',
      c0: vec2(s * side.c0.x, side.c0.y), c1: vec2(s * side.c1.x, side.c1.y) },
    { type: 'bezier', a: underarm, b: shoulderTip, semantic: 'armhole', c0: armhole.c0, c1: armhole.c1 },
    { type: 'line', a: shoulderTip, b: neckSide, semantic: 'shoulder' },
    // The neckline carries on past the centre front to the stand's outer edge, so its lowest point
    // sits on the centre front where the two halves meet.
    { type: 'bezier', a: neckSide, b: neckCf, semantic: 'neckline',
      c0: vec2(s * o.halfNeckCm * 0.32, o.topY - o.neckDepthCm * 1.28),
      c1: vec2(s * (1.8 - stand), o.topY - o.neckDepthCm) },
    { type: 'line', a: neckCf, b: hemCf, semantic: 'free' },
  ];

  const panel = builder.panel({
    name: o.name,
    edges: emitEdges(builder, specs, sign < 0),
    drape: o.drape,
    seamAllowanceCm: 1,
  });

  // A mirrored outline is stored back to front, so the roles are read off in draft order.
  const ordered = sign < 0 ? [...panel.outlineEdgeIds].reverse() : panel.outlineEdgeIds;
  const [hem, sideEdge, armholeEdge, shoulder, neckline, frontEdge] = ordered as [
    string, string, string, string, string, string,
  ];
  return { panel, hem, side: sideEdge, armhole: armholeEdge, shoulder, neckline, frontEdge };
}

/** Outline edge in builder terms, emitted forward or reversed so a mirrored panel keeps its winding. */
interface EdgeSpec {
  type: 'line' | 'bezier';
  a: PtRef;
  b: PtRef;
  c0?: Vec2;
  c1?: Vec2;
  semantic: EdgeSemantic;
}

/** Emits an outline, optionally traversed backwards with every edge's endpoints swapped. */
function emitEdges(builder: PatternBuilder, specs: EdgeSpec[], reverse: boolean): string[] {
  const ordered = reverse ? [...specs].reverse() : specs;
  return ordered.map(spec => (reverse
    ? spec.type === 'line'
      ? builder.line(spec.b, spec.a, spec.semantic)
      : builder.bezier(spec.b, spec.a, spec.c1!, spec.c0!, spec.semantic)
    : spec.type === 'line'
      ? builder.line(spec.a, spec.b, spec.semantic)
      : builder.bezier(spec.a, spec.b, spec.c0!, spec.c1!, spec.semantic)));
}

/** Back yoke plus its named outline edges. */
export interface YokeEdges {
  panel: Panel;
  /** Bottom edge sewn to the body below. */
  yokeLine: string;
  armholeRight: string;
  shoulderRight: string;
  neckline: string;
  shoulderLeft: string;
  armholeLeft: string;
}

/** Back body plus its named outline edges. */
export interface BackBodyEdges {
  panel: Panel;
  hem: string;
  sideRight: string;
  armholeRight: string;
  /** Top edge sewn to the yoke. */
  yokeLine: string;
  armholeLeft: string;
  sideLeft: string;
}

/** Armhole cubic of one side together with the two spans a yoke line cuts it into. */
export interface SplitArmhole {
  /** Underarm to yoke line. */
  lower: CubicBezier2;
  /** Yoke line to shoulder tip. */
  upper: CubicBezier2;
  /** Point where the yoke line meets the armhole. */
  point: Vec2;
}

/** Parameter at which a monotonic-in-y cubic reaches `y`. */
function tAtY(curve: CubicBezier2, y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (evalBezier(curve, mid).y < y) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Splits an armhole cubic at the height of the yoke line. */
export function splitArmhole(frame: ArmholeFrame, yokeY: number, sideSign: 1 | -1): SplitArmhole {
  const curve = armholeCubic(frame, sideSign);
  const [lower, upper] = splitBezier(curve, tAtY(curve, yokeY));
  return { lower, upper, point: lower.p1 };
}

/** Measurements shared by the yoke and the body it covers. */
export interface BackOptions extends ArmholeFrame {
  topY: number;
  halfNeckCm: number;
  /** Back neck drop below the shoulder line. */
  neckDepthCm: number;
  /** Height of the yoke line below the shoulder line. */
  yokeDepthCm: number;
  waistInsetCm?: number;
  hemDropCm?: number;
}

/** Height of the yoke line in pattern coordinates. */
export function yokeYOf(o: BackOptions): number {
  return o.topY - o.yokeDepthCm;
}

/**
 * Adds the back yoke: a band across the shoulders whose bottom edge is the yoke line and whose
 * sides are the upper armholes.
 */
export function addBackYoke(builder: PatternBuilder, o: BackOptions & { name: string; drape: PanelDrape }): YokeEdges {
  const yokeY = yokeYOf(o);
  const right = splitArmhole(o, yokeY, 1);
  const left = splitArmhole(o, yokeY, -1);
  const rightX = right.point.x;
  const leftX = left.point.x;

  const bottomLeft = builder.point(leftX, yokeY);
  const bottomRight = builder.point(rightX, yokeY);
  const tipRight = builder.point(o.halfShoulderCm, o.shoulderY);
  const neckRight = builder.point(o.halfNeckCm, o.topY);
  const neckLeft = builder.point(-o.halfNeckCm, o.topY);
  const tipLeft = builder.point(-o.halfShoulderCm, o.shoulderY);

  const yokeLine = builder.bezier(bottomLeft, bottomRight,
    vec2(leftX * 0.45, yokeY - 0.6), vec2(rightX * 0.45, yokeY - 0.6), 'waist');
  const armholeRight = builder.bezier(bottomRight, tipRight, right.upper.c1, right.upper.c0, 'armhole');
  const shoulderRight = builder.line(tipRight, neckRight, 'shoulder');
  const neckline = builder.bezier(neckRight, neckLeft,
    vec2(o.halfNeckCm * 0.55, o.topY - o.neckDepthCm * (4 / 3)),
    vec2(-o.halfNeckCm * 0.55, o.topY - o.neckDepthCm * (4 / 3)), 'neckline');
  const shoulderLeft = builder.line(neckLeft, tipLeft, 'shoulder');
  const armholeLeft = builder.bezier(tipLeft, bottomLeft, left.upper.c0, left.upper.c1, 'armhole');

  const panel = builder.panel({
    name: o.name,
    edges: [yokeLine, armholeRight, shoulderRight, neckline, shoulderLeft, armholeLeft],
    drape: o.drape,
    seamAllowanceCm: 0.8,
  });

  return { panel, yokeLine, armholeRight, shoulderRight, neckline, shoulderLeft, armholeLeft };
}

/** Adds the back below the yoke: the yoke line on top, the lower armholes, the side seams and the hem. */
export function addBackBody(builder: PatternBuilder, o: BackOptions & { name: string; drape: PanelDrape }): BackBodyEdges {
  const yokeY = yokeYOf(o);
  const drop = o.hemDropCm ?? 2;
  const halfW = o.halfWidthCm;
  const right = splitArmhole(o, yokeY, 1);
  const left = splitArmhole(o, yokeY, -1);
  const rightX = right.point.x;
  const leftX = left.point.x;
  const side = sideSeamCubic({
    hemHalfWidthCm: halfW, halfWidthCm: halfW, hemY: 0, underarmY: o.underarmY,
    waistInsetCm: o.waistInsetCm,
  });

  const hemLeft = builder.point(-halfW, 0);
  const hemRight = builder.point(halfW, 0);
  const underarmRight = builder.point(halfW, o.underarmY);
  const underarmLeft = builder.point(-halfW, o.underarmY);
  const topRight = builder.point(rightX, yokeY);
  const topLeft = builder.point(leftX, yokeY);

  const hem = builder.bezier(hemLeft, hemRight,
    vec2(-halfW * 0.72, -drop * 0.16), vec2(halfW * 0.72, -drop * 0.16), 'hem');
  const sideRight = builder.bezier(hemRight, underarmRight, side.c0, side.c1, 'sideSeam');
  const armholeRight = builder.bezier(underarmRight, topRight, right.lower.c1, right.lower.c0, 'armhole');
  const yokeLine = builder.bezier(topRight, topLeft,
    vec2(rightX * 0.45, yokeY - 0.6), vec2(leftX * 0.45, yokeY - 0.6), 'waist');
  const armholeLeft = builder.bezier(topLeft, underarmLeft, left.lower.c0, left.lower.c1, 'armhole');
  const sideLeft = builder.bezier(underarmLeft, hemLeft,
    vec2(-side.c1.x, side.c1.y), vec2(-side.c0.x, side.c0.y), 'sideSeam');

  const panel = builder.panel({
    name: o.name,
    edges: [hem, sideRight, armholeRight, yokeLine, armholeLeft, sideLeft],
    drape: o.drape,
    seamAllowanceCm: 1,
  });

  return { panel, hem, sideRight, armholeRight, yokeLine, armholeLeft, sideLeft };
}

/** Collar band plus its named outline edges. */
export interface BandEdges {
  panel: Panel;
  /** Edge that joins the neckline (stand) or the stand top (fall). */
  bottom: string;
  endRight: string;
  top: string;
  endLeft: string;
}

/** Measurements for addCollarStand, in centimeters. */
export interface StandOptions {
  name: string;
  /** Neckline arc length the stand's bottom edge is sewn to. */
  necklineCm: number;
  /** Finished stand height at the centre back. */
  heightCm: number;
  /** Height at the front ends; a stand tapers toward the button stand. */
  endHeightCm: number;
  drape: PanelDrape;
}

/**
 * Adds the collar stand: a tapered band whose bottom edge matches the neckline. Its top edge is
 * the roll line the collar falls from.
 */
export function addCollarStand(builder: PatternBuilder, o: StandOptions): BandEdges {
  const halfBottom = o.necklineCm / 2;
  const halfTop = halfBottom * 0.9;
  const bottomL = builder.point(-halfBottom, 0);
  const bottomR = builder.point(halfBottom, 0);
  const topR = builder.point(halfTop, o.endHeightCm);
  const topL = builder.point(-halfTop, o.endHeightCm);

  const bottom = builder.line(bottomL, bottomR, 'neckline');
  const endRight = builder.line(bottomR, topR, 'free');
  // The top edge arcs up to the centre back, where the stand is highest; both handles share one
  // height, which puts the apex at a quarter of the taper below it.
  const apexY = (o.heightCm - o.endHeightCm * 0.25) / 0.75;
  const top = builder.bezier(topR, topL, vec2(halfTop * 0.5, apexY), vec2(-halfTop * 0.5, apexY), 'free');
  const endLeft = builder.line(topL, bottomL, 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [bottom, endRight, top, endLeft],
    drape: o.drape,
    seamAllowanceCm: 0.8,
  });

  return { panel, bottom, endRight, top, endLeft };
}

/** Measurements for addCollarFall, in centimeters. */
export interface FallOptions {
  name: string;
  /** Length of the roll line the collar hangs from; equals the stand's top edge. */
  rollLineCm: number;
  /** Finished collar width at the centre back. */
  widthCm: number;
  /** How far the collar point reaches past the roll line, toward the button stand. */
  pointOutCm: number;
  drape: PanelDrape;
  /** Stand height the collar folds over; the point sits at this height above the roll line. */
  pointRiseCm: number;
}

/** Adds the collar: a piece falling from the roll line, widening to two points at the front. */
export function addCollarFall(builder: PatternBuilder, o: FallOptions): BandEdges {
  const half = o.rollLineCm / 2;
  const bottomL = builder.point(-half, 0);
  const bottomR = builder.point(half, 0);
  const tipR = builder.point(half + o.pointOutCm, o.pointRiseCm);
  const apex = builder.point(0, o.widthCm);
  const tipL = builder.point(-half - o.pointOutCm, o.pointRiseCm);

  const bottom = builder.line(bottomL, bottomR, 'neckline');
  const endRight = builder.line(bottomR, tipR, 'free');
  const outerRight = builder.bezier(tipR, apex,
    vec2(half + o.pointOutCm * 0.7, o.widthCm * 0.62), vec2(half * 0.45, o.widthCm), 'hem');
  const outerLeft = builder.bezier(apex, tipL,
    vec2(-half * 0.45, o.widthCm), vec2(-half - o.pointOutCm * 0.7, o.widthCm * 0.62), 'hem');
  const endLeft = builder.line(tipL, bottomL, 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [bottom, endRight, outerRight, outerLeft, endLeft],
    drape: o.drape,
    seamAllowanceCm: 0.8,
  });

  return { panel, bottom, endRight, top: outerRight, endLeft };
}

/** Rectangle of a cuff plus its named outline edges. */
export interface CuffEdges {
  panel: Panel;
  /** Edge sewn to the sleeve opening. */
  top: string;
  bottom: string;
}

/** Adds a cuff band whose top edge matches the sleeve opening it closes. */
export function addCuff(builder: PatternBuilder, o: {
  name: string; lengthCm: number; heightCm: number; drape: PanelDrape;
}): CuffEdges {
  const half = o.lengthCm / 2;
  const bl = builder.point(-half, 0);
  const br = builder.point(half, 0);
  const tr = builder.point(half, o.heightCm);
  const tl = builder.point(-half, o.heightCm);

  const bottom = builder.line(bl, br, 'hem');
  const endRight = builder.line(br, tr, 'free');
  const top = builder.line(tr, tl, 'waist');
  const endLeft = builder.line(tl, bl, 'free');

  const panel = builder.panel({
    name: o.name,
    edges: [bottom, endRight, top, endLeft],
    drape: o.drape,
    seamAllowanceCm: 0.8,
  });

  return { panel, top, bottom };
}
