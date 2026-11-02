import type { Panel, PanelDrape, BodyLandmark } from '../../core/model/types';
import { landmarkY, type BodyEllipse, type BodyLandmarks } from '../../avatar/landmarks';
import type { PanelMesh } from '../panel/panelBuilder';
import { inferDrape } from './drapeInfer';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Landmark each region hangs from unless the panel overrides it. */
const REGION_ANCHOR: Record<PanelDrape['region'], BodyLandmark> = {
  torso: 'shoulderTop',
  arm: 'shoulder',
  leg: 'hip',
  neck: 'neckTop',
};

/** Default angular span per region: a torso panel covers half the body, a limb panel a full turn. */
const REGION_SWEEP: Record<PanelDrape['region'], number> = {
  torso: 180,
  arm: 360,
  leg: 360,
  neck: 360,
};

/** Default radial gap in centimeters between the panel and the body surface. */
const REGION_EASE: Record<PanelDrape['region'], number> = {
  torso: 1.4,
  arm: 1.2,
  leg: 1.2,
  neck: 0.8,
};

/** Smallest clearance between a wrapped limb row and the limb surface, in meters. */
const MIN_LIMB_GAP_M = 0.005;

/** Bounds on how far a row's ring is scaled, so a narrow row never collapses onto the axis. */
const MIN_ROW_SCALE = 0.7;
const MAX_ROW_SCALE = 1.6;

/** Fully specified wrap of one panel, with every default resolved. */
export interface ResolvedDrape {
  region: PanelDrape['region'];
  anchor: BodyLandmark;
  anchorOffsetCm: number;
  startDeg: number;
  sweepDeg: number;
  side: 'left' | 'right';
  easeCm: number;
  rowWrap: boolean;
  plumb: boolean;
  pinTop: boolean;
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
    rowWrap: drape.rowWrap ?? false,
    plumb: drape.plumb ?? false,
    pinTop: drape.pinTop ?? region !== 'arm',
  };
}

/**
 * Wraps a panel's flat mesh around the body and returns initial positions in meters. Every row
 * is laid on a ring whose arc length equals that row's fabric width, so the wrap neither
 * stretches nor compresses the mesh in either direction; the dress stages then only have to
 * close the seams and slide the piece onto the body.
 */
export function drapePositions(mesh: PanelMesh, panel: Panel, body: BodyLandmarks): Float32Array {
  const out = new Float32Array(mesh.vertexCount * 3);
  const drape = resolveDrape(panel);

  let minx = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2];
    const y = mesh.positions2D[i * 2 + 1];
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
  }
  const widthCm = Math.max(maxx - minx, 1e-3);

  const topY = landmarkY(body, drape.anchor) + drape.anchorOffsetCm * 0.01;
  const spanRad = Math.abs(drape.sweepDeg) * DEG || 1;
  const centerRad = (drape.startDeg + drape.sweepDeg / 2) * DEG;
  const sign = Math.sign(drape.sweepDeg) || 1;
  // Row wrapping maps and sizes every height row on its own width.
  const rows = drape.rowWrap ? rowExtents(mesh) : null;
  const limbR = limbWrapRadius(drape, widthCm, body);
  const limbX = limbAxisX(drape, body);

  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2];
    const y = mesh.positions2D[i * 2 + 1];
    const lo = rows ? rows.lo(y) : minx;
    const hi = rows ? rows.hi(y) : maxx;
    const rowWidth = Math.max(hi - lo, 1e-3);
    const u = Math.min(Math.max((x - lo) / rowWidth, 0), 1);
    const wy = topY - (maxy - y) * 0.01;

    if (drape.region === 'torso') {
      const ring = drape.plumb ? plumbRing(body, wy, topY) : body.torsoEllipseAt(wy);
      // The row's own fabric width sets the ring, so its arc length carries the fabric exactly.
      const radii = rowRadii(ring, rowWidth, spanRad);
      const theta = thetaAtFraction(u, radii, centerRad, spanRad, sign);
      const centerX = body.torsoCenterXAt(wy);
      const ringX = centerX + radii.rx * Math.sin(theta);
      const ringZ = radii.rz * Math.cos(theta);
      // Shoulder rows leave the ring for the shoulder cap, where both sides of the seam meet
      // along the ridge. The cap holds over the shoulder seam and fades below it, and it stops
      // at the neckline dip, which has to stay on the body's front surface.
      const flat = shoulderCapFraction(maxy - y, (x - (lo + hi) / 2) / Math.max(rowWidth / 2, 1e-3));
      const flatX = centerX + (x - (lo + hi) / 2) * 0.01;
      const flatZ = (Math.cos(centerRad) >= 0 ? 1 : -1) * drape.easeCm * 0.01;
      out[i * 3] = ringX + (flatX - ringX) * flat;
      out[i * 3 + 1] = wy;
      out[i * 3 + 2] = ringZ + (flatZ - ringZ) * flat;
    } else {
      // A limb row covers only as much of the tube as its own fabric is long; a cap row keeps
      // its length and narrows toward the outer side instead of being stretched around the arm.
      const span = Math.min((rowWidth * 0.01) / limbR, TAU);
      const theta = centerRad + sign * (u - 0.5) * span;
      // A relaxed arm or splayed leg hangs outward, so the limb axis shifts with height.
      const rakeAngle = drape.region === 'arm' ? body.armRakeRad : drape.region === 'leg' ? body.legRakeRad : 0;
      const rake = Math.tan(rakeAngle) * (limbX >= 0 ? 1 : -1);
      const axis = limbX + rake * Math.max(topY - wy, 0);
      out[i * 3] = axis + limbR * Math.cos(theta);
      out[i * 3 + 1] = wy;
      out[i * 3 + 2] = limbR * Math.sin(theta);
    }
  }
  return out;
}

/** Steps the arc-length lookups of a wrapped row are sampled at. */
const ARC_STEPS = 12;

/**
 * Radii of the ring a row is wrapped on: the body ring is scaled until its arc over the row's
 * span equals the row's fabric width. A row wider than the body therefore stands off it instead
 * of being stretched, and a narrower row hugs it instead of being squeezed. The scale is bounded
 * so a short row, like a neckline, keeps a ring and never folds onto the body axis.
 */
function rowRadii(ring: BodyEllipse, rowWidthCm: number, spanRad: number): BodyEllipse {
  const target = rowWidthCm * 0.01;
  const scale = Math.min(Math.max(target / ellipseArc(ring, spanRad), MIN_ROW_SCALE), MAX_ROW_SCALE);
  return {
    rx: Math.max(ring.rx * scale, 1e-3),
    rz: Math.max(ring.rz * scale, 1e-3),
  };
}

/** Fabric depth below the top edge that stays on the shoulder cap, and where the cap has faded out. */
const SHOULDER_CAP_DEPTH_CM = 5;
const SHOULDER_CAP_FADE_CM = 14;

/** Square slope of a smoothstep curve; zero at both ends and one in the middle. */
function smoothStep(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/**
 * How far a torso vertex moves off its ring onto the shoulder cap, from one at the shoulder seam
 * to zero below the armhole and at the neckline dip. Both cap coordinates are taken so the front
 * and back sides meet along the ridge, while the neckline stays wrapped on the chest.
 */
function shoulderCapFraction(depthCm: number, lateral: number): number {
  const band = smoothStep((SHOULDER_CAP_FADE_CM - depthCm) / (SHOULDER_CAP_FADE_CM - SHOULDER_CAP_DEPTH_CM));
  if (band <= 0) return 0;
  return band * smoothStep((Math.abs(lateral) - 0.2) / 0.15);
}

/**
 * Angle of a point a given fraction of the way along a row's swept arc. Spacing rows by arc
 * length instead of by angle keeps every fabric row at its own rest width.
 */
function thetaAtFraction(fraction: number, radii: BodyEllipse, centerRad: number, spanRad: number, sign: number): number {
  const half = spanRad / 2;
  const total = ellipseArc(radii, spanRad);
  const want = Math.min(Math.max(fraction, 0), 1) * total;
  let acc = 0;
  let prevX = radii.rx * Math.sin(-half);
  let prevZ = radii.rz * Math.cos(-half);
  for (let s = 1; s <= ARC_STEPS; s++) {
    const t = -half + spanRad * (s / ARC_STEPS);
    const x = radii.rx * Math.sin(t);
    const z = radii.rz * Math.cos(t);
    const step = Math.hypot(x - prevX, z - prevZ);
    if (acc + step >= want) {
      const local = step > 0 ? (want - acc) / step : 0;
      return centerRad + sign * (-half + spanRad * (s - 1 + local) / ARC_STEPS);
    }
    acc += step;
    prevX = x;
    prevZ = z;
  }
  return centerRad + sign * half;
}

/** Widest torso ring between a height and the anchor, so a loose garment hangs plumb. */
function plumbRing(body: BodyLandmarks, fromY: number, toY: number): BodyEllipse {
  const steps = 8;
  let rx = 0;
  let rz = 0;
  for (let s = 0; s <= steps; s++) {
    const y = fromY + (toY - fromY) * (s / steps);
    const ring = body.torsoEllipseAt(y);
    if (ring.rx > rx) rx = ring.rx;
    if (ring.rz > rz) rz = ring.rz;
  }
  return { rx, rz };
}

/** Arc length of an ellipse cross-section over an angular span. */
function ellipseArc(ring: BodyEllipse, spanRad: number): number {
  const steps = 16;
  let sum = 0;
  let prevX = ring.rx * Math.sin(-spanRad / 2);
  let prevZ = ring.rz * Math.cos(-spanRad / 2);
  for (let s = 1; s <= steps; s++) {
    const t = -spanRad / 2 + spanRad * (s / steps);
    const x = ring.rx * Math.sin(t);
    const z = ring.rz * Math.cos(t);
    sum += Math.hypot(x - prevX, z - prevZ);
    prevX = x;
    prevZ = z;
  }
  return Math.max(sum, 1e-4);
}

interface RowExtents {
  lo(y: number): number;
  hi(y: number): number;
}

/** Number of height rows the panel silhouette is sampled at. */
const ROW_BINS = 160;

/**
 * Horizontal extent of the flat mesh at each height. Rows come from scanline crossings of the
 * mesh boundary rather than from the vertex cloud, so a row keeps the silhouette of the row
 * above it and the wrap has no stair-step jumps.
 */
function rowExtents(mesh: PanelMesh): RowExtents {
  let miny = Infinity;
  let maxy = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const y = mesh.positions2D[i * 2 + 1];
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  const step = Math.max((maxy - miny) / ROW_BINS, 1e-6);
  const lo = new Float64Array(ROW_BINS).fill(Infinity);
  const hi = new Float64Array(ROW_BINS).fill(-Infinity);

  const segments = mesh.boundaryEdges.map(([a, b]) => {
    const ax = mesh.positions2D[a * 2], ay = mesh.positions2D[a * 2 + 1];
    const bx = mesh.positions2D[b * 2], by = mesh.positions2D[b * 2 + 1];
    return { ax, ay, bx, by, low: Math.min(ay, by), high: Math.max(ay, by) };
  });

  for (let b = 0; b < ROW_BINS; b++) {
    const y = miny + (b + 0.5) * step;
    for (const segment of segments) {
      // Half-open range: a scanline through a shared vertex crosses exactly one segment.
      if (y <= segment.low || y > segment.high) continue;
      const t = (y - segment.ay) / (segment.by - segment.ay);
      const x = segment.ax + (segment.bx - segment.ax) * t;
      if (x < lo[b]) lo[b] = x;
      if (x > hi[b]) hi[b] = x;
    }
  }

  // Bins without a crossing take the nearest filled row, then the edges fall back to the hem.
  let lastLo = 0;
  let lastHi = 0;
  for (let b = 0; b < ROW_BINS; b++) {
    if (hi[b] >= lo[b]) { lastLo = lo[b]; lastHi = hi[b]; }
    lo[b] = lastLo;
    hi[b] = lastHi;
  }
  for (let b = ROW_BINS - 1; b >= 0; b--) {
    if (hi[b] > lo[b]) break;
    if (b < ROW_BINS - 1) { lo[b] = lo[b + 1]; hi[b] = hi[b + 1]; }
  }

  const at = (values: Float64Array, y: number): number => {
    const t = (y - miny) / step - 0.5;
    const i = Math.min(Math.max(Math.floor(t), 0), ROW_BINS - 1);
    const j = Math.min(i + 1, ROW_BINS - 1);
    const f = Math.min(Math.max(t - i, 0), 1);
    return values[i] + (values[j] - values[i]) * f;
  };
  return { lo: y => at(lo, y), hi: y => at(hi, y) };
}

/**
 * Radius of the tube a limb panel wraps on. A panel's widest row fits its full girth around
 * the tube without stretch, and the tube stays clear of the limb surface.
 */
function limbWrapRadius(drape: ResolvedDrape, widthCm: number, body: BodyLandmarks): number {
  const spanRad = Math.abs(drape.sweepDeg) * DEG || 1;
  const baseR = drape.region === 'arm' ? body.armR : drape.region === 'leg' ? body.legR : body.neckR;
  const fromWidth = widthCm * 0.01 / spanRad;
  return Math.max(fromWidth, baseR + MIN_LIMB_GAP_M);
}

/** Offset of a limb's wrap axis from the body centerline. */
function limbAxisX(drape: ResolvedDrape, body: BodyLandmarks): number {
  if (drape.region === 'neck') return 0;
  const sign = drape.side === 'left' ? -1 : 1;
  return sign * (drape.region === 'arm' ? body.shoulderX : body.hipX);
}
