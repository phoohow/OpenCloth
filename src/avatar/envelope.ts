/**
 * Torso wrap geometry fitted directly on the MakeHuman surface.
 *
 * The torso is one vertical elliptic cylinder derived from the built body's vertices: the centre
 * is the skin cloud's centroid depth, the section is the enclosing ellipse of the skin between the
 * shoulder ridge and the crotch. Limb sections live in the simplified body proxy, which the drape
 * reads directly.
 */

import type { Point3 } from '@/avatar/makehuman/body';

/** A vertex moved by an arm belongs to that arm; the sleeve has to clear its whole surface. */
const ARM_INFLUENCE = 0.5;

/** Gap between the measured skin and the proxy or cloth surface, in meters. */
export const CLOTH_CLEARANCE = 0.004;

/** Side multiplier of the left (-1) and right (+1) limbs. */
export type LimbSide = -1 | 1;

/** One straight axis and the elliptic section measured around it. */
export interface RegionEnvelope {
  /** Unit direction along the region, from its root toward its end. */
  axis: Point3;
  /** Unit transverse direction the half width runs along. */
  u: Point3;
  /** Unit transverse direction the half depth runs along. */
  v: Point3;
  /** Half depth per half width of the measured section. */
  aspect: number;
  /** Measured half axes of the section, in meters; `rz = rx * aspect`. */
  rx: number;
  rz: number;
  /** Perimeter of that section, in meters. */
  girth: number;
  /** Point on the centreline at distance t along the axis. */
  at(t: number): Point3;
  /** Point on the centreline at a world height (vertical regions). */
  centre(y: number): Point3;
}

function armWeight(armWeights: Float32Array, v: number): number {
  return Math.max(armWeights[v * 2]!, armWeights[v * 2 + 1]!);
}

/** True when no arm chain moves this vertex: the torso section a bodice is measured on. */
function isTorso(armWeights: Float32Array, v: number): boolean {
  return armWeight(armWeights, v) <= ARM_INFLUENCE;
}

/** Ramanujan's ellipse perimeter; the shape is unchanged by a uniform scale. */
function ellipsePerimeter(rx: number, rz: number): number {
  return Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz)));
}

/** Torso vertices inside the fitted height span: the skin a bodice has to clear. */
function torsoSkin(
  positions: Float32Array,
  armWeights: Float32Array,
  topY: number,
  bottomY: number,
): Point3[] {
  const count = positions.length / 3;
  const points: Point3[] = [];
  for (let v = 0; v < count; v++) {
    const y = positions[v * 3 + 1]!;
    if (y < bottomY || y > topY || !isTorso(armWeights, v)) continue;
    points.push([positions[v * 3]!, y, positions[v * 3 + 2]!]);
  }
  return points;
}


/**
 * Torso: one vertical elliptic cylinder sized on the body's own surface.
 *
 * The centre is the skin cloud's centroid depth, with the lateral centre on the body's midline, so
 * a piece cut on a vertical line hangs vertical instead of inheriting the figure's front/back
 * drift. The section is the widest outline between the shoulder ridge and the crotch, so the cloth
 * always stays outside the skin and no row is fitted separately.
 */
export function fitTorso(
  positions: Float32Array,
  armWeights: Float32Array,
  topY: number,
  bottomY: number,
): RegionEnvelope {
  const points = torsoSkin(positions, armWeights, topY, bottomY);
  let sumZ = 0;
  let maxX = 0;
  for (const p of points) {
    sumZ += p[2];
    maxX = Math.max(maxX, Math.abs(p[0]));
  }
  const meanZ = points.length > 0 ? sumZ / points.length : 0;
  let maxZ = 0;
  for (const p of points) maxZ = Math.max(maxZ, Math.abs(p[2] - meanZ));
  const aspect = maxX > 1e-6 && maxZ > 1e-6 ? maxZ / maxX : 1;
  // Enclosing ellipse with the outline's aspect: every skin point satisfies x²/rx² + z²/rz² ≤ 1,
  // unlike a box-fitted ellipse whose diagonal can cut the body.
  let rx = 0;
  for (const p of points) {
    const z = (p[2] - meanZ) / aspect;
    rx = Math.max(rx, Math.hypot(p[0], z));
  }
  rx = Math.max(rx, 0.01) + CLOTH_CLEARANCE;
  const rz = Math.max(rx * aspect, 0.01);
  const u: Point3 = [1, 0, 0];
  const v: Point3 = [0, 0, 1];
  const centre = (y: number): Point3 => [0, y, meanZ];
  return {
    axis: [0, -1, 0],
    u,
    v,
    aspect: rz / rx,
    rx,
    rz,
    girth: ellipsePerimeter(rx, rz),
    at: (t: number): Point3 => centre(topY - t),
    centre,
  };
}
