/**
 * Measurements of the body a garment is designed on.
 *
 * The figure, the surfaces the drape wraps around and the collision proxy all read the same
 * numbers here, and every one of them is measured on the MakeHuman mesh built for the project's
 * measurements and build, so fabric never sits inside or far off the visible body. Joint positions
 * come from the mesh's own skeleton vertices, so they follow the arm pose instead of a table of
 * proportions.
 */

import type { AvatarParams, BodyLandmark } from '@/model/types';
import { cmToM } from '@/base/units';
import { clamp, monotoneInterp } from '@/base/math';
import {
  makehumanBody, STATURE,
  type LimbJoints, type LimbPair, type MakehumanBody, type Point3,
} from '@/avatar/makehuman/body';
import { makehumanBodyData } from '@/avatar/makehuman/data';
import { girthAt } from '@/avatar/makehuman/measure';
import { CLOTH_CLEARANCE, fitTorso, type LimbSide, type RegionEnvelope } from '@/avatar/envelope';
import { limbLoop, SectionIndex, torsoLoop, type SectionLoop } from '@/avatar/makehuman/section';
import { simplifiedBodyShapes, type SimplifiedShape } from '@/avatar/simplifiedBody';

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

/** Joint positions and bone directions of one arm or leg. */
export interface LimbChain {
  root: Point3;
  mid: Point3;
  end: Point3;
  /** Unit direction from root to mid. */
  dir1: Point3;
  /** Unit direction from mid to end. */
  dir2: Point3;
}

/** Body measurements the pattern, the drape and the cloth collision all read. */
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
  /** Girth divided by 2 pi, at the bust, waist and hip. */
  chestR: number;
  waistR: number;
  hipR: number;
  /** Upper arm radius at the biceps. */
  armR: number;
  /** Thigh radius at mid thigh. */
  legR: number;
  /** Neck radius. */
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

/** Measured body: proportions, the torso profile and the limb axes. */
export interface BodyLandmarks extends BodyProportions {
  /** Torso cross-section at a world height. */
  torsoSectionAt(y: number): TorsoSection;
  /** Torso half width and half depth at a world height. */
  torsoEllipseAt(y: number): BodyEllipse;
  /** Lateral offset of the torso cross-section at a world height. */
  torsoCenterXAt(y: number): number;
  /** Front/back offset of the torso cross-section at a world height. */
  torsoCenterZAt(y: number): number;
  /** Measured left and right arm axes. */
  armChain(side: LimbSide): LimbChain;
  /** Measured left and right leg axes. */
  legChain(side: LimbSide): LimbChain;
  /** Axis and measured section of the torso, fitted once on the mesh and shared by every panel. */
  torsoEnvelopeAt(): RegionEnvelope;
  /** Simplified body proxy shapes, shared by the 3D proxy and the drape targets. */
  bodyShapes(): readonly SimplifiedShape[];
}

/** Widest half width of one cross-section loop. */
function loopRadius(loop: SectionLoop | undefined): number {
  if (!loop) return 0;
  return (loop.maxX - loop.minX) / 2;
}

/** Widest half depth of one cross-section loop. */
function loopDepth(loop: SectionLoop | undefined): number {
  if (!loop) return 0;
  return (loop.maxZ - loop.minZ) / 2;
}

/** Highest point of the shoulder ridge, the line a bodice's shoulder seam sits on. */
function shoulderRidge(positions: ArrayLike<number>, halfX: number, ceiling: number): number {
  let top = 0;
  for (let v = 0; v * 3 < positions.length; v++) {
    const x = Math.abs(positions[v * 3]!);
    if (x < halfX * 0.75 || x > halfX * 1.25) continue;
    const y = positions[v * 3 + 1]!;
    if (y > top && y < ceiling) top = y;
  }
  return top || ceiling;
}

/** Unit vector from `from` toward `to`. */
function unit(to: Point3, from: Point3): Point3 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  return [dx / length, dy / length, dz / length];
}

/** Outward rake of a limb direction, in radians. */
function rakeOf(dir: Point3, side: LimbSide): number {
  return Math.atan2(side * dir[0], Math.max(-dir[1], 1e-4));
}

/** One side of a limb pair, picked by the sign of its joints' x axis. */
function limbOf(pair: LimbPair, side: LimbSide): LimbJoints {
  const preferred = side > 0 ? pair.right : pair.left;
  const other = side > 0 ? pair.left : pair.right;
  return Math.sign(preferred.root[0]) === Math.sign(side) || Math.sign(other.root[0]) !== Math.sign(side)
    ? preferred
    : other;
}

/** Builds a limb chain from three joint positions. */
function chainFrom(joints: LimbJoints): LimbChain {
  const { root, mid, end } = joints;
  return { root, mid, end, dir1: unit(mid, root), dir2: unit(end, mid) };
}

/** x of the limb axis at a height, walking the three joints. */
function axisXAt(joints: LimbJoints, y: number): number {
  const points = [joints.root, joints.mid, joints.end];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const low = Math.min(a[1], b[1]);
    const high = Math.max(a[1], b[1]);
    if (y <= high && y >= low && Math.abs(b[1] - a[1]) > 1e-6) {
      const t = (y - a[1]) / (b[1] - a[1]);
      return a[0] + (b[0] - a[0]) * t;
    }
  }
  // Above or below the chain, continue along the nearest segment.
  const [first, second] = y > joints.root[1] ? [points[0]!, points[1]!] : [points[1]!, points[2]!];
  const t = clamp((y - first[1]) / ((second[1] - first[1]) || 1), -2, 2);
  return first[0] + (second[0] - first[0]) * t;
}

/** Interpolated torso profile, keyed by height, over the sections the arms have not merged into. */
function profileIndex(body: MakehumanBody): { ys: number[]; rx: number[]; front: number[]; back: number[]; cx: number[]; cz: number[] } {
  const clean = body.profile.filter(slice => !slice.merged);
  return {
    ys: clean.map(s => s.y),
    rx: clean.map(s => s.halfW),
    front: clean.map(s => s.front),
    back: clean.map(s => s.back),
    cx: clean.map(s => s.centerX),
    cz: clean.map(s => s.centerZ),
  };
}

/** Reads a value of the torso profile at a height, clamped to the scanned range. */
function profileAt(ys: number[], values: number[], y: number): number {
  if (y <= ys[0]!) return values[0]!;
  const last = ys.length - 1;
  if (y >= ys[last]!) return values[last]!;
  return monotoneInterp(ys, values, y);
}

/** Landmarks of the whole body, measured on the MakeHuman mesh built for these measurements. */
export function bodyLandmarks(params: AvatarParams): BodyLandmarks {
  const body = makehumanBody(params);
  const armWeights = makehumanBodyData().armWeights;
  const { profile, landmarks: torso, joints } = body;
  const height = body.height;
  const index = profileIndex(body);

  const index3d = new SectionIndex(body.positions, body.bodyIndices);
  const limbSlice = (y: number, x: number): SectionLoop | undefined =>
    limbLoop(index3d.loops(y), x);

  // Limb heights come off the mesh's own joints, so a child's shorter legs and a man's longer arm
  // read as what they are instead of a share of an adult figure.
  const shoulderY = joints.arms.right.root[1];
  const wristY = joints.arms.right.end[1];
  const hipJointY = joints.legs.right.root[1];
  const kneeY = joints.legs.right.mid[1];
  const ankleY = joints.legs.right.end[1];
  const neckTopY = height * STATURE.chin;
  const headCenterY = height * STATURE.headCenter;

  const sides: LimbSide[] = [-1, 1];

  /** Radius of one limb at a height: the larger half extent of its section. */
  const radiusAt = (limb: LimbJoints, y: number): number => {
    const loop = limbSlice(y, axisXAt(limb, y));
    return Math.max(loopRadius(loop), loopDepth(loop));
  };

  const armData = new Map<LimbSide, { chain: LimbChain; joints: LimbJoints }>();
  const legData = new Map<LimbSide, { chain: LimbChain; joints: LimbJoints }>();
  for (const side of sides) {
    const armJoints = limbOf(joints.arms, side);
    const legJoints = limbOf(joints.legs, side);
    armData.set(side, { chain: chainFrom(armJoints), joints: armJoints });
    legData.set(side, { chain: chainFrom(legJoints), joints: legJoints });
  }

  const leftArm = armData.get(-1)!;
  const rightArm = armData.get(1)!;
  const leftLeg = legData.get(-1)!;
  const rightLeg = legData.get(1)!;

  const midThighY = (hipJointY + kneeY) / 2;
  const midCalfY = (kneeY + ankleY) * 0.62;
  const thighTopY = hipJointY - height * 0.02;

  const chestHalfW = profileAt(index.ys, index.rx, torso.bustY);
  const waistHalfW = profileAt(index.ys, index.rx, torso.waistY);
  const hipHalfW = profileAt(index.ys, index.rx, torso.hipY);
  const chestHalfD = Math.max(
    profileAt(index.ys, index.front, torso.bustY),
    profileAt(index.ys, index.back, torso.bustY),
  );
  const waistHalfD = Math.max(
    profileAt(index.ys, index.front, torso.waistY),
    profileAt(index.ys, index.back, torso.waistY),
  );
  const hipHalfD = Math.max(
    profileAt(index.ys, index.front, torso.hipY),
    profileAt(index.ys, index.back, torso.hipY),
  );

  const bustGirth = girthAt(profile, torso.bustY);
  const waistGirth = girthAt(profile, torso.waistY);
  const hipGirth = girthAt(profile, torso.hipY);

  const headLoop = torsoLoop(index3d.loops(headCenterY));
  const neckLoop = torsoLoop(index3d.loops(neckTopY - height * 0.01));
  const neckHalfD = neckLoop
    ? Math.max(neckLoop.maxZ - neckLoop.centerZ, neckLoop.centerZ - neckLoop.minZ)
    : 0;
  const leanX = profileAt(index.ys, index.cx, shoulderY) - profileAt(index.ys, index.cx, torso.hipY);

  const armRake = rakeOf(rightArm.chain.dir1, 1);
  const legRake = rakeOf(rightLeg.chain.dir1, 1);
  // The shoulder ridge is measured on the surface: the acromion table sits below the real ridge,
  // which is what a bodice hangs from.
  const ridgeY = shoulderRidge(body.positions, Math.abs(rightArm.joints.root[0]), neckTopY);
  // One column for the whole torso: every bodice, skirt band and panel reads the same body
  // heights. The sections are measured between the ridge and the crotch, so the cloth follows the
  // bust, waist and hip instead of one widest outline.
  const torsoWrap = fitTorso(body.positions, armWeights, ridgeY, torso.crotchY);

  const armRadii = (side: LimbSide) => {
    const arm = armData.get(side)!;
    const elbowY = arm.chain.mid[1];
    const armWristY = arm.chain.end[1];
    return {
      shoulder: radiusAt(arm.joints, shoulderY - height * 0.015),
      biceps: radiusAt(arm.joints, (shoulderY + elbowY) / 2),
      elbow: radiusAt(arm.joints, elbowY),
      forearm: radiusAt(arm.joints, (elbowY + armWristY) / 2),
      wrist: radiusAt(arm.joints, armWristY),
    };
  };
  const legRadii = (side: LimbSide) => {
    const limb = legData.get(side)!.joints;
    return {
      hip: radiusAt(limb, thighTopY),
      midThigh: radiusAt(limb, midThighY),
      knee: radiusAt(limb, kneeY),
      calf: radiusAt(limb, midCalfY),
      ankle: radiusAt(limb, ankleY),
    };
  };

  const rightArmRadii = armRadii(1);
  const rightLegRadii = legRadii(1);
  // Shoulder tip: the joint plus a bottom slice of the deltoid cap. Measured off the skeleton, so
  // a raised arm does not widen the shoulder line the pattern hangs from.
  const shoulderHalfW = Math.abs(rightArm.joints.root[0]) + rightArmRadii.shoulder * 0.2;

  /** Torso cross-section at a height, clamped to the sections the arms have not merged into. */
  const torsoSectionAt = (y: number): TorsoSection => ({
    rx: profileAt(index.ys, index.rx, y),
    front: profileAt(index.ys, index.front, y),
    back: profileAt(index.ys, index.back, y),
  });

  let shapeCache: readonly SimplifiedShape[] | null = null;
  const landmarks: BodyLandmarks = {
    height,
    headH: height - neckTopY,
    neckH: Math.max(neckTopY - ridgeY, height * 0.02),
    torsoH: ridgeY - torso.crotchY,
    legH: hipJointY,
    armH: shoulderY - wristY,
    torsoTop: ridgeY,
    neckTopY,
    shoulderTopY: ridgeY,
    shoulderY,
    armpitY: torso.armpitY,
    bustY: torso.bustY,
    waistY: torso.waistY,
    hipY: torso.hipY,
    crotchY: torso.crotchY,
    kneeY,
    ankleY,
    headCenterY,
    upperArmLen: Math.hypot(...(rightArm.chain.mid.map((v, i) => v - rightArm.chain.root[i]!) as Point3)),
    forearmLen: Math.hypot(...(rightArm.chain.end.map((v, i) => v - rightArm.chain.mid[i]!) as Point3)),
    handLen: height * 0.108,
    thighLen: Math.hypot(...(rightLeg.chain.mid.map((v, i) => v - rightLeg.chain.root[i]!) as Point3)),
    shinLen: Math.hypot(...(rightLeg.chain.end.map((v, i) => v - rightLeg.chain.mid[i]!) as Point3)),
    footLen: height * 0.15,
    chestR: bustGirth / (2 * Math.PI),
    waistR: waistGirth / (2 * Math.PI),
    hipR: hipGirth / (2 * Math.PI),
    armR: rightArmRadii.biceps || cmToM(4.5),
    legR: rightLegRadii.midThigh || cmToM(7),
    neckR: Math.max(loopRadius(neckLoop) || cmToM(5.5), neckHalfD) + CLOTH_CLEARANCE,
    chestHalfW,
    shoulderHalfW,
    waistHalfW,
    hipHalfW,
    chestHalfD,
    waistHalfD,
    hipHalfD,
    deltoidR: Math.max(rightArmRadii.shoulder, cmToM(3.5)),
    elbowR: rightArmRadii.elbow || cmToM(3),
    forearmR: rightArmRadii.forearm || cmToM(3),
    wristR: rightArmRadii.wrist || cmToM(2.4),
    thighTopR: rightLegRadii.hip || cmToM(8),
    kneeR: rightLegRadii.knee || cmToM(5),
    calfR: rightLegRadii.calf || cmToM(5),
    ankleR: rightLegRadii.ankle || cmToM(3.4),
    headHalfW: loopRadius(headLoop) || height * 0.048,
    headHalfD: (headLoop ? Math.max(headLoop.maxZ - headLoop.centerZ, headLoop.centerZ - headLoop.minZ) : height * 0.06),
    footHalfW: height * 0.028,
    handHalfW: height * 0.024,
    handHalfT: height * 0.011,
    shoulderX: Math.abs(rightArm.joints.root[0]),
    hipX: Math.abs(rightLeg.joints.root[0]) || cmToM(9),
    armRakeRad: armRake,
    legRakeRad: legRake,
    torsoLeanRad: clamp(Math.atan2(leanX, shoulderY - torso.hipY), -0.4, 0.4),
    torsoSectionAt,
    torsoEllipseAt: (y: number): BodyEllipse => {
      const section = torsoSectionAt(y);
      return { rx: section.rx, rz: Math.max(section.front, section.back) };
    },
    torsoCenterXAt: (y: number): number => profileAt(index.ys, index.cx, y),
    torsoCenterZAt: (y: number): number => profileAt(index.ys, index.cz, y),
    armChain: (side: LimbSide): LimbChain => (side < 0 ? leftArm : rightArm).chain,
    legChain: (side: LimbSide): LimbChain => (side < 0 ? leftLeg : rightLeg).chain,
    torsoEnvelopeAt: (): RegionEnvelope => torsoWrap,
    bodyShapes: () => (shapeCache ??= simplifiedBodyShapes(body, landmarks)),
  };
  return landmarks;
}

/** Height of a named landmark. */
export function landmarkY(body: BodyLandmarks, landmark: BodyLandmark): number {
  switch (landmark) {
    case 'neckTop': return body.neckTopY;
    case 'shoulderTop': return body.shoulderTopY;
    case 'shoulderCap': return body.shoulderY + body.deltoidR / 2;
    case 'shoulder': return body.shoulderY;
    case 'bust': return body.bustY;
    case 'waist': return body.waistY;
    case 'hip': return body.hipY;
    case 'crotch': return body.crotchY;
    case 'knee': return body.kneeY;
    case 'ankle': return body.ankleY;
  }
}
