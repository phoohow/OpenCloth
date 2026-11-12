import type { AvatarParams, BodyLandmark } from '@/model/types';
import { clamp, lerp, monotoneInterp } from '@/base/math';
import { cmToM } from '@/base/units';

/** Half width and half depth of an elliptical body cross-section, in meters. */
export interface BodyEllipse {
  rx: number;
  rz: number;
}

/** Horizontal slice of the torso: half width plus the half depth toward the front and the back. */
export interface TorsoSection {
  rx: number;
  /** Half depth toward +z, the chest and belly side. */
  front: number;
  /** Half depth toward -z, the back side. */
  back: number;
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
  /** Top of the torso, at the acromion where a bodice hangs from. */
  torsoTop: number;
  /** Top of the neck, under the jaw. */
  neckTopY: number;
  /** Shoulder line where a bodice hangs from. */
  shoulderTopY: number;
  /** Shoulder joint, where the arm hinges. */
  shoulderY: number;
  /** Armpit, the lower edge of the shoulder socket. */
  armpitY: number;
  bustY: number;
  waistY: number;
  hipY: number;
  crotchY: number;
  kneeY: number;
  ankleY: number;
  headCenterY: number;
  /** Upper arm from the shoulder joint to the elbow. */
  upperArmLen: number;
  /** Forearm from the elbow to the wrist. */
  forearmLen: number;
  /** Hand from the wrist to the fingertips. */
  handLen: number;
  /** Thigh from the hip joint to the knee. */
  thighLen: number;
  /** Calf from the knee to the ankle. */
  shinLen: number;
  /** Foot from the heel to the toes. */
  footLen: number;
  /** Girth/(2 pi) reference radii. */
  chestR: number;
  waistR: number;
  hipR: number;
  /** Upper arm radius at the biceps. */
  armR: number;
  /** Thigh radius at mid thigh. */
  legR: number;
  /** Neck stump radius. */
  neckR: number;
  /** Half width of the torso at the bust, waist and hip. */
  chestHalfW: number;
  /** Half width of the shoulder girdle, at the acromion. */
  shoulderHalfW: number;
  waistHalfW: number;
  hipHalfW: number;
  /** Half depth of the torso at the bust, waist and hip. */
  chestHalfD: number;
  waistHalfD: number;
  hipHalfD: number;
  /** Deltoid cap radius at the shoulder. */
  deltoidR: number;
  elbowR: number;
  forearmR: number;
  wristR: number;
  thighTopR: number;
  kneeR: number;
  calfR: number;
  ankleR: number;
  /** Half width and half depth of the head. */
  headHalfW: number;
  headHalfD: number;
  /** Half width of one foot. */
  footHalfW: number;
  /** Half width and half thickness of a hand. */
  handHalfW: number;
  handHalfT: number;
  /** Half distance between the arm axes. */
  shoulderX: number;
  /** Half distance between the leg axes. */
  hipX: number;
  /** Outward tilt of a relaxed arm from vertical. */
  armRakeRad: number;
  /** Outward splay of a leg from vertical. */
  legRakeRad: number;
  /** Lateral lean of the torso from vertical. */
  torsoLeanRad: number;
}

/** Largest lean the shared body geometry accepts, keeping the shear finite. */
const LEAN_LIMIT_RAD = 0.78;
/** Largest leg splay the shared body geometry accepts. */
const LEG_SPREAD_LIMIT_RAD = 1.2;

/**
 * Landmark heights as a fraction of stature. Values follow the ANSUR II medians for adults:
 * acromion 0.82, elbow 0.617, wrist 0.484, crotch 0.434, knee 0.29, ankle 0.048.
 */
const LANDMARK = {
  ankle: 0.048,
  knee: 0.285,
  crotch: 0.455,
  /** Widest hip, level with the greater trochanter. */
  hip: 0.512,
  /** Hip joint, where the thigh hinges. */
  hipJoint: 0.520,
  waist: 0.620,
  bust: 0.720,
  armpit: 0.748,
  /** Shoulder joint, where the arm hinges. */
  shoulder: 0.798,
  /** Acromion, the bony point the shoulder line is measured at. */
  acromion: 0.820,
  neckBase: 0.843,
  chin: 0.870,
  headCenter: 0.935,
} as const;

/** Half depth of the head, nose to occiput, as a fraction of head height. */
const HEAD_DEPTH_RATIO = 0.86;

/** Builds the landmarks from body girths using the procedural mannequin's proportions. */
export function bodyProportions(params: AvatarParams): BodyProportions {
  const height = cmToM(params.heightCm);
  const chestR = cmToM(params.chestCm) / (2 * Math.PI);
  const waistR = cmToM(params.waistCm) / (2 * Math.PI);
  const hipR = cmToM(params.hipCm) / (2 * Math.PI);

  // Depth-to-width ratios: a standing body is markedly wider than it is deep.
  const hipE = girthEllipse(hipR, 0.64);
  const waistE = girthEllipse(waistR, 0.68);
  const chestE = girthEllipse(chestR, 0.70);

  const headH = height * (1 - LANDMARK.chin);
  const torsoTop = height * LANDMARK.acromion;
  const crotchY = height * LANDMARK.crotch;
  const legH = height * LANDMARK.hipJoint;

  return {
    height,
    headH,
    neckH: height * (LANDMARK.chin - LANDMARK.neckBase),
    torsoH: torsoTop - crotchY,
    legH,
    armH: height * (LANDMARK.shoulder - 0.484),
    torsoTop,
    neckTopY: height * LANDMARK.chin,
    shoulderTopY: torsoTop,
    shoulderY: height * LANDMARK.shoulder,
    armpitY: height * LANDMARK.armpit,
    bustY: height * LANDMARK.bust,
    waistY: height * LANDMARK.waist,
    hipY: height * LANDMARK.hip,
    crotchY,
    kneeY: height * LANDMARK.knee,
    ankleY: height * LANDMARK.ankle,
    headCenterY: height * LANDMARK.headCenter,
    upperArmLen: height * (LANDMARK.shoulder - 0.617),
    forearmLen: height * (0.617 - 0.484),
    handLen: height * 0.108,
    thighLen: legH - height * LANDMARK.knee,
    shinLen: height * (LANDMARK.knee - LANDMARK.ankle),
    footLen: height * 0.15,
    chestR,
    waistR,
    hipR,
    armR: chestR * 0.32,
    legR: hipR * 0.5,
    neckR: chestR * 0.36,
    chestHalfW: chestE.rx,
    shoulderHalfW: clamp(chestE.rx * 1.45, height * 0.13, height * 0.152),
    waistHalfW: waistE.rx,
    hipHalfW: hipE.rx,
    chestHalfD: chestE.rz,
    waistHalfD: waistE.rz,
    hipHalfD: hipE.rz,
    deltoidR: chestR * 0.4,
    elbowR: chestR * 0.26,
    forearmR: chestR * 0.295,
    wristR: chestR * 0.19,
    thighTopR: hipR * 0.5,
    kneeR: hipR * 0.26,
    calfR: hipR * 0.3,
    ankleR: hipR * 0.15,
    headHalfW: headH * 0.34,
    headHalfD: headH * HEAD_DEPTH_RATIO * 0.5,
    footHalfW: height * 0.028,
    handHalfW: height * 0.024,
    handHalfT: height * 0.011,
    shoulderX: clamp(chestE.rx * 1.45, height * 0.13, height * 0.152) - chestR * 0.4,
    hipX: clamp(height * 0.047, height * 0.042, height * 0.052),
    armRakeRad: params.poseArmAngleRad ?? 0.12,
    legRakeRad: Math.min(Math.max(params.poseLegSpreadRad ?? 0, 0), LEG_SPREAD_LIMIT_RAD),
    torsoLeanRad: clamp(params.poseTorsoLeanRad ?? 0, -LEAN_LIMIT_RAD, LEAN_LIMIT_RAD),
  };
}

/** Vertical torso outline anchors, from the groin up to the base of the neck. */
function torsoAnchors(p: BodyProportions): Array<{ y: number } & TorsoSection> {
  const bustOut = clamp((p.chestR - p.waistR) * 0.35, 0, 0.022);
  const seatOut = clamp((p.hipR - p.waistR) * 0.3, 0, 0.018);
  const band = (y: number, rx: number, front: number, back: number) => ({ y, rx, front, back });

  return [
    band(p.crotchY, p.hipHalfW * 0.80, p.hipHalfD * 0.70, p.hipHalfD * 0.78),
    band(p.hipY - p.torsoH * 0.09, p.hipHalfW * 0.96, p.hipHalfD * 0.9, p.hipHalfD * 0.9 + seatOut * 0.6),
    band(p.hipY, p.hipHalfW, p.hipHalfD * 0.9, p.hipHalfD * 0.88 + seatOut),
    // Lumbar hollow: the small of the back is the most forward point of the back line.
    band(p.hipY + (p.waistY - p.hipY) * 0.55, lerp(p.hipHalfW, p.waistHalfW, 0.6),
      lerp(p.hipHalfD, p.waistHalfD, 0.7), lerp(p.hipHalfD * 0.97, p.waistHalfD, 0.62)),
    band(p.waistY, p.waistHalfW, p.waistHalfD * 0.97, p.waistHalfD * 0.94),
    band(lerp(p.waistY, p.bustY, 0.55), lerp(p.waistHalfW, p.chestHalfW, 0.72),
      p.chestHalfD * 0.93 + bustOut * 0.4, p.chestHalfD * 0.98),
    // Bust: the section keeps the ribcage depth; the breast mounds are added as ring bulges.
    band(p.bustY, p.chestHalfW * 1.02, p.chestHalfD * 0.98 + bustOut * 0.3, p.chestHalfD * 0.96),
    band(p.armpitY, p.chestHalfW * 1.04, p.chestHalfD * 0.92, p.chestHalfD * 0.99),
    band(p.shoulderY, p.shoulderHalfW * 0.92, p.chestHalfD * 0.84, p.chestHalfD * 0.9),
    band(p.torsoTop, p.shoulderHalfW * 0.87, p.chestHalfD * 0.62, p.chestHalfD * 0.76),
    // Trapezius fillet: the shoulder shelf rolls over into the neck instead of meeting it square.
    band(p.torsoTop + p.neckH * 0.16, p.shoulderHalfW * 0.75, p.chestHalfD * 0.66, p.chestHalfD * 0.74),
    band(p.torsoTop + p.neckH * 0.34, p.shoulderHalfW * 0.52, p.neckR * 1.5, p.neckR * 1.45),
    band(p.torsoTop + p.neckH * 0.56, p.neckR * 1.24, p.neckR * 1.26, p.neckR * 1.22),
    band(p.neckTopY, p.neckR * 0.92, p.neckR * 1.05, p.neckR * 1.22),
  ];
}

/**
 * Standing spine curve: the front/back offset of the torso centre as a fraction of stature at each
 * landmark height. The lumbar region sits forward, the upper back a little behind it, and the head
 * is carried forward over the shoulders, so the side profile is an S instead of a straight column.
 */
const SPINE_CURVE: Array<{ t: number; z: number }> = [
  { t: 0.455, z: 0.000 },
  { t: 0.512, z: -0.004 },
  { t: 0.620, z: 0.008 },
  { t: 0.720, z: 0.008 },
  { t: 0.780, z: -0.006 },
  { t: 0.820, z: -0.010 },
  { t: 0.870, z: 0.004 },
  { t: 0.960, z: 0.010 },
];

/** Forward/back offset of the spine at a fraction of stature. */
export function spineOffsetAt(height: number, y: number): number {
  const ts = SPINE_CURVE.map(a => a.t * height);
  const zs = SPINE_CURVE.map(a => a.z * height);
  return monotoneInterp(ts, zs, y);
}

/** Vertical landmarks and silhouette radii in meters, derived from body girths. */
export interface BodyLandmarks extends BodyProportions {
  /** Torso cross-section at a world height. */
  torsoSectionAt(y: number): TorsoSection;
  /** Torso half width and half depth at a world height. */
  torsoEllipseAt(y: number): BodyEllipse;
  /** Lateral offset of the torso cross-section at a world height. */
  torsoCenterXAt(y: number): number;
  /** Front/back offset of the torso cross-section at a world height, following the spine curve. */
  torsoCenterZAt(y: number): number;
}

/** Builds the landmark set used by the drape placement, collision and the procedural mannequin. */
export function bodyLandmarks(params: AvatarParams): BodyLandmarks {
  const p = bodyProportions(params);
  const anchors = torsoAnchors(p);
  const ys = anchors.map(a => a.y);
  const rxs = anchors.map(a => a.rx);
  const fronts = anchors.map(a => a.front);
  const backs = anchors.map(a => a.back);

  const torsoSectionAt = (y: number): TorsoSection => {
    const last = ys.length - 1;
    if (y <= ys[0]) return { rx: rxs[0], front: fronts[0], back: backs[0] };
    if (y >= ys[last]) return { rx: rxs[last], front: fronts[last], back: backs[last] };
    return {
      rx: monotoneInterp(ys, rxs, y),
      front: monotoneInterp(ys, fronts, y),
      back: monotoneInterp(ys, backs, y),
    };
  };

  return {
    ...p,
    torsoSectionAt,
    torsoEllipseAt: (y: number): BodyEllipse => {
      const s = torsoSectionAt(y);
      return { rx: s.rx, rz: Math.max(s.front, s.back) };
    },
    torsoCenterXAt: (y: number): number =>
      Math.tan(p.torsoLeanRad) * Math.max(y - p.hipY, 0),
    torsoCenterZAt: (y: number): number => spineOffsetAt(p.height, y),
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
