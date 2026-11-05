import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { downloadTextFile } from './codec';
import { fbxText, usdaText, type ExportMesh } from './meshExport';
import { whenImagesReady } from '../render/imageStore';

/** Toggles which scene contents the exporters write. */
export interface ExportOptions {
  /** Clone the avatar mesh into the export alongside the cloth. */
  includeAvatar: boolean;
  /** Whether the export carries the fabric material definitions. */
  includeMaterial: boolean;
}

/** Cloth and its 3D production markings, plus the avatar when asked for. */
function buildExportScene(scene: THREE.Scene, options: ExportOptions): THREE.Scene {
  const names = options.includeAvatar
    ? ['cloth', 'avatar', 'topstitchMesh', 'trims']
    : ['cloth', 'topstitchMesh', 'trims'];
  const exportScene = new THREE.Scene();
  scene.traverse(obj => {
    if (names.includes(obj.name)) exportScene.add(obj.clone());
  });
  return exportScene;
}

/** Hands a url to the browser as a downloaded file. */
function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/** Exports the garment as binary glTF (GLB). */
export async function exportGLB(scene: THREE.Scene, filename = 'garment.glb', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): Promise<void> {
  // Every map image must carry its pixels before the exporter reads the materials.
  await whenImagesReady();
  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(buildExportScene(scene, options), (gltf) => resolve(gltf as ArrayBuffer), reject, { binary: true });
  });

  const blob = new Blob([result], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  URL.revokeObjectURL(url);
}

/** Exports the garment as a Wavefront OBJ file. */
export function exportOBJ(scene: THREE.Scene, filename = 'garment.obj', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): void {
  const objText = new OBJExporter().parse(buildExportScene(scene, options));
  downloadTextFile(filename, objText, 'text/plain');
}

/** World-space triangles of the meshes the exports carry, positions in meters. */
export function collectExportMeshes(scene: THREE.Scene, options: ExportOptions): ExportMesh[] {
  const names = options.includeAvatar
    ? new Set(['cloth', 'avatar', 'topstitchMesh', 'trims'])
    : new Set(['cloth', 'topstitchMesh', 'trims']);
  scene.updateMatrixWorld(true);
  const meshes: ExportMesh[] = [];
  scene.traverse(object => {
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
export function exportFBX(scene: THREE.Scene, filename = 'garment.fbx', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): void {
  downloadTextFile(filename, fbxText(collectExportMeshes(scene, options)), 'text/plain');
}

/** Exports the garment as a USDA text scene. */
export function exportUSD(scene: THREE.Scene, filename = 'garment.usda', options: ExportOptions = { includeAvatar: false, includeMaterial: true }): void {
  downloadTextFile(filename, usdaText(collectExportMeshes(scene, options)), 'text/plain');
}

/** Downloads the canvas's current pixels as a PNG file. */
export function exportScreenshot(canvas: HTMLCanvasElement, filename = 'screenshot.png'): void {
  downloadUrl(canvas.toDataURL('image/png'), filename);
}
