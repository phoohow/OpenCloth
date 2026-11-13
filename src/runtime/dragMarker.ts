/** Marker of the particle a pointer drag is pulling, plus the pull vector it applies. */

import type { Vec3 } from '@/base/math';
import type { CameraState } from '@/render/common';
import { CHANNEL_RASTER } from '@/render/world';
import type {
  EntityId, MaterialId, MaterialRef, MeshData, MeshId, Transform, WorldWriter,
} from '@/render/world';
import { markerSphere } from '@/runtime/pinMarkers';
import { normalizeTuple, pushQuad, pushTriangle } from '@/runtime/meshPrimitives';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Ring radius in meters. It marks the grabbed point, not the whole grab area, so it stays small. */
const RING_INNER_M = 0.0085;
const RING_OUTER_M = 0.0115;
/** Core dot radius, marking the exact particle the pull is anchored to. */
const CORE_RADIUS_M = 0.0025;
/** Number of segments around the ring. */
const RING_SEGMENTS = 28;
/** Shaft radius of the pull arrow, in meters. */
const ARROW_SHAFT_RADIUS_M = 0.003;
/** Fixed arrow length and head size, in meters. */
const ARROW_LENGTH_M = 0.08;
const ARROW_HEAD_LENGTH_M = 0.032;
const ARROW_HEAD_RADIUS_M = 0.0095;
/** Pulls shorter than this stay invisible, in meters. */
const ARROW_MIN_PULL_M = 0.002;
/** Marker colour and opacity. */
const MARKER_COLOR = '#59dcff';
const MARKER_OPACITY = 0.95;

/**
 * Marker for the particle a pointer drag is pulling: a camera-facing ring plus a solid core, drawn
 * on top of the cloth so the grabbed point stays visible while it follows the fabric. A fixed-length
 * arrow leaves that point along the pull direction; the force magnitude is shown beside it.
 */
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
  /** Point the pull is measured from, frozen when the grab starts. */
  private readonly anchor: Vec3 = { x: 0, y: 0, z: 0 };
  /** Current drag target the arrow points at. */
  private readonly tip: Vec3 = { x: 0, y: 0, z: 0 };
  private index: number | null = null;

  /** Particle the marker currently follows, or null. */
  get particleIndex(): number | null {
    return this.index;
  }

  /** Starts following `particleIndex`, placing the marker at its current position. */
  show(
    particleIndex: number, positions: Float32Array | null, host: PresenterHost, camera: CameraState,
  ): void {
    this.index = particleIndex;
    this.ensureShared(host);
    this.sync(positions, camera);
    this.anchor.x = this.position.x;
    this.anchor.y = this.position.y;
    this.anchor.z = this.position.z;
    this.tip.x = this.anchor.x;
    this.tip.y = this.anchor.y;
    this.tip.z = this.anchor.z;
    this.updateArrow();
  }

  /** Keeps the marker on its particle after a readback, and turns it toward the camera. */
  sync(positions: Float32Array | null, camera: CameraState): void {
    const writer = this.writer;
    if (writer === null || this.index === null) return;
    const offset = this.index * 3;
    if (positions && offset + 2 < positions.length) {
      this.position.x = positions[offset];
      this.position.y = positions[offset + 1];
      this.position.z = positions[offset + 2];
    }
    this.rotation = facingRotation(this.position, camera);
    const transform = this.transform();
    if (this.ringEntity !== null) writer.updateEntity(this.ringEntity, { transform });
    if (this.coreEntity !== null) writer.updateEntity(this.coreEntity, { transform });
    this.updateArrow();
  }

  /** Moves the pull direction toward the drag target; the tail stays on the grabbed particle. */
  moveTip(tip: Vec3): void {
    this.tip.x = tip.x;
    this.tip.y = tip.y;
    this.tip.z = tip.z;
    this.updateArrow();
  }

  /** Stops following and removes the marker from the world. */
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

  /** Removes the marker and frees the meshes and material it owns. */
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

  /** Creates the meshes, the material and the four entities on first use. */
  private ensureShared(host: PresenterHost): void {
    if (this.ringEntity !== null) return;
    const writer = host.writer;
    this.writer = writer;
    if (this.materialId === null) {
      // Alpha blending is what makes the compiler treat the marker as translucent.
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
      this.coreMeshId = writer.createMesh(markerSphere(CORE_RADIUS_M, 10, 8));
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
    return {
      position: { ...this.position },
      rotationEuler: { ...this.rotation },
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  /** World position of the arrow head, or null while no arrow is shown. */
  arrowHeadWorld(): Vec3 | null {
    if (this.index === null) return null;
    const dx = this.tip.x - this.anchor.x;
    const dy = this.tip.y - this.anchor.y;
    const dz = this.tip.z - this.anchor.z;
    const pull = Math.hypot(dx, dy, dz);
    if (pull < ARROW_MIN_PULL_M) return null;
    const scale = ARROW_LENGTH_M / pull;
    return {
      x: this.position.x + dx * scale,
      y: this.position.y + dy * scale,
      z: this.position.z + dz * scale,
    };
  }

  /** Re-aims the fixed-length pull arrow from the grabbed point; hides it while the pull is empty. */
  private updateArrow(): void {
    const writer = this.writer;
    if (writer === null || this.shaftEntity === null || this.headEntity === null) return;
    const dx = this.tip.x - this.anchor.x;
    const dy = this.tip.y - this.anchor.y;
    const dz = this.tip.z - this.anchor.z;
    const pull = Math.hypot(dx, dy, dz);
    if (pull < ARROW_MIN_PULL_M) {
      writer.updateEntity(this.shaftEntity, { channels: 0 });
      writer.updateEntity(this.headEntity, { channels: 0 });
      return;
    }
    const direction: Vec3 = { x: dx / pull, y: dy / pull, z: dz / pull };
    const rotation = aimRotation(direction);
    const shaftLength = ARROW_LENGTH_M - ARROW_HEAD_LENGTH_M;
    writer.updateEntity(this.shaftEntity, {
      channels: CHANNEL_RASTER,
      transform: {
        position: { ...this.position },
        rotationEuler: rotation,
        scale: { x: ARROW_SHAFT_RADIUS_M, y: ARROW_SHAFT_RADIUS_M, z: shaftLength },
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
        scale: { x: ARROW_HEAD_RADIUS_M, y: ARROW_HEAD_RADIUS_M, z: ARROW_HEAD_LENGTH_M },
      },
    });
  }
}

/** Flat annulus in the XY plane, so a rotation alone can face it at the camera. */
function ringMesh(): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
    const inner0: readonly [number, number] = [Math.cos(a0) * RING_INNER_M, Math.sin(a0) * RING_INNER_M];
    const inner1: readonly [number, number] = [Math.cos(a1) * RING_INNER_M, Math.sin(a1) * RING_INNER_M];
    const outer0: readonly [number, number] = [Math.cos(a0) * RING_OUTER_M, Math.sin(a0) * RING_OUTER_M];
    const outer1: readonly [number, number] = [Math.cos(a1) * RING_OUTER_M, Math.sin(a1) * RING_OUTER_M];
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

/** Unit cylinder along +Z; entity scale gives the shaft's real radius and length. */
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
    // Both end caps share the axis point, whose normal points along the axis.
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

/** Unit cone with its base at z = 0 and apex at z = +1; entity scale gives its real size. */
function arrowHeadMesh(segments = 14): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const am = (a0 + a1) / 2;
    const sideNormal: readonly [number, number, number] = normalizeTuple(
      Math.cos(am), Math.sin(am), 1,
    );
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

/**
 * Euler angles that turn the ring's +Z toward the camera, without roll. The rotated +Z axis of an
 * XYZ euler with no roll is (sin y, -sin x cos y, cos x cos y).
 */
function facingRotation(position: Vec3, camera: CameraState): Vec3 {
  const dx = camera.position.x - position.x;
  const dy = camera.position.y - position.y;
  const dz = camera.position.z - position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-9) return { x: 0, y: 0, z: 0 };
  return aimRotation({ x: dx / distance, y: dy / distance, z: dz / distance });
}

/** Euler angles that turn the +Z axis onto the unit vector `direction`, without roll. */
function aimRotation(direction: Vec3): Vec3 {
  return {
    x: Math.atan2(-direction.y, direction.z),
    y: Math.asin(Math.min(1, Math.max(-1, direction.x))),
    z: 0,
  };
}
