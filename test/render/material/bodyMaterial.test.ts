import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyBodySkin } from '@/render/material/bodyMaterial';
import { DEFAULT_SKIN_APPEARANCE } from '@/model/defaults';

/** Body mesh with one material of the given name and options. */
function bodyMesh(name: string, options: THREE.MeshStandardMaterialParameters = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name, ...options }));
}

describe('applyBodySkin', () => {
  it('promotes a matte body material and writes the appearance onto it', () => {
    const mesh = bodyMesh('BodyMatte', { color: 0x888888, roughness: 0.9 });
    applyBodySkin(mesh, { color: '#336699', roughness: 0.3, clearcoat: 0.5 });

    const skin = mesh.material as THREE.MeshPhysicalMaterial;
    expect(skin.isMeshPhysicalMaterial).toBe(true);
    expect(skin.name).toBe('BodyMatte');
    expect(skin.color.getHexString()).toBe('336699');
    expect(skin.roughness).toBeCloseTo(0.3);
    expect(skin.clearcoat).toBeCloseTo(0.5);
    expect(skin.metalness).toBe(0);
  });

  it('keeps eye materials and textured surfaces as authored', () => {
    const eye = bodyMesh('EyeMatte', { color: 0x222222 });
    const textured = bodyMesh('BodyMatte', { color: 0x888888 });
    const map = new THREE.Texture();
    (textured.material as THREE.MeshStandardMaterial).map = map;
    const group = new THREE.Group();
    group.add(eye, textured);

    applyBodySkin(group);

    expect(eye.material).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((eye.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('222222');
    expect(textured.material).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((textured.material as THREE.MeshStandardMaterial).map).toBe(map);
  });

  it('reuses the promoted material on later edits', () => {
    const mesh = bodyMesh('BodyMatte');
    applyBodySkin(mesh, DEFAULT_SKIN_APPEARANCE);
    const first = mesh.material;
    applyBodySkin(mesh, { ...DEFAULT_SKIN_APPEARANCE, color: '#111111', roughness: 0.8 });

    expect(mesh.material).toBe(first);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('111111');
    expect((mesh.material as THREE.MeshStandardMaterial).roughness).toBeCloseTo(0.8);
  });

  it('promotes a material shared by several meshes once', () => {
    const shared = new THREE.MeshStandardMaterial({ name: 'BodyMatte' });
    const a = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const b = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const group = new THREE.Group();
    group.add(a, b);

    applyBodySkin(group);

    expect(a.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(b.material).toBe(a.material);
  });
});
