import type { MotionRegion, MotionRig } from '@/avatar';
import type { Vec3Tuple } from '@/base/math';
import type { MotionTrack, ProceduralClip, ProceduralMotion } from '@/render/common';

const CLIPS: readonly NamedClip[] = [armRaise(), march(), reach(), armSwing()];

interface NamedTrack {
  readonly region: MotionRegion;
  readonly times: readonly number[];
  readonly values: readonly Vec3Tuple[];
}

interface NamedClip {
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly NamedTrack[];
}

function track(region: MotionRegion, times: readonly number[], values: readonly Vec3Tuple[]): NamedTrack {
  return { region, times, values };
}

function armRaise(): NamedClip {
  const times = [0, 1, 2];
  const rest: Vec3Tuple = [0, 0, 0];
  return {
    name: '抬臂',
    duration: 2,
    tracks: [
      track('leftShoulder', times, [rest, [0, 0, 0.95], rest]),
      track('rightShoulder', times, [rest, [0, 0, -0.95], rest]),
    ],
  };
}

function march(): NamedClip {
  const times = [0, 0.5, 1, 1.5, 2];
  const rest: Vec3Tuple = [0, 0, 0];
  const lift: Vec3Tuple = [0.5, 0, 0];
  const tuck: Vec3Tuple = [-0.75, 0, 0];
  return {
    name: '原地踏步',
    duration: 2,
    tracks: [
      track('leftHip', times, [rest, lift, rest, [0.16, 0, 0], rest]),
      track('leftKnee', times, [rest, tuck, rest, [-0.2, 0, 0], rest]),
      track('rightHip', times, [rest, [0.16, 0, 0], rest, lift, rest]),
      track('rightKnee', times, [rest, [-0.2, 0, 0], rest, tuck, rest]),
      track('leftShoulder', times, [rest, [0.2, 0, 0], rest, [-0.2, 0, 0], rest]),
      track('rightShoulder', times, [rest, [-0.2, 0, 0], rest, [0.2, 0, 0], rest]),
    ],
  };
}

function reach(): NamedClip {
  const times = [0, 1.5, 3];
  const rest: Vec3Tuple = [0, 0, 0];
  return {
    name: '伸展',
    duration: 3,
    tracks: [
      track('leftShoulder', times, [rest, [0, 0, 1.2], rest]),
      track('rightShoulder', times, [rest, [0, 0, -1.2], rest]),
      track('torso', times, [rest, [-0.18, 0, 0], rest]),
    ],
  };
}

function armSwing(): NamedClip {
  const times = [0, 0.6, 1.2, 1.8, 2.4];
  const rest: Vec3Tuple = [0, 0, 0];
  const forward: Vec3Tuple = [0.55, 0, 0];
  const back: Vec3Tuple = [-0.45, 0, 0];
  return {
    name: '摆臂',
    duration: 2.4,
    tracks: [
      track('leftShoulder', times, [rest, forward, rest, back, rest]),
      track('rightShoulder', times, [rest, back, rest, forward, rest]),
      track('leftElbow', times, [rest, [-0.3, 0, 0], rest, [0.2, 0, 0], rest]),
      track('rightElbow', times, [rest, [0.2, 0, 0], rest, [-0.3, 0, 0], rest]),
    ],
  };
}

function resolveClip(clip: NamedClip, columnOf: (region: MotionRegion) => number): ProceduralClip {
  return {
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.map(({ region, times, values }): MotionTrack => ({
      region: columnOf(region), times, values,
    })),
  };
}

export function makehumanMotion(rig: MotionRig): ProceduralMotion {
  return {
    regions: rig.regions,
    pivots: rig.pivots,
    parents: rig.parents,
    weights: rig.weights,
    clips: CLIPS.map(clip => resolveClip(clip, rig.columnOf)),
  };
}
