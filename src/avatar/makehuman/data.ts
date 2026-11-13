/**
 * Base mesh and morph target table of the MakeHuman body, packed by `scripts/makehuman-data.mjs`.
 *
 * The packed files live under `assets/makehuman/`: Vite serves them from publicDir, and the site
 * build streams the same paths from site Storage. Loading is explicit: the app awaits
 * {@link loadMakehumanBody} before the first project is opened, tests serve the same bytes from
 * disk. Everything below it can then read {@link makehumanBodyData} synchronously.
 */

import { bundledAssetUrl } from '@/base/platform/assetUrls';

/** Site paths of the packed files under `assets/makehuman/`. */
const BODY_PATH = '/makehuman/body.bin';
const TARGETS_PATH = '/makehuman/targets.bin';
const MANIFEST_PATH = '/makehuman/manifest.json';

/** Fields of the packed manifest the decoder needs. */
interface MakehumanManifest {
  readonly vertices: number;
  readonly bodyIndices: number;
  readonly eyeIndices: number;
  readonly armWeightOffset: number;
  readonly targets: readonly string[];
  readonly targetScales: readonly number[];
  readonly joints: MakehumanJoints;
}

/** Joints of the base mesh, as the vertex indices that ring each joint. */
export interface MakehumanJoints {
  readonly leftShoulder: readonly number[];
  readonly leftElbow: readonly number[];
  readonly leftWrist: readonly number[];
  readonly rightShoulder: readonly number[];
  readonly rightElbow: readonly number[];
  readonly rightWrist: readonly number[];
  readonly leftHip: readonly number[];
  readonly leftKnee: readonly number[];
  readonly leftAnkle: readonly number[];
  readonly rightHip: readonly number[];
  readonly rightKnee: readonly number[];
  readonly rightAnkle: readonly number[];
}

/** Rest pose of the MakeHuman base mesh plus its target rows, in meters. */
export interface MakehumanData {
  /** Rest vertex positions, feet on the floor, facing +z. */
  readonly rest: Float32Array;
  /** Triangles of the body surface. */
  readonly bodyIndices: Uint32Array;
  /** Triangles of the two eyeballs, which share the body's vertex buffer. */
  readonly eyeIndices: Uint32Array;
  /** Vertex offsets per target, one row of `vertexCount * 3` per name, scaled by {@link targetScales}. */
  readonly targets: Int8Array;
  /** Target names, in row order. */
  readonly names: readonly string[];
  /** Meters per unit of each target row. */
  readonly targetScales: Float32Array;
  readonly vertexCount: number;
  /** Per-vertex weight of the left and right arm chains, 0..1, interleaved. */
  readonly armWeights: Float32Array;
  readonly joints: MakehumanJoints;
}

let loaded: MakehumanData | null = null;
let pending: Promise<MakehumanData> | null = null;

/** The body data, which must have finished loading. */
export function makehumanBodyData(): MakehumanData {
  if (!loaded) throw new Error('MakeHuman body data has not loaded yet');
  return loaded;
}

/** Fetches the packed body, target table and manifest once; every later call reuses the result. */
export function loadMakehumanBody(): Promise<MakehumanData> {
  pending ??= Promise.all([
    fetchBinary(bundledAssetUrl(BODY_PATH)),
    fetchBinary(bundledAssetUrl(TARGETS_PATH)),
    fetchManifest(bundledAssetUrl(MANIFEST_PATH)),
  ])
    .then(([body, targets, manifest]) => parseMakehumanData(body, targets, manifest))
    .then((data) => {
      loaded = data;
      return data;
    });
  return pending;
}

/** Decodes the packed body and target buffers using their manifest. */
function parseMakehumanData(
  body: ArrayBuffer,
  targets: ArrayBuffer,
  manifest: MakehumanManifest,
): MakehumanData {
  const { vertices, bodyIndices, eyeIndices, armWeightOffset, joints } = manifest;
  const floats = vertices * 3;
  const rest = new Float32Array(body.slice(0, floats * 4));
  const bodyIndexBytes = bodyIndices * 4;
  const eyeIndexBytes = eyeIndices * 4;
  const indexOffset = floats * 4;
  const bodyIndexData = new Uint32Array(body.slice(indexOffset, indexOffset + bodyIndexBytes));
  const eyeIndexData = new Uint32Array(
    body.slice(indexOffset + bodyIndexBytes, indexOffset + bodyIndexBytes + eyeIndexBytes),
  );
  // The packed bytes store each arm weight as a 0..255 share of the vertex.
  const quantized = new Uint8Array(body, armWeightOffset, vertices * 2);
  const armWeights = new Float32Array(vertices * 2);
  for (let i = 0; i < armWeights.length; i++) armWeights[i] = quantized[i]! / 255;
  return {
    rest,
    bodyIndices: bodyIndexData,
    eyeIndices: eyeIndexData,
    targets: new Int8Array(targets),
    names: manifest.targets,
    targetScales: Float32Array.from(manifest.targetScales),
    vertexCount: vertices,
    armWeights,
    joints,
  };
}

/** Reads one packed asset, with a readable error when the asset is missing. */
async function fetchAsset(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MakeHuman data request failed (${response.status}): ${url}`);
  return response;
}

/** Reads a binary asset as raw bytes. */
async function fetchBinary(url: string): Promise<ArrayBuffer> {
  return (await fetchAsset(url)).arrayBuffer();
}

/** Reads the manifest that describes the two binary buffers. */
async function fetchManifest(url: string): Promise<MakehumanManifest> {
  return (await (await fetchAsset(url)).json()) as MakehumanManifest;
}
