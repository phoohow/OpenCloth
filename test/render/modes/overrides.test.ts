import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it } from 'vitest';
import { disposeFillOverrides, fillOverride } from '@/render/modes/overrides';
import { WireOverlay } from '@/render/modes/wire';
import { SceneMgr } from '@/render/scene/manager';

beforeEach(() => {
  disposeFillOverrides();
});

describe('fillOverride', () => {
  it('returns nothing for the physical fill', () => {
    expect(fillOverride('physical', new THREE.MeshPhysicalMaterial())).toBeNull();
  });

  it('keeps a mesh with one material on a single material', () => {
    // A geometry without groups is only drawn when its material is not an array; handing it a
    // one-element array is what made the body disappear under the uv and normal fills.
    const original = new THREE.MeshPhysicalMaterial();
    const override = fillOverride('uvCheck', original);

    expect(Array.isArray(override)).toBe(false);
    expect(override).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('keeps one material per group for a mesh that carries an array', () => {
    const original = [new THREE.MeshPhysicalMaterial(), new THREE.MeshPhysicalMaterial()];
    const override = fillOverride('normal', original);

    expect(Array.isArray(override)).toBe(true);
    expect(override).toHaveLength(original.length);
    expect((override as THREE.Material[])[0]).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
  });

  it('keeps the shading normal and the vertex normal as separate materials', () => {
    const original = new THREE.MeshPhysicalMaterial();
    const shading = fillOverride('normal', original);
    const vertex = fillOverride('vertexNormal', original);

    expect(shading).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
    expect(vertex).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
    expect(vertex).not.toBe(shading);
    // One reads the shading normal, the other the world-space vertex normal.
    expect((vertex as THREE.MeshBasicNodeMaterial).colorNode)
      .not.toBe((shading as THREE.MeshBasicNodeMaterial).colorNode);
  });

  it('reuses one material and one array per shape', () => {
    const single = new THREE.MeshPhysicalMaterial();
    const list = [new THREE.MeshPhysicalMaterial(), new THREE.MeshPhysicalMaterial()];

    expect(fillOverride('uvCheck', single)).toBe(fillOverride('uvCheck', single));
    expect(fillOverride('uvCheck', list)).toBe(fillOverride('uvCheck', list));
  });
});

describe('WireOverlay', () => {
  /** Scene with one registered pattern surface beside the body, a reference and the heatmap. */
  function scene(surface: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial())) {
    const sceneMgr = new SceneMgr();
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial());
    const reference = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial());
    const heat = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    sceneMgr.slot('cloth').add(surface);
    sceneMgr.setPatternSurface(surface, true);
    sceneMgr.slot('avatar').add(body);
    sceneMgr.slot('references').add(reference);
    sceneMgr.slot('cloth').add(heat);
    return { sceneMgr, surface, body, reference, heat };
  }

  const options = { color: 0x66ccff, depth: 'tested' } as const;

  it('mirrors the material shape of the mesh it copies', () => {
    const { sceneMgr } = scene();

    const wire = new WireOverlay(sceneMgr);
    wire.setMode('over', options);

    const wireMesh = sceneMgr.slot('edges').objects[0] as THREE.Mesh;
    expect(wireMesh).toBeDefined();
    expect(Array.isArray(wireMesh.material)).toBe(false);
  });

  it('gives every group of a multi-material surface its own wire material', () => {
    const geometry = new THREE.BoxGeometry();
    geometry.groups = [{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: 6, materialIndex: 1 }];
    const surface = new THREE.Mesh(geometry, [new THREE.MeshPhysicalMaterial(), new THREE.MeshPhysicalMaterial()]);
    const { sceneMgr } = scene(surface);

    const wire = new WireOverlay(sceneMgr);
    wire.setMode('over', options);

    const wireMesh = sceneMgr.slot('edges').objects[0] as THREE.Mesh;
    expect(Array.isArray(wireMesh.material)).toBe(true);
    expect(wireMesh.material as THREE.Material[]).toHaveLength(2);
  });

  it('leaves the body, reference models and overlays out of every wire mode', () => {
    for (const mode of ['over', 'only'] as const) {
      const { sceneMgr, surface, body, reference, heat } = scene();
      const wire = new WireOverlay(sceneMgr);
      wire.setMode(mode, options);

      const edges = sceneMgr.slot('edges').objects as THREE.Mesh[];
      expect(edges).toHaveLength(1);
      expect(edges[0]!.geometry).toBe(surface.geometry);
      for (const other of [body, reference, heat]) {
        expect(edges.some(edge => edge.geometry === other.geometry)).toBe(false);
      }
      wire.dispose();
    }
  });

  it('follows surface registration and removal without a slot change', () => {
    const sceneMgr = new SceneMgr();
    const surface = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial());
    sceneMgr.slot('cloth').add(surface);
    const wire = new WireOverlay(sceneMgr);
    wire.setMode('over', options);
    expect(sceneMgr.slot('edges').objects).toHaveLength(0);

    sceneMgr.setPatternSurface(surface, true);
    wire.sync();
    expect(sceneMgr.slot('edges').objects).toHaveLength(1);

    sceneMgr.setPatternSurface(surface, false);
    wire.sync();
    expect(sceneMgr.slot('edges').objects).toHaveLength(0);
  });

  it('mirrors the garment visibility without touching the body', () => {
    const { sceneMgr, surface, body } = scene();
    const wire = new WireOverlay(sceneMgr);
    wire.setMode('over', options);
    const wireMesh = sceneMgr.slot('edges').objects[0] as THREE.Mesh;

    surface.visible = false;
    wire.sync();

    expect(wireMesh.visible).toBe(false);
    expect(body.visible).toBe(true);
  });
});
