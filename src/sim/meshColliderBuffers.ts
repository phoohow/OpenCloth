import type { MeshCollider } from '@/avatar/collider';
import { createStorageBuffer } from '@/sim/gpuPipelines';
import type { CollideBody } from '@/sim/simUniforms';

/** GPU storage buffers describing the body mesh collision grid. */
export interface MeshColliderBuffers {
  triangle: GPUBuffer;
  cellStart: GPUBuffer;
  cellTriangles: GPUBuffer;
}

/** Collision-uniform description of a body mesh. */
export function collideBodyForMesh(mesh: MeshCollider, capsuleCount: number): CollideBody {
  return {
    capsuleCount,
    triangleCount: mesh.triangleCount,
    gridOrigin: mesh.origin,
    gridCell: mesh.cell,
    gridDims: mesh.dims,
  };
}

/** Body triangles widened to three vec4 slots per triangle for the storage-buffer stride. */
export function packMeshTriangles(mesh: MeshCollider): Float32Array {
  const vertices = new Float32Array(mesh.triangleCount * 12);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const src = t * 9;
    const dst = t * 12;
    for (let k = 0; k < 3; k++) {
      vertices[dst + k * 4] = mesh.vertices[src + k * 3]!;
      vertices[dst + k * 4 + 1] = mesh.vertices[src + k * 3 + 1]!;
      vertices[dst + k * 4 + 2] = mesh.vertices[src + k * 3 + 2]!;
    }
  }
  return vertices;
}

/** Allocates the three collision buffers for a body mesh. */
export function createMeshColliderBuffers(device: GPUDevice, mesh: MeshCollider): MeshColliderBuffers {
  return {
    triangle: createStorageBuffer(device, packMeshTriangles(mesh)),
    cellStart: createStorageBuffer(device, mesh.cellStart),
    cellTriangles: createStorageBuffer(device, mesh.cellTriangles),
  };
}

/** Overwrites one buffer when it fits, replacing it when the payload outgrew it. */
function writeOrReplace(
  device: GPUDevice, buffer: GPUBuffer, data: Float32Array | Uint32Array,
): { buffer: GPUBuffer; replaced: boolean } {
  const bytes = data.buffer as ArrayBuffer;
  if (buffer.size === data.byteLength) {
    device.queue.writeBuffer(buffer, 0, bytes, data.byteOffset, data.byteLength);
    return { buffer, replaced: false };
  }
  buffer.destroy();
  return { buffer: createStorageBuffer(device, data), replaced: true };
}

/**
 * Refreshes the collision buffers after the body moved. `replaced` is true when any buffer
 * changed size, so the caller must rebuild the collision bind group.
 */
export function refreshMeshColliderBuffers(
  device: GPUDevice, mesh: MeshCollider, buffers: MeshColliderBuffers,
): { buffers: MeshColliderBuffers; replaced: boolean } {
  const triangle = writeOrReplace(device, buffers.triangle, packMeshTriangles(mesh));
  const cellStart = writeOrReplace(device, buffers.cellStart, mesh.cellStart);
  const cellTriangles = writeOrReplace(device, buffers.cellTriangles, mesh.cellTriangles);
  return {
    buffers: { triangle: triangle.buffer, cellStart: cellStart.buffer, cellTriangles: cellTriangles.buffer },
    replaced: triangle.replaced || cellStart.replaced || cellTriangles.replaced,
  };
}
