import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import { bodyLandmarks } from '@/avatar/landmarks';
import {
  simplifiedDepth, type SimplifiedShape, type TubeShape,
} from '@/avatar/simplifiedBody';

describe('simplified body', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);
  const shapes = body.bodyShapes();

  it('has one shape per body part and per side', () => {
    const parts = shapes.map(shape => `${shape.part}:${shape.side}`);
    expect(parts).toEqual([
      'head:0', 'neck:0', 'torso:0',
      'upperArm:-1', 'forearm:-1', 'thigh:-1', 'shin:-1', 'foot:-1',
      'upperArm:1', 'forearm:1', 'thigh:1', 'shin:1', 'foot:1',
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
    const right = shapes.filter(shape => shape.side === 1 && shape.kind === 'tube') as TubeShape[];
    for (const shape of right) {
      const left = shapes.find(other =>
        other.part === shape.part && other.side === -1) as TubeShape;
      expect(left.fromR).toBeCloseTo(shape.fromR, 9);
      expect(left.toR).toBeCloseTo(shape.toR, 9);
      expect(left.from[0]).toBeCloseTo(-shape.from[0], 9);
      expect(left.to[0]).toBeCloseTo(-shape.to[0], 9);
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
