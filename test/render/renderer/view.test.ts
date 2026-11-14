import { describe, expect, it } from 'vitest';
import {
  CHANNEL_ALL, CHANNEL_RASTER, createRenderWorld, type MaterialId, type MeshId, type WorldPorts,
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
import {
  buildDrawList, defaultViewSettings, type RenderView, type ViewSettings,
} from '@/render/renderer/view';

/** Single triangle, enough to give an entity geometry. */
function meshId(world: ReturnType<typeof makeWorld>): MeshId {
  return world.writer().createMesh({
    topology: 'triangle',
    streams: { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
  });
}

function surfaceMaterial(world: ReturnType<typeof makeWorld>): MaterialId {
  return world.writer().createMaterial({ kind: 'surface', color: '#f0f0f0' });
}

/** View with overrides applied to the default settings. */
function view(patch: Partial<ViewSettings> = {}, channels = CHANNEL_ALL): RenderView {
  return {
    camera: {
      projection: 'perspective',
      position: { x: 0, y: 1, z: 3 },
      target: { x: 0, y: 1, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fovDeg: 45,
      viewHeightMeters: 1,
      aspect: 1,
      near: 0.1,
      far: 100,
    },
    viewport: { width: 800, height: 600 },
    layers: ['underlay', 'subject', 'overlay', 'gizmo'],
    channels,
    settings: { ...defaultViewSettings(), ...patch },
    overrides: [],
    frame: 1,
  };
}

function worldWithCloth(): { world: ReturnType<typeof makeWorld>; mesh: MeshId; material: MaterialId } {
  const world = makeWorld();
  const mesh = meshId(world);
  const material = surfaceMaterial(world);
  world.writer().createEntity({
    layer: 'subject',
    tags: ['subjectSurface'],
    mesh: { kind: 'mesh', id: mesh },
    materials: [{ kind: 'material', id: material }],
  });
  return { world, mesh, material };
}

describe('draw list', () => {
  it('resolves a physical fill into one surface variant', () => {
    const { world } = worldWithCloth();
    const list = buildDrawList(world.view, view());
    const item = list.items[0]!;

    expect(list.items).toHaveLength(1);
    expect(item.materials[0]?.technique).toBe('surface');
    expect(item.wire).toBeNull();
    expect(item.stage).toBe('scene');
  });

  it('adds a wire variant in over mode', () => {
    const { world } = worldWithCloth();
    const item = buildDrawList(world.view, view({ wire: 'over' })).items[0]!;

    expect(item.materials[0]?.technique).toBe('surface');
    expect(item.wire?.technique).toBe('wire');
  });

  it('draws only the wire variant in wire-only mode', () => {
    const { world } = worldWithCloth();
    const item = buildDrawList(world.view, view({ wire: 'only' })).items[0]!;

    expect(item.materials).toHaveLength(0);
    expect(item.wire?.technique).toBe('wire');
  });

  it('keeps the wire variant while tracing', () => {
    const { world } = worldWithCloth();
    const item = buildDrawList(world.view, view({ wire: 'over', mode: 'pathtrace' })).items[0]!;

    // The wire survives the switch to tracing; SceneStore draws it past the tone curve.
    expect(item.wire?.technique).toBe('wire');
  });

  it('resolves diagnostic fills for subject surfaces only', () => {
    const { world } = worldWithCloth();
    const item = buildDrawList(world.view, view({ fill: 'uvCheck' })).items[0]!;

    expect(item.materials[0]?.technique).toBe('diagnostic');
    expect(item.materials[0]?.diagnostic).toBe('uvCheck');
  });

  it('keeps asset material slots as opaque variants', () => {
    const world = makeWorld();
    world.writer().createEntity({
      layer: 'subject',
      mesh: { kind: 'asset', key: 'avatar' },
      materials: [{ kind: 'asset', key: 'avatar', slot: 0 }],
      bounds: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
    });

    const item = buildDrawList(world.view, view()).items[0]!;
    expect(item.materials[0]?.technique).toBe('asset');
    expect(item.materials[0]?.data.kind).toBe('surface');
  });

  it('gives an asset entity without material refs its built-in slot', () => {
    const world = makeWorld();
    world.writer().createEntity({
      layer: 'subject',
      mesh: { kind: 'asset', key: 'avatar' },
      bounds: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
    });

    const item = buildDrawList(world.view, view()).items[0]!;
    expect(item.materials[0]?.technique).toBe('asset');
    expect(item.traceMaterials[0]?.technique).toBe('asset');
    expect(item.traceMaterials[0]?.source).toEqual({ kind: 'asset', key: 'avatar', slot: 0 });
  });

  it('keeps a raster-only asset out of the trace materials', () => {
    const world = makeWorld();
    world.writer().createEntity({
      layer: 'subject',
      mesh: { kind: 'asset', key: 'avatar' },
      channels: CHANNEL_RASTER,
      bounds: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } },
    });

    const item = buildDrawList(world.view, view()).items[0]!;
    expect(item.materials).toHaveLength(1);
    expect(item.traceMaterials).toHaveLength(0);
  });

  it('routes the simplified model through the wire pass', () => {
    const world = makeWorld();
    const mesh = world.writer().createMesh({
      topology: 'line',
      streams: { position: new Float32Array([0, 0, 0, 1, 0, 0]), color: new Float32Array([1, 1, 1, 1, 1, 1]) },
      index: new Uint32Array([0, 1]),
    });
    world.writer().createEntity({
      layer: 'gizmo',
      tags: ['simplifiedModel', 'wireGuide'],
      mesh: { kind: 'mesh', id: mesh },
      channels: CHANNEL_RASTER,
    });

    const item = buildDrawList(world.view, view()).items[0]!;
    expect(item.materials).toHaveLength(0);
    expect(item.traceMaterials).toHaveLength(0);
    expect(item.wire?.technique).toBe('wire');
    expect(item.wire?.data.vertexColors).toBe(true);
    expect(item.stage).toBe('postTone');
  });

  it('drops the simplified model when it is not tagged as a guide', () => {
    const world = makeWorld();
    const mesh = world.writer().createMesh({
      topology: 'line',
      streams: { position: new Float32Array([0, 0, 0, 1, 0, 0]) },
      index: new Uint32Array([0, 1]),
    });
    world.writer().createEntity({
      layer: 'gizmo',
      tags: ['simplifiedModel'],
      mesh: { kind: 'mesh', id: mesh },
      channels: CHANNEL_RASTER,
    });

    expect(buildDrawList(world.view, view()).items).toHaveLength(0);
  });

  it('hides the model but keeps the cloth, floor and guide when simplified-model-only', () => {
    const { world, mesh, material } = worldWithCloth();
    // The model: hidden in simplified-model-only.
    world.writer().createEntity({
      layer: 'subject',
      tags: ['avatar'],
      mesh: { kind: 'mesh', id: mesh },
      materials: [{ kind: 'material', id: material }],
      channels: CHANNEL_RASTER,
    });
    // The floor: kept as context.
    world.writer().createEntity({
      layer: 'underlay',
      mesh: { kind: 'mesh', id: mesh },
      materials: [{ kind: 'material', id: material }],
      channels: CHANNEL_RASTER,
    });
    const guideMesh = world.writer().createMesh({
      topology: 'line',
      streams: { position: new Float32Array([0, 0, 0, 1, 0, 0]) },
      index: new Uint32Array([0, 1]),
    });
    world.writer().createEntity({
      layer: 'gizmo',
      tags: ['simplifiedModel', 'wireGuide'],
      mesh: { kind: 'mesh', id: guideMesh },
      channels: CHANNEL_RASTER,
    });

    const list = buildDrawList(world.view, { ...view(), hideTags: ['avatar'] });
    // Cloth, floor and guide survive; only the model is hidden.
    expect(list.items).toHaveLength(3);
    expect(list.items.some(item => item.wire !== null)).toBe(true);
  });

  it('orders scene before overlay before gizmo and filters channels', () => {
    const world = makeWorld();
    const mesh = meshId(world);
    const material = surfaceMaterial(world);
    const writer = world.writer();
    writer.createEntity({ layer: 'gizmo', mesh: { kind: 'mesh', id: mesh }, materials: [{ kind: 'material', id: material }] });
    writer.createEntity({ layer: 'overlay', mesh: { kind: 'mesh', id: mesh }, materials: [{ kind: 'material', id: material }] });
    writer.createEntity({ layer: 'subject', mesh: { kind: 'mesh', id: mesh }, materials: [{ kind: 'material', id: material }] });
    writer.createEntity({
      layer: 'subject', mesh: { kind: 'mesh', id: mesh }, materials: [{ kind: 'material', id: material }],
      channels: CHANNEL_RASTER,
    });

    const all = buildDrawList(world.view, view());
    expect(all.items.map(item => item.stage)).toEqual(['scene', 'scene', 'postTone', 'gizmo']);

    const trace = buildDrawList(world.view, view({}, 2));
    expect(trace.items.every(item => item.stage === 'scene')).toBe(true);
  });
});
