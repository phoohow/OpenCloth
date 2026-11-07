import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createDefaultRayTracing } from '@/model';
import type { ViewConfig } from '@/model/types';
import { ViewMode } from '@/render/modes/viewMode';
import { SceneMgr } from '@/render/scene/manager';

/** Raster, physical fill, no overlay: the settings a fresh project starts with. */
function config(patch: Partial<ViewConfig> = {}): ViewConfig {
  return {
    fill: 'uvCheck',
    wire: 'off',
    backend: 'raster',
    wireOptions: { color: 0x66ccff, depth: 'tested' },
    toneMapping: 'aces',
    rayTracing: createDefaultRayTracing(),
    ...patch,
  };
}

/** Scene with a body, the garment surface and the heatmap overlay sharing the cloth slot. */
function scene() {
  const sceneMgr = new SceneMgr();
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial());
  sceneMgr.slot('avatar').add(body);

  const surface = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial());
  const heat = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  sceneMgr.slot('cloth').add(surface);
  sceneMgr.slot('cloth').add(heat);
  sceneMgr.setPatternSurface(surface, true);

  return { sceneMgr, body, surface, heat };
}

describe('ViewMode.applyFillOverride', () => {
  it('restyles the pattern surface only', () => {
    const { sceneMgr, body, surface, heat } = scene();
    const viewMode = new ViewMode(sceneMgr, config());
    const bodyMaterial = body.material;
    const heatMaterial = heat.material;
    const surfaceMaterial = surface.material;

    const restore = viewMode.applyFillOverride();

    // The body and the heatmap overlay are not the pattern: a uv fill must not recolour them.
    expect(body.material).toBe(bodyMaterial);
    expect(heat.material).toBe(heatMaterial);
    expect(surface.material).not.toBe(surfaceMaterial);
    expect(surface.material).toBeInstanceOf(THREE.MeshBasicMaterial);

    restore();
    expect(surface.material).toBe(surfaceMaterial);
    expect(body.material).toBe(bodyMaterial);
  });

  it('restyles the pattern surface for the vertex-normal fill too', () => {
    const { sceneMgr, body, surface, heat } = scene();
    const viewMode = new ViewMode(sceneMgr, config({ fill: 'vertexNormal' }));
    const bodyMaterial = body.material;
    const heatMaterial = heat.material;
    const surfaceMaterial = surface.material;

    const restore = viewMode.applyFillOverride();

    expect(surface.material).not.toBe(surfaceMaterial);
    expect(surface.material).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
    expect(body.material).toBe(bodyMaterial);
    expect(heat.material).toBe(heatMaterial);

    restore();
    expect(surface.material).toBe(surfaceMaterial);
  });

  it('leaves every material alone for the physical fill', () => {
    const { sceneMgr, body, surface } = scene();
    const viewMode = new ViewMode(sceneMgr, config({ fill: 'physical' }));
    const bodyMaterial = body.material;
    const surfaceMaterial = surface.material;

    const restore = viewMode.applyFillOverride();
    expect(body.material).toBe(bodyMaterial);
    expect(surface.material).toBe(surfaceMaterial);
    restore();
  });

  it('hides the surface but not the body when the mode draws edges only', () => {
    const { sceneMgr, body, surface } = scene();
    const viewMode = new ViewMode(sceneMgr, config({ fill: 'physical', wire: 'only' }));

    const restore = viewMode.applyFillOverride();
    expect(surface.visible).toBe(false);
    expect(body.visible).toBe(true);

    restore();
    expect(surface.visible).toBe(true);
  });
});
