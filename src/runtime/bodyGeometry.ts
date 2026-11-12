/** Lofted primitives the procedural body is assembled from, as plain mesh data. */

import { monotoneInterp } from '@/base/math';

/** Indexed triangle mesh in part-local metres. */
export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Local swelling of a ring, used for forms that a plain ellipse cannot express, such as the two
 * breast mounds: the offset fades out across `width` radians on each side of `angle`.
 */
export interface RingBulge {
  /** Centre of the swelling: 0 on +x, a quarter turn on the front (+z). */
  angle: number;
  /** Angular half width over which the swelling fades to nothing. */
  width: number;
  /** Radial offset at the centre, in meters; negative values hollow the surface in. */
  amount: number;
}

/** One horizontal slice of a lofted tube. */
export interface Ring {
  y: number;
  /** Half width along x. */
  rx: number;
  /** Half depth toward +z, the chest and belly side. */
  rz: number;
  /** Half depth toward -z; defaults to `rz`. */
  rzBack?: number;
  /** Section squareness: 2 is an ellipse, higher values flatten the sides toward a rectangle. */
  squareness?: number;
  /** Lateral offset of the section centre. */
  cx?: number;
  /** Front/back offset of the section centre, which is how the standing spine curves. */
  cz?: number;
  /** Depth pulled in at the centre of the back, as a fraction of the back extent. */
  cleft?: number;
  /** Local swellings and hollows around the section. */
  bulges?: RingBulge[];
}

/** Radius profile sample of a limb, `t` running from 0 at the top joint to 1 at the bottom. */
export interface ProfileAnchor {
  t: number;
  /** Half width along the limb-local x axis. */
  rx: number;
  /** Half depth along the limb-local z axis; defaults to `rx`. */
  rz?: number;
}

/** Extra geometry closing the end of a loft. */
export interface LoftCaps {
  /** Distance from the first ring to its pole, along -y. */
  bottom?: number;
  /** Distance from the last ring to its pole, along +y. */
  top?: number;
}

/** Angle difference wrapped into [-pi, pi]. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Position of one ring vertex: angle 0 lies on +x and angles run toward +z. */
function ringVertex(ring: Ring, angle: number): [number, number, number] {
  const squareness = ring.squareness ?? 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const px = Math.sign(c) * Math.abs(c) ** (2 / squareness);
  const pz = Math.sign(s) * Math.abs(s) ** (2 / squareness);
  const depth = s >= 0 ? ring.rz : ring.rzBack ?? ring.rz;
  // Gluteal cleft: the back centre sits forward of the two cheeks.
  const cleft = ring.cleft ?? 0;
  const tuck = s < 0 && cleft > 0 ? 1 - cleft * Math.exp(-((px / 0.2) ** 2)) : 1;
  let x = px * ring.rx;
  let z = pz * depth * tuck;
  // Swellings push the surface out along its own radial direction, so they blend into the section.
  if (ring.bulges && ring.bulges.length > 0) {
    let push = 0;
    for (const bulge of ring.bulges) {
      const d = angleDelta(angle, bulge.angle);
      if (Math.abs(d) >= bulge.width) continue;
      push += bulge.amount * Math.cos((Math.PI / 2) * (d / bulge.width)) ** 2;
    }
    const len = Math.hypot(x, z);
    if (len > 1e-6 && push !== 0) {
      x += (x / len) * push;
      z += (z / len) * push;
    }
  }
  return [(ring.cx ?? 0) + x, ring.y, (ring.cz ?? 0) + z];
}

/** Signed volume of a closed triangle mesh; negative when the triangles face inward. */
function signedVolume(mesh: RawMesh): number {
  const p = mesh.positions;
  const idx = mesh.indices;
  let sum = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    sum += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return sum / 6;
}

/** Flips the winding of a closed mesh whose triangles face inward, so normals point outward. */
export function orientOutward(mesh: RawMesh): RawMesh {
  if (signedVolume(mesh) >= 0) return mesh;
  const idx = mesh.indices.slice();
  for (let i = 0; i < idx.length; i += 3) {
    const swap = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = swap;
  }
  return { positions: mesh.positions, indices: idx };
}

/** Lofts rings given in ascending y into a closed tube, optionally closed with a pole at each end. */
export function loftRings(rings: Ring[], radial: number, caps: LoftCaps = {}): RawMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const ring of rings) {
    for (let j = 0; j < radial; j++) {
      pos.push(...ringVertex(ring, (j / radial) * Math.PI * 2));
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = k * radial + j;
      const b = k * radial + j2;
      const c = (k + 1) * radial + j;
      const e = (k + 1) * radial + j2;
      idx.push(a, c, b, b, c, e);
    }
  }
  // End caps as pole fans; a zero offset closes the ring with a flat disc.
  const first = rings[0];
  const bottom = rings.length - 1;
  const last = rings[bottom];
  const bottomPole = pos.length / 3;
  pos.push(first.cx ?? 0, first.y - (caps.bottom ?? 0), first.cz ?? 0);
  for (let j = 0; j < radial; j++) idx.push(bottomPole, j, (j + 1) % radial);
  const topPole = pos.length / 3;
  pos.push(last.cx ?? 0, last.y + (caps.top ?? 0), last.cz ?? 0);
  const base = bottom * radial;
  for (let j = 0; j < radial; j++) idx.push(topPole, base + (j + 1) % radial, base + j);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Interpolates a radius profile from precomputed knots. */
function profileValue(knots: { ts: number[]; values: number[] }, t: number): number {
  return monotoneInterp(knots.ts, knots.values, t);
}

/**
 * Lathes a limb radius profile down the local -y axis. `length` is the joint-to-joint span, and
 * each end is closed by a rounded cap so the limb reads as a solid even where no joint covers it.
 */
export function loftLimb(
  anchors: ProfileAnchor[],
  length: number,
  radial: number,
  samples = 14,
  capRatio = 0.85,
): RawMesh {
  const ts = anchors.map(a => a.t);
  const widths = { ts, values: anchors.map(a => a.rx) };
  const depths = { ts, values: anchors.map(a => a.rz ?? a.rx) };
  const rings: Ring[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    rings.push({ y: -t * length, rx: profileValue(widths, t), rz: profileValue(depths, t) });
  }
  const topR = anchors[0].rx;
  const bottomR = anchors[anchors.length - 1].rx;
  return loftRings(rings, radial, { top: topR * capRatio, bottom: bottomR * capRatio });
}

/** Ellipsoid around the origin, with the poles on the y axis. */
export function ellipsoid(rx: number, ry: number, rz: number, radial = 16, rings = 10): RawMesh {
  const out: Ring[] = [];
  for (let i = 1; i < rings; i++) {
    const theta = (i / rings) * Math.PI;
    out.push({ y: -ry * Math.cos(theta), rx: rx * Math.sin(theta), rz: rz * Math.sin(theta) });
  }
  const first = out[0].y;
  const last = out[out.length - 1].y;
  return loftRings(out, radial, { bottom: first + ry, top: ry - last });
}
