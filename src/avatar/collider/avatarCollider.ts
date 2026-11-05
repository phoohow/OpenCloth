import type { AvatarParams } from '../../core/model/types';
import { bodyLandmarks, type BodyEllipse, type BodyLandmarks } from '../landmarks';
import { appliedLimbPose, armChain, legChain } from '../pose';
import type { MeshCollider } from './meshCollider';

export { fitCapsulesFromGroup } from './meshCapsuleFitter';
export type { MeshCollider } from './meshCollider';
export { evalBodyDistance } from './bodyDistance';

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
 * Body collision proxy: the capsule approximation plus, when the body mesh is available,
 * the exact triangle grid that takes precedence over it.
 */
export interface AvatarCollider {
  capsules: Capsule[];
  /** Bounding box for fast rejection */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Exact collider built from the body mesh; the capsules are not used when it is present. */
  mesh?: MeshCollider | null;
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

/** Bounding box covering every capsule plus a margin, and the full body height. */
function capsuleBounds(capsules: Capsule[], body: BodyLandmarks): AvatarCollider['bounds'] {
  let reachX = 0;
  let reachZ = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of capsules) {
    const rx = c.radius;
    const rz = c.radiusZ ?? c.radius;
    reachX = Math.max(reachX, Math.abs(c.ax) + rx, Math.abs(c.bx) + rx);
    reachZ = Math.max(reachZ, rz);
    minY = Math.min(minY, c.ay - rx, c.by - rx);
    maxY = Math.max(maxY, c.ay + rx, c.by + rx);
  }
  const pad = 0.1;
  return {
    min: [-reachX - pad, minY - pad, -reachZ - pad],
    max: [reachX + pad, Math.max(maxY, body.height) + pad, reachZ + pad],
  };
}

/** Builds the capsule set from body measurement parameters. */
export function generateAvatarCollider(params: AvatarParams): AvatarCollider {
  const body = bodyLandmarks(params);
  const capsules: Capsule[] = [];
  const cap = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    radius: number, radiusZ = radius,
  ) => capsules.push({ ax, ay, az, bx, by, bz, radius, radiusZ });

  // Torso: hip, waist and chest segments, elliptical and shifted by the lateral lean.
  const torsoSpans: [number, number][] = [
    [body.crotchY, body.hipY],
    [body.hipY, body.waistY],
    [body.waistY, body.bustY],
    [body.bustY, body.torsoTop],
  ];
  for (const [y0, y1] of torsoSpans) {
    const e = widestEllipse(body, y0, y1);
    cap(body.torsoCenterXAt(y0), y0, 0, body.torsoCenterXAt(y1), y1, 0, e.rx * 0.98, e.rz * 0.98);
  }

  // Neck
  cap(body.torsoCenterXAt(body.torsoTop), body.torsoTop, 0,
    body.torsoCenterXAt(body.neckTopY), body.neckTopY, 0, body.neckR);
  // Head
  const headC = body.headCenterY;
  const headX = body.torsoCenterXAt(headC);
  cap(headX, headC - body.headH * 0.3, 0, headX, headC + body.headH * 0.3, 0, body.headH * 0.42);

  // Legs: thigh and calf follow the hip and knee joints.
  for (const side of [-1, 1] as const) {
    const chain = legChain(body, side, appliedLimbPose(params.joints, side));
    cap(
      chain.root[0], chain.root[1], chain.root[2],
      chain.mid[0], chain.mid[1], chain.mid[2],
      body.legR, body.legR * 0.85,
    );
    cap(
      chain.mid[0], chain.mid[1], chain.mid[2],
      chain.end[0], chain.end[1], chain.end[2],
      body.legR * 0.7, body.legR * 0.6,
    );
  }

  // Arms: shoulder ball plus upper arm and forearm along the joint chain.
  const armR = body.armR;
  for (const side of [-1, 1] as const) {
    const chain = armChain(body, side, appliedLimbPose(params.joints, side));
    cap(chain.root[0], chain.root[1], chain.root[2],
      chain.root[0], chain.root[1], chain.root[2], armR * 1.15, armR * 1.15);
    cap(
      chain.root[0], chain.root[1], chain.root[2],
      chain.mid[0], chain.mid[1], chain.mid[2],
      armR, armR * 0.9,
    );
    cap(
      chain.mid[0], chain.mid[1], chain.mid[2],
      chain.end[0], chain.end[1], chain.end[2],
      armR * 0.7, armR * 0.65,
    );
  }

  return { capsules, bounds: capsuleBounds(capsules, body) };
}

/** Packs capsules to match the WGSL Capsule struct: a = (start.xyz, radiusX), b = (end.xyz, radiusZ). */
export function packCapsules(collider: AvatarCollider): Float32Array {
  const data = new Float32Array(collider.capsules.length * 8);
  collider.capsules.forEach((c, i) => {
    const o = i * 8;
    data[o] = c.ax; data[o + 1] = c.ay; data[o + 2] = c.az; data[o + 3] = c.radius;
    data[o + 4] = c.bx; data[o + 5] = c.by; data[o + 6] = c.bz; data[o + 7] = c.radiusZ ?? 0;
  });
  return data;
}
