import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { SceneMgr, TRACE_VISIBLE } from '@/render/scene/manager';

/** Bare mesh for slot membership tests. */
function mesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
}

describe('SceneMgr topology revisions', () => {
  it('ignores slot changes in layers the tracer never walks', () => {
    const scene = new SceneMgr();
    const before = scene.revisions.topology;

    scene.slot('pins').add(mesh());
    scene.slot('seams').add(mesh());

    expect(scene.revisions.topology).toBe(before);
  });

  it('bumps topology for traced layers', () => {
    const scene = new SceneMgr();
    const before = scene.revisions.topology;
    const cloth = scene.slot('cloth');
    const object = mesh();

    cloth.add(object);
    expect(scene.revisions.topology).toBe(before + 1);

    cloth.remove(object);
    expect(scene.revisions.topology).toBe(before + 2);
  });
});

describe('SceneMgr trace masks', () => {
  it('forgets the mask of an object that leaves the slot', () => {
    const scene = new SceneMgr();
    const slot = scene.slot('cloth');
    const overlay = mesh();
    slot.add(overlay);
    slot.setTraceMask(overlay, 0);
    expect(scene.traceMask(overlay)).toBe(0);

    const before = scene.revisions.visibility;
    slot.remove(overlay);

    expect(scene.traceMask(overlay)).toBe(TRACE_VISIBLE);
    expect(scene.revisions.visibility).toBe(before + 1);
  });

  it('drops an entry that is set back to visible', () => {
    const scene = new SceneMgr();
    const object = mesh();
    scene.setTraceMask(object, 0);
    scene.setTraceMask(object, TRACE_VISIBLE);

    expect(scene.traceMask(object)).toBe(TRACE_VISIBLE);
    expect(scene.applyTraceMasks()).toBeTypeOf('function');
  });

  it('clears masks when a slot is cleared', () => {
    const scene = new SceneMgr();
    const slot = scene.slot('cloth');
    const overlay = mesh();
    slot.add(overlay);
    slot.setTraceMask(overlay, 0);

    slot.clear();

    expect(scene.traceMask(overlay)).toBe(TRACE_VISIBLE);
  });
});

describe('SceneMgr pattern surfaces', () => {
  it('caches the surface list until membership changes', () => {
    const scene = new SceneMgr();
    const surface = mesh();
    const initial = scene.patternSurfaceMeshes();

    expect(scene.patternSurfaceMeshes()).toBe(initial);

    scene.setPatternSurface(surface, true);
    const withSurface = scene.patternSurfaceMeshes();
    expect(withSurface).not.toBe(initial);
    expect(withSurface).toContain(surface);

    scene.setPatternSurface(surface, false);
    expect(scene.patternSurfaceMeshes()).not.toBe(withSurface);
    expect(scene.patternSurfaceMeshes()).toHaveLength(0);
  });
});
