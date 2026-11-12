/** Procedural mannequin silhouette as plain mesh data, free of any scene library. */

import type { AssetMesh, MaterialData, MeshData } from '@/render/common';
import type { AvatarParams } from '@/model/types';
import {
  appliedLimbPose, armChain, bodyLandmarks, legChain, type BodyLandmarks, type Point3,
} from '@/avatar';
import { clamp, quaternionFromUnitVectors, rotateQuaternion3, type Quaternion } from '@/base/math';
import { computeVertexNormals } from '@/base/geom';
import {
  ellipsoid, loftLimb, loftRings, orientOutward,
  type ProfileAnchor, type RawMesh, type Ring,
} from '@/runtime/bodyGeometry';

/** Downward local axis the limb lathes run along. */
const DOWN: Point3 = [0, -1, 0];

/** Placement of one part: translation and the rotation taking the downward axis onto the limb. */
interface Placement {
  position: Point3;
  rotation?: Quaternion;
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

/** Quaternion turning the downward axis onto `dir`. */
function downTo(dir: Point3): Quaternion {
  const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return quaternionFromUnitVectors(DOWN, [dir[0] / length, dir[1] / length, dir[2] / length]);
}

/** Bakes a part placement into its vertex positions. */
function bakeMesh(raw: RawMesh, placement: Placement): RawMesh {
  const positions = new Float32Array(raw.positions.length);
  for (let i = 0; i < raw.positions.length; i += 3) {
    let v: Point3 = [raw.positions[i], raw.positions[i + 1], raw.positions[i + 2]];
    if (placement.rotation) v = rotateQuaternion3(v, placement.rotation);
    positions[i] = v[0] + placement.position[0];
    positions[i + 1] = v[1] + placement.position[1];
    positions[i + 2] = v[2] + placement.position[2];
  }
  return { positions, indices: raw.indices };
}

/** Offsets a point along a unit direction. */
function advance(from: Point3, dir: Point3, distance: number): Point3 {
  return [from[0] + dir[0] * distance, from[1] + dir[1] * distance, from[2] + dir[2] * distance];
}

/** Torso and neck as one lofted surface, from the groin to under the jaw. */
function buildTorso(body: BodyLandmarks, steps = 84): RawMesh {
  const rings: Ring[] = [];
  const cleftLo = body.crotchY;
  const cleftPeak = body.hipY - body.torsoH * 0.03;
  const cleftHi = body.waistY;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  /** Depth tuck at the centre of the back, so the seat reads as two cheeks. */
  const buttockCleft = (y: number): number => {
    if (y <= cleftLo || y >= cleftHi) return 0;
    const amount = y <= cleftPeak
      ? smooth((y - cleftLo) / (cleftPeak - cleftLo))
      : smooth((cleftHi - y) / (cleftHi - cleftPeak));
    return 0.22 * amount;
  };

  // Breast mounds: two swellings either side of the sternum, shaped so they swell out of the chest
  // wall rather than sitting on it. Their height and depth both fade to nothing at the edges.
  // How much the torso reads as female: a small waist against wide hips, which is the clearest
  // signal the measurements carry. It scales the bust volume, its width and the sternum valley,
  // so the same geometry gives breasts on a 88/70/98 figure and broad flat pecs on a 94/80/96 one.
  const bustiness = clamp((1 - body.waistR / body.hipR - 0.10) / 0.16, 0, 1);
  const bustAmount = clamp(0.004 + 0.034 * bustiness, 0.004, 0.038);
  // The breast root reaches up toward the second rib and tucks under at the inframammary fold:
  // a long gradual slope above the apex, a short one below it, so the underside folds in.
  const bustTop = body.bustY + body.height * 0.066;
  const bustBottom = body.bustY - body.height * 0.032;
  const bustPeak = body.bustY;
  const bustFactor = (y: number): number => {
    if (y <= bustBottom || y >= bustTop) return 0;
    if (y <= bustPeak) {
      return Math.cos((Math.PI / 2) * ((bustPeak - y) / (bustPeak - bustBottom))) ** 2;
    }
    return Math.cos((Math.PI / 2) * ((y - bustPeak) / (bustTop - bustPeak))) ** 2;
  };
  const FRONT = Math.PI / 2;
  const BUST_SPREAD = 0.50 + 0.12 * (1 - bustiness);
  const BUST_WIDTH = 0.62 + 0.34 * (1 - bustiness);
  const moundAt = (y: number): Ring['bulges'] => {
    const k = bustFactor(y);
    if (k <= 1e-4) return undefined;
    const amount = bustAmount * k;
    return [
      { angle: FRONT - BUST_SPREAD, width: BUST_WIDTH, amount },
      { angle: FRONT + BUST_SPREAD, width: BUST_WIDTH, amount },
      // Sternum: a shallow valley between the two mounds, never a dent of its own.
      { angle: FRONT, width: 0.30, amount: -amount * 0.45 * bustiness },
    ];
  };

  for (let i = 0; i <= steps; i++) {
    const y = body.crotchY + (body.neckTopY - body.crotchY) * (i / steps);
    const section = body.torsoSectionAt(y);
    const squareness = 2.3 - 0.3 * Math.exp(-(((y - body.bustY) / (body.height * 0.085)) ** 2));
    // The landmarks give the outer envelope the cloth and the collider wrap around, so the chest
    // wall is pulled back by exactly what the mounds add at the bust point.
    const amount = bustAmount * bustFactor(y);
    const apex = Math.sin(FRONT - BUST_SPREAD) ** (2 / squareness);
    rings.push({
      y,
      rx: section.rx,
      // Take the smaller of the two, so an absent mound never inflates the chest wall.
      rz: Math.max(Math.min(section.front, (section.front - amount) / apex), section.front * 0.55),
      rzBack: section.back,
      squareness,
      cx: body.torsoCenterXAt(y),
      cz: body.torsoCenterZAt(y),
      cleft: buttockCleft(y),
      bulges: moundAt(y),
    });
  }
  // Groin: the pelvis tapers into the perineum and ends tucked between the thighs, so the
  // bottom of the torso is never visible as a hem under the seat.
  const first = rings[0];
  const groin: Ring[] = [
    {
      ...first,
      y: first.y - body.height * 0.006,
      rx: first.rx * 0.74, rz: first.rz * 0.82, rzBack: (first.rzBack ?? first.rz) * 0.88,
    },
    {
      ...first,
      y: first.y - body.height * 0.015,
      rx: first.rx * 0.46, rz: first.rz * 0.56, rzBack: (first.rzBack ?? first.rz) * 0.62,
    },
    {
      ...first,
      y: first.y - body.height * 0.026,
      rx: first.rx * 0.24, rz: first.rz * 0.32, rzBack: (first.rzBack ?? first.rz) * 0.38,
    },
  ];
  const all = [...groin, ...rings];
  return loftRings(all, 48, { bottom: body.height * 0.006, top: body.neckR * 0.6 });
}

/** Head as a lofted skull: narrow chin, wide cheekbones and a domed crown. */
function buildHead(body: BodyLandmarks): RawMesh {
  const halfW = body.headHalfW;
  const halfD = body.headHalfD;
  // t runs from the chin to the top of the skull; f and b are the face and occiput depths.
  const shape: Array<{ t: number; rx: number; f: number; b: number }> = [
    { t: 0.00, rx: 0.60, f: 0.60, b: 0.70 },
    { t: 0.10, rx: 0.74, f: 0.76, b: 0.78 },
    { t: 0.22, rx: 0.84, f: 0.90, b: 0.76 },
    { t: 0.36, rx: 0.90, f: 0.97, b: 0.87 },
    { t: 0.50, rx: 0.98, f: 1.00, b: 0.96 },
    { t: 0.64, rx: 1.00, f: 0.95, b: 1.00 },
    { t: 0.76, rx: 0.97, f: 0.88, b: 1.00 },
    { t: 0.86, rx: 0.88, f: 0.78, b: 0.93 },
  ];
  const section = (t: number) => {
    let k = 1;
    while (k < shape.length - 1 && shape[k].t < t) k++;
    const a = shape[k - 1];
    const b = shape[k];
    const u = Math.min(Math.max((t - a.t) / (b.t - a.t), 0), 1);
    return {
      rx: a.rx + (b.rx - a.rx) * u,
      f: a.f + (b.f - a.f) * u,
      b: a.b + (b.b - a.b) * u,
    };
  };

  const cx = body.torsoCenterXAt(body.headCenterY);
  const headCz = body.torsoCenterZAt(body.headCenterY);
  const rings: Ring[] = [];
  const steps = 18;
  const crownStart = 0.86;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * crownStart;
    const s = section(t);
    rings.push({
      y: body.neckTopY + body.headH * t,
      rx: s.rx * halfW, rz: s.f * halfD, rzBack: s.b * halfD, squareness: 2.15, cx,
      cz: body.torsoCenterZAt(body.neckTopY + body.headH * t),
    });
  }
  // Crown: a dome over the last part of the skull, sampled by angle so the top stays round.
  const base = section(crownStart);
  const crownH = body.headH * (1 - crownStart);
  const crownSteps = 6;
  for (let k = 1; k < crownSteps; k++) {
    const theta = (k / crownSteps) * (Math.PI / 2);
    const scale = Math.cos(theta);
    rings.push({
      y: body.neckTopY + body.headH * crownStart + crownH * Math.sin(theta),
      rx: base.rx * halfW * scale,
      rz: base.f * halfD * scale,
      rzBack: base.b * halfD * scale,
      squareness: 2.15,
      cx,
      cz: headCz,
    });
  }
  const lastTheta = ((crownSteps - 1) / crownSteps) * (Math.PI / 2);
  return loftRings(rings, 28, {
    bottom: body.headH * 0.02,
    top: crownH * (1 - Math.sin(lastTheta)),
  });
}

/** Palm, fingers and thumb of one hand, hanging along `dir`. */
function buildHand(body: BodyLandmarks, wrist: Point3, dir: Point3, side: -1 | 1): Array<{ name: string; mesh: RawMesh; placement: Placement }> {
  const rotation = downTo(dir);
  const palmLen = body.handLen * 0.52;
  const fingerLen = body.handLen * 0.48;
  const thickness = body.handHalfT;
  const width = body.handHalfW;

  const palm: ProfileAnchor[] = [
    { t: 0, rx: thickness * 0.82, rz: width * 0.66 },
    { t: 0.45, rx: thickness, rz: width * 0.94 },
    { t: 1, rx: thickness * 0.9, rz: width },
  ];
  const fingers: ProfileAnchor[] = [
    { t: 0, rx: thickness * 0.9, rz: width * 0.98 },
    { t: 0.45, rx: thickness * 0.82, rz: width * 0.92 },
    { t: 0.82, rx: thickness * 0.64, rz: width * 0.74 },
    { t: 1, rx: thickness * 0.52, rz: width * 0.62 },
  ];
  const thumbDir: Point3 = [-side * 0.22, -0.78, 0.58];
  const thumbRoot = advance(advance(wrist, dir, palmLen * 0.35), [0, 0, 1], width * 0.62);
  const thumb: ProfileAnchor[] = [
    { t: 0, rx: thickness * 1.15 },
    { t: 0.5, rx: thickness * 0.95 },
    { t: 1, rx: thickness * 0.8 },
  ];

  return [
    { name: 'palm', mesh: loftLimb(palm, palmLen, 16, 6, 0.7), placement: { position: wrist, rotation } },
    {
      name: 'fingers',
      mesh: loftLimb(fingers, fingerLen, 16, 8, 0.9),
      placement: { position: advance(wrist, dir, palmLen), rotation },
    },
    {
      name: 'thumb',
      mesh: loftLimb(thumb, body.handLen * 0.34, 12, 6, 0.9),
      placement: { position: thumbRoot, rotation: downTo(thumbDir) },
    },
  ];
}

/** One foot, built around the ankle with the sole on the floor. */
function buildFoot(body: BodyLandmarks): RawMesh {
  const ankle = body.ankleY;
  const width = body.footHalfW;
  const length = body.footLen;
  // Rings rise from the sole to the ankle joint; the foot loses length as it rises, so the
  // instep clears the toes instead of leaving a boot-shaped block.
  const rings: Ring[] = [
    { y: -ankle, rx: width * 0.86, rz: length * 0.66, rzBack: length * 0.3, squareness: 3.4 },
    { y: -ankle * 0.82, rx: width * 0.92, rz: length * 0.64, rzBack: length * 0.31, squareness: 3.2 },
    { y: -ankle * 0.66, rx: width * 0.96, rz: length * 0.56, rzBack: length * 0.31, squareness: 3 },
    { y: -ankle * 0.5, rx: width * 0.9, rz: length * 0.44, rzBack: length * 0.3, squareness: 2.8 },
    { y: -ankle * 0.34, rx: width * 0.8, rz: length * 0.32, rzBack: length * 0.28, squareness: 2.5 },
    { y: -ankle * 0.18, rx: width * 0.68, rz: length * 0.22, rzBack: length * 0.26, squareness: 2.3 },
    { y: 0, rx: body.ankleR * 1.35, rz: body.ankleR * 1.5, rzBack: body.ankleR * 1.45 },
    { y: body.ankleR * 1.4, rx: body.ankleR * 1.15, rz: body.ankleR * 1.2, rzBack: body.ankleR * 1.15 },
  ];
  return loftRings(rings, 22, { bottom: 0, top: body.ankleR * 0.8 });
}

/**
 * Builds the stylized mannequin from bodyLandmarks measurements so the figure, collision
 * capsules and cloth wrap share one silhouette. All meshes are in metres.
 */
export function proceduralAvatarMeshes(params: AvatarParams): AssetMesh[] {
  const body = bodyLandmarks(params);
  const meshes: AssetMesh[] = [];

  const add = (name: string, raw: RawMesh, placement: Placement): void => {
    const baked = bakeMesh(orientOutward(raw), placement);
    const mesh: MeshData = {
      topology: 'triangle',
      streams: { position: baked.positions, normal: computeVertexNormals(baked.positions, baked.indices) },
      index: baked.indices,
    };
    meshes.push({ name, mesh, material: SKIN });
  };

  add('torso', buildTorso(body), { position: [0, 0, 0] });
  add('head', buildHead(body), { position: [0, 0, 0] });

  const shoulderCap = ellipsoid(body.deltoidR * 1.06, body.deltoidR * 1.3, body.deltoidR * 1.04, 20, 14);
  const elbowBall = ellipsoid(body.elbowR * 1.05, body.elbowR * 1.05, body.elbowR * 1.05, 16, 10);
  const kneeBall = ellipsoid(body.kneeR * 1.02, body.kneeR * 1.08, body.kneeR * 1.22, 18, 10);

  const upperArm: ProfileAnchor[] = [
    { t: 0, rx: body.deltoidR * 0.98 },
    { t: 0.28, rx: body.armR },
    { t: 0.62, rx: body.armR * 0.92 },
    { t: 0.88, rx: body.armR * 0.78 },
    { t: 1, rx: body.elbowR },
  ];
  const forearm: ProfileAnchor[] = [
    { t: 0, rx: body.forearmR },
    { t: 0.3, rx: body.forearmR * 0.94 },
    { t: 0.7, rx: body.forearmR * 0.74 },
    { t: 1, rx: body.wristR },
  ];
  const upperArmMesh = loftLimb(upperArm, body.upperArmLen, 20, 16);
  const forearmMesh = loftLimb(forearm, body.forearmLen, 20, 16);

  const thigh: ProfileAnchor[] = [
    { t: 0, rx: body.thighTopR },
    { t: 0.3, rx: body.legR },
    { t: 0.7, rx: body.legR * 0.82 },
    { t: 1, rx: body.kneeR },
  ];
  const calf: ProfileAnchor[] = [
    { t: 0, rx: body.kneeR * 0.98, rz: body.kneeR * 1.15 },
    { t: 0.22, rx: body.calfR, rz: body.calfR * 1.12 },
    { t: 0.6, rx: body.calfR * 0.78, rz: body.calfR * 0.92 },
    { t: 0.9, rx: body.ankleR * 1.12, rz: body.ankleR * 1.25 },
    { t: 1, rx: body.ankleR, rz: body.ankleR * 1.2 },
  ];
  const thighMesh = loftLimb(thigh, body.thighLen, 22, 16);
  const calfMesh = loftLimb(calf, body.shinLen, 22, 18);
  const footMesh = buildFoot(body);

  for (const side of [-1, 1] as const) {
    const label = side < 0 ? 'left' : 'right';
    const joints = appliedLimbPose(params.joints, side);

    const arm = armChain(body, side, joints);
    const shoulderTop = advance(arm.root, arm.dir1, body.deltoidR * 0.62);
    add(`shoulder-${label}`, shoulderCap, { position: shoulderTop });
    add(`upper-arm-${label}`, upperArmMesh, { position: arm.root, rotation: downTo(arm.dir1) });
    add(`elbow-${label}`, elbowBall, { position: arm.mid });
    add(`forearm-${label}`, forearmMesh, { position: arm.mid, rotation: downTo(arm.dir2) });
    for (const part of buildHand(body, arm.end, arm.dir2, side)) {
      add(`${part.name}-${label}`, part.mesh, part.placement);
    }

    const leg = legChain(body, side, joints);
    add(`thigh-${label}`, thighMesh, { position: leg.root, rotation: downTo(leg.dir1) });
    add(`knee-${label}`, kneeBall, { position: leg.mid });
    add(`calf-${label}`, calfMesh, { position: leg.mid, rotation: downTo(leg.dir2) });
    add(`foot-${label}`, footMesh, { position: leg.end, rotation: downTo(leg.dir2) });
  }

  return meshes;
}
