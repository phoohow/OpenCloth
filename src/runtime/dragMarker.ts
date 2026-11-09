/** Marker of the particle a pointer drag is pulling. */

import type { Vec3 } from '@/base/math';
import type { CameraState } from '@/render/common';
import { CHANNEL_RASTER } from '@/render/world';
import type {
  EntityId, MaterialId, MaterialRef, MeshData, MeshId, Transform, WorldWriter,
} from '@/render/world';
import { markerSphere } from '@/runtime/pinMarkers';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Ring radius in meters. It marks the grabbed point, not the whole grab area, so it stays small. */
const RING_INNER_M = 0.0085;
const RING_OUTER_M = 0.0115;
/** Core dot radius, marking the exact particle the pull is anchored to. */
const CORE_RADIUS_M = 0.0025;
/** Number of segments around the ring. */
const RING_SEGMENTS = 28;
/** Marker colour and opacity. */
const MARKER_COLOR = '#59dcff';
const MARKER_OPACITY = 0.95;

/**
 * Marker for the particle a pointer drag is pulling: a camera-facing ring plus a solid core, drawn
 * on top of the cloth so the grabbed point stays visible while it follows the fabric.
 */
export class DragMarker {
  private writer: WorldWriter | null = null;
  private materialId: MaterialId | null = null;
  private ringMeshId: MeshId | null = null;
  private coreMeshId: MeshId | null = null;
  private ringEntity: EntityId | null = null;
  private coreEntity: EntityId | null = null;
  private readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  private rotation: Vec3 = { x: 0, y: 0, z: 0 };
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
  }

  /** Stops following and removes the marker from the world. */
  hide(host: PresenterHost): void {
    this.index = null;
    const writer = host.writer;
    if (this.ringEntity !== null) writer.destroyEntity(this.ringEntity);
    if (this.coreEntity !== null) writer.destroyEntity(this.coreEntity);
    this.ringEntity = null;
    this.coreEntity = null;
  }

  /** Removes the marker and frees the meshes and material it owns. */
  dispose(host: PresenterHost): void {
    this.hide(host);
    const writer = host.writer;
    if (this.ringMeshId !== null) writer.destroyMesh(this.ringMeshId);
    if (this.coreMeshId !== null) writer.destroyMesh(this.coreMeshId);
    if (this.materialId !== null) writer.destroyMaterial(this.materialId);
    this.ringMeshId = null;
    this.coreMeshId = null;
    this.materialId = null;
    this.writer = null;
  }

  /** Creates the meshes, the material and the two entities on first use. */
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
  }

  private transform(): Transform {
    return {
      position: { ...this.position },
      rotationEuler: { ...this.rotation },
      scale: { x: 1, y: 1, z: 1 },
    };
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
  const x = dx / distance;
  const y = dy / distance;
  const z = dz / distance;
  return { x: Math.atan2(-y, z), y: Math.asin(Math.min(1, Math.max(-1, x))), z: 0 };
}
