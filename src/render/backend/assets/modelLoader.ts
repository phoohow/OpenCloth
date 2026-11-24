import { bundledAssetUrl } from '@/base/platform/assetUrls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as THREE from 'three/webgpu';

const DEFAULT_TARGET_HEIGHT = 1.70;

const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46];

const DEFAULT_MODEL_ROUGHNESS = 0.62;

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'fbx';

export interface LoadedModel {
  group: THREE.Group;
  format: ModelFormat;
  triangleCount: number;
  bbox: THREE.Box3;
  animations: THREE.AnimationClip[];
}

export interface LoadModelOptions {
  targetHeight?: number;
  centerXY?: boolean;
  name?: string;
}

interface GltfJson {
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}

export function detectFormat(filename: string, bytes?: Uint8Array): ModelFormat {
  const ext = baseName(filename).split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'glb' || ext === 'gltf' || ext === 'obj' || ext === 'fbx') return ext;
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

  const offset = new THREE.Vector3();
  if (targetHeight > 0) offset.y = -box.min.y;
  if (centerXY) {
    const center = box.getCenter(new THREE.Vector3());
    offset.x = -center.x;
    offset.z = -center.z;
  }

  group.position.add(offset);
}

export async function loadModelFromFile(file: File, opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const buffer = await file.arrayBuffer();
  const format = detectFormat(file.name, new Uint8Array(buffer));

  if (format === 'obj') {
    return finishLoaded(new OBJLoader().parse(decodeText(buffer)), 'obj', file.name, opts, []);
  }

  if (format === 'fbx') {
    return finishLoaded(await parseFBX(buffer), 'fbx', file.name, opts, []);
  }

  if (format === 'gltf') {
    const text = decodeText(buffer);
    assertEmbeddedGltf(text, file.name);
    const parsed = await parseGLTF(text, '');
    return finishLoaded(parsed.scene, 'gltf', file.name, opts, parsed.animations);
  }

  const parsed = await parseGLTF(buffer, '');
  return finishLoaded(parsed.scene, 'glb', file.name, opts, parsed.animations);
}

export async function loadModelFromUrl(url: string, opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const response = await fetch(bundledAssetUrl(url));
  if (!response.ok) throw new Error(`Failed to fetch model: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  const format = detectFormat(url, new Uint8Array(buffer));

  if (format === 'obj') {
    return finishLoaded(new OBJLoader().parse(decodeText(buffer)), 'obj', url, opts, []);
  }

  if (format === 'fbx') {
    return finishLoaded(await parseFBX(buffer), 'fbx', url, opts, []);
  }

  const data = format === 'gltf' ? decodeText(buffer) : buffer;
  const parsed = await parseGLTF(data, directoryOf(url));
  return finishLoaded(parsed.scene, format, url, opts, parsed.animations);
}

export async function loadModelFromFiles(files: File[], opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const modelFiles = files.filter(f => /\.(glb|gltf|obj|fbx)$/i.test(f.name));
  if (modelFiles.length === 0) throw new Error('No .glb, .gltf, .obj or .fbx file found');

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
    const parsed = await parseGLTF(JSON.stringify(json), '');
    return finishLoaded(parsed.scene, 'gltf', gltfFile.name, opts, parsed.animations);
  } finally {
    for (const url of objectUrls) URL.revokeObjectURL(url);
  }
}

function roughnessFromShininess(shininess: number): number {
  return THREE.MathUtils.clamp(Math.pow(2 / (shininess + 2), 0.25), 0.03, 1);
}

function toStandardMaterial(source: THREE.Material): THREE.MeshStandardMaterial {
  const phong = source as Partial<THREE.MeshPhongMaterial>;
  const basic = source as Partial<THREE.MeshBasicMaterial>;
  return new THREE.MeshStandardMaterial({
    name: source.name,
    color: basic.color?.clone() ?? new THREE.Color(0xffffff),
    map: basic.map ?? null,
    normalMap: phong.normalMap ?? null,
    emissive: phong.emissive?.clone() ?? new THREE.Color(0),
    emissiveMap: phong.emissiveMap ?? null,
    metalness: 0,
    roughness: phong.shininess === undefined
      ? DEFAULT_MODEL_ROUGHNESS : roughnessFromShininess(phong.shininess),
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    depthWrite: source.depthWrite,
    depthTest: source.depthTest,
    vertexColors: phong.vertexColors ?? false,
    flatShading: phong.flatShading ?? false,
  });
}

export function standardizeMaterials(root: THREE.Object3D): void {
  const converted = new Map<THREE.Material, THREE.Material>();
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = list.map(material => {
      if (material instanceof THREE.MeshStandardMaterial) return material;
      const known = converted.get(material);
      if (known) return known;
      const standard = toStandardMaterial(material);
      converted.set(material, standard);
      return standard;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}

function finishLoaded(
  root: THREE.Object3D,
  format: ModelFormat,
  source: string,
  opts: LoadModelOptions,
  animations: THREE.AnimationClip[],
): LoadedModel {
  const group = new THREE.Group();
  group.name = opts.name ?? stripExtension(baseName(source));
  standardizeMaterials(root);
  group.add(root);
  normalizeGroup(group, opts);
  group.animations = animations;
  return {
    group,
    format,
    triangleCount: countTriangles(group),
    bbox: new THREE.Box3().setFromObject(group),
    animations,
  };
}

function parseGLTF(
  data: ArrayBuffer | string,
  resourcePath: string,
): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      data, resourcePath,
      gltf => resolve({ scene: gltf.scene, animations: gltf.animations ?? [] }),
      reject,
    );
  });
}

async function parseFBX(buffer: ArrayBuffer): Promise<THREE.Object3D> {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  return new FBXLoader().parse(buffer, '');
}

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
