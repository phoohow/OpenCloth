import * as THREE from 'three/webgpu';
import { normalLocal, packNormalToRGB } from 'three/tsl';
import type { FabricAppearance, FabricMapSlot, RenderMode } from '../../core/model/types';
import { acquireFabricTexture, type FabricTextureHandle } from './fabricTextures';

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

/** Whether a render mode draws the fabric appearance instead of a diagnostic layer. */
export function modeUsesFabric(mode: RenderMode): boolean {
  return mode === 'shaded' || mode === 'shadedWireframe' || mode === 'raytraced';
}

/** Builds the material a render mode shows the cloth with. */
export function createMaterialForMode(
  app: FabricAppearance, mode: RenderMode, composite: THREE.Texture | null = null,
): THREE.Material {
  switch (mode) {
    case 'wireframe': {
      const m = new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true, side: THREE.DoubleSide });
      return m;
    }
    case 'uvCheck': {
      // Checkerboard drawn into a data texture instead of shipped as an asset.
      const size = 256;
      const data = new Uint8Array(size * size * 4);
      const cell = size / 16;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
          const v = (cx + cy) % 2 === 0 ? 220 : 80;
          data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
        }
      }
      const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const m = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      return m;
    }
    case 'normalVis': {
      // Object-space vertex normal, interpolated across the triangle and shown as colour. Unlike
      // the view-space normal of MeshNormalMaterial this does not follow the camera.
      const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false });
      const packed = packNormalToRGB(normalLocal.normalize());
      // sRGB decode, so the renderer's working-space to sRGB output shows the packed colour as is.
      const decoded = packed.lessThanEqual(0.04045)
        .select(packed.div(12.92), packed.add(0.055).div(1.055).pow(2.4));
      m.colorNode = decoded;
      return m;
    }
    case 'shadedWireframe':
    case 'raytraced':
    case 'shaded':
    default:
      return createFabricMaterial(app, composite);
  }
}

/** Cloth mesh: manages the Three.js Mesh; positions/normals are updated by the simulator. */
export class ClothMeshManager {
  readonly geometry: THREE.BufferGeometry;
  readonly mesh: THREE.Mesh;
  private positionAttr: THREE.BufferAttribute;
  private normalAttr: THREE.BufferAttribute;
  /** One material per geometry group slot, so each pattern piece can wear its own fabric. */
  private materials: THREE.Material[] = [];

  constructor(
    // Flat xyz triples.
    initialPositions: Float32Array,
    indices: Uint32Array,
    // Flat uv pairs.
    uvs: Float32Array,
    material: THREE.Material | THREE.Material[],
  ) {
    this.geometry = new THREE.BufferGeometry();

    this.positionAttr = new THREE.BufferAttribute(new Float32Array(initialPositions), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);

    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.geometry.computeVertexNormals();
    this.normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    this.normalAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.materials = Array.isArray(material) ? [...material] : [material];
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'cloth';
  }

  /** Copies simulation positions and normals into the draw buffers. */
  updateFromSim(positions: Float32Array, normals: Float32Array): void {
    (this.positionAttr.array as Float32Array).set(positions);
    this.positionAttr.needsUpdate = true;
    (this.normalAttr.array as Float32Array).set(normals);
    this.normalAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /** Restores the given initial positions and the normals they imply. */
  resetTo(initialPositions: Float32Array): void {
    (this.positionAttr.array as Float32Array).set(initialPositions);
    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    this.normalAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /** Replaces every group slot's material, disposing the ones that are no longer used. */
  setMaterials(materials: THREE.Material[]): void {
    for (const old of this.materials) {
      if (!materials.includes(old)) old.dispose();
    }
    this.materials = [...materials];
    this.mesh.material = this.materials;
  }

  /** Drops the per-piece material groups before a rebuild. */
  clearGroups(): void {
    this.geometry.groups = [];
  }

  /** Index ranges of the merged mesh, one per material group slot. */
  addGroups(ranges: Array<{ start: number; count: number; slot: number }>): void {
    this.geometry.groups = ranges.map(g => ({ start: g.start, count: g.count, materialIndex: g.slot }));
  }

  /** Frees the geometry and every material slot it wears. */
  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials = [];
  }
}
