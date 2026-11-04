import * as THREE from 'three/webgpu';
import type { SkinAppearance } from '../../core/model/types';
import { DEFAULT_SKIN_APPEARANCE } from '../../core/model/defaults';

/** Highlight layer sharpness of skin: a tight sheen rather than a wet gloss. */
const CLEARCOAT_ROUGHNESS = 0.45;

/** Materials that keep their authored colour; eyes and lashes are not skin. */
const PRESERVED_MATERIAL = /eye|lash|brow/i;

/** Builds the physical material that replaces a matte body material. */
function toSkinMaterial(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    name: source.name,
    color: source.color.clone(),
    roughness: source.roughness,
    metalness: 0,
    side: source.side,
    flatShading: source.flatShading,
    envMapIntensity: source.envMapIntensity,
    transparent: source.transparent,
    opacity: source.opacity,
    depthWrite: source.depthWrite,
  });
}

/** The skin material behind one mesh material, promoted from a matte body material. */
function skinMaterial(material: THREE.Material): THREE.MeshPhysicalMaterial | null {
  if (PRESERVED_MATERIAL.test(material.name)) return null;
  // A textured or non-PBR surface keeps its authored look.
  if (!(material instanceof THREE.MeshStandardMaterial) || material.map) return null;
  return material instanceof THREE.MeshPhysicalMaterial ? material : toSkinMaterial(material);
}

/**
 * Writes a skin appearance onto every untextured body material under `root`, promoting matte
 * materials to physical so the highlight layer can be set. Detail materials and textured
 * surfaces are left alone.
 */
export function applyBodySkin(root: THREE.Object3D, appearance: SkinAppearance = DEFAULT_SKIN_APPEARANCE): void {
  const promoted = new Map<THREE.Material, THREE.Material>();
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map(material => {
      const known = promoted.get(material);
      if (known) return known;
      const skin = skinMaterial(material);
      const applied = skin ?? material;
      promoted.set(material, applied);
      if (!skin) return applied;
      skin.color.set(appearance.color);
      skin.roughness = appearance.roughness;
      skin.metalness = 0;
      skin.clearcoat = appearance.clearcoat;
      skin.clearcoatRoughness = CLEARCOAT_ROUGHNESS;
      skin.needsUpdate = true;
      return skin;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}
