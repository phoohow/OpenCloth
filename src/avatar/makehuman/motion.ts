import type { MakehumanBody } from '@/avatar/makehuman/body';
import type { Vec3Tuple } from '@/base/math';

import { makehumanBodyData, type MakehumanData, type MakehumanJoints } from '@/avatar/makehuman/data';

const PARENT_OF = {
  leftShoulder: 'torso',
  leftElbow: 'leftShoulder',
  leftWrist: 'leftElbow',
  rightShoulder: 'torso',
  rightElbow: 'rightShoulder',
  rightWrist: 'rightElbow',
  leftHip: null,
  leftKnee: 'leftHip',
  leftAnkle: 'leftKnee',
  rightHip: null,
  rightKnee: 'rightHip',
  rightAnkle: 'rightKnee',
  torso: null,
} as const;

export type MotionRegion = keyof typeof PARENT_OF;

export interface MotionRig {
  readonly regions: readonly MotionRegion[];
  readonly pivots: readonly Vec3Tuple[];
  readonly parents: readonly number[];
  readonly weights: Float32Array;
  columnOf(region: MotionRegion): number;
}

function isRegionName(name: string): name is MotionRegion {
  return Object.hasOwn(PARENT_OF, name);
}

function centreOf(positions: Float32Array, ids: readonly number[]): Vec3Tuple {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of ids) {
    x += positions[id * 3] ?? 0;
    y += positions[id * 3 + 1] ?? 0;
    z += positions[id * 3 + 2] ?? 0;
  }

  return [x / ids.length, y / ids.length, z / ids.length];
}

function trunkPivot(positions: Float32Array, joints: MakehumanJoints): Vec3Tuple {
  const left = centreOf(positions, joints.leftHip);
  const right = centreOf(positions, joints.rightHip);
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];
}

function pivotOf(region: MotionRegion, body: MakehumanBody, joints: MakehumanJoints): Vec3Tuple {
  if (region === 'leftShoulder') return body.shoulderPivots.left;
  if (region === 'rightShoulder') return body.shoulderPivots.right;
  if (region === 'torso') return trunkPivot(body.positions, joints);
  return centreOf(body.positions, joints[region]);
}

function regionOrder(data: MakehumanData): MotionRegion[] {
  const names = data.motionRegions;
  const regions = names.filter(isRegionName);
  if (regions.length !== names.length || regions.length !== Object.keys(PARENT_OF).length) {
    throw new Error(`MakeHuman body carries unexpected motion regions: ${names.join(', ')}`);
  }

  return regions;
}

export function makehumanMotionRig(body: MakehumanBody): MotionRig {
  const data = makehumanBodyData();
  const regions = regionOrder(data);
  const columnOf = (region: MotionRegion): number => regions.indexOf(region);
  return {
    regions,
    pivots: regions.map(region => pivotOf(region, body, data.joints)),
    parents: regions.map(region => {
      const parent = PARENT_OF[region];
      return parent ? columnOf(parent) : -1;
    }),
    weights: data.motionWeights,
    columnOf,
  };
}
