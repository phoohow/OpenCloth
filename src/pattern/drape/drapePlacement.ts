import type { Panel, PanelDrape, BodyLandmark } from '../../core/model/types';
import { landmarkY, type BodyEllipse, type BodyLandmarks } from '../../avatar/landmarks';
import type { PanelMesh } from '../panel/panelBuilder';
import { inferDrape } from './drapeInfer';

const DEG = Math.PI / 180;

/** Depth over which the shoulder slope of a bodice fades out below its top edge. */
const SHOULDER_BAND_M = 0.12;

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

/** Wraps a panel's flat mesh around the body and returns initial positions in meters. */
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
  const ease = drape.easeCm * 0.01;
  const spanRad = Math.abs(drape.sweepDeg) * DEG || 1;
  const limbR = limbRadius(drape, widthCm, body);
  const limbX = limbAxisX(drape, body);
  // Rows near a shoulder-anchored top edge slide down the shoulder slope toward the armhole.
  const slope = drape.region === 'torso' && drape.anchor === 'shoulderTop'
    ? body.shoulderTopY - body.shoulderY : 0;
  const centerRad = (drape.startDeg + drape.sweepDeg / 2) * DEG;
  const halfSpan = spanRad / 2;
  // Row wrapping maps and sizes every height row on its own width.
  const rows = drape.rowWrap ? rowExtents(mesh) : null;

  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2];
    const y = mesh.positions2D[i * 2 + 1];
    const lo = rows ? rows.lo(y) : minx;
    const hi = rows ? rows.hi(y) : maxx;
    const rowWidth = Math.max(hi - lo, 1e-3);
    const u = rows ? (x - lo) / rowWidth : (x - minx) / widthCm;
    const fromTop = (maxy - y) * 0.01;
    const theta = (drape.startDeg + u * drape.sweepDeg) * DEG;
    let wy = topY - fromTop;
    if (slope > 0) {
      const around = Math.abs(Math.atan2(Math.sin(theta - centerRad), Math.cos(theta - centerRad)));
      const lateral = Math.min(around / halfSpan, 1);
      wy -= slope * Math.max(0, 1 - fromTop / SHOULDER_BAND_M) * lateral * lateral;
    }
    if (drape.region === 'torso') {
      const ring = drape.plumb ? plumbRing(body, wy, topY) : body.torsoEllipseAt(wy);
      // Fabric longer than the body arc at this height stays loose; shorter fabric is let out.
      const k = Math.max(1, rowWidth * 0.01 / ellipseArc(ring, spanRad));
      out[i * 3] = body.torsoCenterXAt(wy) + (ring.rx * k + ease) * Math.sin(theta);
      out[i * 3 + 1] = wy;
      out[i * 3 + 2] = (ring.rz * k + ease) * Math.cos(theta);
    } else {
      const r = rows ? Math.max(limbR, rowWidth * 0.01 / spanRad) : limbR;
      // A relaxed arm or splayed leg hangs outward, so the limb axis shifts with height.
      const rakeAngle = drape.region === 'arm' ? body.armRakeRad : drape.region === 'leg' ? body.legRakeRad : 0;
      const rake = Math.tan(rakeAngle) * (limbX >= 0 ? 1 : -1);
      const axis = limbX + rake * Math.max(topY - wy, 0);
      out[i * 3] = axis + r * Math.cos(theta);
      out[i * 3 + 1] = wy;
      out[i * 3 + 2] = r * Math.sin(theta);
    }
  }
  return out;
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

const ROW_BINS = 48;

/** Horizontal extent of the flat mesh at each local height, sampled into interpolation bins. */
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
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2];
    const bin = Math.min(Math.floor((mesh.positions2D[i * 2 + 1] - miny) / step), ROW_BINS - 1);
    if (x < lo[bin]) lo[bin] = x;
    if (x > hi[bin]) hi[bin] = x;
  }
  // Bins without vertices take the nearest filled row, then the edges fall back to the hem.
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

/** Cylinder radius fitting the panel width into its span, never collapsing onto the limb. */
function limbRadius(drape: ResolvedDrape, widthCm: number, body: BodyLandmarks): number {
  const spanRad = Math.abs(drape.sweepDeg) * DEG || 1;
  const fromWidth = widthCm * 0.01 / spanRad;
  const baseR = drape.region === 'arm' ? body.armR : drape.region === 'leg' ? body.legR : body.neckR;
  return Math.max(fromWidth, baseR + drape.easeCm * 0.01);
}

/** Offset of a limb's wrap axis from the body centerline. */
function limbAxisX(drape: ResolvedDrape, body: BodyLandmarks): number {
  if (drape.region === 'neck') return 0;
  const sign = drape.side === 'left' ? -1 : 1;
  return sign * (drape.region === 'arm' ? body.shoulderX : body.hipX);
}
