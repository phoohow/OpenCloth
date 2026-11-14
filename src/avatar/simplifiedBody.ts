/**
 * Low-detail body proxy: one ellipsoid, a set of straight conical sections and a foot box per side.
 *
 * Every number is measured on the built MakeHuman mesh, so the proxy follows the current figure
 * and pose. The drape lays panels on these same shapes, so the visible proxy and the panel surface
 * are one model.
 */

import { CLOTH_CLEARANCE, type LimbSide } from '@/avatar/envelope';
import type { MakehumanBody, Point3 } from '@/avatar/makehuman/body';
import { SectionIndex } from '@/avatar/makehuman/section';
import { add3t, cross3t, distance3t, dot3t, normalize3t, scale3t, sub3t } from '@/base/math';

/** Measurements the proxy reads; the full landmark set satisfies this. */
export interface SimplifiedBodySource {
  crotchY: number;
  shoulderTopY: number;
  torsoTop: number;
  neckTopY: number;
  neckR: number;
  deltoidR: number;
  ankleY: number;
  torsoEnvelopeAt(): { rx: number; rz: number; centre(y: number): Point3 };
  armChain(side: LimbSide): { root: Point3; mid: Point3; end: Point3 };
  legChain(side: LimbSide): { root: Point3; mid: Point3; end: Point3 };
}

/** Part a proxy shape stands for. */
export type SimplifiedPart =
  | 'head' | 'neck' | 'torso' | 'arm' | 'leg' | 'foot';

/** Fields shared by every proxy shape. */
interface ShapeBase {
  part: SimplifiedPart;
  /** Limb side; 0 for the parts on the body midline. */
  side: LimbSide | 0;
}

/** Head: an ellipsoid around the measured skull. */
export interface HeadShape extends ShapeBase {
  kind: 'ellipsoid';
  centre: Point3;
  radii: Point3;
}

/** A straight circular cone between two joints, with its radius at each end. */
export interface TubeShape extends ShapeBase {
  kind: 'tube';
  from: Point3;
  to: Point3;
  fromR: number;
  toR: number;
}

/**
 * A limb swept along one continuous centreline: the shoulder, elbow and wrist the panel rows
 * follow, with the corner at the joint rounded and the section radius blended across it.
 */
export interface LimbShape extends ShapeBase {
  kind: 'limb';
  part: 'arm' | 'leg';
  /** Centreline samples from the root joint to just past the tip. */
  path: Point3[];
  /** Section radius at each sample. */
  radii: number[];
}

/** Torso: one vertical elliptic cylinder through the measured wrap section. */
export interface TorsoShape extends ShapeBase {
  kind: 'torso';
  centreX: number;
  centreZ: number;
  bottomY: number;
  topY: number;
  rx: number;
  rz: number;
}

/** Foot: an axis-aligned box around the measured foot. */
export interface BoxShape extends ShapeBase {
  kind: 'box';
  min: Point3;
  max: Point3;
}

/** One proxy of the simplified body. */
export type SimplifiedShape = HeadShape | TubeShape | LimbShape | TorsoShape | BoxShape;

/** Gap the head ellipsoid leaves around the measured skull, in meters. */
const HEAD_CLEARANCE = 0.005;

/** Share of the longest half extent the shorter head axes are pulled toward, rounding the skull. */
const HEAD_ROUNDING = 0.35;

/** Overlap past a joint so neighbouring sections meet without a gap. */
const JOINT_OVERLAP = 0.02;

/** Room the torso carries above the shoulder line to meet the neck. */
const NECK_BASE_COVER = 0.02;

/** Room the torso carries below the crotch so the inner thighs meet the pelvis section. */
const PELVIS_COVER = 0.04;

/** Stations a limb cone is measured at, ends included. */
const LIMB_STATIONS = 13;

/** Reference direction a limb frame projects off; near-vertical axes face the body front. */
export function frameRef(axis: Point3): Point3 {
  return Math.abs(axis[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
}

/**
 * Orthonormal frame across a limb axis: `u` is the reference direction projected off the axis,
 * `v` completes the right-handed frame. The drape and the proxy grid share it, so their angles
 * count from the same direction.
 */
export function tubeFrame(axis: Point3, ref: Point3 = frameRef(axis)): { u: Point3; v: Point3 } {
  const u = normalize3t(sub3t(ref, scale3t(axis, dot3t(axis, ref))));
  return { u, v: normalize3t(cross3t(axis, u)) };
}

/** Bounds of the vertices selected by `accept`. */
function boundsOf(
  positions: Float32Array,
  accept: (x: number, y: number, z: number) => boolean,
): { min: Point3; max: Point3 } | null {
  const min: Point3 = [Infinity, Infinity, Infinity];
  const max: Point3 = [-Infinity, -Infinity, -Infinity];
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

/** Midpoint of two points. */
function mid(a: Point3, b: Point3): Point3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** Extends a tube past both ends so a joint stays covered by its two sections. */
function extendTube(
  from: Point3, to: Point3, fromR: number, toR: number, overlap: number,
): { from: Point3; to: Point3; fromR: number; toR: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  const k = overlap / length;
  return {
    from: [from[0] - dx * k, from[1] - dy * k, from[2] - dz * k],
    to: [to[0] + dx * k, to[1] + dy * k, to[2] + dz * k],
    fromR,
    toR,
  };
}

/** Distance from a point to the line through `from` along `axis`. */
function axisDistance(from: Point3, axis: Point3, point: Point3): number {
  const offset = sub3t(point, from);
  const perp = sub3t(offset, scale3t(axis, dot3t(offset, axis)));
  return Math.hypot(perp[0], perp[1], perp[2]);
}

/**
 * One limb cone fitted on its flesh: the axis runs parallel to the bone line through the mean
 * section centre, and the end radii are the cheapest straight taper that stays outside every
 * measured section, so a muscle belly offset from the bone stays inside the cone. Sections are
 * cut perpendicular to the axis, so a horizontal arm reads the same as a hanging one.
 */
function fitLimbCone(
  positions: Float32Array, indices: Uint32Array,
  root: Point3, end: Point3, clearance: number,
  startPad = 0,
  endTrim = 0.005,
): { from: Point3; to: Point3; fromR: number; toR: number } {
  const axis = normalize3t(sub3t(end, root));
  const { u, v } = tubeFrame(axis);
  const toWorld = (x: number, y: number, z: number): Point3 =>
    add3t(add3t(scale3t(u, x), scale3t(axis, y)), scale3t(v, z));
  const local = new Float32Array(positions.length);
  for (let i = 0; i * 3 < positions.length; i++) {
    const p: Point3 = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    local[i * 3] = dot3t(u, p);
    local[i * 3 + 1] = dot3t(axis, p);
    local[i * 3 + 2] = dot3t(v, p);
  }
  const index = new SectionIndex(local, indices);
  const boneLength = Math.hypot(end[0] - root[0], end[1] - root[1], end[2] - root[2]) || 1e-6;
  const start = sub3t(root, scale3t(axis, startPad));
  const length = boneLength + startPad;
  const step = length / (LIMB_STATIONS - 1);
  const startAlong = dot3t(axis, start);
  const side = Math.sign(root[0]) || 1;
  const centres: Point3[] = [];
  const sections: Point3[][] = [];
  for (let i = 0; i < LIMB_STATIONS; i++) {
    const along = startAlong + step * i;
    const centre = add3t(start, scale3t(axis, step * i));
    centres.push(centre);
    const points: Point3[] = [];
    // Union of three slices across the station's interval, so the taper encloses the flesh
    // between stations as well as at them. Loops are read back in world space so the midline
    // and the limb side keep their meaning in the rotated frame.
    for (const dy of [-step / 2, 0, step / 2]) {
      for (const loop of index.loops(along + dy)) {
        let minX = Infinity;
        let maxX = -Infinity;
        const world: Point3[] = [];
        for (let p = 0; p < loop.points.length; p += 2) {
          const point = toWorld(loop.points[p]!, along + dy, loop.points[p + 1]!);
          minX = Math.min(minX, point[0]);
          maxX = Math.max(maxX, point[0]);
          world.push(point);
        }
        if (minX < 0 && maxX > 0) continue;
        if (Math.sign((minX + maxX) / 2) !== side) continue;
        // A perpendicular cut through a horizontal arm also meets the legs and trunk; keep only
        // loops whose centre sits near this limb's axis.
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const p of world) {
          cx += p[0];
          cy += p[1];
          cz += p[2];
        }
        const centre: Point3 = [cx / world.length, cy / world.length, cz / world.length];
        if (axisDistance(start, axis, centre) > 0.25) continue;
        for (const point of world) {
          const pointAlong = dot3t(sub3t(point, start), axis);
          if (pointAlong < -0.005 || pointAlong > length + endTrim) continue;
          // Trunk flesh hanging off a shoulder cut is not limb flesh.
          if (axisDistance(start, axis, point) > 0.15) continue;
          points.push(point);
        }
      }
    }
    sections.push(points);
  }

  let shift: Point3 = [0, 0, 0];
  let measured = 0;
  for (let i = 0; i < LIMB_STATIONS; i++) {
    const points = sections[i]!;
    if (points.length === 0) continue;
    let cx = 0;
    let cz = 0;
    for (const p of points) {
      cx += p[0];
      cz += p[2];
    }
    const offset = sub3t([cx / points.length, centres[i]![1], cz / points.length], centres[i]!);
    shift = add3t(shift, sub3t(offset, scale3t(axis, dot3t(offset, axis))));
    measured++;
  }
  if (measured > 0) shift = scale3t(shift, 1 / measured);
  const from = add3t(start, shift);
  const to = add3t(end, shift);

  const radii = sections.map(points => {
    if (points.length === 0) return 0;
    let radius = 0;
    for (const point of points) radius = Math.max(radius, axisDistance(from, axis, point));
    return radius + clearance;
  });
  // Sections merged into the pelvis or shoulder read as their nearest measured station.
  for (let i = 0; i < LIMB_STATIONS; i++) {
    if (radii[i]! > 0) continue;
    let nearest = -1;
    for (let j = 0; j < LIMB_STATIONS; j++) {
      if (radii[j]! <= 0) continue;
      if (nearest < 0 || Math.abs(j - i) < Math.abs(nearest - i)) nearest = j;
    }
    radii[i] = nearest < 0 ? clearance : radii[nearest]!;
  }

  // Cheapest enclosing taper: the line through two stations that clears all of them without
  // extrapolating past the widest measured section.
  const maxR = Math.max(...radii);
  let fromR = maxR;
  let toR = maxR;
  let cost = Infinity;
  for (let i = 0; i < LIMB_STATIONS; i++) {
    for (let j = i + 1; j < LIMB_STATIONS; j++) {
      const ti = i / (LIMB_STATIONS - 1);
      const tj = j / (LIMB_STATIONS - 1);
      const slope = (radii[j]! - radii[i]!) / (tj - ti);
      const at = (t: number) => radii[i]! + slope * (t - ti);
      if (at(0) > maxR + 1e-9 || at(1) > maxR + 1e-9) continue;
      let clears = true;
      for (let k = 0; k < LIMB_STATIONS; k++) {
        if (at(k / (LIMB_STATIONS - 1)) < radii[k]! - 1e-9) { clears = false; break; }
      }
      if (!clears) continue;
      const sum = at(0) + at(1);
      if (sum < cost) {
        cost = sum;
        fromR = at(0);
        toR = at(1);
      }
    }
  }
  return { from, to, fromR, toR };
}

/** Spacing the limb centreline is sampled at, in meters. */
const LIMB_STEP = 0.02;

/** Distance a limb reaches past its last joint, covering the wrist or the ankle. */
const LIMB_TIP_COVER = 0.02;

/** Smallest fillet the joint between two bones is rounded with, in meters. */
const JOINT_FILLET_MIN = 0.04;

/** Room a joint fillet keeps between its own centre and the section it sweeps, in meters. */
const JOINT_FILLET_CLEARANCE = 0.015;

/** Longest fillet tangent, as a share of either bone, so the straight runs stay the longer part. */
const JOINT_FILLET_SHARE = 0.4;

/** Bend below which two bones count as one straight run, in radians. */
const JOINT_BEND_MIN = 0.03;

/** Half width of the window the section radius eases across the joint, in meters. */
const JOINT_RADIUS_BLEND = 0.06;

/** Section radius a cone carries at a point along its axis. */
function boneRadiusAt(bone: { from: Point3; to: Point3; fromR: number; toR: number }, point: Point3): number {
  const span = sub3t(bone.to, bone.from);
  const length = Math.hypot(span[0], span[1], span[2]) || 1e-6;
  const along = dot3t(sub3t(point, bone.from), span) / (length * length);
  return bone.fromR + (bone.toR - bone.fromR) * Math.min(1, Math.max(0, along));
}

/** Moves a point off the joint until it sits one fillet tangent back along a bone. */
function backAlong(point: Point3, axis: Point3, distance: number): Point3 {
  return add3t(point, scale3t(axis, -distance));
}

/**
 * Samples a limb's centreline through two bones. The corner at the joint is replaced by a circular
 * fillet tangent to both bones, so the swept surface bends instead of breaking: no crease at the
 * elbow, and no section pushed through the one below it. The radius eases from the first bone's
 * taper onto the second's over a window wider than the fillet, so the sleeve narrows the way a
 * real one does instead of pinching to a waist at the joint.
 */
function limbPath(
  upper: { from: Point3; to: Point3; fromR: number; toR: number },
  lower: { from: Point3; to: Point3; fromR: number; toR: number },
): { path: Point3[]; radii: number[] } {
  const axis0 = normalize3t(sub3t(upper.to, upper.from));
  const axis1 = normalize3t(sub3t(lower.to, lower.from));
  const joint = upper.to;
  const upperLength = distance3t(upper.from, upper.to);
  const lowerLength = distance3t(lower.from, lower.to);
  const bend = Math.acos(Math.min(1, Math.max(-1, dot3t(axis0, axis1))));

  const path: Point3[] = [];
  /** Appends a run, skipping a start point the previous run already laid down. */
  const run = (from: Point3, to: Point3, skipStart = false): void => {
    const steps = Math.max(1, Math.ceil(distance3t(from, to) / LIMB_STEP));
    for (let i = skipStart ? 1 : 0; i <= steps; i++) {
      const t = i / steps;
      path.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ]);
    }
  };

  // The root reaches into the torso so the shoulder section has no open end.
  const root = backAlong(upper.from, axis0, JOINT_OVERLAP);
  const tip = add3t(lower.to, scale3t(axis1, LIMB_TIP_COVER));
  let jointArc = 0;

  if (bend < JOINT_BEND_MIN) {
    run(root, tip);
    jointArc = distance3t(root, joint);
  } else {
    const rJoint = (boneRadiusAt(upper, joint) + boneRadiusAt(lower, lower.from)) / 2;
    let fillet = Math.max(JOINT_FILLET_MIN, rJoint + JOINT_FILLET_CLEARANCE);
    let tangent = fillet * Math.tan(bend / 2);
    const maxTangent = Math.min(upperLength, lowerLength) * JOINT_FILLET_SHARE;
    if (tangent > maxTangent) {
      tangent = maxTangent;
      fillet = tangent / Math.tan(bend / 2);
    }
    const arcStart = backAlong(joint, axis0, tangent);
    const arcEnd = add3t(joint, scale3t(axis1, tangent));
    // The fillet centre sits inside the bend, where its distance to either bone is the radius.
    const inside = normalize3t(add3t(scale3t(axis0, -1), axis1));
    const centre = add3t(joint, scale3t(inside, fillet / Math.cos(bend / 2)));

    run(root, arcStart);
    jointArc = distance3t(root, arcStart) + (bend * fillet) / 2;
    const from: Point3 = sub3t(arcStart, centre);
    const to: Point3 = sub3t(arcEnd, centre);
    const axis = normalize3t(cross3t(from, to));
    const arcSteps = Math.max(3, Math.ceil((bend * fillet) / LIMB_STEP));
    for (let i = 1; i <= arcSteps; i++) {
      const angle = bend * (i / arcSteps);
      const rotated = add3t(
        add3t(scale3t(from, Math.cos(angle)), scale3t(cross3t(axis, from), Math.sin(angle))),
        scale3t(axis, dot3t(axis, from) * (1 - Math.cos(angle))),
      );
      path.push(add3t(centre, rotated));
    }
    run(arcEnd, tip, true);
  }

  // Radius: both bones' tapers, eased into one another across the joint so no ring stands out.
  const arcs: number[] = [0];
  for (let i = 1; i < path.length; i++) arcs.push(arcs[i - 1]! + distance3t(path[i - 1]!, path[i]!));
  const window = Math.max(JOINT_RADIUS_BLEND, distance3t(root, tip) * 0.12);
  const radii = path.map((point, i) => {
    const t = Math.min(1, Math.max(0, (arcs[i]! - jointArc + window) / (2 * window)));
    const eased = t * t * (3 - 2 * t);
    return boneRadiusAt(upper, point) * (1 - eased) + boneRadiusAt(lower, point) * eased;
  });
  return { path, radii };
}

/** Proxy shapes of the current body: head, neck, torso, two arm cones, two leg cones, feet. */
export function simplifiedBodyShapes(
  body: MakehumanBody,
  landmarks: SimplifiedBodySource,
): SimplifiedShape[] {
  const shapes: SimplifiedShape[] = [];
  const torso = landmarks.torsoEnvelopeAt();
  const torsoCentre = torso.centre(0);

  const headPoints: Point3[] = [];
  for (let i = 0; i * 3 < body.positions.length; i++) {
    const x = body.positions[i * 3]!;
    const y = body.positions[i * 3 + 1]!;
    const z = body.positions[i * 3 + 2]!;
    if (y <= landmarks.neckTopY) continue;
    // The neck and upper-back stub below the jaw belongs to the neck tube, not to the skull.
    if (y <= landmarks.neckTopY + JOINT_OVERLAP
      && z <= torsoCentre[2] + landmarks.neckR * 0.5) continue;
    headPoints.push([x, y, z]);
  }
  if (headPoints.length > 0) {
    const min: Point3 = [Infinity, Infinity, Infinity];
    const max: Point3 = [-Infinity, -Infinity, -Infinity];
    for (const p of headPoints) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, p[a]!);
        max[a] = Math.max(max[a]!, p[a]!);
      }
    }
    const centre = mid(min, max);
    const half: Point3 = [
      Math.max((max[0] - min[0]) / 2, 0.01),
      Math.max((max[1] - min[1]) / 2, 0.01),
      Math.max((max[2] - min[2]) / 2, 0.01),
    ];
    // Pull the short half extents toward the longest before inflating, so the skull reads round
    // instead of a pointy egg. No axis shrinks, so every measured point stays enclosed.
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

  // Limb cones are measured on the right side and mirrored, so a symmetric body gets exactly
  // symmetric proxies and sleeves.
  const rightArm = landmarks.armChain(1);
  const rightLeg = landmarks.legChain(1);
  const upperArm = fitLimbCone(
    body.positions, body.bodyIndices, rightArm.root, rightArm.mid, CLOTH_CLEARANCE,
    Math.max(JOINT_OVERLAP, landmarks.deltoidR),
  );
  // Sections above the armpit merge into the torso, so the deltoid cap is measured directly
  // about the cone axis and held as the cone's wide end.
  const capAxis = normalize3t(sub3t(upperArm.to, upperArm.from));
  let capR = 0;
  for (let i = 0; i * 3 < body.positions.length; i++) {
    const p: Point3 = [body.positions[i * 3]!, body.positions[i * 3 + 1]!, body.positions[i * 3 + 2]!];
    if (p[1] < rightArm.root[1] - 0.05 * body.height || p[1] > rightArm.root[1] + 0.045 * body.height
      || p[0] < Math.abs(rightArm.root[0]) || p[0] > Math.abs(rightArm.root[0]) + 0.05 * body.height) continue;
    capR = Math.max(capR, axisDistance(upperArm.from, capAxis, p));
  }
  upperArm.fromR = Math.max(upperArm.fromR, capR + CLOTH_CLEARANCE);
  const forearm = fitLimbCone(body.positions, body.bodyIndices, rightArm.mid, rightArm.end, CLOTH_CLEARANCE, 0, -0.008);
  const thigh = fitLimbCone(body.positions, body.bodyIndices, rightLeg.root, rightLeg.mid, CLOTH_CLEARANCE);
  const shin = fitLimbCone(body.positions, body.bodyIndices, rightLeg.mid, rightLeg.end, CLOTH_CLEARANCE, 0, -0.008);
  const cones = { upperArm, forearm, thigh, shin };
  const mirrored = (cone: { from: Point3; to: Point3; fromR: number; toR: number }, side: LimbSide) =>
    side > 0 ? cone : {
      from: [-cone.from[0], cone.from[1], cone.from[2]] as Point3,
      to: [-cone.to[0], cone.to[1], cone.to[2]] as Point3,
      fromR: cone.fromR,
      toR: cone.toR,
    };

  for (const side of [-1, 1] as LimbSide[]) {
    // Each limb is one swept tube through both bones: the shoulder, elbow and wrist the cloth
    // follows are a single surface, so a sleeve bends over the joint instead of breaking at it.
    for (const [part, upperPart, lowerPart] of [
      ['arm', 'upperArm', 'forearm'], ['leg', 'thigh', 'shin'],
    ] as const) {
      shapes.push({
        kind: 'limb',
        part,
        side,
        ...limbPath(mirrored(cones[upperPart], side), mirrored(cones[lowerPart], side)),
      });
    }

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

/**
 * True when a point lies inside a proxy shape. `depth` is how far past the surface it sits, in
 * meters; points outside return a negative value.
 */
export function simplifiedDepth(shape: SimplifiedShape, point: Point3): number {
  switch (shape.kind) {
    case 'ellipsoid': {
      const q = Math.sqrt(
        ((point[0] - shape.centre[0]) / shape.radii[0]) ** 2
        + ((point[1] - shape.centre[1]) / shape.radii[1]) ** 2
        + ((point[2] - shape.centre[2]) / shape.radii[2]) ** 2,
      );
      // Radii differ, so the normalized overshoot is scaled by the smallest radius.
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
      // Nearest point on the sampled centreline; the section radius there is the surface.
      let best = -1;
      for (let i = 1; i < shape.path.length; i++) {
        const a = shape.path[i - 1]!;
        const b = shape.path[i]!;
        const span = sub3t(b, a);
        const lengthSq = dot3t(span, span);
        if (lengthSq < 1e-12) continue;
        const t = dot3t(sub3t(point, a), span) / lengthSq;
        // Past either end of the limb the point is outside it, as for a capped tube.
        if ((i === 1 && t < 0) || (i === shape.path.length - 1 && t > 1)) continue;
        const clamped = Math.min(1, Math.max(0, t));
        const centre = add3t(a, scale3t(span, clamped));
        const radius = shape.radii[i - 1]! + (shape.radii[i]! - shape.radii[i - 1]!) * clamped;
        best = Math.max(best, radius - distance3t(point, centre));
      }
      return best;
    }
    case 'tube': {
      const axis: Point3 = [
        shape.to[0] - shape.from[0],
        shape.to[1] - shape.from[1],
        shape.to[2] - shape.from[2],
      ];
      const lengthSq = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
      if (lengthSq < 1e-12) return -1;
      const offset: Point3 = [
        point[0] - shape.from[0],
        point[1] - shape.from[1],
        point[2] - shape.from[2],
      ];
      const t = (offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2]) / lengthSq;
      if (t < 0 || t > 1) return -1;
      const centre: Point3 = [
        shape.from[0] + axis[0] * t,
        shape.from[1] + axis[1] * t,
        shape.from[2] + axis[2] * t,
      ];
      const distance = Math.hypot(
        point[0] - centre[0],
        point[1] - centre[1],
        point[2] - centre[2],
      );
      return (shape.fromR + (shape.toR - shape.fromR) * t) - distance;
    }
  }
}