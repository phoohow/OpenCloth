import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { SceneStore } from '@/render/backend/scene/sceneStore';
import { TextureCache } from '@/render/backend/textures';
import type {
  EnvironmentData, MeshGroup, ResolvedMaterial, SceneMesh, SceneSnapshot, VersionStamp,
} from '@/render/common';
import { IDENTITY_TRANSFORM } from '@/render/world';

/** One fabric material shared by every group of the cloth mesh. */
const FABRIC: ResolvedMaterial = {
  technique: 'surface',
  data: { kind: 'surface', name: 'fabric' },
  source: { kind: 'material', id: 1 },
  revision: 1,
};

const VERSIONS: VersionStamp = {
  topology: 1, geometry: 1, transform: 1, material: 1, visibility: 1, lights: 1, environment: 1,
};

const ENVIRONMENT: EnvironmentData = {
  background: 'color', color: '#000000', textureKey: null, intensity: 1, url: '',
};

/** Two-triangle cloth mesh whose drawn ranges are the given groups. */
function clothMesh(groups: readonly MeshGroup[], revision = 1): SceneMesh {
  return {
    id: 1,
    revision,
    topology: 'triangle',
    streams: { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]) },
    index: new Uint32Array([0, 1, 2, 1, 3, 2]),
    groups,
  };
}

/** Snapshot holding that cloth as the only entity. */
function snapshot(groups: readonly MeshGroup[], revision = 1): SceneSnapshot {
  return {
    items: [{
      key: 1,
      mesh: { kind: 'mesh', id: 1 },
      transform: IDENTITY_TRANSFORM,
      rasterStage: 'scene',
      bucket: 'opaque',
      rasterMaterials: [FABRIC],
      traceMaterials: [FABRIC],
      wire: null,
    }],
    meshes: [clothMesh(groups, revision)],
    lights: [],
    environment: ENVIRONMENT,
    versions: VERSIONS,
  };
}

/** Store over an empty asset source. */
function createStore(): SceneStore {
  return new SceneStore({ objectFor: () => null }, new TextureCache());
}

/** Raster object the snapshot drew, or null while nothing is drawn for it. */
function rasterRoot(store: SceneStore): THREE.Mesh | null {
  const scene = store.sceneFor(store.raster, 'scene');
  return (scene.getObjectByName('entity:1') as THREE.Mesh | undefined) ?? null;
}

describe('SceneStore wire guides', () => {
  it('draws a line guide in the wire root', () => {
    const store = createStore();
    store.apply({
      items: [{
        key: 1,
        mesh: { kind: 'mesh', id: 1 },
        transform: IDENTITY_TRANSFORM,
        rasterStage: 'postTone',
        bucket: 'overlay',
        rasterMaterials: [],
        traceMaterials: [],
        wire: {
          technique: 'wire',
          data: { kind: 'wire', vertexColors: true },
          source: { kind: 'material', id: -1 },
        },
      }],
      meshes: [{
        id: 1,
        revision: 1,
        topology: 'line',
        streams: { position: new Float32Array([0, 0, 0, 1, 0, 0]), color: new Float32Array([1, 1, 1, 1, 1, 1]) },
        index: new Uint32Array([0, 1]),
      }],
      lights: [],
      environment: ENVIRONMENT,
      versions: VERSIONS,
    });

    const wire = store.sceneFor(store.wire, 'postTone').getObjectByName('wire:1');
    expect(wire).toBeInstanceOf(THREE.LineSegments);
    expect((wire as THREE.LineSegments).material).toBeInstanceOf(THREE.LineBasicMaterial);
  });
});

describe('SceneStore grouped meshes', () => {
  it('keeps a material list so three walks the group ranges', () => {
    const store = createStore();
    store.apply(snapshot([{ start: 0, count: 3, materialSlot: 0 }, { start: 3, count: 3, materialSlot: 0 }]));

    const root = rasterRoot(store);
    expect(Array.isArray(root?.material)).toBe(true);
    expect(root?.geometry.groups).toHaveLength(2);
  });

  it('drops the group of a panel hidden after the first frame', () => {
    const store = createStore();
    store.apply(snapshot([{ start: 0, count: 3, materialSlot: 0 }, { start: 3, count: 3, materialSlot: 0 }]));
    store.apply(snapshot([{ start: 0, count: 3, materialSlot: 0 }], 2));

    const root = rasterRoot(store);
    expect(Array.isArray(root?.material)).toBe(true);
    expect(root?.geometry.groups).toHaveLength(1);
  });

  it('draws nothing once every group is hidden', () => {
    const store = createStore();
    store.apply(snapshot([{ start: 0, count: 3, materialSlot: 0 }]));
    store.apply(snapshot([], 2));

    expect(rasterRoot(store)).toBeNull();
  });
});
