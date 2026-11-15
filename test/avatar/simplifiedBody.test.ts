import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import { bodyLandmarks } from '@/avatar/landmarks';
import { makehumanBody } from '@/avatar/makehuman/body';
import {
  simplifiedDepth, type LimbShape, type SimplifiedShape,
} from '@/avatar/simplifiedBody';

describe('simplified body', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);
  const shapes = body.bodyShapes();

  it('has one shape per body part and per side', () => {
    const parts = shapes.map(shape => `${shape.part}:${shape.side}`);
    expect(parts).toEqual([
      'head:0', 'neck:0', 'torso:0',
      'arm:-1', 'leg:-1', 'foot:-1',
      'arm:1', 'leg:1', 'foot:1',
    ]);
  });

  it('keeps the head proxy near-round', () => {
    const head = shapes.find(shape => shape.part === 'head')!;
    expect(head.kind).toBe('ellipsoid');
    if (head.kind !== 'ellipsoid') return;
    // The short axes are pulled toward the longest, so the skull never reads as a pointy egg.
    expect(Math.max(...head.radii) / Math.min(...head.radii)).toBeLessThan(1.2);
  });

  it('fits the torso cylinder to the measured wrap section', () => {
    const env = body.torsoEnvelopeAt();
    const torso = shapes.find(shape => shape.kind === 'torso')!;
    expect(torso.kind).toBe('torso');
    if (torso.kind !== 'torso') return;
    expect(torso.rx).toBeCloseTo(env.rx, 9);
    expect(torso.rz).toBeCloseTo(env.rz, 9);
    // The proxy reaches below the crotch so the inner thighs join the pelvis section.
    expect(torso.bottomY).toBeCloseTo(body.crotchY - 0.04, 9);
    // The proxy carries a short collar above the shoulder line so it meets the neck.
    expect(torso.topY).toBeCloseTo(body.shoulderTopY + 0.02, 9);
  });

  it('mirrors the left and right sections', () => {
    const right = shapes.filter(shape => shape.side === 1 && shape.kind === 'limb') as LimbShape[];
    expect(right.length).toBe(2);
    for (const shape of right) {
      const left = shapes.find(other =>
        other.part === shape.part && other.side === -1) as LimbShape;
      expect(left.path.length).toBe(shape.path.length);
      for (let i = 0; i < shape.path.length; i++) {
        expect(left.radii[i]!).toBeCloseTo(shape.radii[i]!, 9);
        expect(left.path[i]![0]).toBeCloseTo(-shape.path[i]![0], 9);
        expect(left.path[i]![1]).toBeCloseTo(shape.path[i]![1], 9);
        expect(left.path[i]![2]).toBeCloseTo(shape.path[i]![2], 9);
      }
    }
  });

  it('tapers the upper limb and tubes the lower one', () => {
    for (const part of ['arm', 'leg'] as const) {
      const limb = shapes.find(shape => shape.kind === 'limb' && shape.part === part && shape.side === 1);
      if (!limb || limb.kind !== 'limb') throw new Error(`${part} proxy missing`);
      // The upper bone narrows from its joint to the next, the way a sleeve head or a thigh does.
      const joint = part === 'arm' ? body.armChain(1).mid : body.legChain(1).mid;
      const jointIndex = nearestSample(limb.path, joint);
      expect(limb.radii[0]!).toBeGreaterThan(limb.radii[jointIndex]! + 0.005);
      // The lower bone is cut as a tube: one girth from the joint to the wrist or ankle.
      const lower = limb.radii.slice(Math.floor(limb.path.length * 0.8));
      expect(Math.max(...lower) - Math.min(...lower)).toBeLessThan(0.001);
    }
  });

  it('rounds the elbow instead of breaking it', () => {
    const arm = shapes.find(shape => shape.kind === 'limb' && shape.part === 'arm' && shape.side === 1);
    if (!arm || arm.kind !== 'limb') throw new Error('arm proxy missing');
    // The centreline bends smoothly: no step between consecutive samples and no pinch in radius.
    let sharpest = 0;
    for (let i = 1; i < arm.path.length - 1; i++) {
      const a = arm.path[i - 1]!;
      const b = arm.path[i]!;
      const c = arm.path[i + 1]!;
      const h1 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const h2 = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
      const cos = ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
        + (b[2] - a[2]) * (c[2] - b[2])) / (h1 * h2);
      sharpest = Math.max(sharpest, Math.acos(Math.min(1, Math.max(-1, cos))));
    }
    // One sample step is a twentieth of the fillet's circumference, so the turn per step stays small.
    expect(sharpest).toBeLessThan(0.5);
    // The section never jumps between neighbours, which is what the seam at the old joint was.
    for (let i = 1; i < arm.path.length; i++) {
      expect(Math.abs(arm.radii[i]! - arm.radii[i - 1]!)).toBeLessThan(0.01);
    }
  });

  it('keeps the sleeve cuff on the forearm girth, not on the elbow cut', () => {
    for (const gender of [0, 1]) {
      const params = { ...project.avatar.params, gender };
      const figure = bodyLandmarks(params);
      const arm = figure.bodyShapes().find(shape =>
        shape.kind === 'limb' && shape.part === 'arm' && shape.side === 1);
      if (!arm || arm.kind !== 'limb') throw new Error('arm proxy missing');
      const chain = figure.armChain(1);
      const positions = makehumanBody(params).positions;
      const cuff = arm.radii[arm.radii.length - 1]!;
      // The tube carries the forearm's own widest section, which sits below the elbow. A cut
      // across the joint also meets the upper arm, and reading that as the forearm's girth put
      // twice the wrist's radius on the cuff.
      expect(cuff).toBeLessThan(skinRadiusAt(positions, chain.mid, chain.end, 0.1) + 0.015);
      expect(cuff).toBeGreaterThan(skinRadiusAt(positions, chain.mid, chain.end, 0.5) + 0.005);
    }
  });

  it('keeps each bone straight', () => {
    for (const part of ['arm', 'leg'] as const) {
      const limb = shapes.find(shape => shape.kind === 'limb' && shape.part === part && shape.side === 1);
      if (!limb || limb.kind !== 'limb') throw new Error(`${part} proxy missing`);
      const joint = part === 'arm' ? body.armChain(1).mid : body.legChain(1).mid;
      const jointIndex = nearestSample(limb.path, joint);
      // Away from the joint both bones stay the straight run the proxy is cut from; only the
      // joint eases one bone's line onto the other's.
      for (const [start, end] of [[0, jointIndex - 6], [jointIndex + 6, limb.path.length - 1]]) {
        const a = limb.path[start]!;
        const b = limb.path[end]!;
        let widest = 0;
        for (let i = start; i <= end; i++) {
          widest = Math.max(widest, lineDistance(a, b, limb.path[i]!));
        }
        expect(widest).toBeLessThan(0.004);
      }
    }
  });

  it('reports depth relative to the proxy surface', () => {
    const torso = shapes.find(shape => shape.kind === 'torso') as SimplifiedShape & { kind: 'torso' };
    expect(simplifiedDepth(torso, [0, (torso.bottomY + torso.topY) / 2, torso.centreZ]))
      .toBeGreaterThan(0.1);
    expect(simplifiedDepth(torso, [0, torso.topY + 0.05, torso.centreZ])).toBeLessThan(0);
    expect(simplifiedDepth(torso, [torso.centreX + torso.rx + 0.01, torso.topY - 0.1, torso.centreZ]))
      .toBeLessThan(0);
  });
});

/** Distance from a point to the line through two samples. */
function lineDistance(a: readonly number[], b: readonly number[], point: readonly number[]): number {
  const span = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const lengthSq = span[0]! ** 2 + span[1]! ** 2 + span[2]! ** 2 || 1e-9;
  const offset = [point[0]! - a[0]!, point[1]! - a[1]!, point[2]! - a[2]!];
  const along = (offset[0]! * span[0]! + offset[1]! * span[1]! + offset[2]! * span[2]!) / lengthSq;
  return Math.hypot(
    offset[0]! - span[0]! * along,
    offset[1]! - span[1]! * along,
    offset[2]! - span[2]! * along,
  );
}

/** Largest skin distance from a bone, cut perpendicular to it at a share along the bone. */
function skinRadiusAt(
  positions: Float32Array, from: readonly number[], to: readonly number[], share: number,
): number {
  const axis = [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!];
  const length = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
  const centre = [
    from[0]! + axis[0]! * share,
    from[1]! + axis[1]! * share,
    from[2]! + axis[2]! * share,
  ];
  let radius = 0;
  for (let v = 0; v * 3 < positions.length; v++) {
    const p = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
    if (p[0]! <= 0) continue;
    const offset = [p[0]! - centre[0]!, p[1]! - centre[1]!, p[2]! - centre[2]!];
    const along = (offset[0]! * axis[0]! + offset[1]! * axis[1]! + offset[2]! * axis[2]!) / length;
    if (Math.abs(along) > 0.01) continue;
    const perp = Math.hypot(
      offset[0]! - (axis[0]! * along) / length,
      offset[1]! - (axis[1]! * along) / length,
      offset[2]! - (axis[2]! * along) / length,
    );
    if (perp > 0.12) continue;
    radius = Math.max(radius, perp);
  }
  return radius;
}

/** Index of the centreline sample closest to a joint. */
function nearestSample(path: readonly (readonly number[])[], joint: readonly number[]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < path.length; i++) {
    const distance = Math.hypot(
      path[i]![0]! - joint[0]!, path[i]![1]! - joint[1]!, path[i]![2]! - joint[2]!,
    );
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  return best;
}
