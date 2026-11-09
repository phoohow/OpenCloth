/** Procedural mannequin silhouette as plain mesh data, free of any scene library. */

import type { AssetMesh, MaterialData, MeshData } from '@/render/common';
import type { AvatarParams } from '@/model/types';
import { bodyLandmarks, type BodyLandmarks } from '@/avatar';
import { appliedLimbPose, armChain, legChain, type Point3 } from '@/avatar';

/** Downward local axis the limb lathes run along. */
const DOWN: Point3 = [0, -1, 0];

/** Indexed triangle mesh in part-local metres. */
interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Elliptical cross-section at one height of a lofted body part. */
interface Station { y: number; rx: number; rz: number; }

type Quaternion = [x: number, y: number, z: number, w: number];

/** Placement of one part: translation, rotation and local depth scale. */
interface Placement {
  position: Point3;
  /** Rotation taking the downward axis onto the limb direction. */
  rotation?: Quaternion;
  /** Euler angles in radians, XYZ order; replaces `rotation` when present. */
  euler?: Point3;
  /** Local z scale applied before the rotation. */
  depth?: number;
}

/** Skin surface shared by every body part. */
const SKIN: MaterialData = {
  kind: 'surface',
  name: 'skin',
  color: '#e8c4a8',
  roughness: 0.62,
  metalness: 0,
  clearcoat: 0.12,
  side: 'double',
};

/**
 * Monotone cubic interpolation (Fritsch-Carlson): smooth between anchors without
 * overshooting past neighboring values.
 */
function monotoneInterp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  // Fritsch-Carlson assumes increasing knots; reverse decreasing inputs.
  if (xs[n - 1] < xs[0]) {
    return monotoneInterp([...xs].reverse(), [...ys].reverse(), x);
  }
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = [d[0]];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) { m.push(0); continue; }
    const w1 = 2 * (xs[k + 1] - xs[k]) + (xs[k] - xs[k - 1]);
    const w2 = (xs[k + 1] - xs[k]) + 2 * (xs[k] - xs[k - 1]);
    m.push((w1 * d[k - 1] + w2 * d[k]) / (w1 + w2));
  }
  m.push(d[n - 2]);
  let i = 1;
  while (xs[i] < x) i++;
  const h = xs[i] - xs[i - 1];
  const t = (x - xs[i - 1]) / h;
  const t2 = t * t, t3 = t2 * t;
  return ys[i - 1] * (2 * t3 - 3 * t2 + 1) + h * m[i - 1] * (t3 - 2 * t2 + t)
    + ys[i] * (-2 * t3 + 3 * t2) + h * m[i] * (t3 - t2);
}

/** Resamples station anchors (indexed 0..1) into `count` smooth stations. */
function sampleStations(anchors: Station[], count: number): Station[] {
  const ts = anchors.map((_, k) => k / (anchors.length - 1));
  const ys = anchors.map(a => a.y);
  const rxs = anchors.map(a => a.rx);
  const rzs = anchors.map(a => a.rz);
  const out: Station[] = [];
  for (let s = 0; s < count; s++) {
    const t = s / (count - 1);
    out.push({
      y: monotoneInterp(ts, ys, t),
      rx: Math.max(monotoneInterp(ts, rxs, t), 0.004),
      rz: Math.max(monotoneInterp(ts, rzs, t), 0.004),
    });
  }
  return out;
}

/** Closed lofted tube through ascending elliptical stations, capped at both ends. */
function loftStations(stations: Station[], radial: number, centerX: (y: number) => number): RawMesh {
  const rings = stations.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const st of stations) {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(centerX(st.y) + st.rx * Math.cos(a), st.y, st.rz * Math.sin(a));
    }
  }
  for (let k = 0; k < rings - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = k * radial + j, b = k * radial + j2;
      const c = (k + 1) * radial + j, e = (k + 1) * radial + j2;
      idx.push(a, c, b, b, c, e);
    }
  }
  // End caps as center vertices, wound outward.
  const first = stations[0], last = stations[rings - 1];
  const c0 = pos.length / 3;
  pos.push(centerX(first.y), first.y, 0);
  for (let j = 0; j < radial; j++) idx.push(c0, j, (j + 1) % radial);
  const c1 = pos.length / 3;
  pos.push(centerX(last.y), last.y, 0);
  const base = (rings - 1) * radial;
  for (let j = 0; j < radial; j++) idx.push(c1, base + (j + 1) % radial, base + j);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Lathes a smooth radius profile through (y, r) anchors, top to bottom. */
function latheProfile(anchors: Array<[number, number]>, samples: number, radial: number): RawMesh {
  const ys = anchors.map(a => a[0]);
  const rs = anchors.map(a => a[1]);
  const top = ys[0], bottom = ys[ys.length - 1];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s <= samples; s++) {
    const y = top + (bottom - top) * (s / samples);
    const r = Math.max(monotoneInterp(ys, rs, y), 0.004);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
    }
  }
  for (let k = 0; k < samples; k++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = k * radial + j, b = (k + 1) * radial + j;
      const c = k * radial + j2, e = (k + 1) * radial + j2;
      idx.push(a, b, c, b, e, c);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** UV sphere around the origin, wound outward. */
function sphere(radius: number, widthSegments: number, heightSegments: number): RawMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let iy = 0; iy <= heightSegments; iy++) {
    const theta = (iy / heightSegments) * Math.PI;
    const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
    for (let ix = 0; ix <= widthSegments; ix++) {
      const phi = (ix / widthSegments) * Math.PI * 2;
      pos.push(
        -radius * Math.cos(phi) * sinTheta,
        radius * cosTheta,
        radius * Math.sin(phi) * sinTheta,
      );
    }
  }
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * (widthSegments + 1) + ix + 1;
      const b = iy * (widthSegments + 1) + ix;
      const c = (iy + 1) * (widthSegments + 1) + ix;
      const d = (iy + 1) * (widthSegments + 1) + ix + 1;
      if (iy !== 0) idx.push(a, b, d);
      if (iy !== heightSegments - 1) idx.push(b, c, d);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Sphere with per-axis radii, matching a scaled unit sphere. */
function scaledSphere(radius: number, widthSegments: number, heightSegments: number, sx: number, sy: number, sz: number): RawMesh {
  const raw = sphere(radius, widthSegments, heightSegments);
  for (let i = 0; i < raw.positions.length; i += 3) {
    raw.positions[i] *= sx;
    raw.positions[i + 1] *= sy;
    raw.positions[i + 2] *= sz;
  }
  return raw;
}

/** Quaternion turning the downward axis onto `dir`. */
function downTo(dir: Point3): Quaternion {
  const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const x = dir[0] / length, y = dir[1] / length, z = dir[2] / length;
  const r = DOWN[1] * y + 1;
  let q: Quaternion;
  if (r < 1e-6) {
    q = Math.abs(DOWN[0]) > Math.abs(DOWN[2]) ? [-DOWN[1], DOWN[0], 0, 0] : [0, -DOWN[2], DOWN[1], 0];
  } else {
    q = [
      DOWN[1] * z - DOWN[2] * y,
      DOWN[2] * x - DOWN[0] * z,
      DOWN[0] * y - DOWN[1] * x,
      r,
    ];
  }
  const norm = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}

/** Rotates a vector by XYZ Euler angles. */
function rotateEuler(v: Point3, euler: Point3): Point3 {
  const cx = Math.cos(euler[0]), sx = Math.sin(euler[0]);
  const cy = Math.cos(euler[1]), sy = Math.sin(euler[1]);
  const cz = Math.cos(euler[2]), sz = Math.sin(euler[2]);
  const m00 = cy * cz, m01 = -cy * sz, m02 = sy;
  const m10 = cx * sz + sx * sy * cz, m11 = cx * cz - sx * sy * sz, m12 = -sx * cy;
  const m20 = sx * sz - cx * sy * cz, m21 = sx * cz + cx * sy * sz, m22 = cx * cy;
  return [
    m00 * v[0] + m01 * v[1] + m02 * v[2],
    m10 * v[0] + m11 * v[1] + m12 * v[2],
    m20 * v[0] + m21 * v[1] + m22 * v[2],
  ];
}

/** Applies a quaternion rotation to a vector. */
function rotateQuaternion(v: Point3, q: Quaternion): Point3 {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
    v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
    v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
}

/** Bakes a part placement into its vertex positions. */
function bakeMesh(raw: RawMesh, placement: Placement): RawMesh {
  const positions = new Float32Array(raw.positions.length);
  const depth = placement.depth ?? 1;
  for (let i = 0; i < raw.positions.length; i += 3) {
    let v: Point3 = [raw.positions[i], raw.positions[i + 1], raw.positions[i + 2] * depth];
    if (placement.rotation) v = rotateQuaternion(v, placement.rotation);
    else if (placement.euler) v = rotateEuler(v, placement.euler);
    positions[i] = v[0] + placement.position[0];
    positions[i + 1] = v[1] + placement.position[1];
    positions[i + 2] = v[2] + placement.position[2];
  }
  return { positions, indices: raw.indices };
}

/** Per-vertex normals accumulated from the triangle winding of an indexed mesh. */
function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length < 1e-9) {
      normals[i] = 0; normals[i + 1] = 1; normals[i + 2] = 0;
      continue;
    }
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

/** Torso stations: groin dome, hip, waist, bust, shoulders and the neck stump. */
function torsoAnchors(body: BodyLandmarks): Station[] {
  const ring = (y: number): Station => ({ y, ...body.torsoEllipseAt(y) });
  const top = body.torsoEllipseAt(body.torsoTop);
  return [
    { ...ring(body.crotchY), rx: body.hipR * 0.42, rz: body.hipR * 0.38 },
    ring(body.hipY),
    ring(body.hipY + body.torsoH * 0.18),
    ring(body.waistY),
    ring(body.hipY + body.torsoH * 0.58),
    ring(body.bustY),
    ring(body.torsoTop),
    { y: body.torsoTop + body.neckH * 0.55, rx: top.rx * 0.85, rz: top.rz * 0.8 },
    { y: body.neckTopY, rx: body.headH * 0.2, rz: body.headH * 0.2 },
    { y: body.neckTopY + 0.015, rx: 0.004, rz: 0.004 },
  ];
}

/**
 * Builds the stylized dress-form mannequin from bodyLandmarks measurements so the figure,
 * collision capsules and cloth wrap share one silhouette. All meshes are in metres.
 */
export function proceduralAvatarMeshes(params: AvatarParams): AssetMesh[] {
  const body = bodyLandmarks(params);
  const { legR, armR, legH, armH, headH, kneeY, shoulderX, shoulderY, hipR } = body;
  const meshes: AssetMesh[] = [];

  const add = (name: string, raw: RawMesh, placement: Placement): void => {
    const baked = bakeMesh(raw, placement);
    const mesh: MeshData = {
      topology: 'triangle',
      streams: { position: baked.positions, normal: computeNormals(baked.positions, baked.indices) },
      index: baked.indices,
    };
    meshes.push({ name, mesh, material: SKIN });
  };

  add('torso', loftStations(sampleStations(torsoAnchors(body), 28), 30, y => body.torsoCenterXAt(y)), {
    position: [0, 0, 0],
  });

  const thighAnchors: Array<[number, number]> = [
    [hipR * 0.15, legR * 0.98],
    [-legH * 0.38, legR * 0.9],
    [-(legH - kneeY), legR * 0.8],
  ];
  const calfAnchors: Array<[number, number]> = [
    [0, legR * 0.8],
    [-(legH - kneeY) * 0.4, legR * 0.68],
    [-(legH - kneeY) * 0.82, legR * 0.5],
    [-(legH - kneeY) * 0.96, legR * 0.46],
    [-(legH - kneeY) * 0.96 - 0.001, 0.004],
  ];
  const thigh = latheProfile(thighAnchors, 12, 16);
  const calf = latheProfile(calfAnchors, 12, 16);
  const knee = sphere(legR * 0.82, 16, 12);
  const foot = scaledSphere(legR * 1.1, 18, 12, 0.7, 0.4, 1.5);

  for (const side of [-1, 1] as const) {
    const joints = appliedLimbPose(params.joints, side);
    const chain = legChain(body, side, joints);
    const label = side < 0 ? 'left' : 'right';
    add(`thigh-${label}`, thigh, { position: chain.root, rotation: downTo(chain.dir1), depth: 0.85 });
    add(`calf-${label}`, calf, { position: chain.mid, rotation: downTo(chain.dir2), depth: 0.85 });
    add(`knee-${label}`, knee, { position: chain.mid });
    add(`foot-${label}`, foot, {
      position: [chain.end[0], chain.end[1], chain.end[2] + legR * 0.35],
      euler: [-joints.hipFlex + joints.kneeBend, 0, side * body.legRakeRad],
    });
  }

  const shoulderCenter = body.torsoCenterXAt(shoulderY);
  const shoulderBall = sphere(armR * 1.15, 16, 12);
  add('shoulder-left', shoulderBall, { position: [shoulderCenter - (shoulderX - armR * 0.35), shoulderY, 0] });
  add('shoulder-right', shoulderBall, { position: [shoulderCenter + shoulderX - armR * 0.35, shoulderY, 0] });

  const upperAnchors: Array<[number, number]> = [
    [0, armR * 0.95],
    [-armH * 0.15, armR * 0.9],
    [-armH * 0.5, armR * 0.78],
  ];
  const forearmAnchors: Array<[number, number]> = [
    [0, armR * 0.78],
    [-armH * 0.3, armR * 0.64],
    [-armH * 0.5, armR * 0.55],
    [-armH * 0.5 - 0.001, 0.004],
  ];
  const upperArm = latheProfile(upperAnchors, 10, 14);
  const forearm = latheProfile(forearmAnchors, 10, 14);
  const elbow = sphere(armR * 0.8, 14, 10);
  const hand = scaledSphere(armR * 0.8, 12, 8, 0.75, 1.5, 0.5);

  for (const side of [-1, 1] as const) {
    const joints = appliedLimbPose(params.joints, side);
    const chain = armChain(body, side, joints);
    const label = side < 0 ? 'left' : 'right';
    add(`upper-arm-${label}`, upperArm, {
      position: chain.root, rotation: downTo(chain.dir1), depth: 0.9,
    });
    add(`forearm-${label}`, forearm, {
      position: chain.mid, rotation: downTo(chain.dir2), depth: 0.9,
    });
    add(`elbow-${label}`, elbow, { position: chain.mid });
    add(`hand-${label}`, hand, {
      position: [
        chain.end[0] + chain.dir2[0] * armR * 0.6,
        chain.end[1] + chain.dir2[1] * armR * 0.6,
        chain.end[2] + chain.dir2[2] * armR * 0.6,
      ],
      rotation: downTo(chain.dir2),
    });
  }

  const head = scaledSphere(headH * 0.45, 24, 18, 0.86, 1.0, 0.92);
  add('head', head, { position: [body.torsoCenterXAt(body.headCenterY), body.headCenterY, 0] });

  return meshes;
}
