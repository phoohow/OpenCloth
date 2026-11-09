import { describe, expect, it } from 'vitest';
import {
  CHANNEL_ALL, CHANNEL_RASTER, CHANNEL_TRACE, IDENTITY_TRANSFORM, createRenderWorld,
  type MeshId, type WorldPorts,
} from '@/render/world';

type TestWorld = {
  writer(): WorldPorts['writer'];
  view: WorldPorts['view'];
  versions: WorldPorts['versions'];
};

/** World ports with the writer callable, matching the old test surface. */
function makeWorld(): TestWorld {
  const ports = createRenderWorld();
  return { writer: () => ports.writer, view: ports.view, versions: ports.versions };
}

/** Single triangle in the xy plane at z = 0. */
function trianglePositions(): Float32Array {
  return new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
}

function meshId(world: ReturnType<typeof makeWorld>): MeshId {
  return world.writer().createMesh({
    topology: 'triangle',
    streams: { position: trianglePositions() },
  });
}

describe('RenderWorld entities', () => {
  it('bumps topology and visibility when an entity joins or leaves', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const topology = world.versions.topology;
    const visibility = world.versions.visibility;

    const id = world.writer().createEntity({
      layer: 'subject',
      mesh: { kind: 'mesh', id: mesh },
    });

    expect(world.versions.topology).toBe(topology + 1);
    expect(world.versions.visibility).toBe(visibility + 1);
    expect(world.view.entity(id)?.layer).toBe('subject');

    world.writer().destroyEntity(id);
    expect(world.view.entity(id)).toBeNull();
    expect(world.versions.topology).toBe(topology + 2);
  });

  it('defaults channels from the layer policy', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const subject = world.writer().createEntity({
      layer: 'subject', mesh: { kind: 'mesh', id: mesh },
    });
    const gizmo = world.writer().createEntity({
      layer: 'gizmo', mesh: { kind: 'mesh', id: mesh },
    });

    expect(world.view.entity(subject)?.channels).toBe(CHANNEL_ALL);
    expect(world.view.entity(gizmo)?.channels).toBe(CHANNEL_RASTER);
  });

  it('filters by layer, channel and tags', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const writer = world.writer();
    writer.createEntity({
      layer: 'subject', tags: ['subjectSurface'], mesh: { kind: 'mesh', id: mesh },
      channels: CHANNEL_RASTER,
    });
    writer.createEntity({
      layer: 'overlay', tags: ['mark'], mesh: { kind: 'mesh', id: mesh },
      channels: CHANNEL_TRACE,
    });

    expect(world.view.entities({ layers: ['subject'] })).toHaveLength(1);
    expect(world.view.entities({ channels: CHANNEL_TRACE })).toHaveLength(1);
    expect(world.view.entities({ tags: ['subjectSurface'] })).toHaveLength(1);
    expect(world.view.entities({ tags: ['subjectSurface', 'mark'] })).toHaveLength(0);
  });
});

describe('RenderWorld versions', () => {
  it('bumps transform and recomputes bounds', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const id = world.writer().createEntity({
      layer: 'subject', mesh: { kind: 'mesh', id: mesh },
    });
    const before = world.view.entity(id)!.bounds;
    const transformVersion = world.versions.transform;

    world.writer().updateEntity(id, {
      transform: {
        ...IDENTITY_TRANSFORM,
        position: { x: 2, y: 0, z: 0 },
      },
    });

    expect(world.versions.transform).toBe(transformVersion + 1);
    expect(world.view.entity(id)!.bounds.min.x).toBe(2);
    expect(before.min.x).toBe(0);
  });

  it('bumps geometry when positions change and refreshes entity bounds', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const id = world.writer().createEntity({
      layer: 'subject', mesh: { kind: 'mesh', id: mesh },
    });
    const geometry = world.versions.geometry;

    world.writer().updateMesh(mesh, {
      streams: {
        position: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
      },
    });

    expect(world.versions.geometry).toBe(geometry + 1);
    expect(world.view.entity(id)!.bounds.max.x).toBe(2);
  });

  it('bumps topology when groups change', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const topology = world.versions.topology;

    world.writer().updateMesh(mesh, {
      groups: [{ start: 0, count: 3, materialSlot: 0 }],
    });

    expect(world.versions.topology).toBe(topology + 1);
  });

  it('bumps material, light and environment versions', () => {
    const world = makeWorld();
    const material = world.writer().createMaterial({ kind: 'surface', color: '#fff' });
    const materialVersion = world.versions.material;

    world.writer().updateMaterial(material, { color: '#000' });
    expect(world.versions.material).toBe(materialVersion + 1);

    const lightVersion = world.versions.lights;
    const light = world.writer().addLight({
      type: 'directional', name: 'key', color: '#fff', intensity: 1,
      position: { x: 0, y: 1, z: 0 }, target: { x: 0, y: 0, z: 0 },
      distance: 0, coneAngleDeg: 45, penumbra: 0, width: 1, height: 1, enabled: true,
    });
    expect(world.versions.lights).toBe(lightVersion + 1);

    world.writer().removeLight(light);
    expect(world.versions.lights).toBe(lightVersion + 2);

    const environmentVersion = world.versions.environment;
    world.writer().setEnvironment({ color: '#111' });
    expect(world.versions.environment).toBe(environmentVersion + 1);
    expect(world.view.environment().color).toBe('#111');
  });
});

describe('RenderWorld queries', () => {
  it('unions bounds and returns an empty box when nothing matches', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    world.writer().createEntity({
      layer: 'subject', mesh: { kind: 'mesh', id: mesh },
      transform: { ...IDENTITY_TRANSFORM, position: { x: 3, y: 0, z: 0 } },
    });

    expect(world.view.bounds({ layers: ['subject'] }).min.x).toBe(3);
    expect(world.view.bounds({ layers: ['overlay'] }).max.x).toBe(0);
  });

  it('raycasts the nearest triangle and reports barycentric weights', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const id = world.writer().createEntity({
      layer: 'subject', mesh: { kind: 'mesh', id: mesh },
    });

    const hit = world.view.raycast({
      origin: { x: 0.25, y: 0.25, z: 1 },
      direction: { x: 0, y: 0, z: -1 },
    }, { layers: ['subject'] });

    expect(hit?.entity).toBe(id);
    expect(hit?.distance).toBeCloseTo(1);
    expect(hit?.barycentric[0]).toBeCloseTo(0.5);
    expect(hit?.barycentric[1]).toBeCloseTo(0.25);
    expect(hit?.barycentric[2]).toBeCloseTo(0.25);
  });

  it('applies the entity transform to raycast hits', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    world.writer().createEntity({
      layer: 'subject', mesh: { kind: 'mesh', id: mesh },
      transform: { ...IDENTITY_TRANSFORM, position: { x: 2, y: 0, z: 0 } },
    });

    const hit = world.view.raycast({
      origin: { x: 2.25, y: 0.25, z: 1 },
      direction: { x: 0, y: 0, z: -1 },
    });

    expect(hit?.point.x).toBeCloseTo(2.25);
  });

  it('returns null for an opaque asset mesh', () => {
    const world = makeWorld();
    world.writer().createEntity({
      layer: 'subject',
      mesh: { kind: 'asset', key: 'avatar' },
      bounds: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
    });

    expect(world.view.raycast({
      origin: { x: 0, y: 1, z: 2 },
      direction: { x: 0, y: 0, z: -1 },
    })).toBeNull();
    expect(world.view.bounds().max.y).toBe(2);
  });
});
