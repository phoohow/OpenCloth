/**
 * Wrap geometry fitted directly on the MakeHuman surface.
 *
 * Every region is one straight axis with one elliptic section: a plain elliptic cylinder, with no
 * bending along its length and no per-size constants. The axis direction, the section's centre,
 * its shape and its girth are all measured on the vertices of the built body. A different figure
 * therefore rebuilds the wrap from its own data, and a T pose turns the fitted arm axis horizontal
 * so the sleeve turns with it instead of being hung from a vertical skeleton line.
 */

import type { Point3 } from '@/avatar/makehuman/body';

/** A vertex moved by an arm belongs to that arm; the sleeve has to clear its whole surface. */
const ARM_INFLUENCE = 0.5;

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
  /** Measured half axes of the enclosing section, in meters; `rz = rx * aspect`. */
  rx: number;
  rz: number;
  /** Perimeter of that section, in meters. */
  girth: number;
  /** Point on the axis at distance t below the panel's top edge. */
  at(t: number): Point3;
  /** Point on the axis at a world height (vertical regions). */
  centre(y: number): Point3;
}

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Point3, b: Point3): Point3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Point3, k: number): Point3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function cross(a: Point3, b: Point3): Point3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: Point3, fallback: Point3): Point3 {
  const length = Math.hypot(...a);
  return length > 1e-9 ? [a[0] / length, a[1] / length, a[2] / length] : fallback;
}

function armWeight(armWeights: Float32Array, v: number): number {
  return Math.max(armWeights[v * 2]!, armWeights[v * 2 + 1]!);
}

/** True when no arm chain moves this vertex: the torso section a bodice is measured on. */
function isTorso(armWeights: Float32Array, v: number): boolean {
  return armWeight(armWeights, v) <= ARM_INFLUENCE;
}

/** True when an arm chain moves this vertex: skin a sleeve must stay outside of. */
function isLimb(armWeights: Float32Array, v: number): boolean {
  return armWeight(armWeights, v) > ARM_INFLUENCE;
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

function centroid(points: readonly Point3[]): Point3 {
  const c: Point3 = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0] / points.length;
    c[1] += p[1] / points.length;
    c[2] += p[2] / points.length;
  }
  return c;
}

/** Orthonormal frame across a fitted axis. `ref` fixes which way angle zero faces. */
function transverse(axis: Point3, ref: Point3): { u: Point3; v: Point3 } {
  const chosen = Math.abs(dot(axis, ref)) > 0.999 ? [0, 0, 1] as Point3 : ref;
  const u = unit(sub(chosen, scale(axis, dot(axis, chosen))), [1, 0, 0]);
  return { u, v: unit(cross(axis, u), [0, 0, 1]) };
}

/** Measured section: centre offsets, half axes, their ratio and the perimeter. */
interface Section {
  offsetU: number;
  offsetV: number;
  aspect: number;
  rx: number;
  rz: number;
  girth: number;
}

/**
 * Smallest-perimeter ellipse that contains every projected surface vertex. Both the centre and
 * the axis ratio are solved from the cloud: the centre is searched over the bounding box, and the
 * ratio is searched for the minimum enclosing perimeter. Nothing here is a fitted constant — a
 * wider or deeper figure simply produces a wider or deeper ellipse.
 *
 * Containment is the hard constraint: a section sized from a tape measurement is narrower than
 * the body's outline at the shoulders and hips, and cloth placed on it cuts straight through the
 * skin. Any width the cut panel cannot reach is left as a seam for the simulator to close.
 */
function sectionOf(samples: ReadonlyArray<[number, number]>): Section {
  const n = samples.length;
  if (n < 8) return { offsetU: 0, offsetV: 0, aspect: 1, rx: 0.1, rz: 0.1, girth: 0 };
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  let mu = 0, mv = 0;
  for (const [a, b] of samples) {
    minU = Math.min(minU, a); maxU = Math.max(maxU, a);
    minV = Math.min(minV, b); maxV = Math.max(maxV, b);
    mu += a / n; mv += b / n;
  }
  const centres: Array<[number, number]> = [
    [mu, mv],
    [(minU + maxU) / 2, (minV + maxV) / 2],
    [(mu + (minU + maxU) / 2) / 2, (mv + (minV + maxV) / 2) / 2],
  ];
  let best = { aspect: 1, girth: Infinity, rx: 0, cu: 0, cv: 0 };
  for (const [cu, cv] of centres) {
    // Coarse scan then a local refinement: the perimeter is unimodal in the axis ratio.
    for (let pass = 0; pass < 2; pass++) {
      const lo = pass === 0 ? 0.3 : Math.max(0.05, best.aspect - 0.08);
      const hi = pass === 0 ? 3.0 : best.aspect + 0.08;
      const steps = pass === 0 ? 90 : 60;
      for (let i = 0; i <= steps; i++) {
        const aspect = lo + (hi - lo) * i / steps;
        let rx = 1e-4;
        for (const [a, b] of samples) {
          const d = Math.hypot(a - cu, (b - cv) / aspect);
          if (d > rx) rx = d;
        }
        const girth = ellipsePerimeter(rx, rx * aspect);
        if (girth < best.girth) best = { aspect, girth, rx, cu, cv };
      }
    }
  }
  return {
    offsetU: best.cu,
    offsetV: best.cv,
    aspect: best.aspect,
    rx: best.rx,
    rz: best.rx * best.aspect,
    girth: best.girth,
  };
}

/**
 * Torso: one vertical elliptic cylinder fitted to the body's own surface.
 *
 * The vertices are mirrored before fitting so a millimetre of asymmetry in the scan cannot shift
 * the two halves off the body's centreline. The axis is plumb: its front/back centre is the
 * cloud's centroid at a fixed depth, so a piece cut on a vertical line hangs vertical instead of
 * inheriting the figure's front/back drift. The section is measured about that same centre and
 * must contain the widest outline between the shoulder ridge and the crotch; a smaller, tape-sized
 * section looks more curved but drives the cloth through the skin at the shoulders and hips. The
 * cut width then decides how far around that section the panel reaches, and the remaining arc is
 * a seam.
 */
export function fitTorso(
  positions: Float32Array,
  armWeights: Float32Array,
  topY: number,
  bottomY: number,
): RegionEnvelope {
  const points = torsoSkin(positions, armWeights, topY, bottomY);
  const doubled: Point3[] = [];
  for (const p of points) doubled.push([p[0], p[1], p[2]], [-p[0], p[1], p[2]]);
  const cloud = doubled.length >= 8 ? doubled : points;

  // Plumb front/back centreline: the centroid depth, with the lateral centre exactly zero.
  let sz = 0;
  for (const p of cloud) sz += p[2];
  const meanZ = sz / cloud.length;
  const section = sectionOf(cloud.map(p => [p[0], p[2] - meanZ]));

  const u: Point3 = [1, 0, 0];
  const v: Point3 = [0, 0, 1];
  const axisZ = meanZ + section.offsetV;
  const centre = (y: number): Point3 => [0, y, axisZ];
  return {
    axis: [0, -1, 0],
    u,
    v,
    aspect: section.aspect,
    rx: section.rx,
    rz: section.rz,
    girth: section.girth,
    at: (t: number): Point3 => centre(topY - t),
    centre,
  };
}

/**
 * Limb: one straight axis fitted to the limb's own surface over the span the panel covers.
 *
 * The seed is the direction between two joint rings measured on the finished mesh, so it already
 * follows the pose (down for a relaxed arm, outward for a T pose). Only vertices of the covered
 * span take part in the section fit: the hand, the shoulder blend and the rest of the arm must not
 * size an upper-arm sleeve. The section is the smallest ellipse of the measured shape which
 * encloses every vertex of that band.
 */
export function fitLimb(
  positions: Float32Array,
  armWeights: Float32Array,
  region: 'arm' | 'leg',
  side: LimbSide,
  anchorY: number,
  root: Point3,
  mid: Point3,
  depth: number,
  legCeiling: number,
): RegionEnvelope {
  const seed = unit(sub(mid, root), [0, -1, 0]);
  // Where the panel's top edge meets the seed line. A level arm has no vertical fall to resolve,
  // so its top edge starts at the joint; neither case needs a size-dependent offset.
  const tAnchor = Math.abs(seed[1]) > 1e-3 ? (anchorY - root[1]) / seed[1] : 0;
  const top = add(root, scale(seed, tAnchor));

  const band: Point3[] = [];
  for (let v = 0; v * 3 < positions.length; v++) {
    const x = positions[v * 3]!;
    const y = positions[v * 3 + 1]!;
    const z = positions[v * 3 + 2]!;
    if (Math.sign(x) !== side) continue;
    if (region === 'arm' ? !isLimb(armWeights, v) : y > legCeiling) continue;
    const p: Point3 = [x, y, z];
    const t = dot(sub(p, top), seed);
    if (t < 0 || t > depth) continue;
    band.push(p);
  }
  if (band.length < 8) {
    const fallback: RegionEnvelope = {
      axis: seed, u: [1, 0, 0], v: [0, 0, 1], aspect: 1, rx: 0.1, rz: 0.1, girth: 0,
      at: (t: number): Point3 => add(top, scale(seed, t)),
      centre: (y: number): Point3 => [top[0], y, top[2]],
    };
    return fallback;
  }

  const origin = centroid(band);
  // The joint direction is the limb's own measured orientation. A short upper-arm band is nearly
  // as wide as it is long, so a second PCA fit would be dominated by the deltoid rather than by
  // the bone; the seed is both cleaner and already pose-aware. Only the section is fitted here.
  const axis = seed;
  // Angle zero faces up for a sleeve (the cap crown) and down for its underarm seam. Projecting
  // +y onto the axis' normal plane is well defined for both a hanging and a horizontal arm.
  const { u, v } = transverse(axis, [0, 1, 0]);
  const section = sectionOf(band.map(p => {
    const d = sub(p, origin);
    return [dot(d, u), dot(d, v)] as [number, number];
  }));
  const offset = add(scale(u, section.offsetU), scale(v, section.offsetV));
  const tTop = dot(sub(top, origin), axis);
  return {
    axis,
    u,
    v,
    aspect: section.aspect,
    rx: section.rx,
    rz: section.rz,
    girth: section.girth,
    at: (t: number): Point3 => add(add(origin, scale(axis, tTop + t)), offset),
    centre: (y: number): Point3 =>
      add(add(origin, scale(axis, (y - origin[1]) / (axis[1] || 1))), offset),
  };
}

/** Mirrors a measured limb envelope, so a cut sleeve pair stays exactly symmetric. */
export function mirrorEnvelope(env: RegionEnvelope): RegionEnvelope {
  const mirror = (p: Point3): Point3 => [-p[0], p[1], p[2]];
  const axis = mirror(env.axis);
  const u = mirror(env.u);
  // Recompute the second transverse vector from the mirrored axis: a reflected frame keeps the
  // pair of sleeves on opposite hands, which is what makes their flat sheets mirror exactly.
  const v = unit(cross(axis, u), [0, 0, 1]);
  return {
    axis,
    u,
    v,
    aspect: env.aspect,
    rx: env.rx,
    rz: env.rz,
    girth: env.girth,
    at: (t: number): Point3 => mirror(env.at(t)),
    centre: (y: number): Point3 => mirror(env.centre(y)),
  };
}
