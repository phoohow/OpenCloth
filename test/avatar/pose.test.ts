import { describe, expect, it } from 'vitest';
import { bodyLandmarks } from '@/avatar/landmarks';
import { generateAvatarCollider } from '@/avatar/collider/avatarCollider';
import type { AvatarParams } from '@/model/types';

const BASE: AvatarParams = { heightCm: 170, chestCm: 92, waistCm: 74, hipCm: 96 };

describe('body pose landmarks', () => {
  it('keeps the torso on the centreline without a lean or spread', () => {
    const body = bodyLandmarks(BASE);
    expect(body.torsoLeanRad).toBe(0);
    expect(body.legRakeRad).toBe(0);
    expect(body.torsoCenterXAt(body.hipY)).toBe(0);
    expect(body.torsoCenterXAt(body.neckTopY)).toBe(0);
  });

  it('shifts the torso above the hip with a lateral lean', () => {
    const body = bodyLandmarks({ ...BASE, poseTorsoLeanRad: 0.2 });
    expect(body.torsoLeanRad).toBeCloseTo(0.2);
    expect(body.torsoCenterXAt(body.hipY)).toBeCloseTo(0);
    const expected = Math.tan(0.2) * (body.bustY - body.hipY);
    expect(body.torsoCenterXAt(body.bustY)).toBeCloseTo(expected);
    expect(body.torsoCenterXAt(body.crotchY)).toBeCloseTo(0);
  });

  it('clamps invalid pose angles into the supported range', () => {
    const body = bodyLandmarks({ ...BASE, poseLegSpreadRad: -0.4, poseTorsoLeanRad: 2 });
    expect(body.legRakeRad).toBe(0);
    expect(body.torsoLeanRad).toBeCloseTo(0.78);
  });
});

describe('collision capsules follow the pose', () => {
  it('keeps legs vertical and centred on the hip axis without splay', () => {
    const collider = generateAvatarCollider(BASE);
    const body = bodyLandmarks(BASE);
    const thigh = collider.capsules.find(c => c.ay === body.legH && c.ax < 0);
    expect(thigh).toBeDefined();
    expect(thigh!.bx).toBeCloseTo(thigh!.ax);
    const shin = collider.capsules.find(c => c.ay < body.legH && c.bx < 0);
    expect(shin!.bx).toBeCloseTo(shin!.ax);
    expect(shin!.bx).toBeCloseTo(-body.hipX);
  });

  it('splays both legs outward about the hip', () => {
    const params: AvatarParams = { ...BASE, poseLegSpreadRad: 0.2 };
    const collider = generateAvatarCollider(params);
    const body = bodyLandmarks(params);

    const rightThigh = collider.capsules.find(c => c.ay === body.legH && c.ax > 0)!;
    const rightShin = collider.capsules.find(c => c.ay < body.legH && c.bx > 0)!;
    const leftThigh = collider.capsules.find(c => c.ay === body.legH && c.ax < 0)!;
    const leftShin = collider.capsules.find(c => c.ay < body.legH && c.bx < 0)!;

    expect(rightThigh.bx).toBeGreaterThan(rightThigh.ax);
    expect(rightShin.bx).toBeGreaterThan(rightThigh.bx);
    expect(leftThigh.bx).toBeLessThan(leftThigh.ax);
    expect(leftShin.bx).toBeLessThan(leftThigh.bx);
    // The hip joint itself stays put.
    expect(leftThigh.ax).toBeCloseTo(-body.hipX);
    expect(rightThigh.ax).toBeCloseTo(body.hipX);
  });

  it('leans the torso capsules while the hip ring stays on the centreline', () => {
    const params: AvatarParams = { ...BASE, poseTorsoLeanRad: 0.2 };
    const collider = generateAvatarCollider(params);
    const body = bodyLandmarks(params);
    const waist = collider.capsules.find(c => c.ay === body.hipY && c.by === body.waistY);
    expect(waist).toBeDefined();
    expect(waist!.ax).toBeCloseTo(0);
    expect(waist!.bx).toBeCloseTo(body.torsoCenterXAt(body.waistY));
  });

  it('larger bounds contain every capsule while the body leans', () => {
    const params: AvatarParams = {
      ...BASE, poseTorsoLeanRad: 0.3, poseLegSpreadRad: 0.3, poseArmAngleRad: 0.4,
    };
    const collider = generateAvatarCollider(params);
    for (const c of collider.capsules) {
      for (const x of [c.ax, c.bx]) {
        expect(x - c.radius).toBeGreaterThanOrEqual(collider.bounds.min[0] - 1e-9);
        expect(x + c.radius).toBeLessThanOrEqual(collider.bounds.max[0] + 1e-9);
      }
      for (const y of [c.ay, c.by]) {
        expect(y).toBeGreaterThanOrEqual(collider.bounds.min[1] - 1e-9);
        expect(y).toBeLessThanOrEqual(collider.bounds.max[1] + 1e-9);
      }
    }
  });
});
