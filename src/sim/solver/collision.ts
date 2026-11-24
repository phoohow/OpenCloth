import type { ColliderGrid, CollisionSurface } from '@/sim/common';
import type { DeviceServices } from '@/sim/device/commands';

import { packTriangles, refreshBodyBuffers, type BodyBuffers } from '@/sim/device/bodyBuffers';

function colliderGrid(surface: CollisionSurface): ColliderGrid {
  return {
    triangleCount: surface.triangleCount,
    origin: surface.origin,
    cell: surface.cell,
    dims: surface.dims,
  };
}

export class Collision {
  buffers: BodyBuffers;
  grid: ColliderGrid = { triangleCount: 0, origin: [0, 0, 0], cell: 1, dims: [0, 0, 0] };
  surface: CollisionSurface | null = null;

  constructor(private readonly services: DeviceServices) {
    const { ledger } = services;
    this.buffers = {
      triangle: ledger.storage(new Float32Array(4)),
      cellStart: ledger.storage(new Uint32Array(2)),
      cellTriangles: ledger.storage(new Uint32Array(1)),
    };
  }

  attach(surface: CollisionSurface | null): void {
    this.surface = surface;
    if (!surface) {
      this.grid = { ...this.grid, triangleCount: 0 };
      return;
    }

    const { ledger } = this.services;
    for (const buffer of [this.buffers.triangle, this.buffers.cellStart, this.buffers.cellTriangles]) {
      ledger.release(buffer);
    }

    this.buffers = {
      triangle: ledger.storage(packTriangles(surface)),
      cellStart: ledger.storage(surface.cellStart),
      cellTriangles: ledger.storage(surface.cellTriangles),
    };
    this.grid = colliderGrid(surface);
  }

  moveVertices(vertices: Float32Array): boolean {
    if (vertices.byteLength !== this.buffers.triangle.size) return false;
    this.services.commands.write(this.buffers.triangle, vertices);
    return true;
  }

  refresh(surface: CollisionSurface): boolean {
    this.surface = surface;
    this.grid = colliderGrid(surface);
    const refreshed = refreshBodyBuffers(this.services, surface, this.buffers);
    this.buffers = {
      triangle: this.services.ledger.track(refreshed.buffers.triangle),
      cellStart: this.services.ledger.track(refreshed.buffers.cellStart),
      cellTriangles: this.services.ledger.track(refreshed.buffers.cellTriangles),
    };
    return refreshed.replaced;
  }
}
