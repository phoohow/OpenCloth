import type { CameraState } from '@/render/common';
import type {
  EntityId, MaterialId, MaterialRef, MeshData, MeshId, Transform, WorldWriter,
} from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import {
  add3, length3, normalize3, normalize3t, scale3, sub3, type Vec3,
} from '@/base/math';
import { worldUnitsPerPixel } from '@/render/common';
import { CHANNEL_RASTER } from '@/render/world';
import { pushQuad, pushTriangle } from '@/runtime/engine/meshPrimitives';
import { markerSphere } from '@/runtime/world/pinMarkers';

const RING_INNER_PX = 5;

const RING_OUTER_PX = 6.6;

const CORE_RADIUS_PX = 1.5;

const RING_SEGMENTS = 28;

const ARROW_SHAFT_RADIUS_PX = 1.7;

const ARROW_LENGTH_PX = 46;

const ARROW_HEAD_LENGTH_PX = 18;

const ARROW_HEAD_RADIUS_PX = 5.4;

const ARROW_MIN_PULL_PX = 1.5;

const MARKER_COLOR = '#59dcff';

const MARKER_OPACITY = 0.95;

export class DragMarker {
  private writer: WorldWriter | null = null;
  private materialId: MaterialId | null = null;
  private ringMeshId: MeshId | null = null;
  private coreMeshId: MeshId | null = null;
  private shaftMeshId: MeshId | null = null;
  private headMeshId: MeshId | null = null;
  private ringEntity: EntityId | null = null;
  private coreEntity: EntityId | null = null;
  private shaftEntity: EntityId | null = null;
  private headEntity: EntityId | null = null;
  private readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  private rotation: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly anchor: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly tip: Vec3 = { x: 0, y: 0, z: 0 };
  private unitsPerPixel = 0;
  private index: number | null = null;

  get particleIndex(): number | null {
    return this.index;
  }

  show(
    particleIndex: number, positions: Float32Array | null, host: PresenterHost,
    camera: CameraState, viewportHeight: number,
  ): void {
    this.index = particleIndex;
    this.ensureShared(host);
    this.sync(positions, camera, viewportHeight);
    this.anchor.x = this.position.x;
    this.anchor.y = this.position.y;
    this.anchor.z = this.position.z;
    this.tip.x = this.anchor.x;
    this.tip.y = this.anchor.y;
    this.tip.z = this.anchor.z;
    this.updateArrow();
  }

  sync(positions: Float32Array | null, camera: CameraState, viewportHeight: number): void {
    const writer = this.writer;
    if (writer === null || this.index === null) return;
    const offset = this.index * 3;
    if (positions && offset + 2 < positions.length) {
      this.position.x = positions[offset];
      this.position.y = positions[offset + 1];
      this.position.z = positions[offset + 2];
    }

    this.unitsPerPixel = worldUnitsPerPixel(camera, this.position, Math.max(1, viewportHeight));
    this.rotation = facingRotation(this.position, camera);
    const transform = this.transform();
    if (this.ringEntity !== null) writer.updateEntity(this.ringEntity, { transform });
    if (this.coreEntity !== null) writer.updateEntity(this.coreEntity, { transform });
    this.updateArrow();
  }

  moveTip(tip: Vec3): void {
    this.tip.x = tip.x;
    this.tip.y = tip.y;
    this.tip.z = tip.z;
    this.updateArrow();
  }

  hide(host: PresenterHost): void {
    this.index = null;
    const writer = host.writer;
    if (this.ringEntity !== null) writer.destroyEntity(this.ringEntity);
    if (this.coreEntity !== null) writer.destroyEntity(this.coreEntity);
    if (this.shaftEntity !== null) writer.destroyEntity(this.shaftEntity);
    if (this.headEntity !== null) writer.destroyEntity(this.headEntity);
    this.ringEntity = null;
    this.coreEntity = null;
    this.shaftEntity = null;
    this.headEntity = null;
  }

  dispose(host: PresenterHost): void {
    this.hide(host);
    const writer = host.writer;
    if (this.ringMeshId !== null) writer.destroyMesh(this.ringMeshId);
    if (this.coreMeshId !== null) writer.destroyMesh(this.coreMeshId);
    if (this.shaftMeshId !== null) writer.destroyMesh(this.shaftMeshId);
    if (this.headMeshId !== null) writer.destroyMesh(this.headMeshId);
    if (this.materialId !== null) writer.destroyMaterial(this.materialId);
    this.ringMeshId = null;
    this.coreMeshId = null;
    this.shaftMeshId = null;
    this.headMeshId = null;
    this.materialId = null;
    this.writer = null;
  }

  private ensureShared(host: PresenterHost): void {
    if (this.ringEntity !== null) return;
    const writer = host.writer;
    this.writer = writer;
    if (this.materialId === null) {
      this.materialId = writer.createMaterial({
        kind: 'unlit',
        name: 'dragMarker',
        color: MARKER_COLOR,
        opacity: MARKER_OPACITY,
        blending: 'alpha',
        depth: 'always',
        depthWrite: false,
        side: 'double',
      });
      this.ringMeshId = writer.createMesh(ringMesh());
      this.coreMeshId = writer.createMesh(markerSphere(CORE_RADIUS_PX, 10, 8));
      this.shaftMeshId = writer.createMesh(arrowShaftMesh());
      this.headMeshId = writer.createMesh(arrowHeadMesh());
    }

    const material: MaterialRef[] = [{ kind: 'material', id: this.materialId! }];
    this.ringEntity = writer.createEntity({
      layer: 'gizmo',
      tags: ['dragMarker'],
      mesh: { kind: 'mesh', id: this.ringMeshId! },
      materials: material,
      channels: CHANNEL_RASTER,
    });
    this.coreEntity = writer.createEntity({
      layer: 'gizmo',
      tags: ['dragMarker'],
      mesh: { kind: 'mesh', id: this.coreMeshId! },
      materials: material,
      channels: CHANNEL_RASTER,
    });
    this.shaftEntity = writer.createEntity({
      layer: 'gizmo',
      tags: ['dragMarker'],
      mesh: { kind: 'mesh', id: this.shaftMeshId! },
      materials: material,
      channels: 0,
    });
    this.headEntity = writer.createEntity({
      layer: 'gizmo',
      tags: ['dragMarker'],
      mesh: { kind: 'mesh', id: this.headMeshId! },
      materials: material,
      channels: 0,
    });
  }

  private transform(): Transform {
    const scale = this.unitsPerPixel;
    return {
      position: { ...this.position },
      rotationEuler: { ...this.rotation },
      scale: { x: scale, y: scale, z: scale },
    };
  }

  arrowHeadWorld(): Vec3 | null {
    if (this.index === null) return null;
    const pull = this.pullVector();
    if (!pull) return null;
    const scale = ARROW_LENGTH_PX * this.unitsPerPixel / pull.length;
    return add3(this.position, scale3(pull, scale));
  }

  private pullVector(): Vec3 & { length: number } | null {
    const pull = sub3(this.tip, this.anchor);
    const length = length3(pull);
    if (length < Math.max(1e-6, ARROW_MIN_PULL_PX * this.unitsPerPixel)) return null;
    return { ...pull, length };
  }

  private updateArrow(): void {
    const writer = this.writer;
    if (writer === null || this.shaftEntity === null || this.headEntity === null) return;
    const pull = this.pullVector();
    if (!pull) {
      writer.updateEntity(this.shaftEntity, { channels: 0 });
      writer.updateEntity(this.headEntity, { channels: 0 });
      return;
    }

    const direction: Vec3 = normalize3(pull);
    const rotation = aimRotation(direction);
    const unit = this.unitsPerPixel;
    const shaftLength = (ARROW_LENGTH_PX - ARROW_HEAD_LENGTH_PX) * unit;
    const shaftRadius = ARROW_SHAFT_RADIUS_PX * unit;
    writer.updateEntity(this.shaftEntity, {
      channels: CHANNEL_RASTER,
      transform: {
        position: { ...this.position },
        rotationEuler: rotation,
        scale: { x: shaftRadius, y: shaftRadius, z: shaftLength },
      },
    });
    writer.updateEntity(this.headEntity, {
      channels: CHANNEL_RASTER,
      transform: {
        position: {
          x: this.position.x + direction.x * shaftLength,
          y: this.position.y + direction.y * shaftLength,
          z: this.position.z + direction.z * shaftLength,
        },
        rotationEuler: rotation,
        scale: {
          x: ARROW_HEAD_RADIUS_PX * unit,
          y: ARROW_HEAD_RADIUS_PX * unit,
          z: ARROW_HEAD_LENGTH_PX * unit,
        },
      },
    });
  }
}

function ringMesh(): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
    const inner0: readonly [number, number] = [Math.cos(a0) * RING_INNER_PX, Math.sin(a0) * RING_INNER_PX];
    const inner1: readonly [number, number] = [Math.cos(a1) * RING_INNER_PX, Math.sin(a1) * RING_INNER_PX];
    const outer0: readonly [number, number] = [Math.cos(a0) * RING_OUTER_PX, Math.sin(a0) * RING_OUTER_PX];
    const outer1: readonly [number, number] = [Math.cos(a1) * RING_OUTER_PX, Math.sin(a1) * RING_OUTER_PX];
    positions.push(
      inner0[0], inner0[1], 0, outer0[0], outer0[1], 0, outer1[0], outer1[1], 0,
      inner0[0], inner0[1], 0, outer1[0], outer1[1], 0, inner1[0], inner1[1], 0,
    );
    for (let vertex = 0; vertex < 6; vertex++) normals.push(0, 0, 1);
  }

  return {
    topology: 'triangle',
    streams: { position: new Float32Array(positions), normal: new Float32Array(normals) },
  };
}

function arrowShaftMesh(segments = 12): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    pushQuad(positions, normals,
      [c0, s0, 0], [c1, s1, 0], [c1, s1, 1], [c0, s0, 1],
      [c0, s0, 0], [c1, s1, 0], [c1, s1, 0], [c0, s0, 0]);
    pushTriangle(positions, normals,
      [0, 0, 0], [c1, s1, 0], [c0, s0, 0],
      [0, 0, -1], [0, 0, -1], [0, 0, -1]);
    pushTriangle(positions, normals,
      [0, 0, 1], [c0, s0, 1], [c1, s1, 1],
      [0, 0, 1], [0, 0, 1], [0, 0, 1]);
  }

  return {
    topology: 'triangle',
    streams: { position: new Float32Array(positions), normal: new Float32Array(normals) },
  };
}

function arrowHeadMesh(segments = 14): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const am = (a0 + a1) / 2;
    const sideNormal = normalize3t([Math.cos(am), Math.sin(am), 1]);
    pushTriangle(positions, normals,
      [c0, s0, 0], [c1, s1, 0], [0, 0, 1],
      sideNormal, sideNormal, sideNormal);
    pushTriangle(positions, normals,
      [0, 0, 0], [c1, s1, 0], [c0, s0, 0],
      [0, 0, -1], [0, 0, -1], [0, 0, -1]);
  }

  return {
    topology: 'triangle',
    streams: { position: new Float32Array(positions), normal: new Float32Array(normals) },
  };
}

function facingRotation(position: Vec3, camera: CameraState): Vec3 {
  const dx = camera.position.x - position.x;
  const dy = camera.position.y - position.y;
  const dz = camera.position.z - position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-9) return { x: 0, y: 0, z: 0 };
  return aimRotation({ x: dx / distance, y: dy / distance, z: dz / distance });
}

function aimRotation(direction: Vec3): Vec3 {
  return {
    x: Math.atan2(-direction.y, direction.z),
    y: Math.asin(Math.min(1, Math.max(-1, direction.x))),
    z: 0,
  };
}
