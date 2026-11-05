import { describe, expect, it } from 'vitest';
import type { AvatarParams } from '../../src/core/model/types';
import { bodyLandmarks } from '../../src/avatar/landmarks';
import { generateAvatarCollider } from '../../src/avatar/collider/avatarCollider';
import {
  appliedLimbPose, armChain, legChain, POSE_PRESETS, posePresetParams,
} from '../../src/avatar/pose';

const BASE: AvatarParams = { heightCm: 170, chestCm: 92, waistCm: 74, hipCm: 96 };
const RAD = Math.PI / 180;

describe('joint chains', () => {
  it('falls back to the straight relaxed pose without joints', () => {
    const body = bodyLandmarks(BASE);
    const arm = armChain(body, 1, appliedLimbPose(undefined, 1));
    expect(arm.mid[0]).toBeCloseTo(arm.root[0] + Math.sin(body.armRakeRad) * body.armH * 0.5, 6);
    expect(arm.end[1]).toBeCloseTo(arm.root[1] - Math.cos(body.armRakeRad) * body.armH, 6);
    expect(arm.end[2]).toBeCloseTo(0, 6);

    const leg = legChain(body, 1, appliedLimbPose(undefined, 1));
    expect(leg.mid[1]).toBeCloseTo(body.kneeY, 6);
    expect(leg.end[2]).toBeCloseTo(0, 6);
  });

  it('swings the arm forward about the shoulder', () => {
    const body = bodyLandmarks(BASE);
    const arm = armChain(body, 1, appliedLimbPose({ right: { shoulderFlexRad: 70 * RAD } }, 1));
    expect(arm.mid[2]).toBeGreaterThan(0);
    expect(arm.mid[1]).toBeGreaterThan(body.shoulderY - body.armH * 0.5);
  });

  it('bends the elbow forward without moving the shoulder', () => {
    const body = bodyLandmarks(BASE);
    const straight = armChain(body, 1, appliedLimbPose(undefined, 1));
    const bent = armChain(body, 1, appliedLimbPose({ right: { elbowBendRad: 90 * RAD } }, 1));
    expect(bent.root).toEqual(straight.root);
    expect(bent.mid).toEqual(straight.mid);
    expect(bent.end[2]).toBeGreaterThan(straight.end[2]);
  });

  it('bends the knee backward and lifts the foot', () => {
    const body = bodyLandmarks(BASE);
    const straight = legChain(body, 1, appliedLimbPose(undefined, 1));
    const bent = legChain(body, 1, appliedLimbPose({ right: { kneeBendRad: 80 * RAD } }, 1));
    expect(bent.mid).toEqual(straight.mid);
    expect(bent.end[2]).toBeLessThan(0);
    expect(bent.end[1]).toBeGreaterThan(straight.end[1]);
  });

  it('clamps joint angles beyond the supported range', () => {
    const pose = appliedLimbPose(
      { right: { shoulderFlexRad: 9, elbowBendRad: -1, hipFlexRad: 9, kneeBendRad: 9 } },
      1,
    );
    expect(pose.shoulderFlex).toBeCloseTo(1.45, 6);
    expect(pose.elbowBend).toBe(0);
    expect(pose.hipFlex).toBeCloseTo(1.45, 6);
    expect(pose.kneeBend).toBeCloseTo(2.2, 6);
  });

  it('keeps left and right limbs independent', () => {
    const pose = { left: { hipFlexRad: 40 * RAD }, right: { hipFlexRad: -30 * RAD } };
    expect(appliedLimbPose(pose, 1).hipFlex).toBeCloseTo(-30 * RAD, 6);
    expect(appliedLimbPose(pose, -1).hipFlex).toBeCloseTo(40 * RAD, 6);
  });
});

describe('collision capsules follow the joints', () => {
  it('bends the thigh forward with a hip swing', () => {
    const params: AvatarParams = { ...BASE, joints: { right: { hipFlexRad: 60 * RAD } } };
    const collider = generateAvatarCollider(params);
    const body = bodyLandmarks(params);
    const thigh = collider.capsules.find(c => c.ay === body.legH && c.ax > 0)!;
    expect(thigh.bz).toBeGreaterThan(0.05);
    expect(thigh.by).toBeGreaterThan(body.kneeY);
  });

  it('bends the calf backward with a knee bend', () => {
    const params: AvatarParams = { ...BASE, joints: { left: { kneeBendRad: 70 * RAD } } };
    const collider = generateAvatarCollider(params);
    const body = bodyLandmarks(params);
    const calf = collider.capsules.find(c => c.ay < body.legH && c.bx < 0)!;
    expect(calf.bz).toBeLessThan(-0.05);
  });
});

describe('pose presets', () => {
  it('carries joint rotations into avatar params', () => {
    const walk = POSE_PRESETS.find(preset => preset.key === 'walk')!;
    const params = posePresetParams(BASE, walk);
    expect(params.joints?.left?.hipFlexRad).toBeCloseTo(25 * RAD, 6);
    expect(params.joints?.right?.hipFlexRad).toBeCloseTo(-18 * RAD, 6);
    expect(params.poseArmAngleRad).toBeCloseTo(walk.armDeg * RAD, 6);
  });

  it('clears the previous joints for a straight preset', () => {
    const params = posePresetParams({ ...BASE, joints: { left: { kneeBendRad: 1 } } }, POSE_PRESETS[0]);
    expect(params.joints).toBeUndefined();
  });
});
