/** The narrow surface presenters write through; never the renderer, GPU or three. */

import type {
  AssetPort, CameraHost, EntityId, MaterialId, TexturePort,
} from '@/render/common';
import type { WorldWriter } from '@/render/world';
import type { TriangleResolver } from '@/runtime/domainBindings';

export interface PresenterHost {
  readonly writer: WorldWriter;
  readonly textures: TexturePort;
  readonly assets: AssetPort;
  readonly camera: CameraHost;
  /** Registers a created entity in the domain binding table picking reads. */
  bind(domainKey: string, entity: EntityId, objectAt?: TriangleResolver): void;
  /** Forgets a destroyed entity's binding. */
  unbind(entity: EntityId): void;
}

/** Writes a plain, double-sided unlit material and returns its id. */
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
