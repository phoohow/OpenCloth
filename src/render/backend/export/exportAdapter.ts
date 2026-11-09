/** Builds a temporary three scene from a pure snapshot and serializes it. */

import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { whenImagesReady } from '@/base/platform';
import type {
  AssetHandle, ExportFormat, ExportPort, SceneItem, SceneSnapshot,
} from '@/render/common';
import type { AssetStore } from '@/render/backend/assets/assetStore';
import { fbxText, usdaText, type ExportMesh } from '@/render/backend/export/meshText';
import { GeometryCache } from '@/render/backend/scene/geometryCache';
import { MaterialCompiler } from '@/render/backend/scene/materialCompiler';
import type { TextureCache } from '@/render/backend/textures';

/** Serializes export snapshots without exposing three to the viewport. */
export class ExportAdapter implements ExportPort {
  constructor(
    private readonly assets: AssetStore,
    private readonly textures: TextureCache,
  ) { }

  async export(
    snapshot: SceneSnapshot,
    _assets: readonly AssetHandle[],
    format: ExportFormat,
  ): Promise<ArrayBuffer> {
    await whenImagesReady();
    const scene = this.buildScene(snapshot);
    if (format === 'glb') {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        new GLTFExporter().parse(
          scene,
          result => resolve(result as ArrayBuffer),
          reject,
          { binary: true },
        );
      });
    }
    if (format === 'obj') {
      return textBuffer(new OBJExporter().parse(scene));
    }
    const meshes = collectMeshes(scene);
    const text = format === 'fbx' ? fbxText(meshes) : usdaText(meshes);
    return textBuffer(text);
  }

  /** Compiles the snapshot into a standalone three scene. */
  private buildScene(snapshot: SceneSnapshot): THREE.Scene {
    const scene = new THREE.Scene();
    const geometries = new GeometryCache();
    const materials = new MaterialCompiler();
    const meshMap = new Map(snapshot.meshes.map(mesh => [mesh.id, mesh]));
    for (const item of snapshot.items) {
      const root = this.objectFor(item, meshMap, geometries, materials);
      if (root) scene.add(root);
    }
    return scene;
  }

  private objectFor(
    item: SceneItem,
    meshMap: Map<number, SceneSnapshot['meshes'][number]>,
    geometries: GeometryCache,
    materials: MaterialCompiler,
  ): THREE.Object3D | null {
    if (item.mesh.kind === 'asset') {
      const source = this.assets.objectFor(item.mesh.key);
      if (!source) return null;
      const clone = source.clone(true);
      clone.updateMatrixWorld(true);
      return clone;
    }
    const mesh = meshMap.get(item.mesh.id);
    if (!mesh) return null;
    const geometry = geometries.get(mesh);
    const compiled = item.rasterMaterials
      .filter(variant => variant.technique !== 'asset')
      .map(variant => materials.get(variant, this.textures));
    const material = compiled.length === 1
      ? compiled[0]!
      : compiled.length > 0 ? compiled : materials.defaultMaterial();
    const object = mesh.instances
      ? new THREE.InstancedMesh(geometry, material, mesh.instances.count)
      : new THREE.Mesh(geometry, material);
    object.name = `entity:${item.key}`;
    object.position.set(item.transform.position.x, item.transform.position.y, item.transform.position.z);
    object.rotation.set(item.transform.rotationEuler.x, item.transform.rotationEuler.y, item.transform.rotationEuler.z);
    object.scale.set(item.transform.scale.x, item.transform.scale.y, item.transform.scale.z);
    return object;
  }
}

/** Encodes text as UTF-8 bytes. */
function textBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

/** World-space triangles of every mesh in an export scene. */
function collectMeshes(scene: THREE.Scene): ExportMesh[] {
  scene.updateMatrixWorld(true);
  const meshes: ExportMesh[] = [];
  const vertex = new THREE.Vector3();
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
    const position = mesh.geometry.getAttribute('position');
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      positions[i * 3] = vertex.x;
      positions[i * 3 + 1] = vertex.y;
      positions[i * 3 + 2] = vertex.z;
    }
    const index = mesh.geometry.getIndex();
    const indices = new Uint32Array(index ? index.count : position.count);
    if (index) {
      for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
    } else {
      for (let i = 0; i < indices.length; i++) indices[i] = i;
    }
    meshes.push({ name: mesh.name || `mesh${meshes.length + 1}`, positions, indices });
  });
  return meshes;
}
