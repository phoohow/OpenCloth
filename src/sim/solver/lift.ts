import type { CollisionSurface } from '@/sim/common';

import { pushOutOfBody } from '@/avatar/collider';

const LIFT_RINGS = 4;

export type ClearanceOf = (index: number) => number;

export function liftBuriedPositions(
  collider: CollisionSurface,
  positions: Float32Array,
  clearanceOf: ClearanceOf,
  skip?: (index: number) => boolean,
): number {
  const count = Math.floor(positions.length / 3);
  let moved = 0;
  for (let i = 0; i < count; i++) {
    if (skip?.(i)) continue;
    const pushed = pushOutOfBody(
      collider, positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!, clearanceOf(i), LIFT_RINGS,
    );
    if (!pushed) continue;
    positions[i * 3] = pushed[0];
    positions[i * 3 + 1] = pushed[1];
    positions[i * 3 + 2] = pushed[2];
    moved++;
  }

  return moved;
}
