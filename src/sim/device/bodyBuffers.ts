import type { CollisionSurface } from '@/sim/common';
import type { DeviceServices } from '@/sim/device/commands';

export interface BodyBuffers {
  triangle: GPUBuffer;
  cellStart: GPUBuffer;
  cellTriangles: GPUBuffer;
}

export function packTriangles(surface: CollisionSurface): Float32Array {
  const vertices = new Float32Array(surface.triangleCount * 12);
  for (let t = 0; t < surface.triangleCount; t++) {
    const src = t * 9;
    const dst = t * 12;
    for (let k = 0; k < 3; k++) {
      vertices[dst + k * 4] = surface.vertices[src + k * 3]!;
      vertices[dst + k * 4 + 1] = surface.vertices[src + k * 3 + 1]!;
      vertices[dst + k * 4 + 2] = surface.vertices[src + k * 3 + 2]!;
    }
  }

  return vertices;
}

function writeOrReplace(
  services: DeviceServices,
  buffer: GPUBuffer,
  data: Float32Array | Uint32Array,
): { buffer: GPUBuffer; replaced: boolean } {
  if (buffer.size === data.byteLength) {
    services.commands.write(buffer, data);
    return { buffer, replaced: false };
  }

  buffer.destroy();
  return { buffer: services.ledger.storage(data), replaced: true };
}

export function refreshBodyBuffers(
  services: DeviceServices, surface: CollisionSurface, buffers: BodyBuffers,
): { buffers: BodyBuffers; replaced: boolean } {
  const triangle = writeOrReplace(services, buffers.triangle, packTriangles(surface));
  const cellStart = writeOrReplace(services, buffers.cellStart, surface.cellStart);
  const cellTriangles = writeOrReplace(services, buffers.cellTriangles, surface.cellTriangles);
  return {
    buffers: { triangle: triangle.buffer, cellStart: cellStart.buffer, cellTriangles: cellTriangles.buffer },
    replaced: triangle.replaced || cellStart.replaced || cellTriangles.replaced,
  };
}
