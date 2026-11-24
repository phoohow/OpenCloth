import type { Vec3Tuple } from '@/base/math';
import type { AssetRegionPose, ProceduralMotion } from '@/render/common';

import { checkMotion, parentFirst } from '@/render/backend/assets/motionRegions';
import { PosedVertexBuffer } from '@/render/backend/assets/posedVertexBuffer';
import * as THREE from 'three/webgpu';

const EULER_ORDER = 'XYZ';

const PROXY_NAME = '__motionRegion';

type AngleProxy = THREE.Object3D & { angleX: number; angleY: number; angleZ: number };

interface SparseWeights {
  readonly start: Uint32Array;
  readonly region: Uint16Array;
  readonly value: Float32Array;
}

function sparseWeights(weights: Float32Array, vertexCount: number, regionCount: number): SparseWeights {
  const counts = new Uint32Array(vertexCount + 1);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    let used = 0;
    for (let region = 0; region < regionCount; region++) {
      if (weights[vertex * regionCount + region]! > 0) used++;
    }

    counts[vertex + 1] = used;
  }

  for (let vertex = 0; vertex < vertexCount; vertex++) counts[vertex + 1] += counts[vertex]!;

  const region = new Uint16Array(counts[vertexCount]!);
  const value = new Float32Array(region.length);
  let at = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    for (let column = 0; column < regionCount; column++) {
      const weight = weights[vertex * regionCount + column]!;
      if (weight <= 0) continue;
      region[at] = column;
      value[at] = weight;
      at++;
    }
  }

  return { start: counts, region, value };
}

export class ProceduralMotionDriver {
  readonly clips: readonly THREE.AnimationClip[];
  private readonly proxies: readonly AngleProxy[];
  private readonly buffer: PosedVertexBuffer;
  private readonly weights: SparseWeights;
  private readonly pivots: readonly Vec3Tuple[];
  private readonly poses: readonly AssetRegionPose[];
  private readonly parents: readonly number[];
  private readonly order: readonly number[];
  private readonly regionCount: number;
  private readonly matrices: Float32Array;
  private readonly transforms: THREE.Matrix4[];
  private readonly appliedAngles: Float32Array;
  private readonly local = new THREE.Matrix4();
  private readonly rotation = new THREE.Matrix4();
  private readonly translation = new THREE.Matrix4();
  private readonly inverseTranslation = new THREE.Matrix4();
  private readonly euler = new THREE.Euler(0, 0, 0, EULER_ORDER);

  constructor(root: THREE.Object3D, source: Float32Array, motion: ProceduralMotion) {
    const vertexCount = source.length / 3;
    checkMotion(motion, vertexCount);
    this.buffer = new PosedVertexBuffer(root, source);
    this.weights = sparseWeights(motion.weights, vertexCount, motion.pivots.length);
    this.pivots = motion.pivots;
    this.parents = motion.parents;
    this.regionCount = motion.pivots.length;
    this.matrices = new Float32Array(this.regionCount * 16);
    this.transforms = Array.from({ length: this.regionCount }, () => new THREE.Matrix4());
    this.appliedAngles = new Float32Array(this.regionCount * 3);
    this.order = parentFirst(this.parents);
    this.poses = motion.regions.map((region, index) => ({
      region,
      matrix: this.matrices.subarray(index * 16, index * 16 + 16),
    }));

    this.proxies = motion.pivots.map((_, region) => {
      const proxy = new THREE.Object3D() as AngleProxy;
      proxy.name = `${PROXY_NAME}${region}`;
      proxy.angleX = 0;
      proxy.angleY = 0;
      proxy.angleZ = 0;
      root.add(proxy);
      return proxy;
    });

    this.clips = motion.clips.map(clip => {
      const tracks: THREE.KeyframeTrack[] = [];
      for (const track of clip.tracks) {
        const proxy = this.proxies[track.region]!;
        const xs: number[] = [];
        const ys: number[] = [];
        const zs: number[] = [];
        for (const value of track.values) {
          xs.push(value[0]);
          ys.push(value[1]);
          zs.push(value[2]);
        }

        tracks.push(new THREE.NumberKeyframeTrack(`${proxy.name}.angleX`, track.times, xs));
        tracks.push(new THREE.NumberKeyframeTrack(`${proxy.name}.angleY`, track.times, ys));
        tracks.push(new THREE.NumberKeyframeTrack(`${proxy.name}.angleZ`, track.times, zs));
      }

      return new THREE.AnimationClip(clip.name, clip.duration, tracks);
    });

    this.composeTransforms();
  }

  regionPoses(): readonly AssetRegionPose[] {
    return this.poses;
  }

  update(): void {
    if (this.composeTransforms()) this.blend();
  }

  pose(force = false): boolean {
    const moved = this.composeTransforms();
    if (!moved && !force) return false;
    this.blend();
    return true;
  }

  detachProxies(): void {
    for (const proxy of this.proxies) proxy.removeFromParent();
  }

  attachProxies(root: THREE.Object3D): void {
    for (const proxy of this.proxies) root.add(proxy);
  }

  dispose(): void {
    this.detachProxies();
  }

  private composeTransforms(): boolean {
    let moved = false;
    for (const region of this.order) {
      const proxy = this.proxies[region]!;
      const applied = region * 3;
      if (proxy.angleX !== this.appliedAngles[applied]
        || proxy.angleY !== this.appliedAngles[applied + 1]
        || proxy.angleZ !== this.appliedAngles[applied + 2]) moved = true;
      this.euler.set(proxy.angleX, proxy.angleY, proxy.angleZ, EULER_ORDER);
      this.rotation.makeRotationFromEuler(this.euler);
      const pivot = this.pivots[region]!;
      this.translation.makeTranslation(pivot[0], pivot[1], pivot[2]);
      this.inverseTranslation.makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
      this.local.copy(this.translation).multiply(this.rotation).multiply(this.inverseTranslation);
      const transform = this.transforms[region]!;
      transform.copy(this.local);
      const parent = this.parents[region] ?? -1;
      if (parent >= 0) transform.premultiply(this.transforms[parent]!);
      transform.toArray(this.matrices, region * 16);
    }

    return moved;
  }

  private blend(): void {
    for (let region = 0; region < this.regionCount; region++) {
      const proxy = this.proxies[region]!;
      this.appliedAngles[region * 3] = proxy.angleX;
      this.appliedAngles[region * 3 + 1] = proxy.angleY;
      this.appliedAngles[region * 3 + 2] = proxy.angleZ;
    }

    this.writePositions();
    this.buffer.refresh();
  }

  private writePositions(): void {
    const { positions, base } = this.buffer;
    const { start, region, value } = this.weights;
    const matrices = this.matrices;
    const vertexCount = base.length / 3;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const index = vertex * 3;
      const bx = base[index]!;
      const by = base[index + 1]!;
      const bz = base[index + 2]!;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let entry = start[vertex]!; entry < start[vertex + 1]!; entry++) {
        const m = region[entry]! * 16;
        const weight = value[entry]!;
        x += weight * (matrices[m]! * bx + matrices[m + 4]! * by + matrices[m + 8]! * bz + matrices[m + 12]!);
        y += weight * (matrices[m + 1]! * bx + matrices[m + 5]! * by + matrices[m + 9]! * bz + matrices[m + 13]!);
        z += weight * (matrices[m + 2]! * bx + matrices[m + 6]! * by + matrices[m + 10]! * bz + matrices[m + 14]!);
      }

      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = z;
    }
  }
}
