import type { AvatarParams, BodyLandmark } from '../core/model/types';

/** Half width and half depth of an elliptical body cross-section, in meters. */
export interface BodyEllipse {
  rx: number;
  rz: number;
}

/**
 * Shared mannequin measurements. The visual body, the collision capsules and the cloth wrap
 * all read these so fabric never sits inside or far off the visible figure.
 */
export interface BodyProportions {
  height: number;
  headH: number;
  neckH: number;
  torsoH: number;
  legH: number;
  armH: number;
  /** Top of the torso, where the neck starts. */
  torsoTop: number;
  /** Top of the neck stump. */
  neckTopY: number;
  /** Shoulder line where a bodice hangs from. */
  shoulderTopY: number;
  /** Arm hinge. */
  shoulderY: number;
  bustY: number;
  waistY: number;
  hipY: number;
  crotchY: number;
  kneeY: number;
  ankleY: number;
  headCenterY: number;
  /** Girth/(2 pi) reference radii. */
  chestR: number;
  waistR: number;
  hipR: number;
  armR: number;
  legR: number;
  /** Neck stump radius. */
  neckR: number;
  /** Half distance between the arm axes. */
  shoulderX: number;
  /** Half distance between the leg axes. */
  hipX: number;
  /** Outward tilt of a relaxed arm from vertical. */
  armRakeRad: number;
}

/** Vertical torso outline anchors: height, girth reference radius and depth-to-width ratio. */
const TORSO_PROFILE: Array<{ at: (p: BodyProportions) => number; r: (p: BodyProportions) => number; depth: number }> = [
  { at: p => p.crotchY, r: p => p.hipR * 0.42, depth: 0.90 },
  { at: p => p.hipY, r: p => p.hipR, depth: 0.85 },
  { at: p => p.hipY + p.torsoH * 0.18, r: p => p.hipR * 0.97, depth: 0.82 },
  { at: p => p.waistY, r: p => p.waistR, depth: 0.78 },
  { at: p => p.hipY + p.torsoH * 0.58, r: p => p.chestR * 0.94, depth: 0.79 },
  { at: p => p.bustY, r: p => p.chestR, depth: 0.82 },
  { at: p => p.torsoTop, r: p => p.chestR * 0.84, depth: 0.74 },
];

/** Builds the landmarks from body girths using the procedural mannequin's proportions. */
export function bodyProportions(params: AvatarParams): BodyProportions {
  const height = params.heightCm / 100;
  const headH = height * 0.13;
  const neckH = height * 0.03;
  const torsoH = height * 0.345;
  const legH = height * 0.47;
  const armH = height * 0.36;
  const torsoTop = legH + torsoH;
  const chestR = params.chestCm / 100 / (2 * Math.PI);
  const waistR = params.waistCm / 100 / (2 * Math.PI);
  const hipR = params.hipCm / 100 / (2 * Math.PI);

  return {
    height,
    headH,
    neckH,
    torsoH,
    legH,
    armH,
    torsoTop,
    neckTopY: torsoTop + neckH,
    shoulderTopY: torsoTop + height * 0.01,
    shoulderY: torsoTop - torsoH * 0.08,
    bustY: legH + torsoH * 0.72,
    waistY: legH + torsoH * 0.35,
    hipY: legH,
    crotchY: legH - hipR * 0.42,
    kneeY: legH * 0.5,
    ankleY: legH * 0.09,
    headCenterY: torsoTop + neckH + headH / 2,
    chestR,
    waistR,
    hipR,
    armR: chestR * 0.3,
    legR: hipR * 0.32,
    neckR: headH * 0.18,
    shoulderX: chestR * 1.3,
    hipX: hipR * 0.45,
    armRakeRad: params.poseArmAngleRad ?? 0.12,
  };
}

/** Vertical landmarks and silhouette radii in meters, derived from body girths. */
export interface BodyLandmarks extends BodyProportions {
  /** Torso half width and half depth at a world height. */
  torsoEllipseAt(y: number): BodyEllipse;
}

/** Builds the landmark set used by draping, collision and the procedural mannequin. */
export function bodyLandmarks(params: AvatarParams): BodyLandmarks {
  const p = bodyProportions(params);
  const anchors = TORSO_PROFILE.map(a => ({ y: a.at(p), ...girthEllipse(a.r(p), a.depth) }));
  // Girth/(2 pi) underestimates an ellipse's width, so each ring is scaled to the stated girth.
  const sized = anchors;

  return {
    ...p,
    torsoEllipseAt: (y: number): BodyEllipse => {
      if (y <= sized[0].y) return { rx: sized[0].rx, rz: sized[0].rz };
      const last = sized[sized.length - 1];
      if (y >= last.y) return { rx: last.rx * 0.9, rz: last.rz * 0.9 };
      for (let i = 1; i < sized.length; i++) {
        if (y > sized[i].y) continue;
        const a = sized[i - 1], b = sized[i];
        const t = (y - a.y) / (b.y - a.y);
        return { rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t };
      }
      return { rx: last.rx, rz: last.rz };
    },
  };
}

/**
 * Ellipse whose perimeter equals the girth of a circle with radius `girthR`, at the requested
 * depth-to-width ratio. Torso rings are wider than they are deep, so the half width grows.
 */
export function girthEllipse(girthR: number, depthRatio: number): BodyEllipse {
  const target = 2 * Math.PI * girthR;
  const ratio = Math.min(Math.max(depthRatio, 0.2), 1);
  let lo = girthR * 0.5;
  let hi = girthR * 1.6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ellipsePerimeter(mid / ratio, mid) < target) lo = mid; else hi = mid;
  }
  const rz = (lo + hi) / 2;
  return { rx: rz / ratio, rz };
}

/** Ramanujan's second approximation for an ellipse perimeter. */
function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 - Math.sqrt(4 - 3 * h)));
}

/** Height of a named landmark. */
export function landmarkY(body: BodyLandmarks, landmark: BodyLandmark): number {
  switch (landmark) {
    case 'neckTop': return body.neckTopY;
    case 'shoulderTop': return body.shoulderTopY;
    case 'shoulder': return body.shoulderY;
    case 'bust': return body.bustY;
    case 'waist': return body.waistY;
    case 'hip': return body.hipY;
    case 'crotch': return body.crotchY;
    case 'knee': return body.kneeY;
    case 'ankle': return body.ankleY;
  }
}
