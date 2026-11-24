import type { AvatarParams, ObjectTransform } from '@/model/types';
import type { AssetRegionPose } from '@/render/common';
import type { EntityId, MeshDesc, MeshId } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import {
  bodyLandmarks, posedSkeleton, tubeFrame, type Skeleton, type SkeletonBone, type SkeletonJoint,
} from '@/avatar';
import { hexToLinearRgb, type LinearRgb } from '@/base/color';
import { add3t, distance3t, normalize3t, scale3t, sub3t, type Vec3Tuple } from '@/base/math';
import { CHANNEL_RASTER } from '@/render/world';
import { guideTransform } from '@/runtime/world/guideTransform';

const BONE_SIDES = 4;

const BONE_BULGE_STATION = 0.22;

const BALL_SIDES = 4;

const BONE_COLOR = '#3f8fe8';

const JOINT_COLOR = '#ffb020';

const BONE_VERTICES = 2 + BONE_SIDES;

const BALL_VERTICES = 2 + BALL_SIDES;

class SkeletonWriter {
  private cursor = 0;

  constructor(
    private readonly positions: Float32Array,
    private readonly colors: Float32Array,
    private readonly index: number[] | null,
  ) {}

  vertex(point: Vec3Tuple, color: LinearRgb): number {
    const at = this.cursor++;
    this.positions[at * 3] = point[0];
    this.positions[at * 3 + 1] = point[1];
    this.positions[at * 3 + 2] = point[2];
    this.colors[at * 3] = color[0];
    this.colors[at * 3 + 1] = color[1];
    this.colors[at * 3 + 2] = color[2];
    return at;
  }

  triangle(a: number, b: number, c: number): void {
    this.index?.push(a, b, c);
  }
}

function addBone(
  out: SkeletonWriter, bone: SkeletonBone, from: Vec3Tuple, to: Vec3Tuple, color: LinearRgb,
): void {
  const axis = normalize3t(sub3t(to, from));
  const { u, v } = tubeFrame(axis);
  const bulge = add3t(from, scale3t(axis, distance3t(from, to) * BONE_BULGE_STATION));
  const apexFrom = out.vertex(from, color);
  const apexTo = out.vertex(to, color);
  const ring: number[] = [];
  for (let i = 0; i < BONE_SIDES; i++) {
    const angle = (i / BONE_SIDES) * Math.PI * 2;
    const across = add3t(
      scale3t(u, Math.cos(angle) * bone.width),
      scale3t(v, Math.sin(angle) * bone.width),
    );
    ring.push(out.vertex(add3t(bulge, across), color));
  }

  for (let i = 0; i < BONE_SIDES; i++) {
    const next = (i + 1) % BONE_SIDES;
    out.triangle(apexFrom, ring[i]!, ring[next]!);
    out.triangle(apexTo, ring[next]!, ring[i]!);
  }
}

function addJointBall(out: SkeletonWriter, joint: SkeletonJoint, color: LinearRgb): void {
  const [x, y, z] = joint.position;
  const r = joint.radius;
  const top = out.vertex([x, y + r, z], color);
  const bottom = out.vertex([x, y - r, z], color);
  const ring: number[] = [];
  for (let i = 0; i < BALL_SIDES; i++) {
    const angle = (i / BALL_SIDES) * Math.PI * 2;
    ring.push(out.vertex([x + Math.cos(angle) * r, y, z + Math.sin(angle) * r], color));
  }

  for (let i = 0; i < BALL_SIDES; i++) {
    const next = (i + 1) % BALL_SIDES;
    out.triangle(top, ring[i]!, ring[next]!);
    out.triangle(bottom, ring[next]!, ring[i]!);
  }
}

function writeSkeleton(writer: SkeletonWriter, skeleton: Skeleton): void {
  const at = new Map(skeleton.joints.map(joint => [joint.name, joint.position]));
  const boneColor = hexToLinearRgb(BONE_COLOR);
  const ballColor = hexToLinearRgb(JOINT_COLOR);
  for (const bone of skeleton.bones) {
    addBone(writer, bone, at.get(bone.from)!, at.get(bone.to)!, boneColor);
  }

  for (const joint of skeleton.joints) addJointBall(writer, joint, ballColor);
}

function vertexCount(skeleton: Skeleton): number {
  return skeleton.bones.length * BONE_VERTICES + skeleton.joints.length * BALL_VERTICES;
}

export class SkeletonStage {
  private readonly meshId: MeshId;
  private readonly entity: EntityId;
  private readonly rest: Skeleton;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private visible = false;

  constructor(private readonly host: PresenterHost, params: AvatarParams, transform?: ObjectTransform) {
    this.rest = bodyLandmarks(params).bodySkeleton();
    const vertices = vertexCount(this.rest);
    this.positions = new Float32Array(vertices * 3);
    this.colors = new Float32Array(vertices * 3);
    const index: number[] = [];
    writeSkeleton(new SkeletonWriter(this.positions, this.colors, index), this.rest);

    const writer = host.writer;
    const desc: MeshDesc = {
      topology: 'triangle',
      streams: { position: this.positions, color: this.colors },
      index: new Uint32Array(index),
    };
    this.meshId = writer.createMesh(desc);
    this.entity = writer.createEntity({
      layer: 'gizmo',
      tags: ['rigSkeleton'],
      mesh: { kind: 'mesh', id: this.meshId },
      channels: CHANNEL_RASTER,
      transform: guideTransform(transform),
    });
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.host.writer.updateEntity(this.entity, {
      tags: visible ? ['rigSkeleton', 'xrayGuide'] : ['rigSkeleton'],
    });
  }

  pose(regions: readonly AssetRegionPose[]): void {
    if (regions.length === 0) return;
    const matrices = new Map(regions.map(region => [region.region, region.matrix]));
    const posed = posedSkeleton(this.rest, matrices);
    writeSkeleton(new SkeletonWriter(this.positions, this.colors, null), posed);
    this.host.writer.updateMesh(this.meshId, { streams: { position: this.positions } });
  }

  place(transform?: ObjectTransform): void {
    this.host.writer.updateEntity(this.entity, { transform: guideTransform(transform) });
  }

  dispose(): void {
    const writer = this.host.writer;
    writer.destroyEntity(this.entity);
    writer.destroyMesh(this.meshId);
  }
}
