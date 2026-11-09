import type { AvatarParams, JointPose, LimbPose } from '@/model/types';
import { clamp, degToRad, rotateAxis3Tuple } from '@/base/math';
import type { BodyLandmarks } from '@/avatar/landmarks';

/** Largest forward swing accepted at a shoulder or hip, in radians. */
const FLEX_LIMIT_RAD = 1.45;
/** Largest elbow bend accepted, in radians. */
const ELBOW_LIMIT_RAD = 2.4;
/** Largest knee bend accepted, in radians. */
const KNEE_LIMIT_RAD = 2.2;

/** A point or direction in meters, axes as x / y / z. */
export type Point3 = [number, number, number];

/** Fully resolved joint rotations of one limb chain, in radians. */
export interface AppliedLimbPose {
  shoulderFlex: number;
  elbowBend: number;
  hipFlex: number;
  kneeBend: number;
}

/** Joint positions and bone directions of one arm or leg chain. */
export interface LimbChain {
  root: Point3;
  mid: Point3;
  end: Point3;
  /** Unit direction from root to mid. */
  dir1: Point3;
  /** Unit direction from mid to end. */
  dir2: Point3;
}

/** Side multiplier of the left (-1) and right (+1) limbs. */
export type PoseSide = -1 | 1;

/** Clamps one joint angle into the range its limb can represent. */
function clampAngle(value: number | undefined, limit: number, allowNegative: boolean): number {
  if (!Number.isFinite(value)) return 0;
  const min = allowNegative ? -limit : 0;
  return clamp(value ?? 0, min, limit);
}

/** Clamped rotations of one side; absent joints read as a straight relaxed limb. */
export function appliedLimbPose(joints: JointPose | undefined, side: PoseSide): AppliedLimbPose {
  const pose: LimbPose = (side < 0 ? joints?.left : joints?.right) ?? {};
  return {
    shoulderFlex: clampAngle(pose.shoulderFlexRad, FLEX_LIMIT_RAD, true),
    elbowBend: clampAngle(pose.elbowBendRad, ELBOW_LIMIT_RAD, false),
    hipFlex: clampAngle(pose.hipFlexRad, FLEX_LIMIT_RAD, true),
    kneeBend: clampAngle(pose.kneeBendRad, KNEE_LIMIT_RAD, false),
  };
}

/** Unit direction of a limb swung outward by `abduct` and forward by `flex`. */
function limbDirection(abduct: number, flex: number): Point3 {
  const cosA = Math.cos(abduct);
  const sinA = Math.sin(abduct);
  return [sinA, -cosA * Math.cos(flex), cosA * Math.sin(flex)];
}

/** Forward axis a bent limb rotates about: the outward axis after abduction. */
function bendAxis(abduct: number): Point3 {
  return [Math.cos(abduct), Math.sin(abduct), 0];
}

/** Adds a scaled unit direction to a point. */
function advance(from: Point3, dir: Point3, distance: number): Point3 {
  return [from[0] + dir[0] * distance, from[1] + dir[1] * distance, from[2] + dir[2] * distance];
}

/** Upper arm and forearm of one side, hinged at the shoulder and elbow. */
export function armChain(body: BodyLandmarks, side: PoseSide, pose: AppliedLimbPose): LimbChain {
  const abduct = side * body.armRakeRad;
  const dir1 = limbDirection(abduct, pose.shoulderFlex);
  const dir2 = rotateAxis3Tuple(dir1, bendAxis(abduct), -pose.elbowBend);
  const root: Point3 = [body.torsoCenterXAt(body.shoulderY) + side * body.shoulderX, body.shoulderY, 0];
  const mid = advance(root, dir1, body.armH * 0.5);
  return { root, mid, end: advance(mid, dir2, body.armH * 0.5), dir1, dir2 };
}

/** Thigh and calf of one side, hinged at the hip and knee. */
export function legChain(body: BodyLandmarks, side: PoseSide, pose: AppliedLimbPose): LimbChain {
  const abduct = side * body.legRakeRad;
  const dir1 = limbDirection(abduct, pose.hipFlex);
  const dir2 = rotateAxis3Tuple(dir1, bendAxis(abduct), pose.kneeBend);
  const root: Point3 = [side * body.hipX, body.legH, 0];
  const mid = advance(root, dir1, body.legH - body.kneeY);
  const calfLength = body.legH * 0.98 - body.kneeY;
  return { root, mid, end: advance(mid, dir2, calfLength), dir1, dir2 };
}



/** One-click body pose: global arm rake, leg splay and torso lean, plus joint rotations. */
export interface PosePreset {
  key: string;
  label: string;
  armDeg: number;
  legDeg: number;
  leanDeg: number;
  joints?: JointPose;
}

const bend = (rad: number): LimbPose => ({ shoulderFlexRad: rad });

/** Built-in poses; the first is the relaxed default. */
export const POSE_PRESETS: PosePreset[] = [
  { key: 'relaxed', label: '自然', armDeg: 7, legDeg: 2, leanDeg: 0 },
  { key: 'a-pose', label: 'A 型', armDeg: 25, legDeg: 4, leanDeg: 0 },
  { key: 't-pose', label: 'T 型', armDeg: 90, legDeg: 6, leanDeg: 0 },
  { key: 'stance', label: '侧立', armDeg: 7, legDeg: 12, leanDeg: 5 },
  {
    key: 'elbow', label: '屈肘', armDeg: 12, legDeg: 2, leanDeg: 0,
    joints: { left: { elbowBendRad: degToRad(90) }, right: { elbowBendRad: degToRad(90) } },
  },
  {
    key: 'raise', label: '抬手', armDeg: 12, legDeg: 2, leanDeg: 0,
    joints: { left: bend(degToRad(80)), right: bend(degToRad(80)) },
  },
  {
    key: 'sit', label: '坐姿', armDeg: 20, legDeg: 4, leanDeg: 0,
    joints: {
      left: { hipFlexRad: degToRad(90), kneeBendRad: degToRad(85) },
      right: { hipFlexRad: degToRad(90), kneeBendRad: degToRad(85) },
    },
  },
  {
    key: 'walk', label: '行走', armDeg: 12, legDeg: 2, leanDeg: 3,
    joints: {
      left: { hipFlexRad: degToRad(25), kneeBendRad: degToRad(8), shoulderFlexRad: -degToRad(20) },
      right: { hipFlexRad: -degToRad(18), kneeBendRad: degToRad(28), shoulderFlexRad: degToRad(24) },
    },
  },
];

/** Avatar params carrying the global angles and joint rotations of a preset. */
export function posePresetParams(params: AvatarParams, preset: PosePreset): AvatarParams {
  return {
    ...params,
    poseArmAngleRad: degToRad(preset.armDeg),
    poseLegSpreadRad: degToRad(preset.legDeg),
    poseTorsoLeanRad: degToRad(preset.leanDeg),
    joints: preset.joints ? cloneJoints(preset.joints) : undefined,
  };
}

/** Deep copy of joint rotations, safe to store in the project. */
export function cloneJoints(joints: JointPose | undefined): JointPose | undefined {
  if (!joints) return undefined;
  return {
    left: joints.left ? { ...joints.left } : undefined,
    right: joints.right ? { ...joints.right } : undefined,
  };
}
