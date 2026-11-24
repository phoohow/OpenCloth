import type { MakehumanBody } from '@/avatar/makehuman/body';

import { CLOTH_CLEARANCE, type LimbSide } from '@/avatar/envelope';
import { outlinePoints, type GirthLine } from '@/avatar/girthLines';
import { planeLoops } from '@/avatar/makehuman/section';
import { tubeFrame } from '@/avatar/tubeFrame';
import {
  add3t, distance3t, dot3t, length3t, midpoint3t, normalize3t, scale3t, sub3t,
  type Vec3Tuple,
} from '@/base/math';

const HEAD_CLEARANCE = 0.005;

const HEAD_ROUNDING = 0.35;

const JOINT_OVERLAP = 0.02;

const NECK_BASE_COVER = 0.02;

const PELVIS_COVER = 0.04;

const LIMB_STEP = 0.02;

const LIMB_TIP_COVER = 0.02;

const BONE_STATIONS = [0.2, 0.45, 0.7, 0.95];

const LIMB_SECTION_LIMIT = 0.12;

const LIMB_MIN_RADIUS = 0.02;

export interface SimplifiedBodySource {
  crotchY: number;
  shoulderTopY: number;
  torsoTop: number;
  neckTopY: number;
  neckR: number;
  ankleY: number;
  torsoEnvelopeAt(): { rx: number; rz: number; centre(y: number): Vec3Tuple };
  bodyGirthLines(): readonly GirthLine[];
  armChain(side: LimbSide): { root: Vec3Tuple; mid: Vec3Tuple; end: Vec3Tuple };
  legChain(side: LimbSide): { root: Vec3Tuple; mid: Vec3Tuple; end: Vec3Tuple };
}

export type SimplifiedPart =
  | 'head' | 'neck' | 'torso' | 'arm' | 'leg' | 'foot';

interface ShapeBase {
  part: SimplifiedPart;
  side: LimbSide | 0;
}

export interface HeadShape extends ShapeBase {
  kind: 'ellipsoid';
  centre: Vec3Tuple;
  radii: Vec3Tuple;
}

export interface TubeShape extends ShapeBase {
  kind: 'tube';
  from: Vec3Tuple;
  to: Vec3Tuple;
  fromR: number;
  toR: number;
}

export interface LimbShape extends ShapeBase {
  kind: 'limb';
  part: 'arm' | 'leg';
  path: Vec3Tuple[];
  radii: number[];
}

export interface TorsoShape extends ShapeBase {
  kind: 'torso';
  centreX: number;
  centreZ: number;
  bottomY: number;
  topY: number;
  rx: number;
  rz: number;
}

export interface BoxShape extends ShapeBase {
  kind: 'box';
  min: Vec3Tuple;
  max: Vec3Tuple;
}

export type SimplifiedShape = HeadShape | TubeShape | LimbShape | TorsoShape | BoxShape;

function boundsOf(
  positions: Float32Array,
  accept: (x: number, y: number, z: number) => boolean,
): { min: Vec3Tuple; max: Vec3Tuple } | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (let i = 0; i * 3 < positions.length; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    if (!accept(x, y, z)) continue;
    found = true;
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }

  return found ? { min, max } : null;
}

function extendTube(
  from: Vec3Tuple, to: Vec3Tuple, fromR: number, toR: number, overlap: number,
): { from: Vec3Tuple; to: Vec3Tuple; fromR: number; toR: number } {
  const span = sub3t(to, from);
  const k = overlap / (length3t(span) || 1);
  return {
    from: sub3t(from, scale3t(span, k)),
    to: add3t(to, scale3t(span, k)),
    fromR,
    toR,
  };
}

function boneRadii(
  positions: Float32Array, indices: Uint32Array,
  from: Vec3Tuple, to: Vec3Tuple,
): number[] {
  const axis = normalize3t(sub3t(to, from));
  const { u, v } = tubeFrame(axis);
  const length = distance3t(from, to);
  return BONE_STATIONS.map(fraction => {
    const origin = add3t(from, scale3t(axis, fraction * length));
    let radius = 0;
    for (const loop of planeLoops(positions, indices, origin, u, v)) {
      const girth = loop.perimeter / (2 * Math.PI);
      if (girth > LIMB_SECTION_LIMIT) continue;
      if (Math.hypot(loop.centerX, loop.centerZ) > LIMB_SECTION_LIMIT) continue;
      radius = Math.max(radius, girth);
    }

    return radius;
  });
}

function lineRadius(line: GirthLine): number {
  let radius = 0;
  for (const point of outlinePoints(line)) radius = Math.max(radius, distance3t(point, line.centre));
  return radius;
}

function lineAgainstRun(
  line: GirthLine, from: Vec3Tuple, to: Vec3Tuple,
): { along: number; reach: number } {
  const span = sub3t(to, from);
  const length = length3t(span) || 1e-6;
  const axis = scale3t(span, 1 / length);
  const across = sub3t(line.centre, from);
  const along = dot3t(across, axis);
  const perp = length3t(sub3t(across, scale3t(axis, along)));
  return {
    along: Math.min(1, Math.max(0, along / length)),
    reach: perp + lineRadius(line),
  };
}

function limbProxy(
  chain: { root: Vec3Tuple; mid: Vec3Tuple; end: Vec3Tuple },
  upper: readonly GirthLine[],
  lower: readonly GirthLine[],
  girth: { wideR: number; jointR: number },
): { path: Vec3Tuple[]; radii: number[] } {
  const jointLine = upper[upper.length - 1];
  const jointReach = jointLine
    ? Math.max(
      lineAgainstRun(jointLine, chain.root, chain.mid).reach,
      lineAgainstRun(jointLine, chain.mid, chain.end).reach,
    )
    : 0;
  const lowerReach = lower.length === 0
    ? 0
    : Math.max(...lower.map(line => lineAgainstRun(line, chain.mid, chain.end).reach));
  const jointRaw = Math.max(jointReach, lowerReach, girth.jointR);
  const upperReach = upper.length === 0
    ? 0
    : Math.max(...upper.slice(0, -1).map(line => lineAgainstRun(line, chain.root, chain.mid).reach));
  const wideRaw = Math.max(upperReach, jointRaw, girth.wideR);
  const jointR = jointRaw + CLOTH_CLEARANCE;
  const wideR = wideRaw + CLOTH_CLEARANCE;

  const upperAxis = normalize3t(sub3t(chain.mid, chain.root));
  const lowerAxis = normalize3t(sub3t(chain.end, chain.mid));
  const upperLength = distance3t(chain.root, chain.mid) || 1e-6;
  const root = add3t(chain.root, scale3t(upperAxis, -JOINT_OVERLAP));
  const tip = add3t(chain.end, scale3t(lowerAxis, LIMB_TIP_COVER));
  const rootR = wideR + (wideR - jointR) * (JOINT_OVERLAP / upperLength);

  const path: Vec3Tuple[] = [];
  const radii: number[] = [];
  sampleRun(path, radii, root, chain.mid, rootR, jointR);
  sampleRun(path, radii, chain.mid, tip, jointR, jointR);
  return { path, radii };
}

function sampleRun(
  path: Vec3Tuple[], radii: number[],
  from: Vec3Tuple, to: Vec3Tuple, fromR: number, toR: number,
): void {
  const spans = Math.max(1, Math.ceil(distance3t(from, to) / LIMB_STEP));
  for (let i = path.length === 0 ? 0 : 1; i <= spans; i++) {
    const t = i / spans;
    path.push([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ]);
    radii.push(fromR + (toR - fromR) * t);
  }
}

export function simplifiedBodyShapes(
  body: MakehumanBody,
  landmarks: SimplifiedBodySource,
): SimplifiedShape[] {
  const shapes: SimplifiedShape[] = [];
  const torso = landmarks.torsoEnvelopeAt();
  const torsoCentre = torso.centre(0);

  const headPoints: Vec3Tuple[] = [];
  for (let i = 0; i * 3 < body.positions.length; i++) {
    const x = body.positions[i * 3]!;
    const y = body.positions[i * 3 + 1]!;
    const z = body.positions[i * 3 + 2]!;
    if (y <= landmarks.neckTopY) continue;
    if (y <= landmarks.neckTopY + JOINT_OVERLAP
      && z <= torsoCentre[2] + landmarks.neckR * 0.5) continue;
    headPoints.push([x, y, z]);
  }

  if (headPoints.length > 0) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const p of headPoints) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, p[a]!);
        max[a] = Math.max(max[a]!, p[a]!);
      }
    }

    const centre = midpoint3t(min, max);
    const half: Vec3Tuple = [
      Math.max((max[0] - min[0]) / 2, 0.01),
      Math.max((max[1] - min[1]) / 2, 0.01),
      Math.max((max[2] - min[2]) / 2, 0.01),
    ];
    const longest = Math.max(...half);
    const inflate = 1.08;
    const radius = (a: number) =>
      (half[a]! + (longest - half[a]!) * HEAD_ROUNDING) * inflate + HEAD_CLEARANCE;
    shapes.push({
      kind: 'ellipsoid',
      part: 'head',
      side: 0,
      centre,
      radii: [radius(0), radius(1), radius(2)],
    });
  }

  shapes.push({
    kind: 'tube',
    part: 'neck',
    side: 0,
    ...extendTube(
      [0, landmarks.torsoTop, torsoCentre[2]],
      [0, landmarks.neckTopY, torsoCentre[2]],
      landmarks.neckR, landmarks.neckR,
      JOINT_OVERLAP,
    ),
  });

  shapes.push({
    kind: 'torso',
    part: 'torso',
    side: 0,
    centreX: 0,
    centreZ: torsoCentre[2],
    bottomY: landmarks.crotchY - PELVIS_COVER,
    topY: landmarks.shoulderTopY + NECK_BASE_COVER,
    rx: torso.rx,
    rz: torso.rz,
  });

  const lines = landmarks.bodyGirthLines();
  const lineOf = (part: 'biceps' | 'elbow' | 'wrist' | 'thigh' | 'knee' | 'calf' | 'ankle') =>
    lines.find(line => line.part === part && line.side === 1);
  for (const [part, chainOf, upperParts, lowerParts] of [
    ['arm', landmarks.armChain, ['biceps', 'elbow'], ['wrist']],
    ['leg', landmarks.legChain, ['thigh', 'knee'], ['calf', 'ankle']],
  ] as const) {
    const chain = chainOf(1);
    const upper = upperParts.map(lineOf).filter((line): line is GirthLine => line !== undefined);
    const lower = lowerParts.map(lineOf).filter((line): line is GirthLine => line !== undefined);
    const upperGirths = boneRadii(body.positions, body.bodyIndices, chain.root, chain.mid);
    const lowerGirths = boneRadii(body.positions, body.bodyIndices, chain.mid, chain.end);
    const jointGirth = Math.max(upperGirths[upperGirths.length - 1]!, ...lowerGirths, LIMB_MIN_RADIUS);
    const proxy = limbProxy(chain, upper, lower,
      { wideR: Math.max(...upperGirths, jointGirth), jointR: jointGirth });
    if (proxy.path.length === 0) continue;
    for (const side of [-1, 1] as LimbSide[]) {
      shapes.push({
        kind: 'limb',
        part,
        side,
        path: proxy.path.map(point => (side > 0
          ? point
          : [-point[0], point[1], point[2]] as Vec3Tuple)),
        radii: proxy.radii,
      });
    }
  }

  for (const side of [-1, 1] as LimbSide[]) {
    const foot = boundsOf(body.positions, (x, y) =>
      y <= landmarks.ankleY + 0.02 && side * x > 0.02);
    if (foot) {
      shapes.push({
        kind: 'box',
        part: 'foot',
        side,
        min: foot.min,
        max: [foot.max[0], Math.max(foot.max[1], landmarks.ankleY + 0.02), foot.max[2]],
      });
    }
  }

  return shapes;
}

export function simplifiedDepth(shape: SimplifiedShape, point: Vec3Tuple): number {
  switch (shape.kind) {
    case 'ellipsoid': {
      const q = Math.sqrt(
        ((point[0] - shape.centre[0]) / shape.radii[0]) ** 2
        + ((point[1] - shape.centre[1]) / shape.radii[1]) ** 2
        + ((point[2] - shape.centre[2]) / shape.radii[2]) ** 2,
      );
      return (1 - q) * Math.min(...shape.radii);
    }
    case 'torso': {
      if (point[1] < shape.bottomY || point[1] > shape.topY) return -1;
      const q = Math.sqrt(
        ((point[0] - shape.centreX) / shape.rx) ** 2
        + ((point[2] - shape.centreZ) / shape.rz) ** 2,
      );
      return (1 - q) * Math.min(shape.rx, shape.rz);
    }
    case 'box': {
      const inside = point[0] >= shape.min[0] && point[0] <= shape.max[0]
        && point[1] >= shape.min[1] && point[1] <= shape.max[1]
        && point[2] >= shape.min[2] && point[2] <= shape.max[2];
      if (!inside) return -1;
      return Math.min(
        point[0] - shape.min[0], shape.max[0] - point[0],
        point[1] - shape.min[1], shape.max[1] - point[1],
        point[2] - shape.min[2], shape.max[2] - point[2],
      );
    }
    case 'limb': {
      let best = -1;
      for (let i = 1; i < shape.path.length; i++) {
        const a = shape.path[i - 1]!;
        const b = shape.path[i]!;
        const span = sub3t(b, a);
        const lengthSq = dot3t(span, span);
        if (lengthSq < 1e-12) continue;
        const t = dot3t(sub3t(point, a), span) / lengthSq;
        if ((i === 1 && t < 0) || (i === shape.path.length - 1 && t > 1)) continue;
        const clamped = Math.min(1, Math.max(0, t));
        const centre = add3t(a, scale3t(span, clamped));
        const radius = shape.radii[i - 1]! + (shape.radii[i]! - shape.radii[i - 1]!) * clamped;
        best = Math.max(best, radius - distance3t(point, centre));
      }

      return best;
    }
    case 'tube': {
      const axis = sub3t(shape.to, shape.from);
      const lengthSq = dot3t(axis, axis);
      if (lengthSq < 1e-12) return -1;
      const t = dot3t(sub3t(point, shape.from), axis) / lengthSq;
      if (t < 0 || t > 1) return -1;
      const centre = add3t(shape.from, scale3t(axis, t));
      return (shape.fromR + (shape.toR - shape.fromR) * t) - distance3t(point, centre);
    }
  }
}
