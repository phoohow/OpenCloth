import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { downloadTextFile } from './codec';
import { whenFabricTexturesReady } from '../render/material/fabricTextures';

/** Toggles which scene contents the exporters write. */
export interface ExportOptions {
  /** Clone the avatar mesh into the export alongside the cloth. */
  includeAvatar: boolean;
  /** Whether the export carries the fabric material definitions. */
  includeMaterial: boolean;
}

/** Cloth, plus the avatar when asked for, cloned into a scene holding only the export contents. */
function buildExportScene(scene: THREE.Scene, options: ExportOptions): THREE.Scene {
  const names = options.includeAvatar ? ['cloth', 'avatar'] : ['cloth'];
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
  await whenFabricTexturesReady();
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

/** Downloads the canvas's current pixels as a PNG file. */
export function exportScreenshot(canvas: HTMLCanvasElement, filename = 'screenshot.png'): void {
  downloadUrl(canvas.toDataURL('image/png'), filename);
}
