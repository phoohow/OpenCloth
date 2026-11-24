import type { LimbSide } from '@/avatar/envelope';
import type { LimbJoints, MakehumanBody } from '@/avatar/makehuman/body';

import { planeLoops, SectionIndex, torsoLoop, type SectionLoop } from '@/avatar/makehuman/section';
import { tubeFrame } from '@/avatar/tubeFrame';
import { offsetPolyline, signedPolygonArea } from '@/base/geom';
import {
  add3t, midpoint3t, normalize3t, scale3t, sub3t, type Vec2, type Vec3Tuple,
} from '@/base/math';

const CALF_STATION = 0.35;

const ANKLE_LIFT = 0.03;

const LINE_STATIONS = 160;

const LINE_LIFT = 0.0014;

const ACROMION_DROP = 0.01;

const NECK_TOP_SHARE = 0.25;

const NECK_SCAN_STEP = 0.005;

const STATION_REACH = 0.1;

const ARMHOLE_ROOM = 0.04;

const ARMHOLE_REACH = 0.04;

const ARMHOLE_STEPS = 4;

const ARMHOLE_MIN_SPAN = 0.5;

const ARMHOLE_MAX_SPAN = 1.6;

export type GirthLinePart =
  | 'neck' | 'bust' | 'waist' | 'hip'
  | 'shoulder' | 'armhole' | 'biceps' | 'elbow' | 'wrist'
  | 'thigh' | 'knee' | 'calf' | 'ankle';

export interface GirthLine {
  part: GirthLinePart;
  side: LimbSide | 0;
  centre: Vec3Tuple;
  u: Vec3Tuple;
  v: Vec3Tuple;
  rx: number;
  rz: number;
  outline: readonly Vec2[];
  girth: number;
}

export interface GirthLineSource {
  neckTopY: number;
  bustY: number;
  waistY: number;
  hipY: number;
  shoulderTopY: number;
  shoulderHalfW: number;
  shoulderY: number;
  armpitY: number;
  armChain(side: LimbSide): LimbJoints;
  legChain(side: LimbSide): LimbJoints;
}

interface SectionEllipse {
  readonly cx: number;
  readonly cz: number;
  readonly angle: number;
  readonly rx: number;
  readonly rz: number;
}

function ellipseOfSection(loop: SectionLoop): SectionEllipse {
  const count = loop.points.length / 2;
  const { centerX: cx, centerZ: cz } = loop;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (let i = 0; i < count; i++) {
    const dx = loop.points[i * 2]! - cx;
    const dz = loop.points[i * 2 + 1]! - cz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }

  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);

  let rx = 0;
  let rz = 0;
  for (let i = 0; i < count; i++) {
    const dx = loop.points[i * 2]! - cx;
    const dz = loop.points[i * 2 + 1]! - cz;
    rx = Math.max(rx, Math.abs(dx * ux + dz * uz));
    rz = Math.max(rz, Math.abs(-dx * uz + dz * ux));
  }

  if (rx < 1e-6 || rz < 1e-6) return { cx, cz, angle, rx: 1e-6, rz: 1e-6 };
  return { cx, cz, angle, rx, rz };
}

function loopPoints(loop: SectionLoop): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < loop.points.length; i += 2) {
    points.push({ x: loop.points[i]!, y: loop.points[i + 1]! });
  }

  return points;
}

function resampleClosed(points: readonly Vec2[], count: number): Vec2[] {
  const spans: number[] = [];
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    spans.push(Math.hypot(b.x - a.x, b.y - a.y));
    perimeter += spans[i]!;
  }

  if (perimeter < 1e-9) return points.map(point => ({ ...point }));
  const out: Vec2[] = [];
  let span = 0;
  let walked = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * perimeter;
    while (span < points.length - 1 && walked + spans[span]! < target) {
      walked += spans[span]!;
      span++;
    }

    const a = points[span]!;
    const b = points[(span + 1) % points.length]!;
    const t = spans[span]! > 1e-9 ? (target - walked) / spans[span]! : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }

  return out;
}

function outlineOfLoop(loop: SectionLoop): Vec2[] {
  const points = loopPoints(loop);
  if (points.length < 3) return points;
  const outward = signedPolygonArea(points) > 0 ? LINE_LIFT : -LINE_LIFT;
  return resampleClosed(offsetPolyline(points, outward), LINE_STATIONS);
}

export function outlinePoints(line: GirthLine): Vec3Tuple[] {
  return line.outline.map(point => add3t(
    line.centre,
    add3t(scale3t(line.u, point.x), scale3t(line.v, point.y)),
  ));
}

function girthLineOfLoop(
  loop: SectionLoop,
  part: GirthLinePart,
  side: LimbSide | 0,
  origin: Vec3Tuple,
  u: Vec3Tuple,
  v: Vec3Tuple,
): GirthLine {
  const ellipse = ellipseOfSection(loop);
  const ex = Math.cos(ellipse.angle);
  const ez = Math.sin(ellipse.angle);
  const first = normalize3t(add3t(scale3t(u, ex), scale3t(v, ez)));
  const second = normalize3t(add3t(scale3t(u, -ez), scale3t(v, ex)));
  const outline = outlineOfLoop(loop).map((point) => {
    const dx = point.x - ellipse.cx;
    const dz = point.y - ellipse.cz;
    return { x: dx * ex + dz * ez, y: dx * -ez + dz * ex };
  });
  return {
    part,
    side,
    centre: add3t(origin, add3t(scale3t(u, ellipse.cx), scale3t(v, ellipse.cz))),
    u: first,
    v: second,
    rx: ellipse.rx,
    rz: ellipse.rz,
    outline,
    girth: loop.perimeter,
  };
}

function loopAtStation(loops: readonly SectionLoop[]): SectionLoop | undefined {
  let best: SectionLoop | undefined;
  let bestDistance = Infinity;
  for (const loop of loops) {
    const distance = Math.hypot(loop.centerX, loop.centerZ);
    if (distance > STATION_REACH || distance >= bestDistance) continue;
    bestDistance = distance;
    best = loop;
  }

  return best;
}

export function girthLines(body: MakehumanBody, source: GirthLineSource): GirthLine[] {
  const index = new SectionIndex(body.positions, body.bodyIndices);
  const lines: GirthLine[] = [];

  const neckAt = (): void => {
    const top = source.neckTopY - (source.neckTopY - source.shoulderTopY) * NECK_TOP_SHARE;
    let best: SectionLoop | null = null;
    let bestY = 0;
    for (let y = top; y >= source.shoulderTopY; y -= NECK_SCAN_STEP) {
      const loop = torsoLoop(index.loops(y));
      if (!loop) continue;
      if (best && loop.perimeter >= best.perimeter) continue;
      best = loop;
      bestY = y;
    }

    if (best) lines.push(girthLineOfLoop(best, 'neck', 0, [0, bestY, 0], [1, 0, 0], [0, 0, 1]));
  };
  const torsoAt = (part: GirthLinePart, y: number): void => {
    const loop = torsoLoop(index.loops(y));
    if (loop) lines.push(girthLineOfLoop(loop, part, 0, [0, y, 0], [1, 0, 0], [0, 0, 1]));
  };
  const limbAt = (part: GirthLinePart, side: LimbSide, origin: Vec3Tuple, axis: Vec3Tuple): void => {
    const { u, v } = tubeFrame(axis);
    const loop = loopAtStation(planeLoops(body.positions, body.bodyIndices, origin, u, v));
    if (!loop) return;
    lines.push(girthLineOfLoop(loop, part, side, origin, u, v));
  };
  const armholeAt = (side: LimbSide, arm: LimbJoints): void => {
    const height = source.shoulderTopY - source.armpitY;
    const { u, v } = tubeFrame([1, 0, 0]);
    for (let step = 0; step <= ARMHOLE_STEPS; step++) {
      const x = side * (source.shoulderHalfW + (step / ARMHOLE_STEPS) * ARMHOLE_REACH);
      const origin: Vec3Tuple = [x, source.shoulderY, arm.root[2]!];
      const loop = loopAtStation(planeLoops(body.positions, body.bodyIndices, origin, u, v));
      if (!loop) continue;
      const heights = [loop.minX, loop.maxX].map(a => origin[1] + u[1] * a);
      const lowest = Math.min(...heights);
      const span = Math.max(...heights) - lowest;
      const fits = lowest >= source.armpitY - ARMHOLE_ROOM
        && span >= height * ARMHOLE_MIN_SPAN && span <= height * ARMHOLE_MAX_SPAN;
      if (!fits) continue;
      lines.push(girthLineOfLoop(loop, 'armhole', side, origin, u, v));
      return;
    }
  };

  neckAt();
  torsoAt('shoulder', source.shoulderTopY - ACROMION_DROP);
  torsoAt('bust', source.bustY);
  torsoAt('waist', source.waistY);
  torsoAt('hip', source.hipY);

  for (const side of [-1, 1] as LimbSide[]) {
    const arm = source.armChain(side);
    const leg = source.legChain(side);
    const upperArm = normalize3t(sub3t(arm.mid, arm.root));
    const foreArm = normalize3t(sub3t(arm.end, arm.mid));
    const thigh = normalize3t(sub3t(leg.mid, leg.root));
    const shin = normalize3t(sub3t(leg.end, leg.mid));
    const elbow = normalize3t(add3t(upperArm, foreArm));
    const knee = normalize3t(add3t(thigh, shin));

    armholeAt(side, arm);

    limbAt('biceps', side, midpoint3t(arm.root, arm.mid), upperArm);
    limbAt('elbow', side, arm.mid, elbow);
    limbAt('wrist', side, arm.end, foreArm);
    limbAt('thigh', side, midpoint3t(leg.root, leg.mid), thigh);
    limbAt('knee', side, leg.mid, knee);
    limbAt('calf', side, add3t(leg.mid, scale3t(sub3t(leg.end, leg.mid), CALF_STATION)), shin);
    limbAt('ankle', side, add3t(leg.end, scale3t(shin, -ANKLE_LIFT)), shin);
  }

  return lines;
}
