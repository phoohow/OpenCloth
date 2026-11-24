import type { Vec3 } from '@/base/math';
import type { DomainBindings } from '@/runtime/view/domainBindings';

import {
  CHANNEL_RASTER, type AssetPort, type CameraHost, type EntityId, type Ray, type RayHit,
} from '@/render/common';
import { pickableLayers, type WorldView } from '@/render/world';

export interface PickResult {
  readonly entity: EntityId;
  readonly domainKey: string;
  readonly triangle: number;
  readonly barycentric: readonly [number, number, number];
  readonly point: Vec3;
  readonly distance: number;
}

export class PickingService {
  constructor(
    private readonly camera: CameraHost,
    private readonly world: WorldView,
    private readonly assets: AssetPort,
    private readonly bindings: DomainBindings,
  ) {}

  pick(ndcX: number, ndcY: number): PickResult | null {
    const ray = this.camera.ray(ndcX, ndcY);
    const filter = { layers: pickableLayers(), channels: CHANNEL_RASTER };
    const meshHit = this.world.raycast(ray, filter);
    const assetHit = this.raycastAssets(ray);
    if (!meshHit && !assetHit) return null;
    if (meshHit && (!assetHit || meshHit.distance <= assetHit.distance)) {
      return this.fromMesh(meshHit);
    }

    return assetHit;
  }

  private raycastAssets(ray: Ray): PickResult | null {
    let best: PickResult | null = null;
    for (const entity of this.world.entities({ layers: pickableLayers() })) {
      if (entity.mesh.kind !== 'asset') continue;
      const handle = this.assets.handle(entity.mesh.key);
      const hit = handle?.raycast(ray);
      if (!hit || (best && hit.distance >= best.distance)) continue;
      best = {
        entity: entity.id,
        domainKey: this.bindings.resolve(entity.id)?.key ?? '',
        triangle: -1,
        barycentric: [1, 0, 0],
        point: hit.point,
        distance: hit.distance,
      };
    }

    return best;
  }

  private fromMesh(hit: RayHit): PickResult {
    return {
      entity: hit.entity,
      domainKey: this.bindings.resolve(hit.entity, hit.triangle)?.key ?? '',
      triangle: hit.triangle,
      barycentric: hit.barycentric,
      point: hit.point,
      distance: hit.distance,
    };
  }
}
