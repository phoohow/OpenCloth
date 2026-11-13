/**
 * Builds the MakeHuman body for a set of measurements.
 *
 * The base mesh carries no anatomy of its own: the shape comes from morph targets, which are
 * vertex offsets packed as Int16 and applied as a weighted sum, exactly as MakeHuman's own
 * macrodetails and measurement modifiers do. The build sliders (gender, age, muscle, weight) pick
 * the corners of MakeHuman's macrodetails grid, stature is solved against the mesh's own bounding
 * box, and the three circumferences are solved by measuring the torso cross-section the pattern is
 * fitted to. The arms are then posed by rotating the vertices their skin weights assign to each
 * arm chain, which is what turns the rest A-pose into a T-pose.
 */

import type { AvatarParams } from '@/model/types';
import { clamp } from '@/base/math';
import { makehumanBodyData, type MakehumanData } from '@/avatar/makehuman/data';
import { SectionIndex, sectionLoops, torsoLoop } from '@/avatar/makehuman/section';
import { scanTorso, type TorsoLandmarks, type TorsoScan, type TorsoSlice } from '@/avatar/makehuman/measure';

/**
 * Landmark heights as a fraction of stature, from the ANSUR II adult medians.
 *
 * Only the landmarks the torso scan cannot find on its own stay here; the hip, waist, bust and
 * armpit heights are measured from the surface.
 */
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

/** A point in meters, axes as x / y / z. */
export type Point3 = [number, number, number];

/** Root, middle and end joint of one limb, measured on the built body. */
export interface LimbJoints {
  root: Point3;
  mid: Point3;
  end: Point3;
}

/** A built body: its surface geometry and the landmarks measured on it. */
export interface MakehumanBody {
  /** Vertex positions in meters, feet on the floor, facing +z, in the requested arm pose. */
  readonly positions: Float32Array;
  readonly bodyIndices: Uint32Array;
  readonly eyeIndices: Uint32Array;
  /** Stature reached by the height solve, in meters. */
  readonly height: number;
  /** Landmarks measured on the finished surface. */
  readonly landmarks: TorsoLandmarks;
  /** Torso cross-sections between the crotch and the shoulder, bottom first. */
  readonly profile: readonly TorsoSlice[];
  /** Limb joints on the finished surface, in the body's final pose. */
  readonly joints: { arms: LimbPair; legs: LimbPair };
}

/** Both sides of a limb pair, keyed by the sign of its x axis. */
export interface LimbPair {
  left: LimbJoints;
  right: LimbJoints;
}

/** Circumference corrections taken before giving up. */
const GIRTH_ROUNDS = 8;
/** Accepted circumference error, in meters. */
const GIRTH_TOLERANCE = 0.0015;
/**
 * Range of one circumference weight. A measurement target is a full-extreme morph for the average
 * build only, so a small or short body needs more than one to reach the same tape measure.
 */
const GIRTH_WEIGHT_LIMIT = 2;
/** Weight step used to read the local slope of a circumference, in the same units. */
const GIRTH_PROBE = 0.02;
/** Height the torso scan starts at, as a fraction of stature. */
const SCAN_BOTTOM = STATURE.crotch;
/** Height the torso scan ends at, as a fraction of stature. */
const SCAN_TOP = 0.83;

/** Applies weighted target rows on top of the rest pose. */
class TargetDeformer {
  private readonly data: MakehumanData;
  private readonly weights: Float32Array;
  private readonly scratch: Float32Array;
  /** Row index of each named target. */
  private readonly rows = new Map<string, number>();

  constructor(data: MakehumanData) {
    this.data = data;
    this.weights = new Float32Array(data.names.length);
    this.scratch = new Float32Array(data.rest.length);
    data.names.forEach((name, row) => this.rows.set(name, row));
  }

  /** Row index of a target name, which must exist in the packed table. */
  row(name: string): number {
    const row = this.rows.get(name);
    if (row === undefined) throw new Error(`unknown MakeHuman target: ${name}`);
    return row;
  }

  /** Sets one target weight; negative values are clamped away. */
  set(name: string, weight: number): void {
    this.weights[this.row(name)] = Math.max(weight, 0);
  }

  /**
   * Renders the weighted sum of the target rows into the shared scratch buffer, times a uniform
   * scale about the ground plane.
   */
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

/** Lowest point of a vertex buffer, in meters. */
function floorOf(positions: ArrayLike<number>): number {
  let min = Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i]!;
    if (y < min) min = y;
  }
  return min;
}

/** Stature of a vertex buffer, in meters. */
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

/** Circumference of the torso at a height, in meters. */
export function torsoGirth(positions: Float32Array, indices: Uint32Array, y: number): number {
  return torsoLoop(sectionLoops(positions, indices, y))?.perimeter ?? 0;
}

/** Target names the build drives, by role. */
const TARGET = {
  bustUp: 'measure/bust-increase',
  bustDown: 'measure/bust-decrease',
  waistUp: 'measure/waist-increase',
  waistDown: 'measure/waist-decrease',
  hipsUp: 'measure/hips-increase',
  hipsDown: 'measure/hips-decrease',
} as const;

/** Corners of MakeHuman's macrodetails grid, in the order the packed rows use. */
const GRID = {
  genders: ['female', 'male'],
  ages: ['baby', 'child', 'young', 'old'],
  muscles: ['minmuscle', 'averagemuscle', 'maxmuscle'],
  weights: ['minweight', 'averageweight', 'maxweight'],
} as const;

/**
 * Weight of the two outer corners of a 3-point slider, as MakeHuman spreads it: the middle corner
 * takes whatever is left, so a slider at 0.5 sits on the average build alone.
 */
function sliderWeights(value: number): [number, number, number] {
  const high = Math.max(0, value * 2 - 1);
  const low = Math.max(0, 1 - value * 2);
  return [low, 1 - high - low, high];
}

/** Years at the four anchor ages of MakeHuman's age slider. */
const AGE_ANCHORS = [1, 10, 25, 90] as const;
/** Slider value MakeHuman's age slider reads at each anchor age. */
const AGE_FACTORS = [0, 0.1875, 0.5, 1] as const;

/** MakeHuman's age slider from a person's age in years: 0 at one year, 0.5 at 25, 1 at 90. */
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

/** Weights of MakeHuman's four age builds at a slider value, summing to one. */
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

/**
 * Sets the macrodetails tables, the figure every measurement is then solved on: the shape of the
 * gender at each age, then the muscle and weight deltas around it.
 */
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

/** Centre of the vertices that ring one joint. */
function jointCentre(positions: ArrayLike<number>, ids: readonly number[]): Point3 {
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

/** Wraps an angle into (-pi, pi]. */
function wrapAngle(angle: number): number {
  let out = angle;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out <= -Math.PI) out += Math.PI * 2;
  return out;
}

/**
 * Rotates each arm chain about its shoulder so the upper arm lies along the target direction.
 * Vertices are turned by their own skin weight, so the armpit keeps a smooth transition while the
 * arm itself stays rigid.
 */
function poseArms(positions: Float32Array, data: MakehumanData): void {
  const sides = [
    { joint: data.joints.leftShoulder, elbow: data.joints.leftElbow, column: 0, sign: Math.sign(jointCentre(positions, data.joints.leftShoulder)[0]) || 1 },
    { joint: data.joints.rightShoulder, elbow: data.joints.rightElbow, column: 1, sign: Math.sign(jointCentre(positions, data.joints.rightShoulder)[0]) || -1 },
  ];
  for (const side of sides) {
    const pivot = jointCentre(positions, side.joint);
    const elbow = jointCentre(positions, side.elbow);
    const current = Math.atan2(elbow[1] - pivot[1], elbow[0] - pivot[0]);
    // A T-pose puts the upper arm on the horizontal axis of its own side.
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

/** Limb joints of a finished body. */
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

/** One circumference the solver drives, with the pair of targets that grows and shrinks it. */
interface GirthGoal {
  key: 'bust' | 'waist' | 'hips';
  up: string;
  down: string;
  /** Height of the landmark on the current body, in meters. */
  y: number;
  /** Requested circumference, in meters. */
  target: number;
  weight: number;
  slope: number;
}

/**
 * Sets the signed weight of one circumference: positive grows it, negative shrinks it, so a single
 * number spans both of the target rows MakeHuman ships for the measurement.
 */
function applyGirth(deformer: TargetDeformer, goal: GirthGoal, weight: number): void {
  deformer.set(goal.up, Math.max(weight, 0));
  deformer.set(goal.down, Math.max(-weight, 0));
}

/** Uniform scale that brings the built shape to the requested stature. */
function statureScale(deformer: TargetDeformer, targetMeters: number): number {
  const reached = statureOf(deformer.deform());
  return reached > 1e-3 ? targetMeters / reached : 1;
}

/** Scans the torso of a body and reads its sizing landmarks. */
function scanBody(index: SectionIndex, height: number): TorsoScan {
  return scanTorso(index, height * SCAN_BOTTOM, height * SCAN_TOP, height);
}

/** Builds kept for reuse; a viewport asks for the same body on every re-render. */
const BUILT = new Map<string, MakehumanBody>();
/** Builds kept before the oldest is dropped. */
const BUILT_LIMIT = 3;

/**
 * Key of a built body, so the caches never reuse a body built for other settings. Callers that
 * memoize anything derived from the body use the same key.
 */
export function bodyKey(params: AvatarParams): string {
  return [
    params.heightCm, params.chestCm, params.waistCm, params.hipCm,
    params.gender ?? 0, params.ageYears ?? 25, params.muscle ?? 0.5,
    params.weight ?? 0.5, params.pose ?? 'a',
  ].join('/');
}

/**
 * Builds the body for these measurements. The result is in meters, grounded at y = 0, facing +z.
 */
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

/** Solves and measures one body from scratch. */
function buildBody(params: AvatarParams): MakehumanBody {
  const data = makehumanBodyData();
  const deformer = new TargetDeformer(data);
  applyMacrodetails(deformer, params);
  const targetHeight = clamp(params.heightCm, 45, 220) / 100;
  // Stature is a uniform scale of the shape: MakeHuman's own height slider scales the figure, and
  // it keeps a child's proportions instead of pulling a limb longer.
  let scale = statureScale(deformer, targetHeight);

  const settled = deformer.deform(scale);
  const settledIndex = new SectionIndex(settled, data.bodyIndices);
  const scanned = scanBody(settledIndex, statureOf(settled));

  const goals: GirthGoal[] = [
    { key: 'bust', up: TARGET.bustUp, down: TARGET.bustDown, y: scanned.landmarks.bustY, target: params.chestCm / 100, weight: 0, slope: 0 },
    { key: 'waist', up: TARGET.waistUp, down: TARGET.waistDown, y: scanned.landmarks.waistY, target: params.waistCm / 100, weight: 0, slope: 0 },
    { key: 'hips', up: TARGET.hipsUp, down: TARGET.hipsDown, y: scanned.landmarks.hipY, target: params.hipCm / 100, weight: 0, slope: 0 },
  ];

  for (let round = 0; round < GIRTH_ROUNDS; round++) {
    let worst = 0;
    for (const goal of goals) {
      const reached = torsoGirth(deformer.deform(scale), data.bodyIndices, goal.y);
      const error = goal.target - reached;
      worst = Math.max(worst, Math.abs(error));
      if (Math.abs(error) < GIRTH_TOLERANCE) continue;

      // Read the local slope with a small step taken away from the weight limit.
      const direction = goal.weight > GIRTH_WEIGHT_LIMIT / 2 ? -1 : 1;
      const probe = clamp(goal.weight + direction * GIRTH_PROBE, -GIRTH_WEIGHT_LIMIT, GIRTH_WEIGHT_LIMIT);
      applyGirth(deformer, goal, probe);
      const probed = torsoGirth(deformer.deform(scale), data.bodyIndices, goal.y);
      goal.slope = (probed - reached) / (probe - goal.weight);
      if (Math.abs(goal.slope) > 1e-3) {
        goal.weight = clamp(goal.weight + error / goal.slope, -GIRTH_WEIGHT_LIMIT, GIRTH_WEIGHT_LIMIT);
      }
      applyGirth(deformer, goal, goal.weight);
    }
    if (worst < GIRTH_TOLERANCE) break;
  }

  // The girth morphs move the crown a little, so the stature is corrected once more.
  scale *= targetHeight / Math.max(statureOf(deformer.deform(scale)), 1e-3);
  const posture = Float32Array.from(deformer.deform(scale));
  // Morphs move the soles, so the body is put back on the floor before anything measures it.
  const floor = floorOf(posture);
  for (let i = 1; i < posture.length; i += 3) posture[i] -= floor;
  // The torso is measured before the arms move: the pose must not change where the waist is.
  const finalScan = scanBody(new SectionIndex(posture, data.bodyIndices), statureOf(posture));
  // The rest mesh is already the A-pose; only the T-pose has to be turned out of it.
  const positions = params.pose === 't' ? Float32Array.from(posture) : posture;
  if (params.pose === 't') poseArms(positions, data);
  return {
    positions,
    bodyIndices: data.bodyIndices,
    eyeIndices: data.eyeIndices,
    height: statureOf(positions),
    landmarks: finalScan.landmarks,
    profile: finalScan.profile,
    joints: limbJoints(positions, data),
  };
}
