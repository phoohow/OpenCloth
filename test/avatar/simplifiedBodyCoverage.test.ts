import { describe, expect, it } from 'vitest';
import { createDefaultAvatar } from '@/model/defaults/avatar';
import { bodyLandmarks } from '@/avatar/landmarks';
import { makehumanBody } from '@/avatar/makehuman/body';
import { simplifiedDepth } from '@/avatar/simplifiedBody';

/** Measurement sets whose proxy must cover the built body. */
const BODIES = [
  createDefaultAvatar().params,
  { ...createDefaultAvatar().params, gender: 1, weight: 1, muscle: 1, heightCm: 195 },
  { ...createDefaultAvatar().params, gender: 0, weight: 0, muscle: 0, heightCm: 150, ageYears: 10 },
];

/** True when a point lies beyond the wrist along an arm, where the proxy has no hand. */
function beyondWrist(
  point: readonly [number, number, number],
  arm: { mid: readonly [number, number, number]; end: readonly [number, number, number] },
): boolean {
  const axis = [arm.end[0] - arm.mid[0], arm.end[1] - arm.mid[1], arm.end[2] - arm.mid[2]] as const;
  const offset = [point[0] - arm.mid[0], point[1] - arm.mid[1], point[2] - arm.mid[2]] as const;
  const length = Math.hypot(...axis) || 1;
  const along = (offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2]) / length;
  if (along <= length) return false;
  const nearest = [
    arm.mid[0] + (axis[0] / length) * along,
    arm.mid[1] + (axis[1] / length) * along,
    arm.mid[2] + (axis[2] / length) * along,
  ] as const;
  return Math.hypot(point[0] - nearest[0], point[1] - nearest[1], point[2] - nearest[2]) < 0.18;
}

describe('simplified body coverage', () => {
  for (const params of BODIES) {
    it(`covers the built body at ${params.heightCm} cm`, () => {
      const mesh = makehumanBody(params);
      const body = bodyLandmarks(params);
      const shapes = body.bodyShapes();
      const arms = [body.armChain(-1), body.armChain(1)];
      let checked = 0;
      let covered = 0;
      let worstGap = 0;
      for (let v = 0; v * 3 < mesh.positions.length; v++) {
        const point: [number, number, number] = [
          mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!,
        ];
        if (arms.some(arm => beyondWrist(point, arm))) continue;
        checked++;
        const depth = Math.max(...shapes.map(shape => simplifiedDepth(shape, point)));
        if (depth >= 0) covered++;
        else worstGap = Math.max(worstGap, -depth);
      }
      // The proxy is approximate by design: hands are excluded, the chin may poke out of the head
      // ellipsoid, and the neck/shoulder join carries a gap. Most skin sits inside a measured shape.
      expect(covered / checked).toBeGreaterThan(0.95);
      expect(worstGap).toBeLessThan(0.06);
    });
  }
});
