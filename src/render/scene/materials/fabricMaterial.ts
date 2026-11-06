import * as THREE from 'three/webgpu';
import type { FabricAppearance, FabricMapSlot } from '@/model/types';
import { acquireFabricTexture, type FabricTextureHandle } from '@/render/scene/materials/fabricTextures';

/** Colour space each map slot is sampled in; only albedo carries sRGB colour. */
const MAP_COLOR_SPACE: Record<FabricMapSlot, THREE.ColorSpace> = {
  albedo: THREE.SRGBColorSpace,
  normal: THREE.NoColorSpace,
  roughness: THREE.NoColorSpace,
  metallic: THREE.NoColorSpace,
};

/** Map handles per material, so replacing a texture frees the one it replaced. */
const materialMaps = new WeakMap<THREE.MeshPhysicalMaterial, Map<FabricMapSlot, FabricTextureHandle>>();

/** Creates a sheened physical material for a fabric appearance, optionally over a composed print texture. */
export function createFabricMaterial(app: FabricAppearance, composite: THREE.Texture | null = null): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(app.baseColor), side: THREE.DoubleSide });
  applyFabricAppearance(mat, app, composite);
  return mat;
}

/**
 * Writes a fabric appearance onto an existing material, so live edits keep the same instance.
 * A composed print texture replaces the albedo slot and already holds the base colour.
 */
export function applyFabricAppearance(
  mat: THREE.MeshPhysicalMaterial, app: FabricAppearance, composite: THREE.Texture | null = null,
): void {
  const handles = mapHandles(mat);
  bindMap(mat, handles, 'normal', app);
  bindMap(mat, handles, 'roughness', app);
  bindMap(mat, handles, 'metallic', app);

  const maps = app.maps ?? {};
  if (composite) {
    releaseMap(handles, mat, 'albedo');
    mat.map = composite;
    mat.color.set(0xffffff);
  } else {
    bindMap(mat, handles, 'albedo', app);
    // A map supplies the channel value; the scalar is the factor used only without a map.
    mat.color.set(maps.albedo ? 0xffffff : app.baseColor);
  }
  mat.metalness = maps.metallic ? 1 : app.metallic;
  mat.roughness = maps.roughness ? 1 : app.roughness;
  mat.sheen = app.sheenIntensity;
  mat.sheenColor.set(app.sheenColor);
  mat.sheenRoughness = app.sheenRoughness;
  mat.transmission = app.transmission;
  mat.thickness = app.thickness;
  mat.clearcoat = app.clearcoat;
  mat.clearcoatRoughness = app.clearcoatRoughness;
  mat.anisotropy = app.anisotropy;
  mat.iridescence = app.iridescence;
  mat.normalScale.set(app.normalScale, app.normalScale);
  mat.needsUpdate = true;
}

/** Drops one bound map slot, releasing the texture at its last handle. */
function releaseMap(
  handles: Map<FabricMapSlot, FabricTextureHandle>, mat: THREE.MeshPhysicalMaterial, slot: FabricMapSlot,
): void {
  const current = handles.get(slot);
  if (!current) return;
  current.release();
  handles.delete(slot);
  setMap(mat, slot, null);
}

/** Handles of one material, releasing every texture when the material is disposed. */
function mapHandles(mat: THREE.MeshPhysicalMaterial): Map<FabricMapSlot, FabricTextureHandle> {
  const existing = materialMaps.get(mat);
  if (existing) return existing;

  const handles = new Map<FabricMapSlot, FabricTextureHandle>();
  materialMaps.set(mat, handles);
  mat.addEventListener('dispose', () => {
    for (const handle of handles.values()) handle.release();
    handles.clear();
  });
  return handles;
}

/** Binds one slot to the appearance's image, keeping the bound texture when the URL is unchanged. */
function bindMap(
  mat: THREE.MeshPhysicalMaterial,
  handles: Map<FabricMapSlot, FabricTextureHandle>,
  slot: FabricMapSlot,
  app: FabricAppearance,
): void {
  const url = app.maps?.[slot] ?? null;
  const current = handles.get(slot);
  if (current && current.url === url) {
    current.setTransform(app.uvTiling, app.uvOffset);
    return;
  }

  current?.release();
  handles.delete(slot);
  if (!url) {
    setMap(mat, slot, null);
    mat.needsUpdate = true;
    return;
  }

  const handle = acquireFabricTexture(url, MAP_COLOR_SPACE[slot], app.uvTiling, app.uvOffset, texture => {
    // Skip the bind when the slot was replaced or the material was disposed.
    if (handles.get(slot) !== handle) {
      texture.dispose();
      return;
    }
    setMap(mat, slot, texture);
    mat.needsUpdate = true;
  });
  handles.set(slot, handle);
  setMap(mat, slot, handle.texture);
  mat.needsUpdate = true;
}

/** Writes one map slot of the material; null clears it. */
function setMap(mat: THREE.MeshPhysicalMaterial, slot: FabricMapSlot, texture: THREE.Texture | null): void {
  switch (slot) {
    case 'albedo': mat.map = texture; break;
    case 'normal': mat.normalMap = texture; break;
    case 'roughness': mat.roughnessMap = texture; break;
    case 'metallic': mat.metalnessMap = texture; break;
  }
}
