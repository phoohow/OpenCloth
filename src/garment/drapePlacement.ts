import type { Panel } from '@/model/types';
import type { PanelMesh } from '@/pattern/panel';

import {
  advanceFrame, frameRef, landmarkY, tubeFrame, type BodyLandmarks, type HeadShape, type LimbShape,
  type LimbSide, type TorsoShape, type TubeShape,
} from '@/avatar';
import {
  add3t, clamp, cross3t, degToRad, distance3t, dot3t, lerp3t, normalize3t, scale3t, sub3t,
  type Vec3Tuple,
} from '@/base/math';
import { resolveWrap, zoneSweep, type ResolvedWrap, type WrapSlot } from '@/garment/wrapPlan';

const ARC_STEP_DEG = 2;

interface PanelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface SectionArc {
  angles: Float32Array;
  arcs: Float32Array;
}

interface SurfaceSection {
  centre: Vec3Tuple;
  cosDir: Vec3Tuple;
  sinDir: Vec3Tuple;
  rSin: number;
  rCos: number;
}

interface WrapSurface {
  thetaAt(distance: number, depth: number): number;
  sectionAt(depth: number): SurfaceSection;
}

interface PathSample {
  point: Vec3Tuple;
  tangent: Vec3Tuple;
  cosDir: Vec3Tuple;
  sinDir: Vec3Tuple;
  radius: number;
}

function boundsOf(mesh: PanelMesh): PanelBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions2D[i * 2]!;
    const y = mesh.positions2D[i * 2 + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { minX, maxX, minY, maxY };
}

function anchorHeight(panel: Panel, body: BodyLandmarks): number {
  const wrap = resolveWrap(panel);
  if (wrap.region === 'head') {
    const head = body.bodyShapes().find(shape => shape.kind === 'ellipsoid');
    if (head) return head.centre[1] + head.radii[1];
  }

  return landmarkY(body, wrap.anchor) + wrap.anchorOffsetCm * 0.01;
}

export function drapeHeightOffsetCm(panel: Panel, maxYCm: number, body: BodyLandmarks): number {
  return anchorHeight(panel, body) * 100 - maxYCm;
}

function sectionArcs(rSin: number, rCos: number, startRad: number, sweepDeg: number): SectionArc {
  const steps = Math.max(8, Math.ceil(Math.abs(sweepDeg) / ARC_STEP_DEG));
  const stepRad = degToRad(sweepDeg) / steps;
  const angles = new Float32Array(steps + 1);
  const arcs = new Float32Array(steps + 1);
  angles[0] = startRad;
  let lastX = rSin * Math.sin(startRad);
  let lastZ = rCos * Math.cos(startRad);
  for (let i = 1; i <= steps; i++) {
    angles[i] = startRad + stepRad * i;
    const x = rSin * Math.sin(angles[i]!);
    const z = rCos * Math.cos(angles[i]!);
    arcs[i] = arcs[i - 1]! + Math.hypot(x - lastX, z - lastZ);
    lastX = x;
    lastZ = z;
  }

  return { angles, arcs };
}

function angleAtArc({ angles, arcs }: SectionArc, distance: number): number {
  const last = arcs.length - 1;
  if (distance <= 0) return angles[0]!;
  if (distance >= arcs[last]!) return angles[last]!;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arcs[mid]! < distance) lo = mid; else hi = mid;
  }

  const span = arcs[hi]! - arcs[lo]!;
  const t = span > 1e-9 ? (distance - arcs[lo]!) / span : 0;
  return angles[lo]! + (angles[hi]! - angles[lo]!) * t;
}

function arcAtAngle({ angles, arcs }: SectionArc, angle: number): number {
  const last = angles.length - 1;
  const turn = angles[last]! - angles[0]!;
  const step = turn / last || 1e-6;
  const wrapped = ((angle - angles[0]!) % turn + turn) % turn;
  const index = Math.min(last - 1e-6, wrapped / step);
  const lo = Math.floor(index);
  return arcs[lo]! + (arcs[lo + 1]! - arcs[lo]!) * (index - lo);
}

function wrapArc(value: number, perimeter: number): number {
  return ((value % perimeter) + perimeter) % perimeter;
}

function cylinderSurface(
  rSin: number, rCos: number,
  centreAt: (depth: number) => Vec3Tuple,
  cosDir: Vec3Tuple, sinDir: Vec3Tuple,
  slot: WrapSlot, direction: number,
): WrapSurface {
  const full = sectionArcs(Math.max(rSin, 1e-4), Math.max(rCos, 1e-4), 0, 360);
  const perimeter = full.arcs[full.arcs.length - 1]!;
  const centreArc = arcAtAngle(full, slot.startRad + slot.sweepRad / 2);
  return {
    thetaAt: distance => angleAtArc(full, wrapArc(centreArc + direction * distance, perimeter)),
    sectionAt: depth => ({
      centre: centreAt(depth), cosDir, sinDir, rSin, rCos,
    }),
  };
}

function torsoSurface(
  torso: TorsoShape, topY: number, slot: WrapSlot, direction: number,
): WrapSurface {
  return cylinderSurface(
    torso.rx, torso.rz,
    depth => [torso.centreX, topY - depth, torso.centreZ],
    [0, 0, 1], [1, 0, 0], slot, direction,
  );
}

function neckSurface(
  neck: TubeShape, topY: number, slot: WrapSlot, direction: number,
): WrapSurface {
  return cylinderSurface(
    neck.fromR, neck.fromR,
    depth => [0, topY - depth, neck.from[2]],
    [0, 0, 1], [1, 0, 0], slot, direction,
  );
}

function limbSurface(
  limb: LimbShape, anchorY: number, downCm: number,
  slot: WrapSlot, direction: number,
): WrapSurface {
  const path = limb.path;
  const lengths: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1]! + distance3t(path[i - 1]!, path[i]!));
  }

  const total = lengths[lengths.length - 1]!;
  const tangentAt = (i: number): Vec3Tuple => {
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(path.length - 1, i + 1)]!;
    return normalize3t(sub3t(b, a));
  };

  const samples: PathSample[] = [];
  let frame = tubeFrame(tangentAt(0), frameRef(tangentAt(0)));
  for (let i = 0; i < path.length; i++) {
    const tangent = tangentAt(i);
    frame = advanceFrame(frame, tangent);
    samples.push({
      point: path[i]!,
      tangent,
      cosDir: frame.u,
      sinDir: frame.v,
      radius: limb.radii[i]!,
    });
  }

  const rootTangent = samples[0]!.tangent;
  const landmarkAlong = Math.abs(rootTangent[1]) > 0.2
    ? (anchorY - samples[0]!.point[1]) / rootTangent[1]
    : 0;
  const startArc = landmarkAlong + downCm;
  const centreAngle = slot.startRad + slot.sweepRad / 2;

  const sectionAt = (depth: number): SurfaceSection => {
    const arc = startArc + depth;
    if (arc <= 0) {
      const sample = samples[0]!;
      return {
        centre: add3t(sample.point, scale3t(sample.tangent, arc)),
        cosDir: sample.cosDir, sinDir: sample.sinDir,
        rSin: sample.radius, rCos: sample.radius,
      };
    }

    if (arc >= total) {
      const sample = samples[samples.length - 1]!;
      return {
        centre: add3t(sample.point, scale3t(sample.tangent, arc - total)),
        cosDir: sample.cosDir, sinDir: sample.sinDir,
        rSin: sample.radius, rCos: sample.radius,
      };
    }

    let lo = 0;
    let hi = lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid]! < arc) lo = mid; else hi = mid;
    }

    const span = lengths[hi]! - lengths[lo]!;
    const t = span > 1e-9 ? (arc - lengths[lo]!) / span : 0;
    const a = samples[lo]!;
    const b = samples[hi]!;
    const tangent = normalize3t(lerp3t(a.tangent, b.tangent, t));
    const blended = lerp3t(a.cosDir, b.cosDir, t);
    const u = normalize3t(sub3t(blended, scale3t(tangent, dot3t(tangent, blended))));
    const radius = a.radius + (b.radius - a.radius) * t;
    return {
      centre: lerp3t(a.point, b.point, t),
      cosDir: u,
      sinDir: cross3t(tangent, u),
      rSin: radius,
      rCos: radius,
    };
  };

  return {
    thetaAt: (distance, depth) =>
      centreAngle + direction * distance / Math.max(sectionAt(depth).rSin, 0.005),
    sectionAt,
  };
}

function headSurface(
  head: HeadShape, body: BodyLandmarks, panelHeight: number,
  slot: WrapSlot, direction: number,
): WrapSurface {
  const [cx, cy, cz] = head.centre;
  const [rx, ry, rz] = head.radii;
  const full = sectionArcs(Math.max(rx, 1e-4), Math.max(rz, 1e-4), 0, 360);
  const perimeter = full.arcs[full.arcs.length - 1]!;
  const centreArc = arcAtAngle(full, slot.startRad + slot.sweepRad / 2);
  const sinMin = clamp((body.neckTopY - cy) / Math.max(ry, 1e-4), -0.999, 0);
  const cosBottom = Math.min(
    clamp(body.neckR / Math.max(Math.min(rx, rz), 1e-4), 0.05, 0.999),
    Math.sqrt(1 - sinMin * sinMin),
  );
  const sinBottom = -Math.sqrt(1 - cosBottom * cosBottom);
  const height = Math.max(panelHeight, 1e-4);
  return {
    thetaAt: distance => angleAtArc(full, wrapArc(centreArc + direction * distance, perimeter)),
    sectionAt: (depth) => {
      const v = clamp(depth / height, 0, 1);
      const sinPhi = 1 - v * (1 - sinBottom);
      const cosPhi = Math.sqrt(Math.max(0, 1 - sinPhi * sinPhi));
      return {
        centre: [cx, cy + ry * sinPhi, cz],
        cosDir: [0, 0, 1],
        sinDir: [1, 0, 0],
        rSin: rx * cosPhi,
        rCos: rz * cosPhi,
      };
    },
  };
}

function surfaceFor(
  wrap: ResolvedWrap,
  body: BodyLandmarks,
  slot: WrapSlot,
  topY: number,
  panelHeight: number,
): WrapSurface {
  const shapes = body.bodyShapes();
  const direction = (Math.sign(slot.sweepRad) || 1) * (wrap.flip ? -1 : 1);
  if (wrap.region === 'arm' || wrap.region === 'leg') {
    const side: LimbSide = wrap.side === 'left' ? -1 : 1;
    const limb = shapes.find((shape): shape is LimbShape =>
      shape.kind === 'limb' && shape.side === side && shape.part === wrap.region);
    if (limb) {
      return limbSurface(limb, topY - wrap.anchorOffsetCm * 0.01, -wrap.anchorOffsetCm * 0.01,
        slot, direction);
    }
  }

  if (wrap.region === 'head') {
    const head = shapes.find((shape): shape is HeadShape => shape.kind === 'ellipsoid');
    if (head) return headSurface(head, body, panelHeight, slot, direction);
  }

  if (wrap.region === 'neck') {
    const neck = shapes.find((shape): shape is TubeShape => shape.kind === 'tube' && shape.part === 'neck');
    if (neck) return neckSurface(neck, topY, slot, direction);
  }

  const torso = shapes.find((shape): shape is TorsoShape => shape.kind === 'torso')!;
  return torsoSurface(torso, topY, slot, direction);
}

export function drapePositions(
  mesh: PanelMesh,
  panel: Panel,
  body: BodyLandmarks,
  slotOverride?: WrapSlot,
): Float32Array {
  const wrap = resolveWrap(panel);
  const bounds = boundsOf(mesh);
  const slot = slotOverride ?? zoneSweep(wrap.region, wrap.zone);
  const topY = anchorHeight(panel, body);
  const panelHeight = Math.max((bounds.maxY - bounds.minY) * 0.01, 1e-4);
  const surface = surfaceFor(wrap, body, slot, topY, panelHeight);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const out = new Float32Array(mesh.vertexCount * 3);

  for (let i = 0; i < mesh.vertexCount; i++) {
    const depth = (bounds.maxY - mesh.positions2D[i * 2 + 1]!) * 0.01;
    const distance = (mesh.positions2D[i * 2]! - midX) * 0.01;
    const theta = surface.thetaAt(distance, depth);
    const section = surface.sectionAt(depth);
    const s = section.rSin * Math.sin(theta);
    const c = section.rCos * Math.cos(theta);
    out[i * 3] = section.centre[0] + section.sinDir[0] * s + section.cosDir[0] * c;
    out[i * 3 + 1] = section.centre[1] + section.sinDir[1] * s + section.cosDir[1] * c;
    out[i * 3 + 2] = section.centre[2] + section.sinDir[2] * s + section.cosDir[2] * c;
  }

  return out;
}

export function drapeReversesWinding(panel: Panel, slot?: WrapSlot): boolean {
  const scale = panel.transform?.scale;
  const scaleSign = scale && scale.x * scale.y * scale.z < 0 ? -1 : 1;
  if (panel.placement || !panel.drape) return scaleSign < 0;
  const wrap = resolveWrap(panel);
  const range = slot ?? zoneSweep(wrap.region, wrap.zone);
  const sweepSign = (Math.sign(range.sweepRad) || 1) * (wrap.flip ? -1 : 1);
  const wrapSign = wrap.region === 'torso' || wrap.region === 'head' ? sweepSign : -sweepSign;
  return wrapSign * scaleSign < 0;
}
