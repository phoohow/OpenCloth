import { describe, expect, it } from 'vitest';
import { makehumanBody, torsoGirth } from '@/avatar/makehuman/body';

describe('makehuman body', () => {
  it('builds to the requested measurements', () => {
    for (const params of [
      { heightCm: 175, chestCm: 88, waistCm: 70, hipCm: 98 },
      { heightCm: 160, chestCm: 96, waistCm: 78, hipCm: 104, gender: 1 },
      { heightCm: 182, chestCm: 104, waistCm: 88, hipCm: 102, gender: 0.8 },
    ]) {
      const body = makehumanBody(params);
      const { landmarks } = body;
      expect(Math.abs(body.height - params.heightCm / 100)).toBeLessThan(0.005);
      expect(Math.abs(torsoGirth(body.positions, body.bodyIndices, landmarks.waistY) - params.waistCm / 100)).toBeLessThan(0.01);
    }
  });
});
