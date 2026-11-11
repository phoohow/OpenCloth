import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyBodySkin } from '@/render/backend/assets/bodyMaterial';
import { standardizeMaterials } from '@/render/backend/assets/modelLoader';

/** Group holding one mesh with the given material. */
function meshGroup(material: THREE.Material): { group: THREE.Group; mesh: THREE.Mesh } {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const group = new THREE.Group();
  group.add(mesh);
  return { group, mesh };
}

describe('applyBodySkin', () => {
  it('blends the surface to the appearance opacity and stops its depth writes', () => {
    const { group, mesh } = meshGroup(new THREE.MeshStandardMaterial());

    applyBodySkin(group, { opacity: 0.5 });

    const skin = mesh.material as THREE.Material;
    expect(skin.opacity).toBeCloseTo(0.5);
    expect(skin.transparent).toBe(true);
    expect(skin.depthWrite).toBe(false);
  });

  it('restores the opaque surface when the appearance turns opaque again', () => {
    const { group, mesh } = meshGroup(new THREE.MeshStandardMaterial());

    applyBodySkin(group, { opacity: 0.5 });
    applyBodySkin(group, { opacity: 1 });

    const skin = mesh.material as THREE.Material;
    expect(skin.opacity).toBe(1);
    expect(skin.transparent).toBe(false);
    expect(skin.depthWrite).toBe(true);
  });

  it('keeps the blending an asset was authored with', () => {
    const authored = new THREE.MeshStandardMaterial({
      opacity: 0.8, transparent: true, depthWrite: false,
    });
    const { group, mesh } = meshGroup(authored);

    applyBodySkin(group, { opacity: 1 });

    const skin = mesh.material as THREE.Material;
    expect(skin.opacity).toBeCloseTo(0.8);
    expect(skin.transparent).toBe(true);
    expect(skin.depthWrite).toBe(false);
  });

  it('leaves the selection overlay alone', () => {
    const { group, mesh } = meshGroup(new THREE.MeshStandardMaterial());
    mesh.name = 'avatarSelectionOverlay';

    applyBodySkin(group, { opacity: 0.5 });

    const overlay = mesh.material as THREE.Material;
    expect(overlay.opacity).toBe(1);
    expect(overlay.depthWrite).toBe(true);
  });
});

describe('standardizeMaterials', () => {
  it('replaces phong and unlit surfaces with standard ones', () => {
    const phong = new THREE.MeshPhongMaterial({ color: 0x336699, shininess: 30 });
    const unlit = new THREE.MeshBasicMaterial({ color: 0x112233, opacity: 0.5, transparent: true });
    const { group } = meshGroup(phong);
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), unlit));

    standardizeMaterials(group);

    const [first, second] = group.children as THREE.Mesh[];
    const a = first!.material as THREE.MeshStandardMaterial;
    const b = second!.material as THREE.MeshStandardMaterial;
    expect(a).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(a.color.getHex()).toBe(0x336699);
    expect(a.metalness).toBe(0);
    expect(b).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(b.color.getHex()).toBe(0x112233);
    expect(b.opacity).toBeCloseTo(0.5);
    expect(b.transparent).toBe(true);
  });

  it('keeps standard materials and shares one replacement per source', () => {
    const standard = new THREE.MeshStandardMaterial();
    const phong = new THREE.MeshPhongMaterial();
    const { group } = meshGroup(standard);
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), phong));
    group.add(new THREE.Mesh(new THREE.BufferGeometry(), phong));

    standardizeMaterials(group);

    const [kept, first, second] = group.children as THREE.Mesh[];
    expect(kept!.material).toBe(standard);
    expect(first!.material).toBe(second!.material);
  });

  it('leaves line segments without a standard material', () => {
    const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const group = new THREE.Group();
    group.add(line);

    standardizeMaterials(group);

    expect(line.material).toBeInstanceOf(THREE.LineBasicMaterial);
  });
});
