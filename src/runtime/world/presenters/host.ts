import type {
  AssetPort, CameraHost, EntityId, MaterialId, TexturePort,
} from '@/render/common';
import type { WorldWriter } from '@/render/world';
import type { TriangleResolver } from '@/runtime/view/domainBindings';

export interface PresenterHost {
  readonly writer: WorldWriter;
  readonly textures: TexturePort;
  readonly assets: AssetPort;
  readonly camera: CameraHost;
  bind(domainKey: string, entity: EntityId, objectAt?: TriangleResolver): void;
  unbind(entity: EntityId): void;
}

export function overlayMaterial(
  writer: WorldWriter,
  color: string,
  options: {
    readonly name: string;
    readonly opacity?: number;
    readonly depthTest?: boolean;
    readonly blending?: 'normal' | 'additive';
  },
): MaterialId {
  return writer.createMaterial({
    kind: 'unlit',
    name: options.name,
    color,
    opacity: options.opacity ?? 1,
    blending: options.blending === 'additive' ? 'additive' : 'opaque',
    depth: options.depthTest === false ? 'always' : 'tested',
    depthWrite: false,
    side: 'double',
  });
}
