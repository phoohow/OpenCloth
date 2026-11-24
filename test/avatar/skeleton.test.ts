import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/app';
import { bodyLandmarks } from '@/avatar/landmarks';
import { posedSkeleton, type SkeletonJointName } from '@/avatar/skeleton';
import { makehumanBody } from '@/avatar/makehuman/body';
import { makehumanMotionRig, type MotionRegion } from '@/avatar/makehuman/motion';

const MIRROR_TOLERANCE = 0.005;

function rotationAbout(pivot: readonly [number, number, number], angle: number): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y] = pivot;
  return new Float32Array([
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    x - (c * x - s * y), y - (s * x + c * y), 0, 1,
  ]);
}

describe('rig skeleton', () => {
  const params = createStarterProject().avatar.params;
  const body = bodyLandmarks(params);
  const skeleton = body.bodySkeleton();
  const { joints, bones } = skeleton;
  const jointOf = (name: SkeletonJointName) => joints.find(joint => joint.name === name)!;

  it('carries the trunk chain and every limb joint', () => {
    expect([...joints.map(joint => joint.name)].sort()).toEqual([
      'chest', 'head', 'leftAnkle', 'leftElbow', 'leftHip', 'leftKnee', 'leftShoulder',
      'leftWrist', 'neck', 'rightAnkle', 'rightElbow', 'rightHip', 'rightKnee',
      'rightShoulder', 'rightWrist', 'spine', 'torso',
    ]);
    expect(bones).toHaveLength(16);
  });

  it('links each bone between two joints that exist', () => {
    const names = new Set(joints.map(joint => joint.name));
    for (const bone of bones) {
      expect(names.has(bone.from)).toBe(true);
      expect(names.has(bone.to)).toBe(true);
      expect(bone.width).toBeGreaterThan(0.005);
    }

    expect(new Set(bones.map(bone => `${bone.from}>${bone.to}`)).size).toBe(bones.length);
    for (const bone of bones) expect(bone.from).not.toBe(bone.to);
  });

  it('runs the trunk chain up the body', () => {
    const heights = ['torso', 'spine', 'chest', 'neck', 'head'] as SkeletonJointName[];
    for (let i = 1; i < heights.length; i++) {
      expect(jointOf(heights[i]!).position[1]).toBeGreaterThan(jointOf(heights[i - 1]!).position[1]);
    }

    for (const name of heights) {
      expect(Math.abs(jointOf(name).position[0])).toBeLessThan(MIRROR_TOLERANCE);
    }
  });

  it('hinges the arms above the wrists and the legs below the hips', () => {
    for (const side of ['left', 'right'] as const) {
      const shoulder = jointOf(`${side}Shoulder`).position;
      const elbow = jointOf(`${side}Elbow`).position;
      const wrist = jointOf(`${side}Wrist`).position;
      expect(elbow[1]).toBeLessThan(shoulder[1]);
      expect(wrist[1]).toBeLessThan(elbow[1]);
      expect(Math.abs(elbow[0])).toBeGreaterThan(Math.abs(shoulder[0]));
      expect(Math.abs(wrist[0])).toBeGreaterThan(Math.abs(elbow[0]));

      const hip = jointOf(`${side}Hip`).position;
      const knee = jointOf(`${side}Knee`).position;
      const ankle = jointOf(`${side}Ankle`).position;
      expect(knee[1]).toBeLessThan(hip[1]);
      expect(ankle[1]).toBeLessThan(knee[1]);
      expect(ankle[1]).toBeGreaterThan(0);
    }
  });

  it('mirrors the limb joints across the body midline', () => {
    for (const part of ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle'] as const) {
      const left = jointOf(`left${part}`).position;
      const right = jointOf(`right${part}`).position;
      expect(Math.abs(left[0] + right[0])).toBeLessThan(MIRROR_TOLERANCE);
      expect(Math.abs(left[1] - right[1])).toBeLessThan(MIRROR_TOLERANCE);
      expect(Math.abs(left[2] - right[2])).toBeLessThan(MIRROR_TOLERANCE);
    }
  });

  it('follows the region that carries each joint', () => {
    const shoulder = jointOf('leftShoulder').position;
    const turn = rotationAbout(shoulder, Math.PI / 2);
    const posed = posedSkeleton(skeleton, new Map([
      ['leftShoulder', turn], ['leftElbow', turn], ['leftWrist', turn],
    ]));
    const shift = (name: SkeletonJointName): number => {
      const from = jointOf(name).position;
      const to = posed.joints.find(joint => joint.name === name)!.position;
      return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    };

    expect(shift('leftShoulder')).toBeLessThan(1e-6);
    expect(shift('leftWrist')).toBeGreaterThan(0.1);
    expect(shift('rightWrist')).toBe(0);
    expect(posed.bones).toBe(skeleton.bones);
  });

  it('swings the whole trunk around the pelvis when the torso turns', () => {
    const pelvis = jointOf('torso').position;
    const posed = posedSkeleton(skeleton, new Map([['torso', rotationAbout(pelvis, 0.2)]]));
    const head = posed.joints.find(joint => joint.name === 'head')!.position;
    const restHead = jointOf('head').position;
    expect(Math.hypot(head[0] - restHead[0], head[1] - restHead[1])).toBeGreaterThan(0.01);
    for (const name of ['leftAnkle', 'rightAnkle'] as SkeletonJointName[]) {
      const ankle = posed.joints.find(joint => joint.name === name)!.position;
      expect(Math.abs(ankle[1] - jointOf(name).position[1])).toBeLessThan(1e-9);
    }
  });

  it('names each limb joint after the region that drives it', () => {
    const buildBody = makehumanBody(params);
    const rig = makehumanMotionRig(buildBody);
    const regions = rig.regions.length;
    const surfaceOf = (region: MotionRegion): [number, number, number] => {
      const column = rig.regions.indexOf(region);
      const sum = [0, 0, 0];
      let count = 0;
      for (let vertex = 0; vertex * 3 < buildBody.positions.length; vertex++) {
        if (rig.weights[vertex * regions + column]! < 0.9) continue;
        sum[0] += buildBody.positions[vertex * 3]!;
        sum[1] += buildBody.positions[vertex * 3 + 1]!;
        sum[2] += buildBody.positions[vertex * 3 + 2]!;
        count++;
      }

      return count === 0 ? [0, 0, 0] : [sum[0] / count, sum[1] / count, sum[2] / count];
    };

    for (const part of ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle'] as const) {
      for (const side of ['left', 'right'] as const) {
        const joint = jointOf(`${side}${part}`);
        const surface = surfaceOf(`${side}${part}`);
        expect(joint.region).toBe(`${side}${part}`);
        expect(Math.sign(joint.position[0])).toBe(Math.sign(surface[0]));
        const reach = Math.hypot(
          joint.position[0] - surface[0],
          joint.position[1] - surface[1],
          joint.position[2] - surface[2],
        );
        expect(reach, `${side}${part} sits inside its own limb`).toBeLessThan(0.3);
      }
    }

    for (const name of ['spine', 'chest', 'neck', 'head'] as const) {
      expect(jointOf(name).region).toBe('torso');
    }
  });

  it('sizes the balls from the body, not from a fixed table', () => {
    const tallest = Math.max(...joints.map(joint => joint.position[1]));
    expect(tallest).toBeLessThan(body.height);
    for (const joint of joints) expect(joint.radius).toBeGreaterThan(0.005);
    expect(jointOf('torso').radius).toBeGreaterThan(jointOf('spine').radius);
  });
});
