import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { bodyLandmarks } from '@/avatar/landmarks';
import { posedSkeleton, type Skeleton } from '@/avatar/skeleton';
import { makehumanBody } from '@/avatar/makehuman/body';
import { makehumanBodyData } from '@/avatar/makehuman/data';
import { AssetStore } from '@/render/backend/assets/assetStore';
import { makehumanAvatarSource } from '@/runtime/engine/makehumanAvatar';
import { createDefaultProject } from '@/model/defaults';

function built() {
  const body = makehumanBody(createDefaultProject().avatar.params);
  return { body, source: makehumanAvatarSource(body) };
}

function columnOf(name: string): number {
  const column = makehumanBodyData().motionRegions.indexOf(name);
  if (column < 0) throw new Error(`body carries no motion region "${name}"`);
  return column;
}

function motionOf(source: ReturnType<typeof makehumanAvatarSource>) {
  if (source.kind !== 'meshes' || !source.motion) throw new Error('body has no motion source');
  return source.motion;
}

function rig(): Skeleton {
  return bodyLandmarks(createDefaultProject().avatar.params).bodySkeleton();
}

function jointAt(skeleton: Skeleton, name: string) {
  const joint = skeleton.joints.find(candidate => candidate.name === name);
  if (!joint) throw new Error(`skeleton carries no joint "${name}"`);
  return joint.position;
}

function posedFrom(skeleton: Skeleton, handle: { regionPoses(): readonly { region: string; matrix: ArrayLike<number> }[] }) {
  const pose = new Map(handle.regionPoses().map(region => [region.region, Float32Array.from(region.matrix)]));
  return posedSkeleton(skeleton, pose);
}

function skinPositions(store: AssetStore): Float32Array {
  const body = store.objectFor('avatar')?.children.find(child => child.name === 'body') as THREE.Mesh | undefined;
  const geometry = body?.geometry;
  if (!geometry) throw new Error('avatar has no skin mesh');
  return geometry.getAttribute('position').array as Float32Array;
}

describe('MakeHuman procedural motion', () => {
  it('packs one weight per motion region for every vertex', () => {
    const { body, source } = built();
    const motion = motionOf(source);
    const vertexCount = body.positions.length / 3;
    expect(motion.weights.length).toBe(vertexCount * motion.pivots.length);
    expect(motion.pivots).toHaveLength(13);
    expect(motion.parents).toHaveLength(13);
    expect(motion.parents[columnOf('leftShoulder')]).toBe(columnOf('torso'));
    expect(motion.parents[columnOf('rightShoulder')]).toBe(columnOf('torso'));
    for (const anchored of ['leftHip', 'rightHip', 'torso']) {
      expect(motion.parents[columnOf(anchored)]).toBe(-1);
    }
  });

  it('authors four named clips with rotation tracks', () => {
    const { source } = built();
    const motion = motionOf(source);
    expect(motion.clips.map(clip => clip.name)).toEqual(['抬臂', '原地踏步', '伸展', '摆臂']);
    for (const clip of motion.clips) {
      expect(clip.duration).toBeGreaterThan(0);
      expect(clip.tracks.length).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        expect(track.region).toBeGreaterThanOrEqual(0);
        expect(track.region).toBeLessThan(motion.pivots.length);
        expect(track.times).toHaveLength(track.values.length);
        expect(clip.duration).toBe(track.times[track.times.length - 1]);
      }
    }
  });

  it('turns the shoulder around the pivot the T-pose was built with', () => {
    const params = createDefaultProject().avatar.params;
    const resting = makehumanBody({ ...params, pose: 'a' });
    const turned = makehumanBody({ ...params, pose: 't' });
    expect(turned.shoulderPivots.left).toEqual(resting.shoulderPivots.left);
    expect(turned.shoulderPivots.right).toEqual(resting.shoulderPivots.right);
    const motion = motionOf(makehumanAvatarSource(turned));
    expect(motion.pivots[columnOf('leftShoulder')]).toEqual(turned.shoulderPivots.left);
    expect(motion.pivots[columnOf('rightShoulder')]).toEqual(turned.shoulderPivots.right);
  });

  it('moves body vertices and its collider once a clip is playing', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);
    const before = handle.collision();
    expect(before).not.toBeNull();
    const original = Float32Array.from(before!.vertices);

    expect(handle.animations().map(clip => clip.name)).toContain('抬臂');
    expect(handle.play(0)).toBe(true);
    expect(handle.advance(1.0)).toBe(true);

    const after = handle.collision();
    expect(after).not.toBeNull();
    let moved = 0;
    for (let i = 0; i < original.length; i++) {
      if (Math.abs(original[i]! - after!.vertices[i]!) > 1e-4) moved++;
    }

    expect(moved).toBeGreaterThan(0);
    store.dispose();
  });

  it('carries the forearm and hand when the shoulder rotates', async () => {
    const { source } = built();
    const { weights } = motionOf(source);
    const regions = motionOf(source).pivots.length;
    const armColumns = [columnOf('leftShoulder'), columnOf('leftElbow'), columnOf('leftWrist')];

    const store = new AssetStore();
    const handle = await store.load('avatar', source);
    const positions = skinPositions(store);
    const before = Float32Array.from(positions);

    const arm: number[] = [];
    for (let v = 0; v < positions.length / 3; v++) {
      if (positions[v * 3]! < 0.25) continue;
      const armWeight = armColumns.reduce((sum, column) => sum + weights[v * regions + column]!, 0);
      if (armWeight > 0.6) arm.push(v);
    }

    expect(arm.length).toBeGreaterThan(0);

    expect(handle.play(0)).toBe(true);
    expect(handle.advance(1.0)).toBe(true);
    const risen = arm.filter(v => positions[v * 3 + 1]! > before[v * 3 + 1]! + 0.1);
    expect(risen.length).toBeGreaterThan(arm.length / 2);
    store.dispose();
  });

  it('leaves the body mesh and the feet where they were before a clip', async () => {
    const { body, source } = built();
    const rest = Float32Array.from(body.positions);
    const { weights } = motionOf(source);
    const regions = motionOf(source).pivots.length;
    const ankles = [columnOf('leftAnkle'), columnOf('rightAnkle')];

    const store = new AssetStore();
    const handle = await store.load('avatar', source);
    expect(handle.select(2)).toBe(true);
    handle.seek(1.5);

    const posed = skinPositions(store);
    let maxFootDelta = 0;
    let leaning = 0;
    for (let v = 0; v < posed.length / 3; v++) {
      const moved = Math.max(
        Math.abs(posed[v * 3]! - rest[v * 3]!),
        Math.abs(posed[v * 3 + 1]! - rest[v * 3 + 1]!),
        Math.abs(posed[v * 3 + 2]! - rest[v * 3 + 2]!),
      );
      if (moved > 0.01) leaning++;
      const ankle = ankles.reduce((sum, column) => sum + weights[v * regions + column]!, 0);
      if (ankle < 0.9) continue;
      maxFootDelta = Math.max(maxFootDelta, moved);
    }

    expect(leaning).toBeGreaterThan(0);
    expect(maxFootDelta).toBeLessThan(1e-3);
    expect(Array.from(body.positions)).toEqual(Array.from(rest));
    store.dispose();
  });

  it('publishes the posed rig, so a skeleton can follow the clip', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);

    const regions = handle.regionPoses();
    expect(regions).toHaveLength(13);
    expect(new Set(regions.map(region => region.region))).toEqual(
      new Set(['torso', 'leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow',
        'rightWrist', 'leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle']),
    );
    for (const region of regions) expect(region.matrix).toHaveLength(16);

    const skeleton = rig();
    const restWrist = jointAt(skeleton, 'leftWrist');
    const restAnkle = jointAt(skeleton, 'leftAnkle');

    expect(handle.play(0)).toBe(true);
    expect(handle.advance(1.0)).toBe(true);
    const raised = jointAt(posedFrom(skeleton, handle), 'leftWrist');
    const travelled = Math.hypot(
      raised[0] - restWrist[0], raised[1] - restWrist[1], raised[2] - restWrist[2],
    );
    expect(travelled).toBeGreaterThan(0.1);

    expect(handle.select(2)).toBe(true);
    handle.seek(1.5);
    const leaning = posedFrom(skeleton, handle);
    const shifted = jointAt(leaning, 'head');
    expect(Math.abs(shifted[2] - jointAt(skeleton, 'head')[2])).toBeGreaterThan(0.01);
    const ankle = jointAt(leaning, 'leftAnkle');
    expect(Math.hypot(ankle[0] - restAnkle[0], ankle[1] - restAnkle[1], ankle[2] - restAnkle[2]))
      .toBeLessThan(1e-6);

    handle.seek(0);
    const restored = jointAt(posedFrom(skeleton, handle), 'leftWrist');
    expect(Math.hypot(
      restored[0] - restWrist[0], restored[1] - restWrist[1], restored[2] - restWrist[2],
    )).toBeLessThan(1e-5);
    store.dispose();
  });

  it('drives each skeleton joint from the region on its own side', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);
    const motion = motionOf(source);
    const skeleton = rig();

    const vertices = skinPositions(store);
    const columns = motion.regions.length;
    const dominated = (region: string): number[] => {
      const column = motion.regions.indexOf(region);
      const out: number[] = [];
      for (let vertex = 0; vertex * 3 < vertices.length; vertex++) {
        if (motion.weights[vertex * columns + column]! > 0.9) out.push(vertex);
      }

      return out;
    };
    const meanZ = (ids: readonly number[]): number =>
      ids.reduce((sum, id) => sum + vertices[id * 3 + 2]!, 0) / ids.length;
    const left = dominated('leftWrist');
    const right = dominated('rightWrist');
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    const restLeftZ = meanZ(left);
    const restRightZ = meanZ(right);

    expect(handle.play(3)).toBe(true);
    expect(handle.advance(0.6)).toBe(true);
    const posed = posedFrom(skeleton, handle);
    const leftSurface = meanZ(left) - restLeftZ;
    const rightSurface = meanZ(right) - restRightZ;
    expect(Math.sign(leftSurface)).toBe(-Math.sign(rightSurface));

    const leftJoint = jointAt(posed, 'leftWrist')[2] - jointAt(skeleton, 'leftWrist')[2];
    const rightJoint = jointAt(posed, 'rightWrist')[2] - jointAt(skeleton, 'rightWrist')[2];
    expect(Math.sign(leftJoint)).toBe(Math.sign(leftSurface));
    expect(Math.sign(rightJoint)).toBe(Math.sign(rightSurface));
    expect(Math.abs(leftJoint)).toBeGreaterThan(0.05);
    store.dispose();
  });

  it('rebuilds the body normals when the skin moves', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);
    const root = store.objectFor('avatar');
    const body = root?.children.find(child => child.name === 'body') as THREE.Mesh | undefined;
    const normal = body?.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    expect(normal).toBeDefined();
    const before = Float32Array.from(normal!.array as Float32Array);

    handle.play(0);
    handle.advance(1.0);

    const after = normal!.array as Float32Array;
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs(before[i]! - after[i]!) > 1e-3) changed++;
    }

    expect(changed).toBeGreaterThan(0);
    store.dispose();
  });

  it('restores the base pose after seeking back to zero', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);
    const base = Float32Array.from(handle.collision()!.vertices);

    handle.play(0);
    handle.advance(1.0);
    handle.seek(0);

    const restored = handle.collision()!.vertices;
    let maxDelta = 0;
    for (let i = 0; i < base.length; i++) maxDelta = Math.max(maxDelta, Math.abs(base[i]! - restored[i]!));
    expect(maxDelta).toBeLessThan(1e-5);
    store.dispose();
  });

  it('honours a one-shot play on a clip that was only selected', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);

    expect(handle.select(0)).toBe(true);
    expect(handle.play(0, false)).toBe(true);
    handle.advance(3);

    expect(handle.playback().timeSeconds).toBeGreaterThan(1.9);
    store.dispose();
  });

  it('restarts a one-shot clip that already ran to its end', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);

    expect(handle.play(0, false)).toBe(true);
    handle.advance(3);
    expect(handle.playback().timeSeconds).toBeGreaterThan(1.9);

    expect(handle.play(0, false)).toBe(true);
    expect(handle.playback().timeSeconds).toBeLessThan(0.01);
    expect(handle.advance(0.5)).toBe(true);
    expect(handle.playback().timeSeconds).toBeCloseTo(0.5, 2);
    store.dispose();
  });

  it('keeps the vertex buffer untouched when the pose did not move', async () => {
    const { source } = built();
    const store = new AssetStore();
    const handle = await store.load('avatar', source);
    const rest = Float32Array.from(skinPositions(store));
    const revision = handle.revision;

    handle.play(0);
    expect(Array.from(skinPositions(store))).toEqual(Array.from(rest));
    expect(handle.revision).toBeGreaterThan(revision);

    handle.advance(1.0);
    expect(Array.from(skinPositions(store))).not.toEqual(Array.from(rest));
    store.dispose();
  });
});
