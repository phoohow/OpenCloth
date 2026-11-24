import type { AvatarParams } from '@/model/types';

import { makehumanBodyData, type MakehumanData } from '@/avatar/makehuman/data';
import { scanTorso, type TorsoLandmarks, type TorsoScan, type TorsoSlice } from '@/avatar/makehuman/measure';
import { SectionIndex, sectionLoops, torsoLoop } from '@/avatar/makehuman/section';
import { clamp, type Vec3Tuple } from '@/base/math';

export const STATURE = {
  ankle: 0.048,
  wrist: 0.484,
  crotch: 0.455,
  knee: 0.285,
  hipJoint: 0.520,
  elbow: 0.617,
  shoulder: 0.798,
  acromion: 0.820,
  neckBase: 0.843,
  chin: 0.870,
  headCenter: 0.935,
} as const;

const GIRTH_ROUNDS = 8;

const GIRTH_TOLERANCE = 0.0015;

const GIRTH_WEIGHT_LIMIT = 2;

const GIRTH_PROBE = 0.02;

const SCAN_BOTTOM = STATURE.crotch;

const SCAN_TOP = 0.83;

const TARGET = {
  bustUp: 'measure/bust-increase',
  bustDown: 'measure/bust-decrease',
  waistUp: 'measure/waist-increase',
  waistDown: 'measure/waist-decrease',
  hipsUp: 'measure/hips-increase',
  hipsDown: 'measure/hips-decrease',
} as const;

const GRID = {
  genders: ['female', 'male'],
  ages: ['baby', 'child', 'young', 'old'],
  muscles: ['minmuscle', 'averagemuscle', 'maxmuscle'],
  weights: ['minweight', 'averageweight', 'maxweight'],
} as const;

const AGE_ANCHORS = [1, 10, 25, 90] as const;

const AGE_FACTORS = [0, 0.1875, 0.5, 1] as const;

const SHOULDER_PIVOT_RISE = 0.02;

const BUILT = new Map<string, MakehumanBody>();

const BUILT_LIMIT = 3;

export interface LimbJoints {
  root: Vec3Tuple;
  mid: Vec3Tuple;
  end: Vec3Tuple;
}

export interface MakehumanBody {
  readonly positions: Float32Array;
  readonly bodyIndices: Uint32Array;
  readonly eyeIndices: Uint32Array;
  readonly height: number;
  readonly landmarks: TorsoLandmarks;
  readonly profile: readonly TorsoSlice[];
  readonly joints: { arms: LimbPair; legs: LimbPair };
  readonly shoulderPivots: ShoulderPivots;
}

export interface ShoulderPivots {
  readonly left: Vec3Tuple;
  readonly right: Vec3Tuple;
}

export interface LimbPair {
  left: LimbJoints;
  right: LimbJoints;
}

interface GirthGoal {
  up: string;
  down: string;
  readonly y: number;
  readonly target: number;
  weight: number;
  slope: number;
}

export function axisXAt(joints: LimbJoints, y: number): number {
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

  const [first, second] = y > joints.root[1] ? [points[0]!, points[1]!] : [points[1]!, points[2]!];
  const t = clamp((y - first[1]) / ((second[1] - first[1]) || 1), -2, 2);
  return first[0] + (second[0] - first[0]) * t;
}

class TargetDeformer {
  private readonly data: MakehumanData;
  private readonly weights: Float32Array;
  private readonly scratch: Float32Array;
  private readonly rows = new Map<string, number>();

  constructor(data: MakehumanData) {
    this.data = data;
    this.weights = new Float32Array(data.names.length);
    this.scratch = new Float32Array(data.rest.length);
    data.names.forEach((name, row) => this.rows.set(name, row));
  }

  row(name: string): number {
    const row = this.rows.get(name);
    if (row === undefined) throw new Error(`unknown MakeHuman target: ${name}`);
    return row;
  }

  set(name: string, weight: number): void {
    this.weights[this.row(name)] = Math.max(weight, 0);
  }

  deform(scale = 1): Float32Array {
    const { rest, targets, targetScales, vertexCount } = this.data;
    const out = this.scratch;
    const stride = vertexCount * 3;
    for (let i = 0; i < stride; i++) out[i] = rest[i]! * scale;
    for (let row = 0; row < this.weights.length; row++) {
      const weight = this.weights[row]!;
      if (weight === 0) continue;
      const offset = row * stride;
      const step = weight * targetScales[row]! * scale;
      if (step === 0) continue;
      for (let i = 0; i < stride; i++) {
        const delta = targets[offset + i]!;
        if (delta !== 0) out[i] += delta * step;
      }
    }

    return out;
  }
}

function floorOf(positions: ArrayLike<number>): number {
  let min = Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i]!;
    if (y < min) min = y;
  }

  return min;
}

function statureOf(positions: ArrayLike<number>): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i]!;
    if (y < min) min = y;
    if (y > max) max = y;
  }

  return max - min;
}

export function torsoGirth(positions: Float32Array, indices: Uint32Array, y: number): number {
  return torsoLoop(sectionLoops(positions, indices, y))?.perimeter ?? 0;
}

function sliderWeights(value: number): [number, number, number] {
  const high = Math.max(0, value * 2 - 1);
  const low = Math.max(0, 1 - value * 2);
  return [low, 1 - high - low, high];
}

function ageFactor(years: number): number {
  const age = clamp(years, AGE_ANCHORS[0], AGE_ANCHORS[3]);
  for (let i = 0; i < AGE_ANCHORS.length - 1; i++) {
    const from = AGE_ANCHORS[i]!;
    const to = AGE_ANCHORS[i + 1]!;
    if (age <= to) {
      const t = (age - from) / (to - from);
      return AGE_FACTORS[i]! + (AGE_FACTORS[i + 1]! - AGE_FACTORS[i]!) * t;
    }
  }

  return 1;
}

function ageWeights(factor: number): Record<(typeof GRID.ages)[number], number> {
  if (factor >= 0.5) {
    const old = Math.max(0, factor * 2 - 1);
    return { baby: 0, child: 0, young: 1 - old, old };
  }

  const baby = Math.max(0, 1 - factor * 5.333);
  const young = Math.max(0, (factor - 0.1875) * 3.2);
  const child = Math.max(0, Math.min(1, 5.333 * factor) - young);
  return { baby, child, young, old: 0 };
}

function applyMacrodetails(deformer: TargetDeformer, params: AvatarParams): void {
  const gender = clamp(params.gender ?? 0, 0, 1);
  const muscle = sliderWeights(clamp(params.muscle ?? 0.5, 0, 1));
  const weight = sliderWeights(clamp(params.weight ?? 0.5, 0, 1));
  const ages = ageWeights(ageFactor(params.ageYears ?? 25));

  const genders = [1 - gender, gender];
  GRID.genders.forEach((genderName, g) => {
    GRID.ages.forEach((ageName) => {
      deformer.set(`age/${genderName}-${ageName}`, genders[g]! * ages[ageName]);
      GRID.muscles.forEach((muscleName, m) => {
        GRID.weights.forEach((weightName, w) => {
          const share = genders[g]! * ages[ageName] * muscle[m]! * weight[w]!;
          deformer.set(`muscle/${genderName}-${ageName}-${muscleName}-${weightName}`, share);
        });
      });
    });
  });
}

function jointCentre(positions: ArrayLike<number>, ids: readonly number[]): Vec3Tuple {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of ids) {
    x += positions[id * 3]!;
    y += positions[id * 3 + 1]!;
    z += positions[id * 3 + 2]!;
  }

  const n = Math.max(ids.length, 1);
  return [x / n, y / n, z / n];
}

function shoulderPivots(positions: Float32Array, data: MakehumanData): ShoulderPivots {
  const pivotOf = (ids: readonly number[]): Vec3Tuple => {
    const centre = jointCentre(positions, ids);
    return [centre[0], centre[1] + SHOULDER_PIVOT_RISE, centre[2]];
  };
  return { left: pivotOf(data.joints.leftShoulder), right: pivotOf(data.joints.rightShoulder) };
}

function wrapAngle(angle: number): number {
  let out = angle;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out <= -Math.PI) out += Math.PI * 2;
  return out;
}

function poseArms(positions: Float32Array, data: MakehumanData, pivots: ShoulderPivots): void {
  const sides = [
    { joint: data.joints.leftShoulder, elbow: data.joints.leftElbow, column: 0, pivot: pivots.left, sign: Math.sign(pivots.left[0]) || 1 },
    { joint: data.joints.rightShoulder, elbow: data.joints.rightElbow, column: 1, pivot: pivots.right, sign: Math.sign(pivots.right[0]) || -1 },
  ];
  for (const side of sides) {
    const joint = jointCentre(positions, side.joint);
    const pivot = side.pivot;
    const elbow = jointCentre(positions, side.elbow);
    const current = Math.atan2(elbow[1] - joint[1], elbow[0] - joint[0]);
    const goal = side.sign > 0 ? 0 : Math.PI;
    const turn = wrapAngle(goal - current);
    if (Math.abs(turn) < 1e-4) continue;
    for (let v = 0; v < data.vertexCount; v++) {
      const weight = data.armWeights[v * 2 + side.column]!;
      if (weight <= 0) continue;
      const angle = turn * weight;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const i = v * 3;
      const dx = positions[i]! - pivot[0];
      const dy = positions[i + 1]! - pivot[1];
      positions[i] = pivot[0] + dx * cos - dy * sin;
      positions[i + 1] = pivot[1] + dx * sin + dy * cos;
    }
  }
}

function limbJoints(positions: ArrayLike<number>, data: MakehumanData): MakehumanBody['joints'] {
  const chain = (root: readonly number[], mid: readonly number[], end: readonly number[]): LimbJoints => ({
    root: jointCentre(positions, root),
    mid: jointCentre(positions, mid),
    end: jointCentre(positions, end),
  });
  return {
    arms: {
      left: chain(data.joints.leftShoulder, data.joints.leftElbow, data.joints.leftWrist),
      right: chain(data.joints.rightShoulder, data.joints.rightElbow, data.joints.rightWrist),
    },
    legs: {
      left: chain(data.joints.leftHip, data.joints.leftKnee, data.joints.leftAnkle),
      right: chain(data.joints.rightHip, data.joints.rightKnee, data.joints.rightAnkle),
    },
  };
}

function applyGirth(deformer: TargetDeformer, goal: GirthGoal, weight: number): void {
  deformer.set(goal.up, Math.max(weight, 0));
  deformer.set(goal.down, Math.max(-weight, 0));
}

function solveGirths(
  deformer: TargetDeformer,
  indices: Uint32Array,
  goals: readonly GirthGoal[],
  stand: () => Float32Array,
): void {
  for (const goal of goals) applyGirth(deformer, goal, goal.weight);
  for (let round = 0; round < GIRTH_ROUNDS; round++) {
    let worst = 0;
    for (const goal of goals) {
      const reached = torsoGirth(stand(), indices, goal.y);
      const error = goal.target - reached;
      worst = Math.max(worst, Math.abs(error));
      if (Math.abs(error) < GIRTH_TOLERANCE) continue;

      const direction = goal.weight > GIRTH_WEIGHT_LIMIT / 2 ? -1 : 1;
      const probe = clamp(goal.weight + direction * GIRTH_PROBE, -GIRTH_WEIGHT_LIMIT, GIRTH_WEIGHT_LIMIT);
      applyGirth(deformer, goal, probe);
      const probed = torsoGirth(stand(), indices, goal.y);
      goal.slope = (probed - reached) / (probe - goal.weight);
      if (Math.abs(goal.slope) > 1e-3) {
        goal.weight = clamp(goal.weight + error / goal.slope, -GIRTH_WEIGHT_LIMIT, GIRTH_WEIGHT_LIMIT);
      }

      applyGirth(deformer, goal, goal.weight);
    }

    if (worst < GIRTH_TOLERANCE) return;
  }
}

function statureScale(deformer: TargetDeformer, targetMeters: number): number {
  const reached = statureOf(deformer.deform());
  return reached > 1e-3 ? targetMeters / reached : 1;
}

function scanBody(index: SectionIndex, height: number): TorsoScan {
  return scanTorso(index, height * SCAN_BOTTOM, height * SCAN_TOP, height);
}

export function bodyKey(params: AvatarParams): string {
  return [
    params.heightCm, params.chestCm, params.waistCm, params.hipCm,
    params.gender ?? 0, params.ageYears ?? 25, params.muscle ?? 0.5,
    params.weight ?? 0.5, params.pose ?? 'a',
  ].join('/');
}

export function makehumanBody(params: AvatarParams): MakehumanBody {
  const key = bodyKey(params);
  const cached = BUILT.get(key);
  if (cached) return cached;
  const body = buildBody(params);
  BUILT.set(key, body);
  if (BUILT.size > BUILT_LIMIT) {
    const oldest = BUILT.keys().next();
    if (!oldest.done) BUILT.delete(oldest.value);
  }

  return body;
}

function buildBody(params: AvatarParams): MakehumanBody {
  const data = makehumanBodyData();
  const deformer = new TargetDeformer(data);
  applyMacrodetails(deformer, params);
  const targetHeight = clamp(params.heightCm, 45, 220) / 100;
  let scale = statureScale(deformer, targetHeight);

  const stand = (): Float32Array => {
    const out = Float32Array.from(deformer.deform(scale));
    const floor = floorOf(out);
    for (let i = 1; i < out.length; i += 3) out[i] -= floor;
    return out;
  };

  const mesh = stand();
  const scanned = scanBody(new SectionIndex(mesh, data.bodyIndices), statureOf(mesh));

  const goals: GirthGoal[] = [
    { up: TARGET.bustUp, down: TARGET.bustDown, y: scanned.landmarks.bustY, target: params.chestCm / 100, weight: 0, slope: 0 },
    { up: TARGET.waistUp, down: TARGET.waistDown, y: scanned.landmarks.waistY, target: params.waistCm / 100, weight: 0, slope: 0 },
    { up: TARGET.hipsUp, down: TARGET.hipsDown, y: scanned.landmarks.hipY, target: params.hipCm / 100, weight: 0, slope: 0 },
  ];

  solveGirths(deformer, data.bodyIndices, goals, stand);
  scale *= targetHeight / Math.max(statureOf(stand()), 1e-3);
  solveGirths(deformer, data.bodyIndices, goals, stand);

  const posture = stand();
  const finalScan = scanBody(new SectionIndex(posture, data.bodyIndices), statureOf(posture));
  const positions = params.pose === 't' ? Float32Array.from(posture) : posture;
  const pivots = shoulderPivots(positions, data);
  if (params.pose === 't') poseArms(positions, data, pivots);
  return {
    positions,
    bodyIndices: data.bodyIndices,
    eyeIndices: data.eyeIndices,
    height: statureOf(positions),
    landmarks: finalScan.landmarks,
    profile: finalScan.profile,
    joints: limbJoints(positions, data),
    shoulderPivots: pivots,
  };
}
