import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import { bodyLandmarks } from '@/avatar/landmarks';
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

  it('reports depth relative to the proxy surface', () => {
    const torso = shapes.find(shape => shape.kind === 'torso') as SimplifiedShape & { kind: 'torso' };
    expect(simplifiedDepth(torso, [0, (torso.bottomY + torso.topY) / 2, torso.centreZ]))
      .toBeGreaterThan(0.1);
    expect(simplifiedDepth(torso, [0, torso.topY + 0.05, torso.centreZ])).toBeLessThan(0);
    expect(simplifiedDepth(torso, [torso.centreX + torso.rx + 0.01, torso.topY - 0.1, torso.centreZ]))
      .toBeLessThan(0);
  });
});

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
