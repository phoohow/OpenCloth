import type { AvatarParams, BodyLandmark } from '@/model/types';

import { CLOTH_CLEARANCE, fitTorso, type LimbSide, type RegionEnvelope } from '@/avatar/envelope';
import { girthLines, type GirthLine } from '@/avatar/girthLines';
import {
  makehumanBody, bodyKey, axisXAt, STATURE,
  type LimbJoints, type LimbPair, type MakehumanBody,
} from '@/avatar/makehuman/body';
import { makehumanBodyData } from '@/avatar/makehuman/data';
import { girthAt } from '@/avatar/makehuman/measure';
import { limbLoop, SectionIndex, torsoLoop, type SectionLoop } from '@/avatar/makehuman/section';
import { simplifiedBodyShapes, type SimplifiedShape } from '@/avatar/simplifiedBody';
import { bodySkeleton, type Skeleton } from '@/avatar/skeleton';
import { monotoneInterp } from '@/base/geom';
import { clamp, distance3t, normalize3t, sub3t, type Vec3Tuple } from '@/base/math';
import { cmToM } from '@/base/units';

const MEASURED = new Map<string, BodyLandmarks>();

const MEASURED_LIMIT = 3;

export interface BodyEllipse {
  rx: number;
  rz: number;
}

export interface TorsoSection {
  rx: number;
  front: number;
  back: number;
}

export interface LimbChain {
  root: Vec3Tuple;
  mid: Vec3Tuple;
  end: Vec3Tuple;
  dir1: Vec3Tuple;
  dir2: Vec3Tuple;
}

export interface BodyProportions {
  height: number;
  headH: number;
  neckH: number;
  torsoH: number;
  legH: number;
  armH: number;
  torsoTop: number;
  neckTopY: number;
  shoulderTopY: number;
  shoulderY: number;
  armpitY: number;
  bustY: number;
  waistY: number;
  hipY: number;
  crotchY: number;
  kneeY: number;
  ankleY: number;
  headCenterY: number;
  upperArmLen: number;
  forearmLen: number;
  handLen: number;
  thighLen: number;
  shinLen: number;
  footLen: number;
  chestR: number;
  waistR: number;
  hipR: number;
  armR: number;
  legR: number;
  neckR: number;
  chestHalfW: number;
  shoulderHalfW: number;
  waistHalfW: number;
  hipHalfW: number;
  chestHalfD: number;
  waistHalfD: number;
  hipHalfD: number;
  deltoidR: number;
  elbowR: number;
  forearmR: number;
  wristR: number;
  thighTopR: number;
  kneeR: number;
  calfR: number;
  ankleR: number;
  headHalfW: number;
  headHalfD: number;
  footHalfW: number;
  handHalfW: number;
  handHalfT: number;
  shoulderX: number;
  hipX: number;
  armRakeRad: number;
  legRakeRad: number;
  torsoLeanRad: number;
}

export interface BodyLandmarks extends BodyProportions {
  torsoSectionAt(y: number): TorsoSection;
  torsoEllipseAt(y: number): BodyEllipse;
  torsoCenterXAt(y: number): number;
  torsoCenterZAt(y: number): number;
  armChain(side: LimbSide): LimbChain;
  legChain(side: LimbSide): LimbChain;
  torsoEnvelopeAt(): RegionEnvelope;
  bodyShapes(): readonly SimplifiedShape[];
  bodyGirthLines(): readonly GirthLine[];
  bodySkeleton(): Skeleton;
}

function loopRadius(loop: SectionLoop | undefined): number {
  if (!loop) return 0;
  return (loop.maxX - loop.minX) / 2;
}

function loopDepth(loop: SectionLoop | undefined): number {
  if (!loop) return 0;
  return (loop.maxZ - loop.minZ) / 2;
}

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

function rakeOf(dir: Vec3Tuple, side: LimbSide): number {
  return Math.atan2(side * dir[0], Math.max(-dir[1], 1e-4));
}

function limbOf(pair: LimbPair, side: LimbSide): LimbJoints {
  const preferred = side > 0 ? pair.right : pair.left;
  const other = side > 0 ? pair.left : pair.right;
  return Math.sign(preferred.root[0]) === Math.sign(side) || Math.sign(other.root[0]) !== Math.sign(side)
    ? preferred
    : other;
}

function chainFrom(joints: LimbJoints): LimbChain {
  const { root, mid, end } = joints;
  return {
    root, mid, end,
    dir1: normalize3t(sub3t(mid, root)),
    dir2: normalize3t(sub3t(end, mid)),
  };
}

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

function profileAt(ys: number[], values: number[], y: number): number {
  if (y <= ys[0]!) return values[0]!;
  const last = ys.length - 1;
  if (y >= ys[last]!) return values[last]!;
  return monotoneInterp(ys, values, y);
}

export function bodyLandmarks(params: AvatarParams): BodyLandmarks {
  const key = bodyKey(params);
  const cached = MEASURED.get(key);
  if (cached) return cached;
  const measured = measureBodyLandmarks(params);
  MEASURED.set(key, measured);
  if (MEASURED.size > MEASURED_LIMIT) {
    const oldest = MEASURED.keys().next();
    if (!oldest.done) MEASURED.delete(oldest.value);
  }

  return measured;
}

function measureBodyLandmarks(params: AvatarParams): BodyLandmarks {
  const body = makehumanBody(params);
  const armWeights = makehumanBodyData().armWeights;
  const { profile, landmarks: torso, joints } = body;
  const height = body.height;
  const index = profileIndex(body);

  const index3d = new SectionIndex(body.positions, body.bodyIndices);
  const limbSlice = (y: number, x: number): SectionLoop | undefined =>
    limbLoop(index3d.loops(y), x);

  const shoulderY = joints.arms.right.root[1];
  const wristY = joints.arms.right.end[1];
  const hipJointY = joints.legs.right.root[1];
  const kneeY = joints.legs.right.mid[1];
  const ankleY = joints.legs.right.end[1];
  const neckTopY = height * STATURE.chin;
  const headCenterY = height * STATURE.headCenter;

  const sides: LimbSide[] = [-1, 1];

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
  const ridgeY = shoulderRidge(body.positions, Math.abs(rightArm.joints.root[0]), neckTopY);
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
  const shoulderHalfW = Math.abs(rightArm.joints.root[0]) + rightArmRadii.shoulder * 0.2;

  const torsoSectionAt = (y: number): TorsoSection => ({
    rx: profileAt(index.ys, index.rx, y),
    front: profileAt(index.ys, index.front, y),
    back: profileAt(index.ys, index.back, y),
  });

  let shapeCache: readonly SimplifiedShape[] | null = null;
  let lineCache: readonly GirthLine[] | null = null;
  let skeletonCache: Skeleton | null = null;
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
    upperArmLen: distance3t(rightArm.chain.mid, rightArm.chain.root),
    forearmLen: distance3t(rightArm.chain.end, rightArm.chain.mid),
    handLen: height * 0.108,
    thighLen: distance3t(rightLeg.chain.mid, rightLeg.chain.root),
    shinLen: distance3t(rightLeg.chain.end, rightLeg.chain.mid),
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
    bodyGirthLines: () => (lineCache ??= girthLines(body, landmarks)),
    bodySkeleton: () => (skeletonCache ??= bodySkeleton(body, landmarks)),
  };
  return landmarks;
}

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
