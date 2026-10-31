import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { bundledAssetUrl } from '../core/assets/bundledAssetUrls';

/** Supported model file formats. */
export type ModelFormat = 'glb' | 'gltf' | 'obj';

/** A loaded model, normalized and ready to be added to the scene. */
export interface LoadedModel {
  group: THREE.Group;
  format: ModelFormat;
  triangleCount: number;
  /** World-space bounds after normalization. */
  bbox: THREE.Box3;
}

/** Normalization and naming applied while loading. */
export interface LoadModelOptions {
  /** Target height in meters; 0 disables scaling and grounding. */
  targetHeight?: number;
  /** Centers the model on the x/z origin. */
  centerXY?: boolean;
  /** Group name; defaults to the file or URL base name without extension. */
  name?: string;
}

const DEFAULT_TARGET_HEIGHT = 1.70;
// ASCII 'glTF'
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46];

/** Resolves the format from the extension, falling back to GLB magic bytes. */
export function detectFormat(filename: string, bytes?: Uint8Array): ModelFormat {
  const ext = baseName(filename).split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'glb' || ext === 'gltf' || ext === 'obj') return ext;
  if (filename.startsWith('data:')) {
    const comma = filename.indexOf(',');
    const mime = (comma > 5 ? filename.slice(5, comma) : '').split(';')[0]?.toLowerCase() ?? '';
    if (mime.includes('gltf-binary')) return 'glb';
    if (mime.includes('gltf+json') || mime.includes('json')) return 'gltf';
    if (mime.includes('obj')) return 'obj';
  }
  if (bytes && GLB_MAGIC.every((byte, i) => bytes[i] === byte)) return 'glb';
  if (bytes) {
    const head = new TextDecoder().decode(bytes.slice(0, 128)).trimStart();
    if (head.startsWith('{')) return 'gltf';
    if (/^(#|v\s|o\s|g\s|mtllib\s)/.test(head)) return 'obj';
  }
  throw new Error(`Unknown model format: ${filename}`);
}

/** Sums triangles over all meshes, indexed or not. */
export function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    const vertexCount = mesh.geometry.index ? mesh.geometry.index.count : position.count;
    total += Math.floor(vertexCount / 3);
  });
  return total;
}

/** Scales the group to targetHeight and grounds/centers it via group.scale/position. */
export function normalizeGroup(group: THREE.Group, opts: Pick<LoadModelOptions, 'targetHeight' | 'centerXY'> = {}): void {
  const targetHeight = opts.targetHeight ?? DEFAULT_TARGET_HEIGHT;
  const centerXY = opts.centerXY ?? true;

  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  if (targetHeight > 0 && size.y > 1e-6) {
    group.scale.multiplyScalar(targetHeight / size.y);
    box.setFromObject(group);
  }

  // Offsets derive from the scaled box so the final min.y and x/z center are exact.
  const offset = new THREE.Vector3();
  if (targetHeight > 0) offset.y = -box.min.y;
  if (centerXY) {
    const center = box.getCenter(new THREE.Vector3());
    offset.x = -center.x;
    offset.z = -center.z;
  }
  group.position.add(offset);
}

/** Loads a single .glb / .gltf / .obj file; .gltf buffers must be embedded. */
export async function loadModelFromFile(file: File, opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const buffer = await file.arrayBuffer();
  const format = detectFormat(file.name, new Uint8Array(buffer));

  if (format === 'obj') {
    return finishLoaded(new OBJLoader().parse(decodeText(buffer)), 'obj', file.name, opts);
  }
  if (format === 'gltf') {
    const text = decodeText(buffer);
    assertEmbeddedGltf(text, file.name);
    const root = await parseGLTF(text, '');
    return finishLoaded(root, 'gltf', file.name, opts);
  }
  const root = await parseGLTF(buffer, '');
  return finishLoaded(root, 'glb', file.name, opts);
}

/** Loads a model over HTTP; sibling .gltf resources resolve against the URL directory. */
export async function loadModelFromUrl(url: string, opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const response = await fetch(bundledAssetUrl(url));
  if (!response.ok) throw new Error(`Failed to fetch model: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  const format = detectFormat(url, new Uint8Array(buffer));

  if (format === 'obj') {
    return finishLoaded(new OBJLoader().parse(decodeText(buffer)), 'obj', url, opts);
  }
  const data = format === 'gltf' ? decodeText(buffer) : buffer;
  const root = await parseGLTF(data, directoryOf(url));
  return finishLoaded(root, format, url, opts);
}

/** Loads a multi-file .gltf by mapping sibling files to object URLs. */
export async function loadModelFromFiles(files: File[], opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const modelFiles = files.filter(f => /\.(glb|gltf|obj)$/i.test(f.name));
  if (modelFiles.length === 0) throw new Error('No .glb, .gltf or .obj file found');

  const gltfFile = modelFiles.find(f => f.name.toLowerCase().endsWith('.gltf'));
  if (!gltfFile) return loadModelFromFile(modelFiles[0], opts);

  const json = JSON.parse(decodeText(await gltfFile.arrayBuffer())) as GltfJson;
  const byName = new Map(files.map(f => [f.name, f]));
  const objectUrls: string[] = [];
  for (const entries of [json.buffers ?? [], json.images ?? []]) {
    for (const entry of entries) {
      const uri = entry.uri;
      if (!uri || isAbsoluteUri(uri)) continue;
      const sibling = byName.get(baseName(uri));
      if (!sibling) throw new Error(`Missing resource "${baseName(uri)}" for ${gltfFile.name}`);
      entry.uri = URL.createObjectURL(sibling);
      objectUrls.push(entry.uri);
    }
  }
  try {
    const root = await parseGLTF(JSON.stringify(json), '');
    return finishLoaded(root, 'gltf', gltfFile.name, opts);
  } finally {
    for (const url of objectUrls) URL.revokeObjectURL(url);
  }
}

/** The .gltf json entries that can reference sibling resource files. */
interface GltfJson {
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}

/** Wraps a loader result in a named, normalized group. */
function finishLoaded(root: THREE.Object3D, format: ModelFormat, source: string, opts: LoadModelOptions): LoadedModel {
  const group = new THREE.Group();
  group.name = opts.name ?? stripExtension(baseName(source));
  group.add(root);
  normalizeGroup(group, opts);
  return {
    group,
    format,
    triangleCount: countTriangles(group),
    bbox: new THREE.Box3().setFromObject(group),
  };
}

function parseGLTF(data: ArrayBuffer | string, resourcePath: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(data, resourcePath, gltf => resolve(gltf.scene), reject);
  });
}

/** Rejects .gltf files whose buffers or images reference sibling files. */
function assertEmbeddedGltf(text: string, filename: string): void {
  const json = JSON.parse(text) as GltfJson;
  const external = [...json.buffers ?? [], ...json.images ?? []]
    .some(entry => entry.uri !== undefined && !isAbsoluteUri(entry.uri));
  if (external) throw new Error(`${filename} references sibling files; use loadModelFromFiles`);
}

function isAbsoluteUri(uri: string): boolean {
  return uri.startsWith('data:') || uri.startsWith('blob:') || /^[a-z]+:/i.test(uri);
}

function decodeText(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

function baseName(pathOrUrl: string): string {
  const withoutQuery = pathOrUrl.split(/[?#]/)[0];
  return withoutQuery.split(/[\\/]/).pop() ?? withoutQuery;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function directoryOf(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0];
  return withoutQuery.slice(0, withoutQuery.lastIndexOf('/') + 1);
}
