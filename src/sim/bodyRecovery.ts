import { pushOutOfBody, type MeshCollider } from '@/avatar/collider';

/**
 * Lifts particles that sit inside the body out to its surface, in place.
 *
 * The collide pass searches a block of cells around each particle, so it cannot reach one buried
 * deeper than that block. These passes cover the cases the GPU pass misses: the starting layout of
 * a panel laid inside the body, and the positions the CPU self-collision pass pushes back in.
 */

/** Clearance kept from the surface, per particle, in meters. */
export type ClearanceOf = (index: number) => number;

/**
 * Widest search a start-up lift runs, in cells: four cells is 4 cm on a 1 cm grid. The search cost
 * grows with the cube of the radius, and a panel laid deeper than this inside the body is a
 * modelling mistake the solver should not spend seconds on.
 */
const LIFT_RINGS = 4;
/** Widest search the per-frame lift runs; the collide pass already covers the shallower band. */
const MOVE_RINGS = 2;

/** Lifts every included particle to at least `clearanceOf(i)` outside the body. */
function lift(
  collider: MeshCollider,
  positions: Float32Array,
  clearanceOf: ClearanceOf,
  maxRings: number,
  include: (index: number) => boolean,
): number {
  const count = Math.floor(positions.length / 3);
  let moved = 0;
  for (let i = 0; i < count; i++) {
    if (!include(i)) continue;
    const pushed = pushOutOfBody(
      collider, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], clearanceOf(i), maxRings,
    );
    if (!pushed) continue;
    positions[i * 3] = pushed[0];
    positions[i * 3 + 1] = pushed[1];
    positions[i * 3 + 2] = pushed[2];
    moved++;
  }
  return moved;
}

/** Lifts every particle to at least `clearanceOf(i)` outside the body; returns how many moved. */
export function liftBuriedPositions(
  collider: MeshCollider,
  positions: Float32Array,
  clearanceOf: ClearanceOf,
  skip?: (index: number) => boolean,
): number {
  return lift(collider, positions, clearanceOf, LIFT_RINGS, i => !skip?.(i));
}

/** Lifts the particles whose position differs from `before`; returns how many moved. */
export function liftMovedPositions(
  collider: MeshCollider,
  positions: Float32Array,
  before: Float32Array,
  clearanceOf: ClearanceOf,
): number {
  return lift(
    collider, positions, clearanceOf, MOVE_RINGS,
    i => positions[i * 3] !== before[i * 3]
      || positions[i * 3 + 1] !== before[i * 3 + 1]
      || positions[i * 3 + 2] !== before[i * 3 + 2],
  );
}
