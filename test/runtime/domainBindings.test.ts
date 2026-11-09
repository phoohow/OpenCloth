import { describe, expect, it } from 'vitest';
import type { AssetPort, CameraHost, Ray, RayHit } from '@/render/common';
import type { WorldView } from '@/render/world';
import { DomainBindings } from '@/runtime/domainBindings';
import { PickingService } from '@/runtime/picking';

describe('DomainBindings', () => {
  it('resolves bound entities and their triangle ranges', () => {
    const bindings = new DomainBindings();
    bindings.bind('cloth', 7, triangle => (triangle < 10 ? 'panel-a' : 'panel-b'));

    expect(bindings.resolve(7)).toEqual({ key: 'cloth', object: null });
    expect(bindings.resolve(7, 3)).toEqual({ key: 'cloth', object: 'panel-a' });
    expect(bindings.resolve(7, 12)).toEqual({ key: 'cloth', object: 'panel-b' });
    expect(bindings.resolve(8)).toBeNull();
  });

  it('rebinds, unbinds and clears', () => {
    const bindings = new DomainBindings();
    bindings.bind('avatar', 1);
    bindings.bind('avatar', 1);
    expect(bindings.resolve(1)?.key).toBe('avatar');

    bindings.unbind(1);
    expect(bindings.resolve(1)).toBeNull();

    bindings.bind('cloth', 2);
    bindings.bind('ref', 3);
    bindings.clear();
    expect(bindings.resolve(2)).toBeNull();
    expect(bindings.resolve(3)).toBeNull();
  });
});

/** Picking over a stub world whose mesh hit and asset list the test controls. */
function picking(bindings: DomainBindings, meshHit: RayHit | null, assetEntities: number[] = []) {
  const ray: Ray = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  const camera = { ray: () => ray } as unknown as CameraHost;
  const world = {
    raycast: () => meshHit,
    entities: () => assetEntities.map(id => ({
      id,
      mesh: { kind: 'asset', key: `asset-${id}` },
      tags: new Set(['avatar']),
    })),
    entity: () => null,
  } as unknown as WorldView;
  const assets = {
    handle: () => ({
      raycast: () => ({ distance: 2, point: { x: 0, y: 0, z: -2 } }),
    }),
  } as unknown as AssetPort;
  return new PickingService(camera, world, assets, bindings);
}

/** Mesh hit of one triangle on an entity. */
function hit(entity: number, distance: number): RayHit {
  return {
    entity,
    triangle: 4,
    distance,
    point: { x: 0, y: 0, z: -distance },
    barycentric: [1, 0, 0],
  };
}

describe('PickingService', () => {
  it('reports the bound domain key, not the entity tags', () => {
    const bindings = new DomainBindings();
    bindings.bind('cloth', 7);
    const service = picking(bindings, hit(7, 1));

    expect(service.pick(0, 0)?.domainKey).toBe('cloth');
  });

  it('leaves unbound entities without a domain key even when tagged', () => {
    const service = picking(new DomainBindings(), hit(7, 1));

    expect(service.pick(0, 0)?.domainKey).toBe('');
  });

  it('resolves asset hits through the binding table and keeps the nearest', () => {
    const bindings = new DomainBindings();
    bindings.bind('avatar', 3);
    const service = picking(bindings, hit(7, 3), [3]);
    bindings.bind('cloth', 7);

    // The asset at distance 2 is nearer than the mesh at distance 3.
    expect(service.pick(0, 0)).toMatchObject({ entity: 3, domainKey: 'avatar', triangle: -1 });
  });
});