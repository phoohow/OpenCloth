import type { AvatarParams } from '../../core/model/types';
import { bodyLandmarks, type BodyEllipse, type BodyLandmarks } from '../landmarks';

export { fitCapsulesFromGroup } from './meshCapsuleFitter';
export { evalSDF } from './sdfEval';

/** Body cross-section approximated by a line segment with elliptical half widths. */
export interface Capsule {
  /** Segment start */
  ax: number; ay: number; az: number;
  /** Segment end */
  bx: number; by: number; bz: number;
  /** Cross-section half width (x) */
  radius: number;
  /** Cross-section half depth (z); falls back to `radius` when unset. */
  radiusZ?: number;
}

/**
 * Analytic capsule SDF: the body as a set of capsules whose distance to a point is
 * evaluated directly, on the GPU or on the CPU.
 */
export interface AvatarSDF {
  capsules: Capsule[];
  /** Bounding box for fast rejection */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Largest cross-section a body segment covers, sampled over its height span. */
function widestEllipse(body: BodyLandmarks, y0: number, y1: number): BodyEllipse {
  let rx = 0;
  let rz = 0;
  for (let s = 0; s <= 6; s++) {
    const e = body.torsoEllipseAt(y0 + (y1 - y0) * (s / 6));
    if (e.rx > rx) rx = e.rx;
    if (e.rz > rz) rz = e.rz;
  }
  return { rx, rz };
}

/** Builds the capsule set from body measurement parameters. */
export function generateAvatarSDF(params: AvatarParams): AvatarSDF {
  const body = bodyLandmarks(params);
  const capsules: Capsule[] = [];
  const cap = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    radius: number, radiusZ = radius,
  ) => capsules.push({ ax, ay, az, bx, by, bz, radius, radiusZ });

  // Torso: hip, waist and chest segments, elliptical like the visible body.
  const torsoSpans: [number, number][] = [
    [body.crotchY, body.hipY],
    [body.hipY, body.waistY],
    [body.waistY, body.bustY],
    [body.bustY, body.torsoTop],
  ];
  for (const [y0, y1] of torsoSpans) {
    const e = widestEllipse(body, y0, y1);
    cap(0, y0, 0, 0, y1, 0, e.rx * 0.98, e.rz * 0.98);
  }

  // Neck
  cap(0, body.torsoTop, 0, 0, body.neckTopY, 0, body.neckR);
  // Head
  const headC = body.headCenterY;
  cap(0, headC - body.headH * 0.3, 0, 0, headC + body.headH * 0.3, 0, body.headH * 0.42);

  // Legs
  const legX = body.hipX;
  cap(-legX, body.legH, 0, -legX, body.kneeY, 0, body.legR, body.legR * 0.85);
  cap(-legX, body.kneeY, 0, -legX, 0.04, 0, body.legR * 0.7, body.legR * 0.6);
  cap(legX, body.legH, 0, legX, body.kneeY, 0, body.legR, body.legR * 0.85);
  cap(legX, body.kneeY, 0, legX, 0.04, 0, body.legR * 0.7, body.legR * 0.6);

  // Arms: shoulder ball plus raked upper arm and forearm along the pose angle.
  const armR = body.armR;
  const rake = body.armRakeRad;
  const midX = Math.sin(rake) * body.armH * 0.5;
  const midY = Math.cos(rake) * body.armH * 0.5;
  for (const side of [-1, 1]) {
    const sx = side * body.shoulderX;
    cap(sx, body.shoulderY, 0, sx, body.shoulderY, 0, armR * 1.15, armR * 1.15);
    cap(sx, body.shoulderY, 0, sx + side * midX, body.shoulderY - midY, 0, armR, armR * 0.9);
    cap(sx + side * midX, body.shoulderY - midY, 0, sx + side * midX * 2, body.shoulderY - midY * 2, 0, armR * 0.7, armR * 0.65);
  }

  const pad = 0.1;
  const reach = body.shoulderX + Math.abs(Math.sin(rake)) * body.armH + armR;
  const bounds = {
    min: [-reach - pad, -pad, -body.hipR - pad] as [number, number, number],
    max: [reach + pad, body.height + pad, body.hipR + pad] as [number, number, number],
  };

  return { capsules, bounds };
}

/** Packs capsules to match the WGSL Capsule struct: a = (start.xyz, radiusX), b = (end.xyz, radiusZ). */
export function packCapsules(sdf: AvatarSDF): Float32Array {
  const data = new Float32Array(sdf.capsules.length * 8);
  sdf.capsules.forEach((c, i) => {
    const o = i * 8;
    data[o] = c.ax; data[o + 1] = c.ay; data[o + 2] = c.az; data[o + 3] = c.radius;
    data[o + 4] = c.bx; data[o + 5] = c.by; data[o + 6] = c.bz; data[o + 7] = c.radiusZ ?? 0;
  });
  return data;
}
