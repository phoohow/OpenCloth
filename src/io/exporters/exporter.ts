import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { downloadTextFile } from '@/io/serialization/codec';
import { fbxText, usdaText, type ExportMesh } from '@/io/exporters/meshExport';
import { whenImagesReady } from '@/render';
import { downloadBlob, downloadUrl } from '@/common/platform';

/** Toggles which scene contents the exporters write. */
export interface ExportOptions {
  /** Clone the avatar mesh into the export alongside the cloth. */
  includeAvatar: boolean;
  /** Whether the export carries the fabric material definitions. */
  includeMaterial: boolean;
}

/** Cloth and its 3D production markings, plus the avatar when asked for. */
function buildExportScene(roots: readonly THREE.Object3D[], options: ExportOptions): THREE.Scene {
  const names = options.includeAvatar
    ? ['cloth', 'avatar', 'topstitchMesh', 'trims']
    : ['cloth', 'topstitchMesh', 'trims'];
  const exportScene = new THREE.Scene();
  for (const root of roots) {
    root.traverse(obj => {
      if (names.includes(obj.name)) exportScene.add(obj.clone());
    });
  }
  return exportScene;
}

/** Exports the garment as binary glTF (GLB). */
export async function exportGLB(roots: readonly THREE.Object3D[], filename = 'garment.glb', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): Promise<void> {
  // Every map image must carry its pixels before the exporter reads the materials.
  await whenImagesReady();
  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(buildExportScene(roots, options), (gltf) => resolve(gltf as ArrayBuffer), reject, { binary: true });
  });

  downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), filename);
}

/** Exports the garment as a Wavefront OBJ file. */
export function exportOBJ(roots: readonly THREE.Object3D[], filename = 'garment.obj', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): void {
  const objText = new OBJExporter().parse(buildExportScene(roots, options));
  downloadTextFile(filename, objText, 'text/plain');
}

/** World-space triangles of the meshes the exports carry, positions in meters. */
export function collectExportMeshes(roots: readonly THREE.Object3D[], options: ExportOptions): ExportMesh[] {
  const names = options.includeAvatar
    ? new Set(['cloth', 'avatar', 'topstitchMesh', 'trims'])
    : new Set(['cloth', 'topstitchMesh', 'trims']);
  const meshes: ExportMesh[] = [];
  for (const root of roots) root.updateMatrixWorld(true);
  for (const root of roots) root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !names.has(mesh.name)) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const positions = new Float32Array(position.count * 3);
    const vertex = new THREE.Vector3();
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

/** Exports the garment as an ASCII FBX 7.4 mesh file. */
export function exportFBX(roots: readonly THREE.Object3D[], filename = 'garment.fbx', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): void {
  downloadTextFile(filename, fbxText(collectExportMeshes(roots, options)), 'text/plain');
}

/** Exports the garment as a USDA text scene. */
export function exportUSD(roots: readonly THREE.Object3D[], filename = 'garment.usda', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): void {
  downloadTextFile(filename, usdaText(collectExportMeshes(roots, options)), 'text/plain');
}

/** Downloads the canvas's current pixels as a PNG file. */
export function exportScreenshot(canvas: HTMLCanvasElement, filename = 'screenshot.png'): void {
  downloadUrl(canvas.toDataURL('image/png'), filename);
}
