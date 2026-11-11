import * as THREE from 'three/webgpu';
import type { AssetAppearance } from '@/render/common';

/** Name of the clone meshes marking a selected asset; selection is not part of the surface. */
export const SELECTION_OVERLAY_NAME = 'avatarSelectionOverlay';

/** Highlight layer sharpness of skin: a tight sheen rather than a wet gloss. */
const CLEARCOAT_ROUGHNESS = 0.45;

/** Materials that keep their authored colour; eyes and lashes are not skin. */
const PRESERVED_MATERIAL = /eye|lash|brow/i;

/** Fallback skin values used when the project names none. */
const DEFAULT_SKIN: Required<AssetAppearance> = {
  color: '#e8c4a8', roughness: 0.62, clearcoat: 0.12, opacity: 1,
};

/** Blending a surface had before any opacity was written onto it. */
interface AuthoredAlpha {
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
}

/** Authored blending per material, so an opacity can be set back to 1 without losing it. */
const authoredAlpha = new WeakMap<THREE.Material, AuthoredAlpha>();

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
 * Writes one surface opacity onto a material, over the blending it was authored with. A surface
 * that still blends stops writing depth, and one that turns opaque writes it again, or the asset
 * neither occludes nor gets occluded by what surrounds it.
 */
function writeAlpha(material: THREE.Material, opacity: number): void {
  let authored = authoredAlpha.get(material);
  if (!authored) {
    authored = {
      opacity: material.opacity,
      transparent: material.transparent,
      depthWrite: material.depthWrite,
    };
    authoredAlpha.set(material, authored);
  }
  const alpha = Math.min(1, Math.max(0, authored.opacity * opacity));
  const blending = authored.transparent || alpha < 0.95;
  if (material.transparent !== blending) material.needsUpdate = true;
  material.transparent = blending;
  material.opacity = alpha;
  material.depthWrite = authored.depthWrite && !blending;
}

/** Carries the authored blending of the material a promotion replaces onto its successor. */
function inheritAuthoredAlpha(from: THREE.Material, to: THREE.Material): void {
  const authored = authoredAlpha.get(from);
  if (authored) authoredAlpha.set(to, authored);
}

/** Whether an object carries surfaces of the asset itself rather than a selection clone. */
export function isSurfaceMesh(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh;
  return !!mesh.isMesh && !!mesh.material && mesh.name !== SELECTION_OVERLAY_NAME;
}

/**
 * Writes a skin appearance onto every surface under `root`, promoting matte body materials to
 * physical so the highlight layer can be set. Detail materials and textured surfaces keep their
 * authored colour; the appearance opacity is blended over all of them.
 */
export function applyBodySkin(root: THREE.Object3D, appearance: AssetAppearance = DEFAULT_SKIN): void {
  const opacity = appearance.opacity ?? DEFAULT_SKIN.opacity!;
  const promoted = new Map<THREE.Material, THREE.Material>();
  root.traverse(obj => {
    if (!isSurfaceMesh(obj)) return;
    const mesh = obj;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map(material => {
      const known = promoted.get(material);
      if (known) return known;
      const skin = skinMaterial(material);
      promoted.set(material, skin ?? material);
      if (!skin) {
        writeAlpha(material, opacity);
        return material;
      }
      inheritAuthoredAlpha(material, skin);
      skin.color.set(appearance.color ?? DEFAULT_SKIN.color!);
      skin.roughness = appearance.roughness ?? DEFAULT_SKIN.roughness!;
      skin.metalness = 0;
      skin.clearcoat = appearance.clearcoat ?? DEFAULT_SKIN.clearcoat!;
      skin.clearcoatRoughness = CLEARCOAT_ROUGHNESS;
      writeAlpha(skin, opacity);
      skin.needsUpdate = true;
      return skin;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}
