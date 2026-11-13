import type { BodyLandmark, Panel, PanelDrape } from '@/model/types';
import { degToRad } from '@/base/math';
import { landmarkY, type BodyLandmarks, type LimbSide, type Point3, type RegionEnvelope } from '@/avatar';
import type { PanelMesh } from '@/pattern/panel/panelBuilder';
import { inferDrape } from '@/pattern/drape/drapeInfer';

/** Landmark each region hangs from unless the panel overrides it. */
const REGION_ANCHOR: Record<PanelDrape['region'], BodyLandmark> = {
  torso: 'shoulderTop',
  arm: 'shoulder',
  leg: 'hip',
  neck: 'neckTop',
};

/** Default angular span: a torso panel covers the front half, a limb panel a full turn. */
const REGION_SWEEP: Record<PanelDrape['region'], number> = {
  torso: 180,
  arm: 360,
  leg: 360,
  neck: 360,
};

/** Designed ease in centimeters; the cut width carries it, the wrap never adds it to the radius. */
const REGION_EASE: Record<PanelDrape['region'], number> = {
  torso: 2,
  arm: 1.2,
  leg: 1.2,
  neck: 0.8,
};

/** Fully specified wrap of one panel, with every default resolved. */
export interface ResolvedDrape {
  region: PanelDrape['region'];
  anchor: BodyLandmark;
  anchorOffsetCm: number;
  startDeg: number;
  sweepDeg: number;
  side: 'left' | 'right';
  easeCm: number;
}

/** Completes a panel's drape, inferring one from the panel name for hand-drawn patterns. */
export function resolveDrape(panel: Panel): ResolvedDrape {
  const drape = panel.drape ?? inferDrape(panel.name);
  const region = drape.region;
  return {
    region,
    anchor: drape.anchor ?? REGION_ANCHOR[region],
    anchorOffsetCm: drape.anchorOffsetCm ?? 0,
    startDeg: drape.startDeg ?? (region === 'torso' ? -90 : 0),
    sweepDeg: drape.sweepDeg ?? REGION_SWEEP[region],
    side: drape.side ?? 'right',
    easeCm: drape.easeCm ?? REGION_EASE[region],
  };
}

/** Flat mesh extent in centimeters; `maxY` is the top edge, `minY` the bottom edge. */
interface PanelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function boundsOf(mesh: PanelMesh): PanelBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2];
    const y = mesh.positions2D[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/** Width of a cut piece in meters. */
function panelWidth(bounds: PanelBounds): number {
  return Math.max((bounds.maxX - bounds.minX) * 0.01, 1e-3);
}

/** Length of a cut piece in meters, measured down from its top edge. */
function panelDepth(bounds: PanelBounds): number {
  return Math.max((bounds.maxY - bounds.minY) * 0.01, 1e-3);
}

/**
 * Wraps a panel's flat mesh around the body and returns initial positions in meters.
 *
 * Every region is one straight axis with one elliptic section, both fitted on the body's own
 * surface. The piece is laid out by arc length along that section, so its flat area is preserved
 * exactly and its curvature comes from the figure, not from a size-dependent constant. A T pose
 * rotates the fitted arm axis; the sleeve is rebuilt on that axis without any special case.
 */
export function drapePositions(mesh: PanelMesh, panel: Panel, body: BodyLandmarks): Float32Array {
  const drape = resolveDrape(panel);
  const bounds = boundsOf(mesh);
  switch (drape.region) {
    case 'torso': return wrapTorso(mesh, drape, body, bounds);
    case 'arm':
    case 'leg': return wrapLimb(drape.region, mesh, drape, body, bounds);
    case 'neck': return wrapNeck(mesh, drape, body, bounds);
  }
}

/**
 * True when the panel's pose turns the pattern sheet over, so its counter-clockwise 2D triangles
 * come out clockwise in 3D. The torso wrap keeps the sheet's facing for a positive sweep; a tube
 * turns it over once per wrap, and a limb tube on the mirrored side turns it back. A negative
 * transform scale mirrors as well.
 */
export function drapeReversesWinding(panel: Panel): boolean {
  const scale = panel.transform?.scale;
  const scaleSign = scale && scale.x * scale.y * scale.z < 0 ? -1 : 1;
  if (panel.placement || !panel.drape) return scaleSign < 0;
  const drape = resolveDrape(panel);
  const sweepSign = drape.sweepDeg < 0 ? -1 : 1;
  const sideSign = drape.side === 'left' ? -1 : 1;
  const wrapSign = drape.region === 'torso'
    ? sweepSign
    : drape.region === 'neck' ? -sweepSign : -sweepSign * sideSign;
  return wrapSign * scaleSign < 0;
}

/** Angle of a vertex, spread symmetrically about the centre of the declared sweep. */
function columnAngle(x: number, bounds: PanelBounds, centerRad: number, sweepRad: number, sign: number): number {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const u = Math.min(Math.max((x - bounds.minX) / width, 0), 1);
  return centerRad + sign * (u - 0.5) * sweepRad;
}

/** Centre angle and direction of a panel's declared sweep. */
function sweepBasis(drape: ResolvedDrape): { centerRad: number; declared: number; sign: number } {
  return {
    centerRad: degToRad(drape.startDeg + drape.sweepDeg / 2),
    declared: degToRad(Math.abs(drape.sweepDeg)),
    sign: Math.sign(drape.sweepDeg) || 1,
  };
}

/** Height of a vertex in meters: the top edge sits at the anchor and fabric depth hangs below. */
function vertexHeight(offsetCm: number, y: number): number {
  return (y + offsetCm) * 0.01;
}

/** Height the panel's top edge sits at. */
function anchorHeight(drape: ResolvedDrape, body: BodyLandmarks): number {
  return landmarkY(body, drape.anchor) + drape.anchorOffsetCm * 0.01;
}

/** Vertical offset in centimeters from a pattern y to the world height of the same point. */
function heightOffsetCm(topY: number, maxYCm: number): number {
  return topY * 100 - maxYCm;
}

/**
 * Vertical offset in centimeters a draped panel adds to its pattern y to reach its world height.
 * The 2D pane reads the same value, so a panel sits at one height on both sides.
 */
export function drapeHeightOffsetCm(panel: Panel, maxYCm: number, body: BodyLandmarks): number {
  return heightOffsetCm(anchorHeight(resolveDrape(panel), body), maxYCm);
}

/** Points of an elliptic section along one sweep, with the arc length walked to reach each. */
interface SectionArc {
  angles: Float32Array;
  arcs: Float32Array;
}

/** One sample per two degrees is fine enough that the chord error stays far under a millimeter. */
const ARC_STEP_DEG = 2;

/** Arc length walked in even angular steps; `rSin` scales sin(theta), `rCos` scales cos(theta). */
function sectionArcs(rSin: number, rCos: number, startRad: number, sweepDeg: number): SectionArc {
  const steps = Math.max(8, Math.ceil(Math.abs(sweepDeg) / ARC_STEP_DEG));
  const stepRad = degToRad(sweepDeg) / steps;
  const angles = new Float32Array(steps + 1);
  const arcs = new Float32Array(steps + 1);
  angles[0] = startRad;
  let lastX = rSin * Math.sin(startRad);
  let lastZ = rCos * Math.cos(startRad);
  for (let i = 1; i <= steps; i++) {
    angles[i] = startRad + stepRad * i;
    const x = rSin * Math.sin(angles[i]!);
    const z = rCos * Math.cos(angles[i]!);
    arcs[i] = arcs[i - 1]! + Math.hypot(x - lastX, z - lastZ);
    lastX = x;
    lastZ = z;
  }
  return { angles, arcs };
}

/** Angle reached after walking `distance` along a sweep. */
function angleAtArc({ angles, arcs }: SectionArc, distance: number): number {
  const last = arcs.length - 1;
  if (distance <= 0) return angles[0]!;
  if (distance >= arcs[last]!) return angles[last]!;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arcs[mid]! < distance) lo = mid; else hi = mid;
  }
  const span = arcs[hi]! - arcs[lo]!;
  const t = span > 1e-9 ? (distance - arcs[lo]!) / span : 0;
  return angles[lo]! + (angles[hi]! - angles[lo]!) * t;
}

/** Arc length reached at an angle on a full turn of the section. */
function arcAtAngle({ angles, arcs }: SectionArc, angle: number): number {
  const last = angles.length - 1;
  const turn = angles[last]! - angles[0]!;
  const step = turn / last || 1e-6;
  const wrapped = ((angle - angles[0]!) % turn + turn) % turn;
  const index = Math.min(last - 1e-6, wrapped / step);
  const lo = Math.floor(index);
  return arcs[lo]! + (arcs[lo + 1]! - arcs[lo]!) * (index - lo);
}

/** An elliptic cylinder measured on the body, ready to carry a piece cut to a given width. */
interface WrapSection {
  /** Unit vector the cosine of the wrap angle runs along. */
  cosDir: Point3;
  /** Unit vector the sine of the wrap angle runs along. */
  sinDir: Point3;
  /** Semi-axis along `cosDir`, in meters. */
  rCos: number;
  /** Semi-axis along `sinDir`, in meters. */
  rSin: number;
}

/**
 * Builds the section from the measured body data. The half axes enclose the body surface, so a
 * piece cut narrower than the body wraps less than a full turn and leaves a seam, instead of being
 * pushed inside the skin.
 */
function sectionFor(env: RegionEnvelope, region: PanelDrape['region']): WrapSection {
  // A torso faces +z at angle zero; a limb's zero angle faces up the fitted axis' first transverse
  // vector, so a sleeve's cap crown rides over the shoulder and its seam falls under the arm.
  return region === 'torso'
    ? { cosDir: env.v, sinDir: env.u, rCos: env.rz, rSin: env.rx }
    : { cosDir: env.u, sinDir: env.v, rCos: env.rx, rSin: env.rz };
}

/** Lays a flat panel out by arc length on a measured elliptic cylinder, preserving its area. */
function wrapRegion(
  mesh: PanelMesh,
  drape: ResolvedDrape,
  bounds: PanelBounds,
  env: RegionEnvelope,
  axisAt: (y: number) => Point3,
  angularSign: number,
): Float32Array {
  const out = new Float32Array(mesh.vertexCount * 3);
  const section = sectionFor(env, drape.region);
  const full = sectionArcs(section.rSin, section.rCos, 0, 360);
  const perimeter = full.arcs[full.arcs.length - 1]!;
  const { centerRad, sign } = sweepBasis(drape);
  const sCenter = arcAtAngle(full, centerRad);
  // Measured from the middle of the piece, so a seam allowance on one cutting edge cannot shift
  // the panel off the body's centreline.
  const midX = (bounds.minX + bounds.maxX) / 2;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const distance = (mesh.positions2D[i * 2]! - midX) * 0.01;
    const arc = ((sCenter + distance * sign * angularSign) % perimeter + perimeter) % perimeter;
    const theta = angleAtArc(full, arc);
    const centre = axisAt(mesh.positions2D[i * 2 + 1]!);
    const across = section.rSin * Math.sin(theta);
    const through = section.rCos * Math.cos(theta);
    out[i * 3] = centre[0] + section.sinDir[0] * across + section.cosDir[0] * through;
    out[i * 3 + 1] = centre[1] + section.sinDir[1] * across + section.cosDir[1] * through;
    out[i * 3 + 2] = centre[2] + section.sinDir[2] * across + section.cosDir[2] * through;
  }
  return out;
}

/** Torso: a vertical cylinder whose centreline and section were fitted on the surface. */
function wrapTorso(mesh: PanelMesh, drape: ResolvedDrape, body: BodyLandmarks, bounds: PanelBounds): Float32Array {
  const topY = anchorHeight(drape, body);
  const offsetCm = heightOffsetCm(topY, bounds.maxY);
  const env = body.torsoEnvelopeAt();
  return wrapRegion(
    mesh, drape, bounds, env,
    (y: number): Point3 => env.centre(vertexHeight(offsetCm, y)),
    1,
  );
}

/**
 * Sleeve or trouser leg: a cylinder on the limb's fitted axis. The axis follows the limb itself, so
 * a relaxed arm hangs the sleeve down and a T pose lays it out sideways. The section encloses every
 * vertex of the span the panel covers, so no skin crosses the fabric.
 */
function wrapLimb(
  region: 'arm' | 'leg',
  mesh: PanelMesh,
  drape: ResolvedDrape,
  body: BodyLandmarks,
  bounds: PanelBounds,
): Float32Array {
  const side: LimbSide = drape.side === 'left' ? -1 : 1;
  const env = body.limbEnvelopeAt(region, side, anchorHeight(drape, body), panelDepth(bounds));
  return wrapRegion(
    mesh, drape, bounds, env,
    (y: number): Point3 => env.at((bounds.maxY - y) * 0.01),
    side,
  );
}

/** Collar: a tube standing on the body centreline, around the neck. */
function wrapNeck(mesh: PanelMesh, drape: ResolvedDrape, body: BodyLandmarks, bounds: PanelBounds): Float32Array {
  const width = panelWidth(bounds);
  return wrapTube(mesh, drape, bounds, {
    topY: anchorHeight(drape, body),
    radius: tubeRadius(drape, width, body.neckR),
    axisX: 0,
    rake: 0,
  });
}

/** Radius of a circular tube: the cut width reaches a full turn, the body is the floor. */
function tubeRadius(drape: ResolvedDrape, width: number, bodyR: number): number {
  const sweepRad = Math.max(degToRad(Math.abs(drape.sweepDeg)), degToRad(1));
  return Math.max(bodyR, width / sweepRad);
}

/** One tube a neck panel wraps on: where its top starts, its radius and how it tilts outward. */
interface LimbTube {
  topY: number;
  radius: number;
  axisX: number;
  rake: number;
}

/** Bends a panel around a vertical tube whose axis shifts outward with depth. */
function wrapTube(mesh: PanelMesh, drape: ResolvedDrape, bounds: PanelBounds, tube: LimbTube): Float32Array {
  const out = new Float32Array(mesh.vertexCount * 3);
  const offsetCm = heightOffsetCm(tube.topY, bounds.maxY);
  const { centerRad, declared, sign } = sweepBasis(drape);
  const sweepRad = Math.min(declared, panelWidth(bounds) / tube.radius);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const wy = vertexHeight(offsetCm, mesh.positions2D[i * 2 + 1]);
    const theta = columnAngle(mesh.positions2D[i * 2], bounds, centerRad, sweepRad, sign);
    const axis = tube.axisX + tube.rake * Math.max(tube.topY - wy, 0);
    out[i * 3] = axis + tube.radius * Math.cos(theta);
    out[i * 3 + 1] = wy;
    out[i * 3 + 2] = tube.radius * Math.sin(theta);
  }
  return out;
}
