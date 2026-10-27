import * as THREE from 'three/webgpu';
import type { AvatarParams } from '../../core/model/types';
import { bodyLandmarks } from '../landmarks';

/** Elliptical cross-section at one height of a lofted body part. */
interface Station { y: number; rx: number; rz: number; }

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

/** Builds a closed lofted tube through elliptical stations, capped at both ends. */
function loftStations(stations: Station[], radial: number): THREE.BufferGeometry {
  const rings = stations.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const st of stations) {
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(st.rx * Math.cos(a), st.y, st.rz * Math.sin(a));
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
  pos.push(0, first.y, 0);
  for (let j = 0; j < radial; j++) idx.push(c0, j, (j + 1) % radial);
  const c1 = pos.length / 3;
  pos.push(0, last.y, 0);
  const base = (rings - 1) * radial;
  for (let j = 0; j < radial; j++) idx.push(c1, base + (j + 1) % radial, base + j);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Lathes a smooth radius profile through (y, r) anchors, top to bottom. */
function latheProfile(anchors: [y: number, r: number][], samples: number, radial: number): THREE.LatheGeometry {
  const ys = anchors.map(a => a[0]);
  const rs = anchors.map(a => a[1]);
  const top = ys[0], bottom = ys[ys.length - 1];
  const pts: THREE.Vector2[] = [];
  for (let s = 0; s <= samples; s++) {
    const y = top + (bottom - top) * (s / samples);
    pts.push(new THREE.Vector2(Math.max(monotoneInterp(ys, rs, y), 0.004), y));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/**
 * Builds a stylized dress-form mannequin from bodyLandmarks measurements so the figure,
 * collision capsules and cloth wrap share one silhouette.
 */
export function generateProceduralAvatar(params: AvatarParams): THREE.Group {
  const group = new THREE.Group();
  group.name = 'avatar';

  const body = bodyLandmarks(params);
  const {
    height: heightM, headH, neckH, torsoH, legH, armH,
    torsoTop, neckTopY, bustY, waistY, hipY, crotchY,
    hipR, shoulderX, shoulderY, armR, legR, hipX, armRakeRad,
  } = body;

  const mat = new THREE.MeshStandardMaterial({
    color: 0xd8d5d0, roughness: 0.65, metalness: 0,
  });

  const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rotZ = 0, depth = 1): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotZ;
    mesh.scale.set(1, 1, depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Torso: groin dome -> hip -> waist -> bust -> shoulders -> neck stump, elliptical.
  const ring = (y: number): Station => ({ y, ...body.torsoEllipseAt(y) });
  const torsoAnchors: Station[] = [
    { ...ring(crotchY), rx: hipR * 0.42, rz: hipR * 0.38 },
    ring(hipY),
    ring(hipY + torsoH * 0.18),
    ring(waistY),
    ring(hipY + torsoH * 0.58),
    ring(bustY),
    ring(torsoTop),
    { y: torsoTop + neckH * 0.55, rx: body.torsoEllipseAt(torsoTop).rx * 0.85, rz: body.torsoEllipseAt(torsoTop).rz * 0.8 },
    { y: neckTopY, rx: headH * 0.2, rz: headH * 0.2 },
    { y: neckTopY + 0.015, rx: 0.004, rz: 0.004 },
  ];
  add(loftStations(sampleStations(torsoAnchors, 28), 30));

  // Legs: tapered thigh -> knee -> calf -> ankle with a flat bottom.
  const legAnchors: [number, number][] = [
    [legH + hipR * 0.15, legR * 0.98],
    [legH * 0.62, legR * 0.9],
    [legH * 0.5, legR * 0.8],
    [legH * 0.3, legR * 0.68],
    [legH * 0.09, legR * 0.5],
    [legH * 0.02, legR * 0.46],
    [legH * 0.02 - 0.001, 0.004],
  ];
  add(latheProfile(legAnchors, 20, 16), -hipX, 0, 0, 0, 0.85);
  add(latheProfile(legAnchors, 20, 16), hipX, 0, 0, 0, 0.85);

  // Rounded feet.
  const footGeo = new THREE.SphereGeometry(legR * 1.1, 18, 12);
  footGeo.scale(0.7, 0.4, 1.5);
  add(footGeo, -hipX, legR * 0.44, legR * 0.35);
  add(footGeo, hipX, legR * 0.44, legR * 0.35);

  // Arms: rounded shoulder ball + tapered lathe raked outward from vertical.
  const ballGeo = new THREE.SphereGeometry(armR * 1.15, 16, 12);
  add(ballGeo, -(shoulderX - armR * 0.35), shoulderY);
  add(ballGeo, shoulderX - armR * 0.35, shoulderY);

  const armAnchors: [number, number][] = [
    [0, armR * 0.95],
    [-armH * 0.15, armR * 0.9],
    [-armH * 0.5, armR * 0.78],
    [-armH * 0.8, armR * 0.64],
    [-armH, armR * 0.55],
    [-armH - 0.001, 0.004],
  ];
  add(latheProfile(armAnchors, 14, 14), -shoulderX, shoulderY, 0, -armRakeRad, 0.9);
  add(latheProfile(armAnchors, 14, 14), shoulderX, shoulderY, 0, armRakeRad, 0.9);

  // Simple hands along the raked arm axis.
  const handDist = armH + armR * 1.1;
  const handGeo = new THREE.SphereGeometry(armR * 0.8, 12, 8);
  handGeo.scale(0.75, 1.5, 0.5);
  const hx = Math.sin(armRakeRad) * handDist, hy = Math.cos(armRakeRad) * handDist;
  add(handGeo, -(shoulderX + hx), shoulderY - hy);
  add(handGeo, shoulderX + hx, shoulderY - hy);

  // Smooth ovoid head, no facial features.
  const headGeo = new THREE.SphereGeometry(headH * 0.45, 24, 18);
  headGeo.scale(0.86, 1.0, 0.92);
  add(headGeo, 0, body.headCenterY);

  group.userData.bodyMetrics = {
    heightM, chestR: body.chestR, waistR: body.waistR, hipR,
    legH, torsoH, torsoTop, headCenter: body.headCenterY,
    shoulderY, shoulderX, legSpacing: hipX,
  };
  return group;
}
