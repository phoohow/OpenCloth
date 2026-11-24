import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/app';
import { bodyLandmarks } from '@/avatar/landmarks';
import type { AvatarParams } from '@/model/types';

const GIRTH_TOLERANCE_CM = 1;

const CASES: Array<{ name: string; params: Partial<AvatarParams> }> = [
  { name: 'default', params: {} },
  { name: 'curvy', params: { chestCm: 98, waistCm: 62, hipCm: 106 } },
  { name: 'broad', params: { chestCm: 110, waistCm: 95, hipCm: 112 } },
];

describe('requested girths', () => {
  for (const { name, params } of CASES) {
    it(`measures ${name} back to the numbers it was built from`, () => {
      const avatar = { ...createStarterProject().avatar.params, ...params };
      const landmarks = bodyLandmarks(avatar);
      const lines = landmarks.bodyGirthLines();
      const girthOf = (part: string): number =>
        (lines.find(line => line.part === part)!.girth * 100);

      expect(Math.abs(girthOf('bust') - avatar.chestCm)).toBeLessThan(GIRTH_TOLERANCE_CM);
      expect(Math.abs(girthOf('waist') - avatar.waistCm)).toBeLessThan(GIRTH_TOLERANCE_CM);
      expect(Math.abs(girthOf('hip') - avatar.hipCm)).toBeLessThan(GIRTH_TOLERANCE_CM);
    });
  }

  it('finds the three sections in body order', () => {
    const landmarks = bodyLandmarks(createStarterProject().avatar.params);
    expect(landmarks.hipY).toBeLessThan(landmarks.waistY);
    expect(landmarks.waistY).toBeLessThan(landmarks.bustY);
    expect(landmarks.bustY).toBeLessThan(landmarks.armpitY);
  });
});
