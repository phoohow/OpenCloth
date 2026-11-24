import type { LimbSide } from '@/avatar/envelope';
import type { LimbJoints, MakehumanBody } from '@/avatar/makehuman/body';
import type { Vec3Tuple } from '@/base/math';

import { makehumanBodyData } from '@/avatar/makehuman/data';
import { applyMatrix4, midpoint3t } from '@/base/math';

const REFERENCE_HEIGHT = 1.7;

const ROOT_JOINT_RADIUS = 0.028;

const SPINE_JOINT_RADIUS = 0.016;

const LIMB_JOINT_RADIUS = 0.019;

const HEAD_JOINT_RADIUS = 0.024;

const BONE_OF_JOINT_BALLS = 0.55;

const REGION_OF: Readonly<Record<SkeletonJointName, string>> = {
  torso: 'torso', spine: 'torso', chest: 'torso', neck: 'torso', head: 'torso',
  leftShoulder: 'leftShoulder', leftElbow: 'leftElbow', leftWrist: 'leftWrist',
  rightShoulder: 'rightShoulder', rightElbow: 'rightElbow', rightWrist: 'rightWrist',
  leftHip: 'leftHip', leftKnee: 'leftKnee', leftAnkle: 'leftAnkle',
  rightHip: 'rightHip', rightKnee: 'rightKnee', rightAnkle: 'rightAnkle',
};

export type SkeletonJointName =
  | 'torso' | 'spine' | 'chest' | 'neck' | 'head'
  | 'leftShoulder' | 'rightShoulder' | 'leftElbow' | 'rightElbow'
  | 'leftWrist' | 'rightWrist'
  | 'leftHip' | 'rightHip' | 'leftKnee' | 'rightKnee' | 'leftAnkle' | 'rightAnkle';

export interface SkeletonJoint {
  name: SkeletonJointName;
  position: Vec3Tuple;
  radius: number;
  region: string;
}

export interface SkeletonBone {
  from: SkeletonJointName;
  to: SkeletonJointName;
  width: number;
}

export interface Skeleton {
  joints: readonly SkeletonJoint[];
  bones: readonly SkeletonBone[];
}

export interface SkeletonSource {
  height: number;
  bustY: number;
  waistY: number;
  torsoTop: number;
  headCenterY: number;
  torsoCenterXAt(y: number): number;
  torsoCenterZAt(y: number): number;
  armChain(side: LimbSide): LimbJoints;
  legChain(side: LimbSide): LimbJoints;
}

interface SidedChain {
  side: 'left' | 'right';
  chain: LimbJoints;
}

function leftSideSign(body: MakehumanBody): LimbSide {
  const ids = makehumanBodyData().joints.leftShoulder;
  const x = ids.reduce((sum, id) => sum + (body.positions[id * 3] ?? 0), 0);
  return x < 0 ? -1 : 1;
}

function sidedChains(
  source: SkeletonSource, leftSign: LimbSide,
): { arms: SidedChain[]; legs: SidedChain[] } {
  const nameOf = (side: LimbSide): 'left' | 'right' => (side === leftSign ? 'left' : 'right');
  return {
    arms: [
      { side: nameOf(-1), chain: source.armChain(-1) },
      { side: nameOf(1), chain: source.armChain(1) },
    ],
    legs: [
      { side: nameOf(-1), chain: source.legChain(-1) },
      { side: nameOf(1), chain: source.legChain(1) },
    ],
  };
}

export function bodySkeleton(body: MakehumanBody, source: SkeletonSource): Skeleton {
  const unit = source.height / REFERENCE_HEIGHT;
  const joints: SkeletonJoint[] = [];
  const add = (name: SkeletonJointName, position: Vec3Tuple, radius: number): void => {
    joints.push({ name, position, radius: radius * unit, region: REGION_OF[name] });
  };
  const spineAt = (y: number): Vec3Tuple => [source.torsoCenterXAt(y), y, source.torsoCenterZAt(y)];
  const { arms, legs } = sidedChains(source, leftSideSign(body));

  const hipCentre = midpoint3t(legs[0].chain.root, legs[1].chain.root);
  add('torso', hipCentre, ROOT_JOINT_RADIUS);
  add('spine', spineAt(source.waistY), SPINE_JOINT_RADIUS);
  add('chest', spineAt(source.bustY), SPINE_JOINT_RADIUS);
  add('neck', spineAt(source.torsoTop), SPINE_JOINT_RADIUS);
  add('head', spineAt(source.headCenterY), HEAD_JOINT_RADIUS);

  for (const { side, chain } of arms) {
    add(`${side}Shoulder`, chain.root, LIMB_JOINT_RADIUS);
    add(`${side}Elbow`, chain.mid, LIMB_JOINT_RADIUS);
    add(`${side}Wrist`, chain.end, LIMB_JOINT_RADIUS);
  }

  for (const { side, chain } of legs) {
    add(`${side}Hip`, chain.root, LIMB_JOINT_RADIUS);
    add(`${side}Knee`, chain.mid, LIMB_JOINT_RADIUS);
    add(`${side}Ankle`, chain.end, LIMB_JOINT_RADIUS);
  }

  const radiusOf = new Map(joints.map(joint => [joint.name, joint.radius]));
  const bones: SkeletonBone[] = [];
  const link = (from: SkeletonJointName, to: SkeletonJointName): void => {
    bones.push({ from, to, width: (radiusOf.get(from)! + radiusOf.get(to)!) * BONE_OF_JOINT_BALLS });
  };

  link('torso', 'spine');
  link('spine', 'chest');
  link('chest', 'neck');
  link('neck', 'head');
  for (const { side } of arms) {
    link('chest', `${side}Shoulder`);
    link(`${side}Shoulder`, `${side}Elbow`);
    link(`${side}Elbow`, `${side}Wrist`);
  }

  for (const { side } of legs) {
    link('torso', `${side}Hip`);
    link(`${side}Hip`, `${side}Knee`);
    link(`${side}Knee`, `${side}Ankle`);
  }

  return { joints, bones };
}

export function posedSkeleton(
  skeleton: Skeleton, pose: ReadonlyMap<string, ArrayLike<number>>,
): Skeleton {
  const joints = skeleton.joints.map((joint): SkeletonJoint => {
    const matrix = pose.get(joint.region);
    return matrix ? { ...joint, position: applyMatrix4(matrix, joint.position) } : joint;
  });
  return { joints, bones: skeleton.bones };
}
